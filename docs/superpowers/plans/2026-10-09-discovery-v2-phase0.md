# Discovery V2 Phase 0 — offline spike

Goal: select a bounded discovery/similarity route using source audit, current API probes and reproducible offline evidence.
Architecture: candidate sidecar independent of canonical graph; no production code or UI changes.
Tech stack: WSL Node, existing TypeScript parser, public GitHub read APIs, fixed MIT fixtures.
Spec: user Discovery V2 / Phase 0 request (2026-10-09).
Global constraints: preserve tools/, no paid calls, no push/deploy; unknown labels stay unknown; benchmark source is data, never executed.
Review focus: discovery recall is not closed-pool retrieval recall; similarity is not ancestry; measured budget usage differs from configured caps.

- [x] Audit collectors, contracts, cache, tests and effective limits; probe bounded current public APIs.
- [x] Pin legal source fixtures; compare exact blobs, token Jaccard, MinHash and winnowing; include transformed positives and template negatives; validate metric and coverage behavior.
- [x] Write RFC and result report, run checks sequentially (unit/build before browser), review diff, commit only Phase 0 files locally and stop for Review.
