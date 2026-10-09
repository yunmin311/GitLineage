# Phase 1B: bounded Repository Search experiment

Run at the repository root in WSL2 Ubuntu with Linux Node >=22.18 and existing lockfile dependencies. No new dependency or production entry point.

```sh
npm run typecheck
node --test test/discovery/*.test.ts
node experiments/discovery-v2/run-search.ts
```

Default run is entirely offline: three fixed queries, mock Transport, fixed observation clock, four numeric-ID candidates, a response-proven rename alias and all discovery reasons. Only `artifacts/discovery-v2/mock-search/search-sidecar.json` is written. Wall timing is observational and excluded when comparing deterministic content. The mocked rate-limit headers are fixtures, not live quota measurements.

A separate explicit, anonymous live probe:

```sh
node experiments/discovery-v2/run-search.ts --live
```

This sends at most one GET to `https://api.github.com/search/repositories`, `q=p-limit in:name is:public fork:true`, per_page=5, page=1. Attempts/search=1, candidates=5, concurrency=1, wall deadline=15 s, request timeout=10 s, per-response/aggregate retained-body reservation=64 KiB. It does not load environment credentials, run gh, refresh fixtures, fetch Git, run code or compare snapshots. Output: `artifacts/discovery-v2/live-search/search-sidecar.json`. Live results may change; do not rerun live to reproduce offline tests. The actual October 9 anonymous receipt is retained in `phase1b-live-probe.json`; it predates the final additional diagnostic fields and is preserved as received, not regenerated.

Contract migration is explicit: `discovery-search-sidecar@2` contains `discovery-candidate@2`, with pending verification, no lineage claim, no score, and candidate revision `{state:unresolved,sha:null}`. Phase 1A `discovery-candidate@1` and its fixtures are unchanged. `comparisonIdentity` rejects unresolved candidates. No implicit conversion, comparison or canonical graph write exists.

Boundaries: at most four queries, 25 results/page, two pages/query; separate total attempts <=40 and search attempts <=4, candidates <=16, wall <=120 s, concurrency <=2. Runner is serial; direct provider calls share the same synchronous ledger for concurrency. Network caps default to 256 KiB/response and 1 MiB aggregate reservation and may only be reduced. Reservation happens before transport and is not refunded for failures, cancellation or retry. Source-file counters remain separate and zero for search.

Fetch already received each chunk before this module sees it. Retention/JSON parsing is strictly capped, first overflowing chunk is discarded and the stream cancelled; delivered overflow bytes are counted separately. This is not a hard cap on bytes transferred on the wire, decompression buffers, process RSS or CPU. No hard CPU budget is implemented.

401/403/429 and redirects stop the run; success with remaining=0 stops subsequent requests. One immediate retry is permitted for network error/5xx when Retry-After is absent/zero, charged separately. Positive Retry-After stops follow-up queries to the same service; this experiment does not sleep or bypass it. There is no automatic credential fallback, metadata lookup or traversal. Receipts retain only allowlisted headers and safe diagnostics, not arbitrary remote messages/descriptions.

Coverage includes per-query states, returned/unique/admitted/rejected counts, rejected identity locations, planned pages left unfinished, total_count, incomplete_results, accessible pages still unfetched and results beyond GitHub's 1000-result window. A completed bounded search is never global coverage. Unknown live candidates are not benchmark truth labels.

See `docs/DISCOVERY_V2_PHASE1B_REPORT.md` and `phase1b-validation.json` for baseline audit, commits, actual regression and saved artifact hashes. No production cache, UI or API route is modified.
