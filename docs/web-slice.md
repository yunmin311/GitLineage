# Web slice — Phase 2 and Phase 3

A production-shaped HTTP boundary over the analyzer, a separate presentation
layer, and the R3.1 subject-centric one-hop Explorer rendered from real analyzer
output. URL-first, cache-aware, responsive, buildable, and — since Phase 3 —
asynchronous.

The core provenance contract is **frozen**. Neither phase changed any ontology,
collector, evidence semantic, resolver behaviour or graph schema field to make
the UI easier. Every visual problem found in real data was fixed in the
presentation and layout layer, and the deviations are listed at the end.

- **Phase 2** built the production bundle, deployment configuration, revision
  metadata and the Explorer interactions.
- **Phase 3** decoupled analysis from request lifetime, after the public
  deployment exposed a real blocker: a cold analysis of a large repository takes
  minutes, which outlives any reverse-proxy or CDN request deadline.

## Running it

```bash
npm run serve                      # dev, unbundled client, http://127.0.0.1:8080
npm run build                      # production bundle → dist/web
npm start                          # build, then serve the bundle
npm run serve:api-only             # API without a client at all

npm run check                      # typecheck (server + browser scripts) + tests
npm run test:web                   # live client checks against real repositories
npm run shots                      # headless capture into docs/screenshots
```

`npm run test:web` and `npm run shots` accept `GITLINEAGE_WEB_TEST_CACHE` and
`GITLINEAGE_SHOT_CACHE` to reuse a warm cache. A cold analysis of a large
repository takes minutes and GitHub rate-limits repeated cold analyses of the
same repositories, so a warm cache is the difference between a 40-second run and
a failing one.

## Data flow

```
/owner/repo  (client route)
      │
      └── GET /api/view/<owner>/<repo>    → presentation view-model
                                                 │
                                                 ▼
                                           buildView(graph)
                                                 │
                                                 ▼
                                     layout / labels / visibility / counts
                                                 │
                                                 ▼
                                           R3.1 SVG renderer
                                                 │
                              click edge → Evidence Drawer

GET /api/graph/<owner>/<repo> stays available and unchanged
```

The canonical graph is the source of truth. The view-model is derived from it and
adds no field back into it; `test/view-model.test.ts` asserts this by comparing
the graph's JSON before and after `buildView`.

The client calls **only** `/api/view`. It does not also fetch `/api/graph`,
because that would double the analysis wait for a result the server has already
produced. `/api/graph` remains the contract surface and is still served.

## Async analysis (Phase 3)

### The blocker this solves

A cold analysis is minutes of real work, and a reverse proxy or CDN will not hold
a request open that long. Measured through a real Cloudflare tunnel on the public
deployment:

| Repository | Cold analysis | Old behaviour |
| --- | --- | --- |
| `grpc/grpc` | 121–311s | initiating request died with `524` |
| `vitest-dev/vitest` | 121–223s | initiating request died with `524` |

The analysis itself always completed; only the connection was cut. Raising a
timeout would not fix it, and pre-warming a cache only moves the problem. So
analysis became a job that owns its own lifecycle.

### Job API

`POST /api/analysis/<owner>/<repo>`

Starts or joins an analysis and returns immediately. It never holds the
connection for the duration of the work.

A valid revision-aware artifact already existed:

```json
200 OK
{
  "status": "complete",
  "cacheHit": true,
  "resolvedRevision": "e9c026c611c1…",
  "repository": "octocat/spoon-knife",
  "graphUrl": "/api/graph/octocat/spoon-knife",
  "viewUrl": "/api/view/octocat/spoon-knife"
}
```

Analysis is required:

```json
202 Accepted
{
  "status": "queued",
  "jobId": "c1d0231c-3024-47b0-91c0-09a3b042ec61",
  "repository": "grpc/grpc",
  "statusUrl": "/api/analysis/jobs/c1d0231c-3024-47b0-91c0-09a3b042ec61",
  "retryAfterMs": 1500,
  "joined": false
}
```

`joined: true` means this request attached to a job that was already running
rather than starting one. `Retry-After` is sent as a header too.

`GET /api/analysis/jobs/<jobId>`

```json
{
  "ok": true,
  "data": {
    "jobId": "c1d0231c-…",
    "status": "collecting",
    "repository": "grpc/grpc",
    "resolvedRevision": "d04df218e898…",
    "schemaVersion": "2.0.0",
    "analyzerVersion": "0.2.0",
    "error": null
  },
  "meta": { "phases": ["queued", "…", "complete", "failed"], "retryAfterMs": 1500 }
}
```

