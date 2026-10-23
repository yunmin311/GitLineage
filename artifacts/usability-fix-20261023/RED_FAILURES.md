# 修复前失败证据
原始日志保留在本地同目录；下文为原文转录，仅去除行尾空格，未修改断言、错误或结果。

## cache-red.log

```text
✖ spent address may read only owned, identity-checked cached directories without dispatch (62.349621ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 623.277318

✖ failing tests:

test at test/exploration-usability.test.ts:7:1
✖ spent address may read only owned, identity-checked cached directories without dispatch (62.349621ms)
  AssertionError [ERR_ASSERTION]: previously verified content stays readable at 20/20

  429 !== 200

      at TestContext.<anonymous> (file:///mnt/e/1project/gitlineage/test/exploration-usability.test.ts:20:80)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: 429,
    expected: 200,
    operator: 'strictEqual',
    diff: 'simple'
  }
```

## initial-entry-red.log

```text
{"ts":"2026-10-23T12:13:04.667Z","event":"http.request","method":"GET","path":"/expressjs/express","status":200,"requestMs":7,"queued":0,"running":0,"queueDepth":0}
{"ts":"2026-10-23T12:13:04.687Z","event":"http.request","method":"GET","path":"/fonts.css","status":200,"requestMs":5,"queued":0,"running":0,"queueDepth":0}
{"ts":"2026-10-23T12:13:04.689Z","event":"http.request","method":"GET","path":"/site.css","status":200,"requestMs":5,"queued":0,"running":0,"queueDepth":0}
{"ts":"2026-10-23T12:13:04.769Z","event":"analysis.accepted","jobId":"86218724-7679-40ce-a2f4-3b6627b17486","repository":"expressjs/express","dedupKey":"183424334f434a3c2be9e6552974ff15","resolvedRevision":"7ef98448f8b38099ab1ded55e458538ad47a51e7","queueDepth":1,"running":0,"durationMs":2}
{"ts":"2026-10-23T12:13:04.773Z","event":"http.request","method":"POST","path":"/api/analysis/expressjs/express","status":202,"requestMs":7,"queued":0,"running":1,"queueDepth":0}
{"ts":"2026-10-23T12:13:04.776Z","event":"analysis.started","jobId":"86218724-7679-40ce-a2f4-3b6627b17486","repository":"expressjs/express","resolvedRevision":"7ef98448f8b38099ab1ded55e458538ad47a51e7","queueDepth":0,"running":1}
{"ts":"2026-10-23T12:13:04.778Z","event":"http.request","method":"GET","path":"/api/analysis/jobs/86218724-7679-40ce-a2f4-3b6627b17486","status":200,"requestMs":1,"queued":0,"running":1,"queueDepth":0}
{"ts":"2026-10-23T12:13:04.785Z","event":"analysis.phase","jobId":"86218724-7679-40ce-a2f4-3b6627b17486","repository":"expressjs/express","phase":"collecting","queueDepth":0,"running":1}
{"ts":"2026-10-23T12:13:04.787Z","event":"analysis.phase","jobId":"86218724-7679-40ce-a2f4-3b6627b17486","repository":"expressjs/express","phase":"resolving_relationships","queueDepth":0,"running":1}
{"ts":"2026-10-23T12:13:04.788Z","event":"analysis.phase","jobId":"86218724-7679-40ce-a2f4-3b6627b17486","repository":"expressjs/express","phase":"validating","queueDepth":0,"running":1}
{"ts":"2026-10-23T12:13:04.789Z","event":"analysis.phase","jobId":"86218724-7679-40ce-a2f4-3b6627b17486","repository":"expressjs/express","phase":"publishing","queueDepth":0,"running":1}
{"ts":"2026-10-23T12:13:04.790Z","event":"analysis.completed","jobId":"86218724-7679-40ce-a2f4-3b6627b17486","repository":"expressjs/express","resolvedRevision":"7ef98448f8b38099ab1ded55e458538ad47a51e7","cacheHit":false,"durationMs":22,"queueDepth":0,"running":1}
{"ts":"2026-10-23T12:13:06.782Z","event":"http.request","method":"GET","path":"/api/analysis/jobs/86218724-7679-40ce-a2f4-3b6627b17486","status":200,"requestMs":0,"queued":0,"running":0,"queueDepth":0}
{"ts":"2026-10-23T12:13:06.788Z","event":"http.request","method":"GET","path":"/api/view/expressjs/express","status":200,"requestMs":3,"queued":0,"running":0,"queueDepth":0}
node:internal/modules/run_main:107
    triggerUncaughtException(
    ^

AssertionError [ERR_ASSERTION]: Explore more is fully reachable above the bottom toolbar
    at file:///mnt/e/1project/gitlineage/test/web/initial-neighborhood-acceptance.ts:23:85 {
  generatedMessage: false,
  code: 'ERR_ASSERTION',
  actual: false,
  expected: true,
  operator: '==',
  diff: 'simple'
}

Node.js v24.21.0
```

## registry-red.log

```text
✔ unscoped and scoped registry packages resolve their recorded repository without inventing a prefix (24.029776ms)
✖ registry failure is a diagnostic, not an assertion that repository metadata is absent (5.236802ms)
ℹ tests 2
ℹ suites 0
ℹ pass 1
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 147.671503

✖ failing tests:

test at test/registry-url.test.ts:23:1
✖ registry failure is a diagnostic, not an assertion that repository metadata is absent (5.236802ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:

  undefined !== []

      at TestContext.<anonymous> (file:///mnt/e/1project/gitlineage/test/registry-url.test.ts:27:84)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: undefined,
    expected: [],
    operator: 'deepStrictEqual',
    diff: 'simple'
  }
```

## dependency-diagnostic-red.log

```text
✔ unscoped and scoped registry packages resolve their recorded repository without inventing a prefix (24.71239ms)
✔ registry failure is a diagnostic, not an assertion that repository metadata is absent (5.590685ms)
✖ deduplication is not reported as a dependency coverage limit (1.317736ms)
ℹ tests 3
ℹ suites 0
ℹ pass 2
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 248.216188

✖ failing tests:

test at test/registry-url.test.ts:34:1
✖ deduplication is not reported as a dependency coverage limit (1.317736ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:

  true !== false

      at TestContext.<anonymous> (file:///mnt/e/1project/gitlineage/test/registry-url.test.ts:36:96)
      at Test.runInAsyncScope (node:async_hooks:227:14)
      at Test.run (node:internal/test_runner/test:1402:25)
      at Test.processPendingSubtests (node:internal/test_runner/test:974:18)
      at Test.postRun (node:internal/test_runner/test:1542:19)
      at Test.run (node:internal/test_runner/test:1467:12)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: true,
    expected: false,
    operator: 'strictEqual',
    diff: 'simple'
  }
```
