# Web slice — Phase 2

A production-shaped HTTP boundary over the analyzer, a separate presentation
layer, and the R3.1 subject-centric one-hop Explorer rendered from real analyzer
output. URL-first, cache-aware, responsive, and buildable.

The core provenance contract is **frozen**. This phase changed no ontology,
collector, evidence semantic, resolver behaviour or graph schema field to make
the UI easier. Every visual problem found in real data was fixed in the
presentation and layout layer, and the deviations are listed at the end.

## Running it

```bash
npm run serve                      # dev, unbundled client, http://127.0.0.1:4317
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

## Client structure

The browser code is split so the behaviour that must not drift is testable
without a DOM. Every module under `src/web/client/lib/` is pure and is unit-tested
in Node; `app.js` is the only file that touches the document.

| Module | Responsibility |
| --- | --- |
| `lib/url-state.mjs` | `/owner/repo` parsing, repository input normalisation, shareable query state |
| `lib/geometry.mjs` | slot layout, hub wrapping, parallel-edge bowing, label anchors, fit/zoom |
| `lib/search.mjs` | node and relationship search, layer filtering, bundle expansion |
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
with `400` for an unusable repository reference, `502` when analysis fails, and
`500` for a contract violation.

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
| `GITLINEAGE_PORT` / `PORT` | `4317` | port |
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

## Not built, deliberately

No dashboard, no workspace, no auth, no project manager, no search index, no
timeline. No repository code is executed: the server calls the same analyzer the
CLI does, over the same allowlisted HTTP client and the same bounded git runner.