### State machine

```
queued → resolving → collecting → resolving_relationships
       → validating → publishing → complete
```

or, from any non-terminal phase, `failed`.

Transitions are enforced, not documented: an out-of-order phase report throws
rather than becoming a state a client can observe. Terminal is terminal.

Every phase is emitted by the analyzer itself at an existing pipeline stage
boundary, through an optional `onPhase` hook. Nothing is interpolated and there
is **no percentage anywhere** — between two stages there is nothing honest to
show. The client's step list is asserted equal to the server's list by
`test/web-analysis-client.test.ts`.

### Deduplication

Job identity derives from the work, not the request:

```
owner + repo + resolved revision + graph schema version + analyzer version
  → sha256, truncated
  → one active computation
```

Two visitors asking for the same repository at the same revision under the same
contract join one job instead of launching a second clone and a second pass over
the GitHub API. When the revision cannot be resolved the key uses `*`, which is
deliberately coarser and therefore safe: it can only ever join requests that
share an owner, a name and a contract version, never split one.

Creating a job is asynchronous, so two *simultaneous* requests would both see
"no active job". The scheduler therefore claims the dedup key synchronously, in
the same turn as the active-job check, before any `await`.

The revision-aware artifact cache still does the real caching. Deduplication
only stops duplicate *work*.

### Surviving disconnects

The job owns the analyzer promise. Closing the browser, a proxy timing out, or
the edge dropping a connection cannot stop it, because none of them own the
promise. A completed artifact remains available for subsequent requests.

### Restart semantics

Job state is one JSON file per job, written atomically, in a directory **outside
the Git working tree**. This is deliberately not Redis: single-node deployment,
and the expensive work is already deduplicated by the artifact cache, so the
registry only has to survive a restart well enough to know what was in flight.

- **Completed work derives truth from the artifact cache, not the registry.** A
  `complete` record is a reporting convenience; the server re-probes the cache on
  every request, so a lost registry cannot lose a result and a stale registry
  cannot invent one.
- **A job that was in flight when the process died is not left running.** It is
  failed with `interrupted_by_restart`, which is retryable.
- **Recovery runs at startup, not on the first request.** Calling it from request
  handlers alone is not enough: a server that starts and is then asked nothing
  would leave an orphaned job marked in-flight forever. That was a real bug found
  by the restart test, and `test/web-jobs.test.ts` now covers it.
- **A corrupt or truncated job file is discarded, never trusted.** A `.tmp`
  leftover from an interrupted write is never read.
- **Job ids are server-generated UUIDs.** Anything else is a `404`, so a crafted
  id cannot traverse out of the job directory.

### Abuse protection

A public endpoint will happily start unbounded cold analyses, each costing
GitHub API quota and local compute. Cached reads are cheap and stay unmetered;
only *new expensive work* is counted.

| Control | Config | Default |
| --- | --- | --- |
| Analyses per client address | `GITLINEAGE_RATE_LIMIT_PER_IP` | 5 |
| Window | `GITLINEAGE_RATE_LIMIT_WINDOW_MS` | 60000 |
| Concurrent analyses (global) | `GITLINEAGE_MAX_CONCURRENT_ANALYSES` | 2 |
| Bounded queue depth | `GITLINEAGE_MAX_QUEUE_DEPTH` | 20 |
| Trusted proxy header | `GITLINEAGE_TRUSTED_PROXY_HEADER` | none |
| Peers allowed to set it | `GITLINEAGE_TRUSTED_PROXY_PEERS` | none |
| Metering off switch | `GITLINEAGE_RATE_LIMIT_ENABLED` | 1 |
| Revision probe ceiling | `GITLINEAGE_PROBE_TIMEOUT_MS` | 8000 |

Order matters, and is the whole design:

1. an artifact is checked first — free, no token spent;
2. then an existing job — free, no token spent, the caller joins it;
3. only then is a rate-limit token spent on genuinely new work.

Joining an in-flight job is therefore never punished, even with the budget
exhausted. That is the abuse-relevant case: a visitor reloading the page must
not be refused because of a job that is already running for them.

Refusals are typed and carry `Retry-After` as both header and body field:

