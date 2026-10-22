# Bounded candidate admission closeout

## Frozen evaluation protocol (before implementation, 2026-10-22)

Targets: sindresorhus/p-limit (small JS concurrency utility and public forks),
chalk/chalk (terminal formatting/name ambiguity), vitejs/vite (TS monorepo/build tools),
gin-gonic/gin (Go HTTP framework), pallets/flask (Python web framework), and
yunmin311/GitLineage (small, sparse-purpose project; no useful result is acceptable).
Use the existing enriched public-exploration query plan: first page, three items per
query, at most two search requests and three admitted identities. Do not issue a
larger search to manufacture a late useful result. Acquisition uses the existing
preview, snapshot resolver and shared budgets; explicit development acquisition costs
are reported separately from replay. No acquired repository code is executed.

Save original API bodies, request order/status/bytes/timing, metadata, pinned SHA and
old search receipts before changing admission. Label every actually returned identity
for whether source comparison serves the target's stated purpose, independently of
the algorithm's support/order output. Same name/language alone is insufficient.
Known provider fork/parent metadata is independent Git evidence, not similarity proof.
An independent implementation with the same purpose can still be useful to compare.
Ambiguous purpose stays unknown; do not count unknown as useful or irrelevant.

Compare old and proposed admission on identical captured responses and budgets;
report admitted useful/irrelevant/unknown counts, useful top two, useful exclusions,
query coverage, identities, raw ranks, and any regression per target. An aggregate
improvement must not conceal per-target loss. No general-population precision claim.
Run the real enabled application's production bundle through source listing, manual
selection/recommendation, comparison and downloaded receipts where supported. Record
unsupported languages, missing content, quota failures and unsuccessful samples.
Replay controlled partial-provider and exhausted-budget scenarios separately; never
present them as real GitHub outages. Keep existing request/file/byte/time limits.

Retain the strategy only if it improves actual useful admissions without demonstrated
loss on this fixed set. If no captured set exercises saturation, state that limitation
and use one clearly labeled controlled saturation counterexample, not fabricated live
search rankings. Preserve all observations and fair query turns before leftovers.

## Delivered behavior and measured results (2026-10-23, Asia/Shanghai)

