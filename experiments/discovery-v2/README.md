# Discovery V2 Phase 0 — bounded offline spike

This is an isolated experiment, not an analyzer collector. It never writes Graph artifacts or loads vendored code as executable modules. See [RFC](../../docs/DISCOVERY_V2_RFC.md) and [results report](../../docs/DISCOVERY_V2_BENCHMARK_REPORT.md).

From the repository root, with the existing lockfile dependencies installed and Linux Git / Node >=22.18:

```sh
node --test experiments/discovery-v2/benchmark.test.mjs
node experiments/discovery-v2/benchmark.mjs /tmp/discovery-results.json
```

These commands are offline. Fixed MIT files are included under fixtures; manifest.json supplies full upstream commits, provenance, licenses and SHA-256 for every file. All files are checked before use. The run creates and removes its own temporary Git repository to prove that a copied source file can have an independent initial commit with the same blob. It does not touch the project's Git history. The existing document parser is imported read-only to audit only the two pinned READMEs; zero recognized lineage declarations does not prove absence of a source statement elsewhere.

Results should reproduce corpusDigest and rankings/metrics; elapsed time and process CPU are observations and vary. Node 24.21.0 / TypeScript 5.9.3 were used for the saved result. Scores are mathematical measurements, never lineage probabilities. Unknown public pairs remain unknown. Only positive non-null scores count as retrievals; precision uses fixed K including unfilled slots, and unknown labels give lower/upper bounds. precisionJudged excludes unknown and is not Precision@K.

One source file per repository is deliberately narrow. k=5, w=4, 64 seeded MinHash components; no global index or LSH. Max 256 KiB/file and 20000 tokens. Parser failure / empty shingles return unavailable, not fabricated zero similarity. Identifier normalization collapses properties and imported names as well as bindings; transformed code is not executed and is not guaranteed runnable. There is no claim of cross-language support, calibrated thresholds or complete real-world discovery.

Optional acquisition is **networked**, uses an existing GitHub credential via the project's resolver, and needs explicit invocation:

```sh
node experiments/discovery-v2/acquire.mjs --refresh
```

This refreshes four public repositories at their then-current heads and selects the oldest fork (one item); it is not a replay of the pinned snapshot and may change fixtures, rankings and labels. Review its diff and re-run the benchmark. Maximum 24 requests, 20 s/request, 256 KiB/response with streaming cancellation, no retries or paging, redirects rejected. Fixture acquisition requires MIT metadata and retains license text. No token/Authorization header is persisted. Search is limited to two repository queries (5 results each), one authenticated code query scoped to the known root (3 results), and one anonymous code capability probe (1 result). No paid service is called.

api-probes-initial.json records the first 21-request run. api-probes.json records the subsequent 24-request run that added README scope and an upstream commit check. Actual Phase 0 acquisition/research total is 45 GETs; offline benchmark calls are zero. Future failed acquisition may leave partial files: treat refresh as a reviewable maintenance command, not an atomic production data importer. Keep the checked-in corpus or restore only this experiment after reviewing changes.

Fixture MIT licenses apply to their respective upstream sources; synthetic transformations retain those source notices. Experiment code follows the repository license. Please do not interpret synthetic labels as human-verified lineage labels for real projects.