| Situation | Status | `error.code` |
| --- | --- | --- |
| Per-address budget spent | 429 | `analysis_rate_limited` |
| Queue full | 503 | `analysis_overloaded` |
| Analysis not finished yet | 202 | `analysis_pending` |

Client identity comes from the socket, which cannot be forged. A proxy header is
consulted **only** when the deployment declares that header trustworthy, and then
only its first hop. Trusting `X-Forwarded-For` unconditionally would let any
caller forge an identity and bypass the per-IP budget entirely.

No accounts, billing or authentication are built.

### The result endpoints stayed canonical

`/api/graph` and `/api/view` remain completed-result endpoints. Their successful
representation is unchanged: a v2 canonical graph or its view-model. When no
artifact exists they return the typed `analysis_pending` response rather than
blocking, which is what actually removes the `524`.

```json
202 Accepted
{
  "ok": false,
  "error": { "code": "analysis_pending", "message": "analysis is not finished…; poll the job it names" },
  "meta": {
    "jobId": "c1d0231c-…",
    "status": "queued",
    "statusUrl": "/api/analysis/jobs/c1d0231c-…",
    "retryAfterMs": 1500,
    "joined": false
  }
}
```

The canonical graph is never turned into a job representation.

### Client lifecycle

```
landing → paste → navigate immediately to /owner/repo
        → real server phases → Explorer when ready
```

- The route is shareable throughout, and a second browser opening the same URL
  attaches to the existing job.
- Progress shows the real phases, never a fake percentage.
- Polling is the whole transport. No WebSocket, no SSE; neither materially
  simplified anything, and polling is enough.
- Poll delay backs off gently and is bounded at 5s, and polling stops on any
  phase the client does not recognise, so it cannot spin forever.

## Client structure

The browser code is split so the behaviour that must not drift is testable
without a DOM. Every module under `src/web/client/lib/` is pure and is unit-tested
in Node; `app.js` is the only file that touches the document.

| Module | Responsibility |
| --- | --- |
| `lib/url-state.mjs` | `/owner/repo` parsing, repository input normalisation, shareable query state |
| `lib/geometry.mjs` | slot layout, hub wrapping, parallel-edge bowing, label anchors, fit/zoom |
| `lib/search.mjs` | node and relationship search, layer filtering, bundle expansion, orphan-bundle detection |
| `lib/analysis.mjs` | job start/status parsing, phase text, poll cadence, refusal wording |
| `lib/evidence-links.mjs` | real GitHub URLs with line anchors, and the similarity disclaimer |
| `app.js` | the only DOM-aware file: render, interaction, routing |

`*.d.mts` files declare the runtime shape of the `.mjs` modules, so a contract
change breaks the type check here rather than silently breaking the UI.

## API

### `GET /api/graph/<owner>/<repo>`

Returns the canonical `LineageGraph` **byte-for-byte as the analyzer produced
it**. No view fields, no renaming, no wrapper inside `data`.

```json
{
  "ok": true,
  "data": { "schemaVersion": "2.0.0", "graph": {}, "entities": [],
            "relationships": [], "evidence": [], "diagnostics": [] },
  "meta": { "endpoint": "canonical-graph", "note": "canonical LineageGraph, unmodified" }
}
```

Before serving, the graph is re-validated. A graph that fails its own contract
returns `500 contract_violation` rather than being published, and a graph at an
unsupported `schemaVersion` is refused the same way.

### `GET /api/view/<owner>/<repo>`

Returns the presentation view-model derived from the same graph.

| Field | Meaning |
| --- | --- |
| `subject`, `nodes[]` | nodes with `slot`, `label`, `fact`, `isSubject`, `isPackage` |
| `edges[]` | `directed`, `arrow`, `arrowheadAt`, `family`, `label`, `subjectRole`, `visibility`, `evidenceCount` |
| `primaryEdgeCount` / `bundledEdgeCount` / `bundles[]` | density handling, with real counts |
| `statusCounts`, `familyCounts` | evidence-status and relation-family totals |
| `directionContract` | `directional[]` and `symmetric[]`, straight from the ontology |
| `evidenceByRelationship{}` | the real `Evidence` records, for the drawer |
| `empty{}`, `partial{}` | terminal states |

Both analysis endpoints return **revision and freshness metadata**, so "reload
gives the same result" is a checkable claim rather than an implication:

| `meta` field | Meaning |
| --- | --- |
| `cacheHit` | the artifact came from the version-keyed cache |
| `resolvedRevision` | the exact commit the artifact describes |
| `resolvedRef` / `defaultBranch` | what was resolved, when known |
| `elapsedMs` | server-side time for this request |

