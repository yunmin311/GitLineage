# Phase 1A offline module

Run from the repository root with existing Linux Node and lockfile dependencies:

```sh
node --test test/discovery/*.test.ts
node experiments/discovery-v2/run-phase1.ts
```

The second command writes only `artifacts/discovery-v2/sidecar.json` and `receipt.json` (ignored). The deterministic content hash is in the receipt. Timings/process CPU are observational and separate. `phase1-results.json` is a small saved summary, not a replacement for localized evidence in the reproducible sidecar.

`phase1-fixtures.json` contains synthetic multifile inputs and full real Git root commits. To reconstruct it offline: `node experiments/discovery-v2/create-phase1-fixtures.mjs`. Fixed dates/content/Git identities make commits reproducible. Vendored Phase 0 public files are not changed. Synthetic source retains copied MIT notices. No fixture source is executed. Synthetic positives/negatives are construction labels, public unreviewed pairs remain unknown. Labels are not verifier outcomes.

The module is not imported by the production analyzer, cache, Web or UI. There is no feature toggle or default run in production: invocation must be explicit. TypeScript is presently an existing dev dependency; any future production packaging must promote/bundle the parser explicitly and recheck worker entry packaging.

Resource scope: the source ledger bounds snapshot materialization and worker execution. Before a run, fixed fixture descriptors have an independent 512 KiB aggregate / 256 KiB per descriptor hard input preparation cap; metadata bytes are reported separately. `usage.totalBytes` is source bytes reserved before reads, conservatively charged even if a read fails. It is not a network-transfer counter. No network operation exists in the offline module. Future provider callers must use `attempt()` before every actual HTTP attempt, including retries; HTTP integration is intentionally not implemented here. CPU is unsupported as a hard budget; worker wall termination and 128 MiB V8 old-generation limits are not OS process/RSS isolation. Each completed worker is awaited until termination. Source tokens are capped at 20000/file; match ranges are representative capped samples with truncation flags.

Filtering is heuristic. Template directories are excluded, not arbitrary common-code detection. Untagged generic code can score 1. Normalization collapses all identifier leaves, including property names/imports, and is auxiliary only. Supported JS/TS parsing is syntax-level, with no AST similarity engine or cross-language comparison.

`probe-npm.ts` is a separate explicit networked baseline diagnostic, not a Discovery entry point. It has fixed bounded registry GETs and saves statuses/digests without credentials. Never run acquisition/refresh to reproduce offline results.
