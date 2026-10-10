# Discovery V2 Phase 1A implementation plan

Approved scope: independent, explicitly invoked offline candidate analysis; no production integration.

1. Define strict runtime candidate contract and pre-operation resource ledger; prove malformed inputs, concurrent reservations, failed attempts and cancellation with tests. Commit independently after typecheck.
2. Read only pinned Phase 0 fixtures with digest checks and bounded reads; classify every file. Compare exact blobs and strict/auxiliary normalized 5-shingles in terminable workers. Save deterministic sidecar separately from timing receipt. Add multifile adversarial fixtures and boundary checks; commit after targeted tests and typecheck.
3. Reproduce shallow-history completeness and npm registry URL issues independently. Make narrow fixes only where reproduced, each with its own regression and commit.
4. Finish build/typecheck/unit before serial browser suites. Record results and remaining limits; stop for Review. Preserve tools; no push/deploy.