### `GET /api/contract`

Publishes `graphSchemaVersion`, `supportedGraphSchemaVersions`,
`analyzerVersion` and the direction contract, so a client never has to hard-code
them.

### `GET /healthz`

Status plus schema and analyzer versions and the public configuration.

Errors use one envelope shape: `{ ok: false, error: { code, message, detail } }`
with `400` for an unusable repository reference, `202 analysis_pending` when no
artifact exists yet, `429` when the analysis budget is spent, `503` when the
queue is full, `502` when analysis fails, and `500` for a contract violation.

## Canonical graph → view-model

| Canonical | View-model | Why |
| --- | --- | --- |
| `relationship.directed` | `edge.directed`, `edge.arrow`, `edge.arrowheadAt` | Copied verbatim. `arrow` is `'none'` for every symmetric type and never carries an `arrowheadAt`. |
| `relationship.type` | `edge.family`, `edge.relationLabel` | Visual grouping only. |
| `relationship.status` | `edge.status`, `statusCounts` | Unchanged. |
| `relationship.source/target` | `edge.source/target`, `subjectRole` | `subjectRole` is `outbound`/`inbound`/`peer` and affects **wording only**. |
| — | `node.slot` | Derived from the *semantics* of the connecting edge: provenance arriving at the subject sits above, a symmetric peer has no vertical slot. |
| `evidenceIds` | `evidenceCount`, `evidenceByRelationship[edgeId]` | The real records, locator and observed text intact. |
| `relationships` | `visibility`, `bundles[]` | Density handling. Nothing is dropped. |

Two rules are enforced by tests rather than convention:

1. **Arrow direction comes from the relationship.** `edgeGeometry()` receives the
   arrow and places it. There is no code path in `app.js` that reads the selected
   node to decide direction.
2. **Symmetric endpoint order is a storage detail.** Focusing either endpoint
   re-draws the same edges with the same arrows; only dimming changes.

## Route behaviour

`/<owner>/<repo>` is the primary route, so replacing the domain later is a DNS
change with no routing work. `/` is the landing page. `parseRoute` accepts
exactly two segments for a repository route, validates the owner and name, and
rejects everything else with `404`.

The whole frame is in the query string, so a shared link reproduces it exactly:

| Parameter | State |
| --- | --- |
| `edge` | selected relationship |
| `node` | selected node |
| `layers` | active layer set (absent means all on) |
| `q` | search query |
| `bundles` | expanded bundle keys |
| `depth` | analysis depth |

Defaults are omitted rather than written, and untrusted values are validated on
read: a `depth` that is not a small integer is discarded, and a stale selection
is dropped rather than leaving an empty drawer open. `Esc` clears the selection.

## Configuration

Everything deployment-specific is read from the environment, so the same build
runs locally, in a container and behind a public domain. **No localhost is
assumed anywhere** — `test/web-build.test.ts` asserts the bundle contains neither
`localhost` nor `127.0.0.1`, and the live validation checks that no rendered link
points at a hard-coded host.

| Variable | Default | Meaning |
| --- | --- | --- |
| `GITLINEAGE_HOST` | `127.0.0.1` | bind address |
| `GITLINEAGE_PORT`, then `PORT` | `8080` | port. The project-specific variable wins, so a stray `PORT` from a platform cannot redirect the service. |
| `GITLINEAGE_CACHE` | `.cache` | artifact cache root |
| `GITLINEAGE_CLIENT_DIR` | `src/web/client` | static client root |
| `GITLINEAGE_NO_CLIENT` | off | API-only mode |
| `GITLINEAGE_DEPTH` | `200` | analysis depth |
| `GITLINEAGE_MAX_CANDIDATES` | `12` | candidate repositories per analysis |
| `GITLINEAGE_NO_GIT` | off | disable the git runner |
| `GITLINEAGE_NO_REGISTRY` | off | disable registry lookups |
| `GITLINEAGE_EXTRA_ALLOW_HOSTS` | empty | comma-separated outbound allowlist extension |
| `GITLINEAGE_ANALYSIS_TIMEOUT_MS` | `900000` | per-request analysis budget |
| `GITLINEAGE_PUBLIC_ORIGIN` | unset | public base URL, documentation only |
| `NODE_ENV` | `development` | reported by `/healthz` |

