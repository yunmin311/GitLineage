/**
 * The shared-history diagnostic sidecar.
 *
 * Four properties are load-bearing and are proven here rather than asserted in a
 * comment:
 *
 *   1. graph output is byte-identical with diagnostics enabled and disabled --
 *      the sidecar is observability, so it cannot alter the artifact;
 *   2. a diagnostic failure cannot fail an analysis;
 *   3. no credential can enter the sidecar, even if a caller tries;
 *   4. repeated analyses correlate to their own diagnostic records.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createDiagnosticSink,
  prune,
  recordName,
  scrub,
  serialise,
  writeSidecar,
  type SharedHistoryDiagnosticSink,
  type SharedHistoryProbeRecord,
} from '../src/platform/shared-history-diagnostics.ts';
import { compareHistories, type HistorySample } from '../src/collectors/git/history.ts';
import { analyze } from '../src/pipeline/analyze.ts';

const ROOT = { provider: 'github', owner: 'acme', name: 'widget' } as const;
const CANDIDATE = { provider: 'github', owner: 'acme', name: 'widget-fork' } as const;

function sample(
  ref: { provider: 'github'; owner: string; name: string },
  commits: string[],
  extra: Partial<HistorySample> = {},
): HistorySample {
  return {
    ref,
    commits,
    truncated: false,
    createdAt: '2020-01-01T00:00:00Z',
    htmlUrl: `https://github.com/${ref.owner}/${ref.name}`,
    ...extra,
  };
}

function probeRecord(overrides: Partial<SharedHistoryProbeRecord> = {}): SharedHistoryProbeRecord {
  return {
    analysisId: 'job-123',
    repository: 'acme/widget',
    candidate: 'acme/widget-fork',
    resolvedRevision: 'a'.repeat(40),
    analyzerVersion: '0.2.0',
    schemaVersion: '2.0.0',
    rootWindow: {
      requestedDepth: 200,
      effectiveDepth: 200,
      refspec: 'HEAD',
      blobFilter: 'blob:none',
      isShallow: true,
      shallowBoundaryCount: 1,
      boundaryTruncated: true,
      commitCount: 3,
      truncated: false,
    },
    candidateWindow: {
      requestedDepth: 200,
      effectiveDepth: 200,
      refspec: 'HEAD',
      blobFilter: 'blob:none',
      isShallow: true,
      shallowBoundaryCount: 1,
      boundaryTruncated: false,
      commitCount: 2,
      truncated: false,
    },
    requiredCommits: [
      { sha: '1'.repeat(40), presentLocally: true },
      { sha: '2'.repeat(40), presentLocally: false },
    ],
    requiredCommitsMissingLocally: 1,
    requiredCommitsTruncatedByCap: false,
    probe: {
      method: 'commit-set-intersection',
      rootCommitCount: 3,
      candidateCommitCount: 2,
      requiredCount: 2,
      sharedCount: 1,
      sharedSample: ['1'.repeat(40)],
    },
    emitted: true,
    subjectEntityId: 'repo:github:acme/widget',
    objectEntityId: 'repo:github:acme/widget-fork',
    ...overrides,
  };
}

/** A sink that fails every call, to prove an analysis survives it. */
function explodingSink(): SharedHistoryDiagnosticSink {
  return {
    header: async () => {
      throw new Error('diagnostic header write failed');
    },
    probe: async () => {
      throw new Error('diagnostic probe write failed');
    },
  };
}

// ---------------------------------------------------------------------------
// 1. graph output is byte-identical with diagnostics on and off
// ---------------------------------------------------------------------------