PR #9 was normally merged at `f0a4ef3d40edaa139f0fa33a5c7c9f75227fe52e`. Its
[merged-main ARM64/live/image run](https://github.com/yunmin311/GitLineage/actions/runs/39807603005) passed.
This change starts from that merge; the new feature PR is not authorized for merge.

Admission now evaluates all **already fetched** valid non-target identities with the
existing V4 metadata assessment. Each query first takes its best available identity
in fair turns up to its equal share; remaining slots use the best remaining observed
identities. Stable ties keep provider order. No scoring rule or request plan changed.
Every observed identity, original query/page/rank, metadata and admission outcome is
kept in an additive `admission` search receipt, including excluded identities. Existing
candidate schemas and identity binding remain unchanged. Cancellation can finalize
accounting for obtained observations, but cannot authorize new network/file/worker work.

### Fixed actual-search comparison

Six targets were fixed. Five searches succeeded; GitLineage failed bootstrap with
`commit: response_bytes_exhausted` before search. The portable fixture retains this
failure and the benchmark asserts that every fixed target is accounted for. Fractions
below describe the five successful captures only, not six successes or GitHub-wide recall.

| Target | Old useful admissions | New useful admissions | Useful excluded old → new |
| --- | ---: | ---: | --- |
| sindresorhus/p-limit | 1/3 | 2/3 | 1 → 0 |
| chalk/chalk | 2/2 | 2/2 | 0 → 0 |
| vitejs/vite | 2/3 | 2/3 | 0 → 0 |
| gin-gonic/gin | 1/3 | 2/3 | 1 → 0 |
| pallets/flask | 1/3 | 2/3 | 1 → 0 |

- Useful admissions: **7/14 → 10/14**; irrelevant: **4 → 3**; unknown: **3 → 1**.
- Useful top-two choices: **6/10 → 9/10**. No useful admission loss on these five captures.
- Exactly the same **10 search requests / 142,483 original search-response bytes**;
  replay has zero HTTP. Compact fixture replay bytes are separately reported and are
  not substituted for original API bytes. Bootstrap acquisition costs/failure are separate.
- Fair query coverage deliberately retains some weak choices. `owncloud/web` remains an
  irrelevant Vite candidate; `codegangsta/gin` and `1inch/limit-order-protocol` also survive.
  Metadata overlap is still heuristic. The sample is small, manually purpose-labeled and
  not a statistical estimate. No additional pages were fetched to manufacture late hits.

### Real production-bundle browser flow

WSL2 Ubuntu 24.04, Chromium via Playwright, existing authorized local exploration
handler, real GitHub responses and the existing comparison worker. Only the unrelated
Graph background uses a recorded fixture. This is not a deployed public-site test.
Per repository, the operator keeps at most two existing recommended files, then runs
comparison and downloads/validates the digest-bound review receipt. Controlled failure
fixtures are reported separately from actual provider behavior.

| Target → choice | Width | Outcome | HTTP | Delivered response bytes | Elapsed ms |
| --- | ---: | --- | ---: | ---: | ---: |
| chalk/chalk → jaywcjlove/colors-cli | 390 | compared | 21 | 120831 | 24481 |
| gin-gonic/gin → xgfone/ship | 390 | no supported selectable source for gin-gonic/gin; language/parser/listing coverage is limited | 15 | 104209 | 14613 |
| jucke/p-limit → sindresorhus/p-limit | 390 | compared | 19 | 145584 | 22876 |
| octocat/Spoon-Knife → github/spoon-knife | 390 | no supported selectable source for octocat/spoon-knife; language/parser/listing coverage is limited | 11 | 90297 | 12053 |
| pallets/flask → (none) | 1280 | no admitted candidate; see original search/failure receipt | 5 | 17328 | 7744 |
| sindresorhus/p-limit → leejialing/limit-promise | 1280 | compared | 21 | 107311 | 17741 |
| vitejs/vite → module-federation/vite | 1280 | compared | 21 | 126177 | 20989 |
| yunmin311/GitLineage → (none) | 1280 | no admitted candidate; see original search/failure receipt | 3 | 48182 | 7965 |

Four comparisons completed with four selected pairs each. Every successful downloaded
receipt passed the existing validator. Exact SHAs, blob bindings, source bytes, every
read/omitted path, matched fragments and requests remain in the local evidence directory.

| Actual repositories | Actual files read |
| --- | --- |
| chalk/chalk @ `47fc05abd46171b235e24174cd2dba83d25bf037` | `benchmark.js`, `source/index.js` |
| jaywcjlove/colors-cli @ `6a4a1335591f67a310d801a7f14b702900948501` | `lib/ansi-regex.js`, `toxic.js` |
| jucke/p-limit @ `e293f0b92536447f72ca818fcf07be8d287f1c24` | `index.js`, `test.js` |
| sindresorhus/p-limit @ `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb` | `benchmark.js`, `index.js` |
| sindresorhus/p-limit @ `a8a6fbec4e0e866d6d779b10889bb4f5567e70eb` | `benchmark.js`, `index.js` |
| leejialing/limit-promise @ `6a17f0322cffdafb76c773cda3eca2b5243199c9` | `index.js`, `lib/LimitPromise.js` |
| vitejs/vite @ `4ca25e1d3a24cb3343352f781a276cbfd2d206d6` | `oxlint.config.ts`, `vitest.config.e2e.ts` |
| module-federation/vite @ `cbba1dae9d3b5436ece3c56449a018dbed719a28` | `playwright.external-runtime.config.ts`, `tsdown.config.ts` |

Important limits observed:
- Vite compared root configuration files; `packages/vite`, `packages/create-vite`,
  plugin/src directories and other listed omissions exceeded the unchanged directory
  budget. This is **not** validation of core monorepo implementation similarity.
- p-limit leaves scripts/workflows unlisted or unselected; limit-promise leaves example
  source unselected. Chalk leaves tests/examples and other directories outside coverage.
- Go and Spoon-Knife have no selectable JS/TS source in the bounded listing. Flask had
  two empty live searches; search results changed relative to the frozen acquisition.
  GitLineage still cannot resolve a large commit response within the existing cap.
- GitHub independently reports `jucke/p-limit` as a fork with parent `sindresorhus/p-limit`.
  Its index→index pair is worth review. This provider relationship and the source
  similarity are separate observations; candidates remain pending with no lineage claim.
- Independent p-limit/concurrency implementations have two limited-information and two
  no-signal pairs. Vite’s four overlaps are limited-information observations, not provenance.
- The first live harness used obsolete status text, then an asynchronous receipt-listener
  race/wrong unsupported-source error field. Original failed attempts are preserved.
  Only Chalk, Go and Spoon-Knife were repeated after harness fixes; no production code
  changed for those harness errors. These extra development requests are not hidden
  in the equal-input benchmark. All attempts/costs are in the raw evidence directories.

### Gates, scope and usage

`npm run benchmark:discovery-admission` and `npm run test:discovery-admission-browser`
are additive M2 ARM64 PR/dispatch gates. The latter exercises production-bundle Chromium
at 1920/1280/430/390, keyboard selection, manual insufficient choices, completed comparison,
404 partial content, 24-request exhaustion, receipt download, Reduced Motion, dialog geometry,
Graph URL/camera restoration and page errors. Existing V3/V4 gates remain active.
Main push still runs the ARM64 live/image workflow; full M2 requires PR or manual dispatch.
No branch/admin protection or deployment setting was changed.

User flow: open the existing Discovery/Deep Search action in an enabled exploration
environment, enter a public repository, inspect candidate reasons and resource receipt,
manually choose a candidate, open Source Files, adjust recommendations, compare, review
coverage/fragments and download the review with pinned evidence. Default production
feature enablement and authorization are unchanged; this PR alone does not enable deployment.

No new dependency, production module, parser, crawler, model, scoring rule or UI system.
Existing 24 HTTP/2 search/3 candidate/8 files per repository/128 KiB per file/2 MiB source/
30-second active/concurrency-two and network response limits remain unchanged.
Canonical Graph, Presentation View and Discovery Candidate remain separate;
`verification: pending`, `lineageClaim: none` and no third-party code execution remain enforced.
WebKit/Safari, physical device touch/pinch and sustained performance were not revalidated
for this feature. No deployment or production change occurred.

Raw local evidence: `artifacts/discovery-admission/` (baseline, benchmark, live,
live-confirmation, chromium, regression, logs and production bundle hashes). CI uploads
all offline/browser evidence for its exact SHA. Existing three opt-in live unit skips
must remain disclosed separately. The historical intermittent Private Beta issue must
not be assumed fixed by this work.

Candidate admission is sufficiently improved on this bounded set to retain the small
change. Next priority is an explicitly authorized limited beta release and real user
feedback, subject to CI/release qualification, not another Discovery feature sequence.
Estimate: **85%** overall (+3 points from 82%; this round cap 88%; remaining 15%).
Next-round theoretical cap: **90%**, conditional on release and real-user validation;
not a promise or a code/test-count calculation. Broader source coverage and unsupported
languages remain product limitations, not reasons to add them to this PR.

### Local final verification

Typecheck and production build passed. Unit: 641 passed, 0 failed, 3 existing opt-in
live skips (644 total); Discovery-specific suite: 155 passed. The new admission browser
suite passed all seven cases. Both existing Discovery benchmarks and Canvas, Landing,
Analysis, Preflight, stale A→B, UI contract, responsive, mobile, Deep Search,
Discovery V3/V4 browser, Exploration and Private Beta suites passed. Private Beta’s
historical intermittent failure did not recur; this is not evidence that it is fixed.
The production bundle hash was checked after browser runs. Independent review found
a missing failed-target denominator in the portable benchmark; it now explicitly retains
all six planned targets, five successful acquisitions and the failed bootstrap.
No remaining review finding. Anti-overengineering review retained only the existing
relevance function, small bounded admission change, additive receipts and necessary
capture/replay/browser evidence; no new production subsystem or dependency.