CLI flags override the environment: `--host`, `--port`, `--cache`,
`--client <dir>`, `--no-client`, `--depth`, `--max-candidates`, `--timeout-ms`.

## Production build

`build.mjs` bundles the client with esbuild into `dist/web/`:

```
dist/web/index.html            shell, pointing at the bundle
dist/web/app.css
dist/web/assets/app.js         minified, no sourcemap
dist/web/build-manifest.json   build time and asset sizes
```

The build **fails** if it does not rewrite the module reference, so a shell left
pointing at unbundled source is a build error rather than a silent regression.

Two deployment facts are load-bearing and covered by `test/web-build.test.ts`:

- **Asset URLs are root-absolute.** The shell is also served at `/owner/repo`,
  where a relative `./app.css` would resolve to `/owner/app.css` and 404.
- **The asset allowlist covers the bundle path.** The server must serve
  `/assets/app.js`, not just `/app.js`; otherwise the production bundle 404s
  while dev works.

## Screenshots

Real repositories, real analyzer output, real production bundle, headless
Chromium. Set `GITLINEAGE_SHOT_CACHE` to reuse a warm cache.

| File | Case |
| --- | --- |
| `00-landing.png` | the landing, before any repository is chosen |
| `01-fork-shared-history-exact-content.png` | `nachocebey/is`: arrowhead for the directional fork, none for the symmetric edges |
| `01-…-evidence-drawer.png` | the real `github_fork_metadata` record |
| `01-…-search.png`, `01-…-layers.png` | search and the layers popover, both reflected in the URL |
| `01-…-phone.png` | the same frame at 420px, where the drawer is a sheet |
| `02-submodules-and-shared-history.png` | `grpc/grpc`: 25 lineage edges, 20-node hub laid out as a grid |
| `03-declared-attribution-bundled.png` | `vitest-dev/vitest`: declared fork in a README, 101 secondary edges bundled |
| `04-empty-strong-lineage.png` | `octocat/Spoon-Knife`: no evidence-backed lineage |

Every capture reports node count, edge count, **arrowhead count**, symmetric-edge
count, bundle rows, horizontal overflow and drawer evidence cards, so a
regression shows up as a number rather than as somebody noticing a picture.

## Live validation

`test/web/live-phase2-validation.ts` drives the real bundle against the real
server against real GitHub and asserts 26 behaviours, including:

- a cold `/owner/repo` route reaches the explorer and draws the same frame as an
  in-app search;
- a shared link reproduces the same selection from cold;
- the second load is labelled `cached`;
- a symmetric relationship renders with no arrowhead while its directed
  neighbour keeps one;
- the drawer carries real evidence records;
- a narrow viewport still shows a usable graph;
- no link points at a hard-coded host, and the client logs no uncaught errors.

## Where real data forced a deviation from R3.1

Five, all handled in the presentation and layout layer.

**1. One hop is not seven edges.** R3.1 assumes roughly seven relationships.
`vitest-dev/vitest` produces 102 one-hop relationships, 83 of them
`depends_on` from 24 manifest files. Drawing them would bury the single declared
fork that is the actual answer.

Resolution: the view-model marks edges `primary` or `bundled`. Lineage-bearing
types are drawn up to `PRIMARY_DRAW_CAP = 30`; the remainder, plus all
`depends_on` and `references`, collapse into bundles that show a real count and
expand on click. The status line states `1 shown / 102 one-hop / 102
relationships` and the bundle panel explains what was grouped. `grpc/grpc` keeps
its 25 lineage edges drawn, because they *are* that repository's story.

**2. Several relationships can join the same pair of repositories.** A fork also
shares history and identical content with its upstream, so three edges connect
the same two nodes. R3.1's sample has one edge per pair.

Resolution: parallel edges are bowed apart by a perpendicular offset, and each
label is anchored at a different position along its own curve.

**3. Slot assignment is not sufficient for a repository with several roles.**
`nachocebey/is` is simultaneously a fork source, a history peer and an identity
peer of `sindresorhus/is`. The slot rule resolves ancestry first, so all three
edges meet at the same slot.

Resolution: no semantic compromise was made. The slot stays correct for the
directional edge, and the symmetric edges are drawn to the same node without
arrows, so they cannot be misread as direction.

**4. A hub is not a line.** `grpc/grpc` has 20 `uses_submodule` peers in one
slot. A single column overprints every label and runs off the canvas.