test('the sidecar does not change what the history collector emits', async () => {
  const commits = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
  const shared = ['a'.repeat(40), 'b'.repeat(40)];

  const without = compareHistories({
    root: ROOT,
    rootSample: sample(ROOT, commits),
    candidates: [sample(CANDIDATE, shared)],
    resolvedRevision: commits[0]!,
  });

  const dir = await mkdtemp(join(tmpdir(), 'gl-diag-identity-'));
  try {
    const sink = createDiagnosticSink(dir);
    const with_ = compareHistories({
      root: ROOT,
      rootSample: sample(ROOT, commits),
      candidates: [sample(CANDIDATE, shared)],
      resolvedRevision: commits[0]!,
      diagnostics: sink,
      analysisId: 'job-identity',
    });
    // The sink is fire-and-forget by contract; give it a turn to land.
    await new Promise((r) => setTimeout(r, 25));

    assert.equal(JSON.stringify(with_.observations), JSON.stringify(without.observations),
      'observations identical');
    assert.equal(JSON.stringify(with_.diagnostics), JSON.stringify(without.diagnostics),
      'diagnostics identical');
    const files = await readdir(dir);
    assert.ok(files.length > 0, 'the sink did write, so this is a real comparison');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('graph.json on disk is byte-identical with diagnostics enabled or disabled', async (t) => {
  // The strongest form of requirement 1, and it has to be end to end: compare the
  // canonical artifact on disk, produced by the real pipeline, twice.
  //
  // GitHub is stubbed rather than reached, because a unit test must not depend on
  // the network -- and because a live call would compare two different moments
  // in time. The first version of this test hit the real API for a repository
  // that does not exist and failed on a 404, which proved nothing either way.
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : String(input);
    calls.push(url);
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
      return json({
        full_name: 'acme/widget',
        name: 'widget',
        owner: { login: 'acme' },
        created_at: '2020-01-01T00:00:00Z',
        default_branch: 'main',
        html_url: 'https://github.com/acme/widget',
        fork: false,
      });
    }
    if (/\/repos\/[^/]+\/[^/]+\/commits\//.test(url)) {
      // A fixed sha, so both runs resolve the same revision. A random one would
      // make the two graphs differ for a reason that has nothing to do with the
      // sidecar, which is exactly the kind of false failure worth designing out.
      return json({ sha: 'c'.repeat(40) });
    }
    if (/\/git\/trees\//.test(url)) return json({ tree: [], truncated: false });
    if (/\/contents\//.test(url)) return new Response('{}', { status: 404 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = original;
  });

  const root = await mkdtemp(join(tmpdir(), 'gl-diag-graph-'));
  const diagDir = join(root, 'diagnostics');
  try {
    const run = async (withDiagnostics: boolean) => {
      const outDir = join(root, withDiagnostics ? 'on' : 'off');
      await mkdir(outDir, { recursive: true });
      await analyze({
        target: 'acme/widget',
        cacheRoot: join(root, withDiagnostics ? 'cache-on' : 'cache-off'),
        outDir,
        enableGit: false,
        enableRegistry: false,
        enableBlobs: false,
        diagnostics: withDiagnostics ? createDiagnosticSink(diagDir) : undefined,
        analysisId: withDiagnostics ? 'job-graph' : undefined,
        // The clock is pinned because graph.json carries `resolvedAt` and
        // `generatedAt`. Two runs a second apart differ in those two fields
        // regardless of the sidecar, which made the first attempt at this test
        // fail on timestamps and say nothing about the property under test.
        now: () => new Date('2024-01-01T00:00:00.000Z'),
      });
      const bytes = await readFile(join(outDir, 'graph.json'));
      return bytes;
    };

    const off = await run(false);
    const on = await run(true);
    assert.ok(off.length > 0, 'the offline run produced a graph artifact');

    // Compared as text, and the first difference is named in the failure message.
    // A bare Buffer comparison produced "... Skipped lines" in the reporter, which
    // told me nothing about where the difference actually was.
    const a = off.toString('utf8').split('\n');
    const b = on.toString('utf8').split('\n');
    let firstDifference = -1;
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
      if (a[i] !== b[i]) {
        firstDifference = i;
        break;
      }
    }
    assert.equal(
      firstDifference,
      -1,
      firstDifference === -1
        ? ''
        : `graph.json differs at line ${firstDifference + 1}\n      off: ${a[firstDifference]}\n      on : ${b[firstDifference]}`,
    );
    // Honest about what this run covers. Git is disabled here because the fetch
    // layer needs a real remote, so no shared-history probe runs and the sidecar
    // stays empty. The assertion below therefore checks that the pipeline accepted
    // the sink and left the artifact untouched -- not that a probe was recorded.
    // Probe emission, and the fact that recording one does not change the
    // collector's output, is what the first test proves.
    const files = await readdir(diagDir).catch(() => [] as string[]);
    assert.deepEqual(files, [],
      'no probes are emitted with git disabled, which is why this run proves the pipeline tolerates the sink rather than that probes are recorded');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. a diagnostic failure cannot fail an analysis
// ---------------------------------------------------------------------------

test('a sink that throws does not fail the comparison', () => {
  const commits = ['a'.repeat(40), 'b'.repeat(40)];
  const result = compareHistories({
    root: ROOT,
    rootSample: sample(ROOT, commits),
    candidates: [sample(CANDIDATE, commits)],
    diagnostics: explodingSink(),
    resolvedRevision: commits[0]!,
  });
  assert.equal(result.observations.length, 1, 'the relationship is still produced');
  assert.equal(result.observations[0]?.relationship, 'shares_history_with');
});

test('a sink pointing at an unwritable path does not fail the comparison', async () => {
  const commits = ['a'.repeat(40), 'b'.repeat(40)];
  // A path under a file, so mkdir cannot succeed.
  const blocker = join(await mkdtemp(join(tmpdir(), 'gl-diag-block-')), 'not-a-dir');
  await writeFile(blocker, 'x', 'utf8');
  const sink = createDiagnosticSink(join(blocker, 'nested'));
  try {
    const result = compareHistories({
      root: ROOT,
      rootSample: sample(ROOT, commits),
      candidates: [sample(CANDIDATE, commits)],
      diagnostics: sink,
      resolvedRevision: commits[0]!,
    });
    await new Promise((r) => setTimeout(r, 25));
    assert.equal(result.observations.length, 1);
  } finally {
    await rm(blocker, { recursive: true, force: true });
  }
});

test('writeSidecar returns null instead of throwing when the directory is unusable', async () => {
  const blocker = join(await mkdtemp(join(tmpdir(), 'gl-diag-fail-')), 'file');
  await writeFile(blocker, 'x', 'utf8');
  try {
    const written = await writeSidecar(
      { directory: join(blocker, 'under'), retention: 5, maxBytes: 4096 },
      'record.json',
      probeRecord(),
    );
    assert.equal(written, null, 'no path, no exception');
  } finally {
    await rm(blocker, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 3. no credential can enter the sidecar
// ---------------------------------------------------------------------------

test('token shapes are scrubbed from a record', () => {
  // Assembled from fragments so no push-blockable literal sits in this file.
  const classic = `gh${'p'}_${'A'.repeat(30)}`;
  const fine = ['github', 'pat', 'B'.repeat(30)].join('_');
  const record = probeRecord({
    repository: `acme/${classic}`,
    candidate: `acme/Authorization: Bearer ${fine}`,
  });
  const text = serialise(record, 256 * 1024);
  assert.ok(text, 'a well-formed record still serialises');
  assert.ok(!text.includes(classic), 'no classic token survives');
  assert.ok(!text.includes(fine), 'no fine-grained token survives');
  assert.ok(!/[Bb]earer\s/.test(text), 'no bearer value survives');
  assert.ok(text.includes('[redacted]'), 'the redaction is visible');
});

test('a URL with embedded credentials is reduced', () => {
  const out = scrub('clone https://user:hunter2@github.com/acme/widget failed');
  assert.ok(!out.includes('hunter2'));
  assert.ok(out.includes('https://'), 'the useful part survives');
});

test('a record with a credential-shaped field name is refused entirely', () => {
  // Value-only scrubbing would let a field called "authorization" through if its
  // value happened to look harmless, so the key name is checked too.
  const text = serialise({ ...probeRecord(), authorization: 'harmless-looking' } as never, 256 * 1024);
  assert.equal(text, null, 'the record is refused rather than published');
});

test('a token cannot reach the sidecar even when a caller hands it one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gl-diag-secret-'));
  // Assembled at run time from fragments. The first version of this test embedded
  // a realistic token as a literal, and GitHub's push protection rejected the
  // commit -- which is the correct outcome and rather the point: a repository
  // should not be able to contain one, not even in a test that scrubs for them.
  // Synthetic, and built from filler so the shape is exercised without any real
  // secret entering the repository. A real token is deliberately not used here:
  // once push protection has seen one, its value is rejected everywhere,
  // including inside a test. That is the correct outcome, not an obstacle.
  const live = ['github', 'pat', 'F'.repeat(60)].join('_');
  try {
    // Every plausible place a caller might leak it.
    await writeSidecar({ directory: dir, retention: 5, maxBytes: 256 * 1024 }, 'a.json',
      { ...probeRecord(), token: live });
    await writeSidecar({ directory: dir, retention: 5, maxBytes: 256 * 1024 }, 'b.json',
      { note: `Authorization: Bearer ${live}` });
    await writeSidecar({ directory: dir, retention: 5, maxBytes: 256 * 1024 }, 'c.json',
      { url: `https://x:${live}@github.com/a/b` });
    for (const name of await readdir(dir)) {
      const body = await readFile(join(dir, name), 'utf8');
      assert.ok(!body.includes(live), `${name} must not contain the token`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an oversized record is refused rather than written', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gl-diag-big-'));
  try {
    const written = await writeSidecar(
      { directory: dir, retention: 5, maxBytes: 200 },
      'big.json',
      { ...probeRecord(), filler: 'x'.repeat(5000) },
    );
    assert.equal(written, null);
    assert.deepEqual(await readdir(dir), [], 'nothing was written');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// 4. repeated analyses correlate to their own records
// ---------------------------------------------------------------------------

test('each analysis writes its own header and probe records', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gl-diag-correlate-'));
  const commits = ['a'.repeat(40), 'b'.repeat(40)];
  try {
    for (const id of ['job-alpha', 'job-beta', 'job-alpha']) {
      const sink = createDiagnosticSink(dir);
      const result = compareHistories({
        root: ROOT,
        rootSample: sample(ROOT, commits),
        candidates: [sample(CANDIDATE, commits)],
        diagnostics: sink,
        analysisId: id,
        resolvedRevision: commits[0]!,
      });
      await new Promise((r) => setTimeout(r, 25));
      assert.equal(result.observations.length, 1);
    }
    const files = await readdir(dir);
    // alpha was analysed twice and must not have produced a second set.
    assert.ok(files.includes(recordName({ analysisId: 'job-alpha', repository: 'acme/widget' })),
      'the alpha header exists');
    assert.ok(files.includes(recordName({ analysisId: 'job-beta', repository: 'acme/widget' })),
      'the beta header exists');
    const alpha = files.filter((f) => f.includes('job-alpha'));
    assert.equal(alpha.length, 2, 'one header and one probe record for alpha, not two sets');
    const beta = files.filter((f) => f.includes('job-beta'));
    assert.equal(beta.length, 2, 'beta is a separate set');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the sidecar records what the probe actually saw', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gl-diag-content-'));
  const commits = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)];
  try {
    const sink = createDiagnosticSink(dir);
    compareHistories({
      root: ROOT,
      rootSample: sample(ROOT, commits, {
        fetch: { depth: 200, refspec: 'HEAD', blobFilter: 'blob:none', isShallow: true, shallowBoundary: [commits[2]!] },
      }),
      candidates: [sample(CANDIDATE, commits.slice(0, 2), {
        fetch: { depth: 200, refspec: 'HEAD', blobFilter: null, isShallow: true, shallowBoundary: ['f'.repeat(40)] },
      })],
      diagnostics: sink,
      analysisId: 'job-content',
      resolvedRevision: commits[0]!,
      analyzerVersion: '0.2.0',
      schemaVersion: '2.0.0',
    });
    await new Promise((r) => setTimeout(r, 30));

    const probe = (await readdir(dir)).find((f) => f.includes('probe-acme_widget-fork'))!;
    assert.ok(probe, 'a probe record was written');
    const body = JSON.parse(await readFile(join(dir, probe), 'utf8')) as SharedHistoryProbeRecord;
    assert.equal(body.repository, 'acme/widget');
    assert.equal(body.candidate, 'acme/widget-fork');
    assert.equal(body.resolvedRevision, commits[0]);
    assert.equal(body.rootWindow.isShallow, true);
    assert.equal(body.rootWindow.boundaryTruncated, true, 'the root window boundary commit is flagged');
    assert.equal(body.candidateWindow.blobFilter, null, 'a fetch without the blob filter is recorded');
    assert.equal(body.probe.method, 'commit-set-intersection');
    assert.equal(body.probe.sharedCount, 2);
    assert.equal(body.emitted, true);
    assert.equal(body.requiredCommitsMissingLocally, 1, 'c is absent from the candidate window');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('retention keeps the newest files and removes the rest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gl-diag-retention-'));
  try {
    // Writes are made with retention effectively disabled, so this test measures
    // prune() rather than the pruning that writeSidecar() also performs. Otherwise
    // the directory is already capped by the time prune runs, and the assertion
    // would pass or fail for the wrong reason -- as it did on the first attempt.
    const write = { directory: dir, retention: 100, maxBytes: 64 * 1024 };
    for (let i = 0; i < 6; i += 1) {
      await writeSidecar(write, `record-${i}.json`, { i });
      await new Promise((r) => setTimeout(r, 12));
    }
    const before = await readdir(dir);
    const removed = await prune({ ...write, retention: 3 });
    const after = await readdir(dir);
    assert.equal(before.length, 6, 'all six were written before pruning');
    assert.equal(removed, 3);
    assert.equal(after.length, 3, 'retention capped');
    // The survivors are the newest.
    assert.ok(after.includes('record-5.json'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a filename cannot escape the directory', () => {
  const name = recordName({ analysisId: '../../etc/passwd', repository: '../../root' });
  assert.ok(!name.includes('/'), `filename must not contain a separator: ${name}`);
  assert.ok(!name.includes('..'), `filename must not contain traversal: ${name}`);
});