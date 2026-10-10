# P0/P0.5 release and subsequent M2 integration

The stable UI PR starts at `ab425b6807fc7fdfc3b8c61cf02849b0336c0d49`.
Its original six UI commits remain intact. Use a normal merge commit for this PR;
do not squash or rebase the UI and independent acceptance history.

## Production Discovery guard

The stable UI workflow has two explicit paths:

- Without Discovery source, tests or experiments, it requires their absence and
  rejects Discovery / Deep Search route references in the production web server.
- With any Discovery directory present, it requires a nonempty
  `test/production-preview-disabled.test.ts` and runs it. A missing, empty, failing
  or entirely skipped test fails CI. The existing named runtime test,
  `production server keeps Deep Search disabled and does not accept preview tasks`,
  must actually pass; a synthetic test-file-only pass is insufficient. If this
  safety test is renamed, update the workflow assertion explicitly as well.

M2 already supplies this runtime test: the ordinary production server reports
`{ enabled: false }` and rejects preview search tasks with HTTP 404. Keep this
test when merging main into M2; do not replace it with an absence-only check.
The workflow also watches Discovery source and experiment paths so changes there
trigger its safety check. This release does not import Discovery business code.

## Fixture compatibility

Compared against M2 head `02299f88b3122840cf7bcef80da4684f2407b4be`:
all eight `test/fixtures/canonical/*.graph.json` snapshots, their README, and
`test/helpers/canonical-fixtures.ts` are byte-identical. The release adds an
independent SHA-256 integrity test; retain it together with M2's existing tests.

When subsequently merging main into `review/gitlineage-development`, preserve
M2's `test/web/fixture-server.ts` Preview Handler extension:

1. Import `ServeOptions` alongside `serve`.
2. Keep `FixtureServerOptions = Pick<ServeOptions, 'previewHandler'> &
   { phaseDelayMs?: number }`.
3. Destructure `phaseDelayMs` separately and forward the remaining `serveOptions`
   into `serve`. This lets Deep Search browser tests inject their controlled
   preview handler while ordinary UI fixtures remain deterministic.
4. Retain the common pinned snapshots, isolated temporary cache, scheduler drain
   (`whenIdle`) and cleanup behavior.

Use a normal main-to-M2 merge and resolve this helper in favor of the M2 extension;
do not rewrite M2 history. No M2 branch change is part of this release preparation.

## Guard validation

The workflow's exact shell block was executed locally against this stable UI
checkout and a temporary archive of the M2 head above. Both passed. Negative
checks correctly rejected a missing test, an empty test, a comment-only file,
a skipped required test, a failing runtime test and a production route without
Discovery directories. All eight canonical fixture SHA-256 assertions passed.