Resolution: each slot wraps into a grid once it exceeds `SLOT_WRAP_AFTER`
members, and the grid is pushed clear of the subject by its own half-extent, so
growing a slot moves it outwards instead of into the subject. `grpc/grpc` lays
out as a readable 4×5 grid with no overlapping node boxes.

**5. Label collision is predicted by node degree, not by parallel-edge count.**
Those 20 submodule edges are 20 *distinct* pairs, so each is a parallel fan of
one and a per-pair label rule labels all 20 — whose mid-line labels then land on
top of each other.

Resolution: labels are thinned by node degree. An edge touching a node above
`LABEL_DEGREE_LIMIT` keeps its label in the DOM but hidden, revealed by CSS on
hover or selection. Redrawing on hover was tried first and rejected: rebuilding
the canvas under the pointer re-fires the event in a loop.

**6. An all-bundled graph is visually indistinguishable from an empty one.**
`expressjs/express` has 48 real one-hop relationships — 44 `depends_on` and 4
`references` — and every one of them belongs to a bulk family that is always
bundled. The default view therefore drew *nothing*: a lone subject node, which is
exactly how a repository with no lineage looks. 48 real relationships and zero
real relationships rendered the same way.

Resolution: when nothing else would be drawn, each orphan bundle gets a
lightweight representative card on the canvas, connected to the subject by an
arrowless elbow:

```
expressjs/express
        │
        ├──── Dependencies ×44
        └──── References ×4
```

The card is deliberately not a node: dashed outline, a count, and a connector with
no arrowhead, because a bundle is a count of several relationships and has no
direction. Clicking it expands the real relationships, and the expansion is
recorded in the URL, so a shared link restores it. Only orphan bundles get a card,
so a graph that already draws something is unaffected, and the canonical graph is
untouched — this is layout only.

## Bugs found by the live validation

Each of these was a real defect, found because the checks drive the real browser
rather than asserting on the source.

| Defect | Cause |
| --- | --- |
| The production bundle 404'd | the server's asset allowlist only knew `/app.js`, not `/assets/app.js` |
| Every asset 404'd on a cold `/owner/repo` load | relative `./app.css` resolved against the repository path |
| The landing 404'd at `/` | `parseRoute` treated the root as not-found |
| Hidden panels stayed on screen | a `display: flex` layout rule beat the UA's `[hidden]` rule |
| No SVG text rendered at all | `svgEl()` silently dropped its children argument |
| Clicks on a relationship stopped working | hidden labels still hit-tested, swallowing clicks meant for the line |
| A shared link opened no drawer | the drawer was only rendered from a click, never restored from URL state |
| Hovering a relationship froze the page | hover triggered `draw()`, which rebuilt the DOM under the pointer |
| A restart left an orphaned job marked in-flight forever | recovery ran only on the first request, so a server asked nothing never recovered |
| Two simultaneous cold requests started two analyses | creating a job is async, so both saw "no active job" before either had registered |
| A fast analysis showed no progress at all | the progress view was only revealed on the first poll, which for a quick job was already `complete` |
| A second browser re-running a cached repository got `202` | without a known revision the dedup key could not find the artifact; a completed run's revision is now used |

## Deployment

The service is deployed as **one long-running Node process on one node**, not as
a serverless function: a cold analysis is minutes of real work and has no request
or process lifetime limit.

| Artifact | Purpose |
| --- | --- |
| `Dockerfile` | Two-stage image: builds the client bundle, prunes dev dependencies, installs `git`, runs unprivileged with a healthcheck |
| `gitlineage.env.example` | Every setting, with the secure default stated and the reason |
| `deploy/gitlineage.service` | systemd unit: graceful `SIGTERM` drain, always-restart, hardened filesystem |
| `deploy/RUNBOOK.md` | Host selection, install, safe-redeploy rule, and what survives what |

State lives on explicit persistent paths that are never inside the checkout:

| Path | Contents | Survives redeploy |
| --- | --- | --- |
| `GITLINEAGE_CACHE` | revision-aware graph artifacts | yes |
| `GITLINEAGE_JOB_STORE` | durable job records | yes |
| `TMPDIR` | disposable git scratch | no, by design |

`deploy/RUNBOOK.md` states the persistence matrix explicitly, because "did the
deploy delete my cache" is the question that actually gets asked.

