# Project state

Decisions here are binding on the implementation unless this file is changed.
Anything not listed as a decision is a proposal and must not be treated as
settled.

## Design engineering closure — 2026-10-22

V3.3 and Relationship Map are closed as a design stage. PR [#7](https://github.com/yunmin311/GitLineage/pull/7)
was normally merged at `5da98b38ec54e5d65e6272861c530586f0533147`.
Do not open another visual Milestone for minor differences. Only demonstrated
functional, accessibility, browser-compatibility or serious performance regressions
justify further UI changes. Device-level acceptance remains open independently.

- **Merged-main verification:** native [ARM64 / live / image](https://github.com/yunmin311/GitLineage/actions/runs/39783929489)
  and manually dispatched [full M2](https://github.com/yunmin311/GitLineage/actions/runs/39784908215)
  both passed on that exact merge SHA. Stable UI remains a PR-only, path-filtered
  workflow; its PR result is not a separate post-merge result.
- **Cross-browser:** Linux Playwright WebKit 26.6 passed Site Continuity, History
  Return, component motion, unified workspace and History controls on the final
  production bundle. Four widths (1920/1280/430/390), keyboard and Reduced Motion
  were exercised. History Return measured 44px high with all nine hit probes
  reachable in ready and failed states at every width. This does not certify
  macOS Safari, iOS, physical touch or pinch.
- **Sustained browser sampling:** Chromium, WSL2 x86_64, four sequential three-minute
  samples, 2,125 action iterations. Recorded canonical fixtures had 15/43/98 nodes;
  synthetic stress supplied 1,298 presentation nodes without changing canonical data.
  Recorded-fixture frame P99 was about 16.8ms; synthetic P99 was 33.4ms with 47
  interaction long tasks (maximum 71ms). Grouping bounds the painted scene: this
  does not certify 1,298 simultaneously painted nodes, hardware GPU performance,
  mobile thermals or production cold analysis.
- **Unresolved local test observation:** two full unit runs failed the real-engine
  Private Beta test at `test/discovery/private-beta.test.ts:39` with an absent export.
  A later unmodified standard run passed (622 pass, zero fail, three existing live
  skips), as did isolated diagnostics and 12 concurrent isolated samples. Both main
  CI unit runs passed. The intermittent failure's cause is unconfirmed; retries
  are not a fix. It remains a release qualification item, not a reason to redesign.
- **Release audit, read only:** no branch protection/rulesets/required checks were
  configured. Main push runs ARM64; the full M2 release check requires dispatch.
  Production was clean at `868c488d6d5358b05899ad8e777e320ca0037c0e`, not the new main.
  Public and on-disk asset hashes agreed. The existing rollback restores
  `dd5d70109fe42ef1d46eb5f053e6795f6da39aa3`; a future release must snapshot the
  currently running version. No deployment, restart, production data/configuration
  change or administrator-rule change occurred.

Local evidence, raw measurements, screenshots and release/device checklists are in
`artifacts/integration-closeout/`; CI evidence is also attached to the linked runs.
The design stage is closed; unconditional production readiness is not claimed.
Discovery V3 now implements [representative source comparison](discovery-v3.md)
in the existing enabled exploration flow: bounded deterministic recommendations,
manual overrides, multi-file worker results, digest-bound review and cumulative-budget
repeat comparisons. The earlier [proposal](discovery-next-milestone.md) is superseded
by that delivered scope. It preserves `verification: pending` / `lineageClaim: none`
and the separation of canonical graph, presentation view and Discovery candidates.
Authored-corpus coverage improves under unchanged caps; live candidate relevance and
normalized-token false observations remain explicit limits, not solved provenance.

## Decision

Confirmed and implemented in this repository.

| Decision | Detail |
| --- | --- |
| Three separate object kinds | `Entity`, `Relationship` and `Evidence` are never merged. Evidence is first-class data in `graph.json`, not UI text. |
| Three evidence statuses | `VERIFIED`, `DECLARED`, `DETECTED`. No generic `INFERRED`. |
| Ten relationship types | `forked_from`, `derived_from`, `shares_history_with`, `depends_on`, `uses_submodule`, `declared_inspiration`, `references`, `shares_exact_content_with`, `similar_to`, `evolved_into`. `copied_from` and similar accusations do not exist. |
| Direction is ontology-owned | Directional: `forked_from`, `derived_from`, `depends_on`, `uses_submodule`, `declared_inspiration`, `references`, `evolved_into`. Symmetric: `shares_history_with`, `shares_exact_content_with`, `similar_to`. The resolver stamps direction from the ontology and rejects contradicting observations. Symmetric endpoints are canonicalised so a pair yields one edge. A renderer must read `directed`, never infer it from the focused node. |
| `shares_exact_content_with` replaces `contains_exact_content_from` | V1 direction audit. Identical blob content proves neither origin nor copying direction, so the type is symmetric and its evidence uses `first_*`/`second_*` keys instead of `source_*`/`target_*`. Core semantics changed, not only the display name. |
| Two admission guards | Evidence type to relationship type, and status to both. A collector proposes, the resolver disposes. Rejections become diagnostics. |
| Direction is fixed by the ontology | `shares_history_with`, `shares_exact_content_with` and `similar_to` are undirected; the other seven types are directed. |
| Dependency is `DECLARED` only | A manifest is an author's statement. GitLineage never runs a package manager. |
| `derived_from` needs containment plus ordering | Shared commits alone give `shares_history_with`, never a direction. Truncated windows can never prove containment. |
| Canonical exact content; separate sampled similarity | `shares_exact_content_with` uses identical Git blob IDs. Discovery measurements remain independent sidecars with `verification=pending`, `lineageClaim=none`; no similarity detector inserts canonical lineage edges. |
| Public exploration, no login | Explicitly enabled anonymous entry reuses Discovery search/source/compare and repository exploration. Opening exploration tools starts no Discovery transport work; an explicit exploration action is required. Normal canonical analysis can still request GitHub data on a cache miss. Defaults in `experiments/public-exploration/service.ts`: 1200 actual HTTP attempts/process/hour, 120/address/hour, ten seconds between new explorations/address, one active shared operation. Failed requests are charged before dispatch; cancellation does not refund. Visitor results are bound to cookie and address; quotas are process-local and reset on restart. Private Beta uses separate authenticated ownership and budgets. Both entry points remain disabled in production by default. |
| Bounded structure and history | Pinned repository ID/revision/tree; initial history reads at most six commits and three observed branch tips. Explicit continuation reads six more commits/page up to 120/session, branch pages of three up to 20 pages, and listed directories up to 128/session (path validation currently caps depth at 32). Each operation has a fresh <=24-attempt / 30-second / 1-MiB reserved network budget; aggregate session ceiling is 240 attempts, also subject to the anonymous service quota. Submodules are pinned gitlinks, never followed. Unopened directories and unobserved parents remain unexamined; CPU hard budgeting is unsupported. See `experiments/public-exploration/repository-explorer.ts`. |
| Main workspace and separate History | One repository relationship canvas combines Origins, Dependencies, References, observed internal structure and discovery observations. Layer switches change visibility/emphasis without replacing the graph world. Local expansion preserves object identity and URL exploration state. Git History uses its own log/branch tracks and returns to the preserved main graph. Presentation grouping is not a canonical lineage edge; discovery remains `pending` / `none`. |
| Declarations require a resolvable repository | An attribution phrase without a repository URL in its window produces no relationship, only a diagnostic. Code blocks and indented code are not prose. |
| `thanks to` is a reference | An acknowledgement is a link, not a claim of derivation. |
| Collector boundary | Collectors observe and emit `Observation[]`. They never merge evidence, never choose a status, never touch the graph. |
| Only `git` is ever executed | Fixed subcommand allowlist, no shell, scrubbed environment, stdin-only `--file`, https-only transport. |
| SSRF defence | Four-host outbound allowlist, per-hop redirect revalidation, https only, no credentials in URLs. |
| Resource limits are hard caps | Centralised in `src/platform/limits.ts`, always reported through diagnostics. |
| Deterministic output | Same revision, same graph, apart from timestamps. Codepoint ordering, content-derived ids, no clock or locale input. |
| Public repositories only in V1 | The `private` cache namespace is refused outright; a live test asserts that no storage is created. |
| Bounded git access | Shallow, tagless, blob-filtered, submodule-free, timeout-bounded, with a post-fetch size budget that fails loudly. |
| Blob identity from the tree API | Exact content costs one API call per candidate instead of a clone. |
| Implementation language | TypeScript on Node >= 22.18, executed directly through Node's type stripping, with `tsc --noEmit` as the type gate and `node:test` as the test runner. |
| Single package, not a monorepo | One `package.json`. Module boundaries under `src/` match the proposed layout so a later split is mechanical. |
| Minimal dependencies | Runtime: `smol-toml` only. Dev: `typescript`, `@types/node`, `ajv`, `ajv-formats`, `playwright` (browser interaction and screenshots), `esbuild` (production bundling). |
| Core contract frozen for the Web phase | Phases 1 to 3 of the Web slice changed no ontology, collector, evidence semantic, resolver behaviour or graph schema field for presentation convenience. The one addition to the pipeline is an optional `onPhase` observer at existing stage boundaries, which is instrumentation and changes no behaviour. Every visual problem found in real data was fixed in `src/web/view-model.ts` and the client layout. Deviations are listed in `docs/web-slice.md`. |
| Analysis is a job, not a request | The public deployment proved that a cold analysis (measured up to 311s) outlives any reverse-proxy deadline, so the initiating request was being cut off with `524` while the analysis completed anyway. Analysis is now an idempotent job with its own lifecycle: `POST /api/analysis/:owner/:repo` returns immediately, `GET /api/analysis/jobs/:jobId` observes real phases, and the result endpoints answer `analysis_pending` instead of blocking. Raising a timeout or pre-warming a cache would only move the problem. |
| Job identity is the work, not the request | owner + repo + resolved revision + schema version + analyzer version. Two visitors asking for the same repository join one analysis instead of launching a second clone and a second pass over the GitHub API. The revision-aware artifact cache still does the real caching; deduplication only stops duplicate work. |
| Restart must not strand a job | Completed work derives truth from the artifact cache, not the job registry. A job in flight when the process died is failed with `interrupted_by_restart` and is retryable. Recovery runs at startup, not on the first request — calling it only from request handlers leaves an orphan looking permanently running on a server that is asked nothing. That was a real bug, now covered by a test. |
| Meter new work, not reads | Cached reads and result endpoints are unmetered. A per-address budget, a global concurrency cap and a bounded queue guard new analyses, with typed 429 and 503 plus `Retry-After`. Joining an in-flight job is free, because it costs no work. Client identity comes from the socket unless a proxy header is explicitly declared trusted. |
| An all-bundled graph must not look empty | `expressjs/express` has 48 real relationships, all bundled, so the canvas drew nothing and was indistinguishable from a repository with no lineage. Orphan bundles now get lightweight representative cards, visibly distinct from entities, expandable, and recorded in the URL. |
| Graph schema 2.0.0 | Bumped for the breaking rename. `validateGraph` refuses any other version; artifact cache paths embed `v2.0.0`; the JSON Schema pins `const: "2.0.0"`. A 1.x artifact cannot be served, reused or validated. |
| Two HTTP surfaces, not one | `/api/graph/:owner/:repo` returns the canonical graph unchanged; `/api/view/:owner/:repo` returns the presentation view-model. No renderer field ever enters the canonical graph. The client calls only `/api/view`, since fetching both would double the analysis wait for one result. |
| `/owner/repo` as the primary route | So a future domain replacement is a DNS change. The whole frame lives in the query string (`edge`, `node`, `layers`, `q`, `bundles`, `depth`), so a shared link reproduces it exactly. `/` is the landing page. |
| Freshness is stated, not implied | Both analysis endpoints return `cacheHit`, `resolvedRevision`, `resolvedRef`, `defaultBranch` and `elapsedMs`. The UI shows `cached <time>` in the app bar, so "reload gives the same result" is checkable. |
| No localhost anywhere | Deployment settings come from the environment, and the production bundle is asserted to contain neither `localhost` nor `127.0.0.1`. Asset URLs are root-absolute, because the shell is also served at `/owner/repo`. |
| Client logic is separated and testable | Pure layout, classification and URL modules are unit-tested in Node. Workspace, History, motion and preview controllers also use the DOM and have browser acceptance checks. `*.d.mts` declarations tie typed browser imports to the view-model. |
| Browser scripts typecheck separately | `tsconfig.web-scripts.json` adds the DOM lib for the Playwright drivers, so the main config stays DOM-free and server code cannot reach for browser globals by accident. |
| Bundling is presentation-only | Canonical relationships remain intact. Counted grouping controls expand classified member neighborhoods on the main canvas; members and their actual relationship evidence remain reachable. Groups and categories are display navigation, not lineage edges. |
| Relationship-owned spatial neighborhoods | The current presentation layout allocates branch envelopes and local subtree footprints, with one identity for shared objects and obstacle-aware cross references. If every safe route fails, inspectable endpoint badges expose the connection gap instead of omitting the relationship or drawing through nodes. |
| CLI first, web later | `analyze` produces `graph.json`; the renderer consumes it and must not change the contract. |

### Implementation decisions taken during this work

These were not in the specification; they are recorded here so they are not
mistaken for product requirements.

- `Package -> references -> Repository` is how a resolved package source
  repository is expressed, instead of introducing a new relationship type. It is
  `DECLARED` registry metadata, never an ancestry claim.
- Go module paths are treated as repository paths, so `depends_on` can point at a
  `Repository` entity directly.
- A repository URL yields at most one relationship per target, at the strongest
  declared meaning, so a URL covered by "inspired by" does not also appear as a
  bare `references` edge.
- `shares_exact_content_with` is `VERIFIED`-only and symmetric-only. Normalised-hash
  detection would need a new evidence type and an explicit ontology amendment.
- Submodule identity is joined on `path` against the tree's gitlink entries
  rather than on the submodule name, because a name may contain dots.
- Unparseable or unreadable inputs produce diagnostics and partial results, never
  a failed analysis and never a silent claim.
- Redirects are followed manually up to three hops, each re-validated, so that
  renamed repositories keep working.
- HTTP cache entries store a body file *name*, not an absolute path, so a cache
  directory stays readable across machines and working directories. A 304 whose
  cached body has gone triggers one unconditional refetch instead of an error.
  Found by live validation after mixing Windows and WSL cache directories.
- Git repository detection compares `--show-toplevel` against the requested
  directory, so a cache nested inside another repository can never adopt it.
  Found the hard way: an analysis run rewrote this project's own `origin` to the
  analysed repository and marked it shallow. See Deprecated.
- Only plain `https://github.com/<owner>/<repo>` remotes are fetched, validated
  before any filesystem access, so `file://` and `ext::` helper URLs cannot
  reach git even with `GIT_ALLOW_PROTOCOL=https`.

## Proposal

Open, not implemented, not binding.

| Proposal | Notes |
| --- | --- |
| Interactive explorer | **Implemented in M2.** `src/web/` serves separate canonical and presentation surfaces, a unified repository workspace and independent Git History. Local multi-neighborhood expansion, search, layers and evidence are available. Explicitly enabled Discovery V2 / Deep Search provides bounded source comparison without lineage claims. Full repository coverage, durable exploration sessions and physical-device acceptance are not established by the offline browser suites. |
| Deployment | **Existing production is protected.** The build is `dist/web` plus one Node server; this PR changes neither deployment nor production data. Current live host, TLS and production revision are not revalidated by local or PR tests. |
| Timeline / evolution view | First observed, last observed, introduced in commit, removed in commit. |
| Similarity detector | Bounded Discovery V2 candidate retrieval and sampled comparison are implemented as independent sidecars, `verification: pending`, `lineageClaim: none`. Broader coverage and provenance promotion are not established. |
| Normalised content hashing | Would need a new evidence type and an ontology amendment before any code. |
| `ExternalProject` entities | For projects hosted outside GitHub, so a declaration about a non-GitHub project is representable instead of being dropped. |
| Manifest git-dependency to repository edge | Today a `git+https` spec is recorded inside the evidence and used as a candidate; a direct edge would need a new ontology decision. |
| More ecosystems | Maven, Gradle, Composer, RubyGems, crates.io, NuGet. |
| More registries | crates.io, the Go module proxy, npm scoped-package metadata. |
| Software Heritage adapter | Archival source when GitHub metadata is incomplete or a repository is gone. |
| World of Code adapter | Global cross-repository provenance signals, as an optional adapter and never a V1 blocker. |
| ScanCode / SPDX adapters | Deterministic license, copyright and composition signals. Optional; the core must work without them. |
| Cross-forge support | GitLab, Codeberg, Bitbucket, self-hosted Git. The canonical model does not bind GitHub, so this should not require restructuring. |
| Private repository analysis | Credential model, private cache, artifact encryption, cross-repository permission checks. Explicitly must not reuse the public pipeline. |
| Exporters | GraphML, Mermaid, SPDX references, SVG. Consumers of the canonical graph only. |
| Artifact store and cache service | Revision-aware cache keyed on repository identity, resolved revision and schema version. |
| SPDX / SBOM authoring | Out of scope; GitLineage consumes such data, it does not produce it. |

## Deprecated

| Option | Status | Reason |
| --- | --- | --- |
| A generic `INFERRED` status | Rejected | Mixes clues with facts and pushes the system toward heuristic or AI inference. A future inference type must be separate and must not share the visual language of verified relationships. |
| Running package managers to obtain metadata | Rejected | Repository code is untrusted data and is never executed. |
| Similarity upgraded to provenance | Rejected | Similarity cannot establish direction, authorship or origin. |
| Implicit `INFERRED` naming (`copied_from`, `stolen_from`) | Rejected | The analyzer has no standing to make that claim. |
| `git rev-parse --git-dir` as an existence test | Replaced | Git searches upward, so a cache directory inside a repository adopted that repository: the analyser rewrote its `origin` remote and marked it shallow and blob-filtered. Now compares `--show-toplevel` with the target directory. Fixed after live validation damaged this project's own git config. |
| Graph schema 1.0.0 | Superseded by 2.0.0 | The `contains_exact_content_from` rename and the `source_*` → `first_*` evidence key change are breaking. 1.x artifacts are rejected by `validateGraph`, refused by the cache path, and rejected by the JSON Schema. |
| `contains_exact_content_from` | Replaced | The V1 direction audit found that the name asserted provenance direction the evidence did not support. Replaced by the symmetric `shares_exact_content_with`, with symmetric endpoint canonicalisation and origin-free evidence field names. A regression test asserts the old name is not a valid relationship type. |
| Unbounded full clone per repository | Rejected | Storage, bandwidth and latency blow up immediately. Bounded fetch plus the tree API covers the same signals. |
| Framework-first implementation | Not started | The specification deliberately left the language open until the analyzer contract was proven. It is now fixed by the decision above; the choice is recorded rather than debated. |
| A monorepo with separate packages | Deferred | A single package with the proposed module layout proves the contract with less machinery. Revisit if the web layer needs independent deployables. |

## Historical verification status (Web Phase 2)

| Check | Command | Status |
| --- | --- | --- |
| Types | `npm run typecheck` | passes, 0 errors (server config and browser-script config) |
| Unit, contract, regression, view-model, HTTP, schema, offline pipeline | `npm test` | 230 tests, 227 pass, 3 live skipped, 0 fail |
| Analysis jobs, dedup, restart, rate limits | `test/web-jobs.test.ts` | 26 tests covering the async lifecycle |
| Client async parsing and bundle representatives | `test/web-analysis-client.test.ts` | 19 tests |
| Deployment configuration and secure defaults | `test/deploy-config.test.ts` | 8 tests; template and code cannot drift apart |
| Structured log contract and redaction | `test/analysis-logging.test.ts` | 13 tests, including a nested-credential leak |
| Reported configuration matches the configuration in use | `test/deploy-config.test.ts` | the cache and job store reported by `/healthz` are the ones actually served from |
| Live integration on real repositories | `npm run test:live` | 7 pass |
| Production build and its served artefact | `npm run build` + `test/web-build.test.ts` | passes; bundle served over HTTP with no hard-coded host |
| Live client behaviour on real repositories | `npm run test:web` | 26/26 checks pass |
| Live async lifecycle through a public tunnel | `test/web/live-async-validation.ts` | 25/25 checks pass |
| Cold analysis past the proxy deadline | cold-proxy harness | `grpc/grpc` 311s and `vitest-dev/vitest` 190s both returned 202 immediately and completed |
| Graceful restart with persistent state | restart harness | `SIGTERM` drains, the interrupted job is recovered as `interrupted_by_restart`, the completed artifact and the canonical graph are byte-identical afterwards, and a retry gets a fresh job |
| Screenshots of real repositories | `npm run shots` | 20 PNGs across landing, explorer, drawer, search, layers and phone, no console errors, no horizontal overflow |
| Artifact validation | `node src/cli/main.ts validate <graph.json>` | passes on every produced artifact |

Recorded run for Web Phase 2: graph schema 2.0.0, analyzer 0.2.0, Node 24.21,
git 2.43.0, WSL2, Chromium from the WSL Playwright cache.

These counts and live runs are historical, not evidence for the current M2 HEAD.
Current M2 acceptance is tracked by the PR workflows `M2 PR validation` and
`P0/P0.5 stable UI validation` on the same final development commit. Offline
Chromium fixtures, fixed Mock GitHub Transport and isolated trusted TLS/Caddy
staging do not by themselves establish fresh GitHub API, WebKit or physical-device
acceptance. See the dated closure above for the separately executed merged-main
live and Linux WebKit checks; physical-device acceptance remains unverified.

Superseded run note: 89 tests at the direction-audit commit, 130 at the Phase 1
commit, 209 at the async-jobs commit. The Phase 2 run is recorded in the
historical verification table above.

Details and recorded results: `docs/integration-validation.md`.

## Historical hosting validation

The intended host is a single-node Oracle OCI **Always Free Ampere A1** VM.
Because Ampere A1 is `aarch64`, "it builds on an x86 laptop" answers the wrong
question, so `.github/workflows/arm64-validate.yml` runs the whole thing on a
**native** ARM64 runner rather than under emulation. Emulation hides precisely
the failure worth catching: a native binary that was never published for the
target architecture. The runner is free on a public repository.

Recorded on `aarch64`, Node 24 arm64, `esbuild` resolving to `@esbuild/linux-arm64`:

| Step | Result |
| --- | --- |
| Dependency install | succeeds, native binary present for arm64 |
| `npm run typecheck` | 0 errors |
| `npm run build` | bundle produced |
| `npm test` | 235 tests, 232 pass, 3 live skipped, 0 fail |
| `npm run test:live` | 7 pass against real repositories |
| Serve and analyse | `/healthz` reports `nodeEnv: production`; `octocat/spoon-knife` accepted as `202` |
| `docker build` | image architecture reported as `arm64` |
| Container run | accepts an analysis, and cache plus jobs land on the mounted volumes rather than in the image layer |

The first run of this workflow failed, and the reason was worth the run: the
server bound port 4317 while announcing a cache directory it was not using.
Neither was an ARM64 fault. Three latent deployment bugs came out of it, all now
fixed and covered — the generic `PORT` outranking `GITLINEAGE_PORT`, a default
port that collides with the OpenTelemetry collector, and `/healthz` reporting a
different cache root from the one in use.

The provisioning and credential inventory recorded during this earlier validation
is obsolete. This PR does not inspect or modify OCI, Caddy, TLS, DNS or production
configuration. That historical validation did not verify the current live deployment;
the dated closure above records the later read-only version/hash inspection.

The live validation above was driven through a Cloudflare Quick Tunnel, which
worked and then failed repeatedly for reasons outside the application: TLS
handshake resets mid-run, and a new hostname on every restart. That is why one
earlier 17-minute reading was wrong — the client could not poll while the server
finished in 71 seconds. **Client-side timing is not evidence of analysis
duration**; `test/job-timing.ts` reads the server's own timestamps instead.

Deployment assets (`Dockerfile`, `gitlineage.env.example`,
`deploy/gitlineage.service`, `deploy/RUNBOOK.md`) remain outside this closure's
change scope; their presence is not a new deployment or live acceptance claim.
