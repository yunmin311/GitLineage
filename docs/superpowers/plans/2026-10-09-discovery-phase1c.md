# Discovery Phase 1C implementation

User-authorized execution; baseline c6aaadf8fdbdbf359ddf95ccec58afe3ce3e0b16. Preserve tools/ and production.

1. Add failing offline resolver tests. Implement an independently budgeted GitHub JSON reader and stable-ID, full-commit resolver with runtime validation. Share the existing network ledger without changing default Search behavior.
2. Collect explicitly selected paths from commit-bound nonrecursive trees and content-addressed blobs, verifying identity, bytes, blob and optional expected SHA256. Adapt to unchanged v1 comparator; keep unresolved failures in a separate envelope.
3. Add fixed mock E2E replay and all specified failure cases; verify filesystem permissions and Graph/cache sentinels. Run one explicit small public probe with receipts.
4. Run typecheck, build, unit, Phase 0 and all browser regressions serially after build. Commit by stage, report measurements and unresolved limits. Stop for Review, no push/deploy.

Limits: 3 comparisons, 8 selected files per repository, 128 KiB/file, 2 MiB source reservations, 24 HTTP attempts including search, 4 search attempts, 2 concurrency, 30 s wall. Existing 256 KiB response retention and 1 MiB aggregate network reservation ceilings preserved; default 32 KiB response reservations. CPU hard budget unsupported.