`test/deploy-config.test.ts` asserts that every variable the env template
documents is read by the code, that the four settings the code reads but the
template might omit stay documented, and that the secure defaults are the secure
ones — the trusted-proxy header defaults to unset.

### Client IP

The server trusts the socket address unless **both** a forwarding header and the
peers allowed to set it are declared:

| Setting | Meaning |
| --- | --- |
| `GITLINEAGE_TRUSTED_PROXY_HEADER` | unset | the header a proxy sets, e.g. `x-forwarded-for` |
| `GITLINEAGE_TRUSTED_PROXY_PEERS` | socket addresses or CIDRs allowed to speak for a client |

Both are required, and the second is what makes the first safe. A forwarding
header is attacker-controlled: if the socket peer is not checked, any caller can
claim another address and spend that address's budget. Declaring a header with no
peers leaves it **inert**, which costs per-client accuracy but never costs
security.

Note the third state, which is easy to reach by accident. With a reverse proxy in
front and the header disabled, every visitor arrives from the proxy's own
loopback address, so the whole site shares **one** budget. That is why the OCI
deployment declares both `x-forwarded-for` and `127.0.0.1/32`.

### Upstream rate limits

A 403 from GitHub has two completely different meanings, and conflating them is
what made a production failure take four minutes and say nothing useful:

| Response | Meaning | Action |
| --- | --- | --- |
| `403`, `x-ratelimit-remaining > 0` | authorization refused | fail immediately, `upstream_forbidden`, not retryable |
| `403`/`429`, `remaining: 0` | primary rate limit | fail immediately with the reset time, `upstream_rate_limited`, retryable |
| `429` with `Retry-After` | secondary rate limit | wait the stated time if it is short, then retry once |

`Retry-After` is honoured in both its numeric and HTTP-date forms. The longest
wait worth sitting through is `LIMITS.http.maxRateLimitWaitMs` (5s): a secondary
limit clears in seconds and is worth waiting for, while a primary limit resets
on the hour, and sleeping through it would hold a worker until the analysis timed
out and then be reported as a timeout rather than as the rate limit it was.

Failures reach the browser as typed codes, and the job record persists the code
rather than flattening everything to `analysis_failed`:

| Code | Browser says | Retry offered |
| --- | --- | --- |
| `upstream_rate_limited` | GitHub is rate limiting this server | yes |
| `upstream_forbidden` | This server may not read that repository | no |
| `analysis_rate_limited` | Too many analyses from this address | yes |
| `analysis_overloaded` | The analysis queue is full | yes |
| `analysis_timeout`, `interrupted_by_restart` | The analysis did not finish | yes |

### Observability

Line-delimited JSON on stdout, captured by the journal. Deliberately small: no
metrics stack, no exporter, no new dependency.

| Event | Records |
| --- | --- |
| `server.started` | URL, effective configuration, persistent paths |
| `http.request` | method, path, status, duration, queue depth, running count |
| `analysis.accepted` / `analysis.joined` | job id, repository, dedup key, queue depth |
| `analysis.cacheHit` | served from cache, no work started |
| `analysis.started` / `analysis.phase` | real pipeline phases |
| `analysis.completed` | **server-measured** duration, resolved revision, cache hit |
| `analysis.failed` | error code, duration |
| `analysis.refused` | `analysis_rate_limited` or `analysis_overloaded` |
| `job.recovered` | a job failed as `interrupted_by_restart` |

Job duration is logged from the persisted record's own timestamps rather than
from wall-clock around the request, because a poll delayed by a slow tunnel
would otherwise be reported as analysis time. That mistake was made once during
validation and corrected; `test/job-timing.ts` exists to keep it corrected.

Every string that reaches a log line is passed through a redactor first. That is
not belt-and-braces: the first version of this module promised in a comment that
no credential could be logged, and a test immediately proved the promise false by
putting a token-shaped string in an error message. The only realistic route is an
upstream error echoing a header, but "unreachable in practice" is how leaks
happen. GitHub, AWS, Slack and JWT shapes are matched, along with
`Authorization` headers and URL userinfo, so `https://[redacted]@github.com/o/r`
keeps the host an operator needs and drops the password.

No credential, token or cookie reaches a log line. That is enforced by
`test/analysis-logging.test.ts`, not asserted in a comment.

## Not built, deliberately

No dashboard, no workspace, no auth, no project manager, no search index, no
timeline. No repository code is executed: the server calls the same analyzer the
CLI does, over the same allowlisted HTTP client and the same bounded git runner.