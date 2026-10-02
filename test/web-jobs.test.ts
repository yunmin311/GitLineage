/**
 * Async analysis job tests.
 *
 * These cover the properties the public deployment depends on and that cannot be
 * checked by reading the code:
 *
 *  - a request never waits for an analysis;
 *  - two requests for the same cold repository produce one analyzer run;
 *  - the state machine only advances forward and ends terminal;
 *  - a job interrupted by a restart is failed, not left running;
 *  - new work is metered, cached reads are not;
 *  - the concurrency cap and the bounded queue produce typed refusals.
 *
 * No GitHub access: the analyzer is injected through `schedulerAnalyzeOverride`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serve } from '../src/web/serve.ts';
import { parseRoute } from '../src/web/server.ts';
import type { AnalyzeInvocation } from '../src/web/analysis/scheduler.ts';
import { resolve } from '../src/core/resolver.ts';
import { validateGraph } from '../src/core/validate.ts';
import { GRAPH_SCHEMA_VERSION } from '../src/core/model.ts';
import type { EntityRef, LineageGraph, Observation } from '../src/core/model.ts';
import type { AnalysisPhase as PipelinePhase } from '../src/pipeline/analyze.ts';
import { JobStore } from '../src/web/analysis/store.ts';
import { AnalysisRateLimiter, clientIp } from '../src/web/analysis/ratelimit.ts';
import { dedupKey, dedupKeyString } from '../src/web/analysis/dedup.ts';
import { ANALYSIS_PHASES, canTransition, isTerminal, RUNNING_PHASES } from '../src/web/analysis/types.ts';

const SUBJECT: EntityRef = { kind: 'repository', provider: 'github', owner: 'me', name: 'project' };
const UPSTREAM: EntityRef = { kind: 'repository', provider: 'github', owner: 'up', name: 'stream' };

function fixtureGraph(owner = 'me', name = 'project'): LineageGraph {
  const subject: EntityRef = { kind: 'repository', provider: 'github', owner, name };
  const observations: Observation[] = [
    {
      collector: 'github-metadata',
      extractor: 'github-fork-metadata@1',
      subject,
      object: UPSTREAM,
      relationship: 'forked_from',
      directed: true,
      evidence: {
        type: 'github_fork_metadata',
        status: 'VERIFIED',
        repository: subject,
        sourceUrl: 'https://github.com/up/stream',
        data: { fork: true, source_full_name: 'up/stream', source_url: 'https://github.com/up/stream' },
      },
    },
  ];
  const { graph } = resolve({
    root: subject,
    observations,
    revision: { commit: 'a'.repeat(40), defaultBranch: 'main', resolvedAt: '2026-01-01T00:00:00.000Z' },
    namespace: 'public',
    extractors: ['github-fork-metadata@1'],
    observedAt: '2026-01-01T00:00:00.000Z',
  });
  assert.ok(validateGraph(graph).valid);
  return graph;
}

interface HarnessOptions {
  /** Milliseconds each phase takes, so a test can observe an intermediate state. */
  phaseDelayMs?: number;
  fail?: boolean;
  analysesPerIp?: number;
  maxConcurrent?: number;
  maxQueueDepth?: number;
  /**
   * Revision the stubbed probe reports. `null` means the probe cannot resolve a
   * revision, which is the honest default: without GitHub there is no commit to
   * find, so tests exercise the coarser dedup key and the "new work" path.
   */
  probeCommit?: string | null;
}

interface Harness {
  base: string;
  analysesRun: () => number;
  phasesSeen: () => AnalysisPhaseRecord[];
  jobStoreRoot: string;
  close: () => Promise<void>;
}

type AnalysisPhaseRecord = PipelinePhase | 'complete' | 'failed';

/**
 * Boots a server whose jobs are observable.
 *
 * `probeRevision` is not stubbed, so the server falls back to a `*` revision
 * key: the dedup and lifecycle behaviour under test does not depend on knowing a
 * real commit, and stubbing the probe would mean stubbing the GitHub client.
 */
async function harness(options: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'gitlineage-jobs-'));
  const cacheRoot = join(root, 'cache');
  const jobStoreRoot = join(root, 'jobs');
  let runCount = 0;
  const phases: AnalysisPhaseRecord[] = [];
  const delay = options.phaseDelayMs ?? 0;

  const { server, url, app } = await serve(
    {
      port: 0,
      cacheRoot,
      jobStoreRoot,
      depth: 0,
      maxCandidates: 0,
      enableGit: false,
      enableRegistry: false,
      analysisTimeoutMs: 30_000,
      schedulerAnalyzeOverride: async ({ target, onPhase }: AnalyzeInvocation) => {
        runCount += 1;
        const [owner, name] = target.split('/') as [string, string];
        const graph = fixtureGraph(owner, name);
        const order: AnalysisPhaseRecord[] = ['resolving', 'collecting', 'resolving_relationships', 'validating', 'publishing'];
        for (const phase of order) {
          onPhase?.(phase as PipelinePhase);
          phases.push(phase);
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        }
        if (options.fail) throw new Error('analyzer exploded');
        return { graph, cacheHit: false };
      },
      // The probe is stubbed so no test depends on GitHub reachability, and so a
      // slow network cannot make an assertion about response time meaningless.
      probeRevisionOverride: async () => ({ commit: options.probeCommit ?? null }),
    },
    {},
    {
      rateLimitAnalysesPerIp: options.analysesPerIp ?? 50,
      rateLimitEnabled: options.analysesPerIp !== 0,
      maxConcurrentAnalyses: options.maxConcurrent ?? 2,
      maxQueueDepth: options.maxQueueDepth ?? 20,
      analysisProbeTimeoutMs: 500,
      jobStoreRoot,
    },
  );

  return {
    base: url,
    analysesRun: () => runCount,
    phasesSeen: () => [...phases],
    jobStoreRoot,
    close: async () => {
      // Let the scheduler finish every in-flight job before the temporary
      // directory disappears. `waitForPhase` returns as soon as a terminal
      // phase is *observable*, which can be a moment before the final record
      // write has landed; deleting the tree at that instant races the write.
      await app.analysis.whenIdle();
      await new Promise<void>((done) => server.close(() => done()));
      app.analysis.shutdown();
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function post(base: string, path: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}${path}`, { method: 'POST' });
  return { status: response.status, body: await response.json() };
}

async function getJob(base: string, jobId: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}/api/analysis/jobs/${jobId}`);
  return { status: response.status, body: await response.json() };
}

async function waitForPhase(base: string, jobId: string, phases: AnalysisPhaseRecord[], timeoutMs = 20_000) {
  const started = Date.now();
  for (;;) {
    const { body } = await getJob(base, jobId);
    if (phases.includes(body?.data?.status)) return body.data;
    if (isTerminalPhase(body?.data?.status)) return body.data;
    if (Date.now() - started > timeoutMs) {
      throw new Error(`job never reached ${phases.join('|')}; last status ${body?.data?.status}`);
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}

function isTerminalPhase(status: unknown): boolean {
  return status === 'complete' || status === 'failed';
}

// ------------------------------------------------------------------ routing

test('the analysis routes are recognised and nothing else is', () => {
  assert.deepEqual(parseRoute('/api/analysis/octocat/spoon-knife'), {
    kind: 'analysis',
    repository: { owner: 'octocat', name: 'spoon-knife' },
  });
  const uuid = '11111111-2222-3333-4444-555555555555';
  assert.deepEqual(parseRoute(`/api/analysis/jobs/${uuid}`), { kind: 'analysis-job', jobId: uuid });
  // A crafted id cannot reach the store, which only accepts UUIDs.
  assert.equal(parseRoute('/api/analysis/jobs/..%2F..%2Fetc%2Fpasswd').kind, 'not-found');
  assert.equal(parseRoute('/api/analysis/jobs/nope').kind, 'not-found');
  // Existing endpoints are untouched.
  assert.equal(parseRoute('/api/graph/o/r').kind, 'graph');
  assert.equal(parseRoute('/api/view/o/r').kind, 'view');
});

// ------------------------------------------------------- state machine shape

test('the phase list is the documented finite state machine', () => {
  assert.deepEqual([...ANALYSIS_PHASES], [
    'queued',
    'resolving',
    'collecting',
    'resolving_relationships',
    'validating',
    'publishing',
    'complete',
    'failed',
  ]);
});

test('only forward transitions are legal, and terminal is terminal', () => {
  assert.equal(canTransition('queued', 'resolving'), true);
  assert.equal(canTransition('resolving', 'collecting'), true);
  assert.equal(canTransition('collecting', 'resolving_relationships'), true);
  assert.equal(canTransition('resolving_relationships', 'validating'), true);
  assert.equal(canTransition('validating', 'publishing'), true);
  assert.equal(canTransition('publishing', 'complete'), true);

  // Never backwards, never skipping.
  assert.equal(canTransition('collecting', 'resolving'), false);
  assert.equal(canTransition('queued', 'validating'), false);
  assert.equal(canTransition('publishing', 'collecting'), false);
  assert.equal(canTransition('complete', 'resolving'), false);
  assert.equal(canTransition('failed', 'queued'), false);
  // Any running phase may fail.
  for (const phase of ANALYSIS_PHASES) {
    if (isTerminal(phase)) continue;
    assert.equal(canTransition(phase, 'failed'), true, `${phase} may fail`);
  }
  assert.equal(isTerminal('complete'), true);
  assert.equal(isTerminal('failed'), true);
  assert.equal(isTerminal('queued'), false);
  assert.deepEqual([...RUNNING_PHASES], ['resolving', 'collecting', 'resolving_relationships', 'validating', 'publishing']);
});

// ---------------------------------------------------------------- dedup key

test('the dedup key identifies work, not requests', () => {
  const base = {
    owner: 'Me',
    name: 'Project',
    resolvedRevision: 'abc123',
    schemaVersion: '2.0.0',
    analyzerVersion: '0.2.0',
  };
  // Case-insensitive identity, so two visitors cannot fork work by casing.
  assert.equal(dedupKey(base), dedupKey({ ...base, owner: 'me', name: 'project' }));
  // A different revision is different work.
  assert.notEqual(dedupKey(base), dedupKey({ ...base, resolvedRevision: 'def456' }));
  // A different contract version is different work.
  assert.notEqual(dedupKey(base), dedupKey({ ...base, schemaVersion: '3.0.0' }));
  assert.notEqual(dedupKey(base), dedupKey({ ...base, analyzerVersion: '0.3.0' }));
  // An unknown revision is coarser, never split.
  assert.notEqual(dedupKey({ ...base, resolvedRevision: null }), dedupKey({ ...base, resolvedRevision: 'abc123' }));
  assert.match(dedupKeyString({ ...base, resolvedRevision: null }), /@\*/);
  assert.match(dedupKeyString(base), /@abc123\|v2\.0\.0\|a0\.2\.0/);
});

// ---------------------------------------------------------- the happy path

test('POST /api/analysis returns 202 immediately and the job completes', async () => {
  const h = await harness({ phaseDelayMs: 30 });
  try {
    const started = Date.now();
    const { status, body } = await post(h.base, '/api/analysis/me/project');
    const elapsed = Date.now() - started;

    assert.equal(status, 202);
    // The request returned long before the analysis could have finished.
    assert.ok(elapsed < 300, `returned in ${elapsed}ms`);
    assert.equal(body.status, 'queued');
    assert.match(body.jobId, /^[0-9a-f-]{36}$/);
    assert.equal(body.statusUrl, `/api/analysis/jobs/${body.jobId}`);
    assert.equal(typeof body.retryAfterMs, 'number');
    assert.ok(body.retryAfterMs > 0);

    // The work continues after the request is gone.
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(h.analysesRun(), 1, 'the job owns the analysis');

    const final = await waitForPhase(h.base, body.jobId, ['complete']);
    assert.equal(final.status, 'complete');
    assert.equal(final.graphUrl, '/api/graph/me/project');
    assert.equal(final.viewUrl, '/api/view/me/project');
    assert.equal(final.error, null);

    // Real phases were observed, in order, none invented.
    const seen = h.phasesSeen();
    assert.deepEqual(seen, [...RUNNING_PHASES]);
  } finally {
    await h.close();
  }
});

test('the job walks the real phase sequence and reports no percentage', async () => {
  const h = await harness({ phaseDelayMs: 40 });
  try {
    const { body } = await post(h.base, '/api/analysis/me/project');
    const observed: string[] = [];
    const started = Date.now();
    for (;;) {
      const job = await getJob(h.base, body.jobId);
      const status = job.body.data.status;
      if (observed[observed.length - 1] !== status) observed.push(status);
      if (isTerminalPhase(status)) break;
      assert.ok(Date.now() - started < 20_000, 'polling terminates');
      await new Promise((r) => setTimeout(r, 15));
    }
    assert.equal(observed[0], 'queued');
    assert.equal(observed[observed.length - 1], 'complete');
    // Only real phases appear, and never out of order.
    for (const phase of observed) assert.ok((ANALYSIS_PHASES as readonly string[]).includes(phase), phase);
    const indexOf = (p: string) => observed.indexOf(p);
    assert.ok(indexOf('resolving') < indexOf('collecting'));
    assert.ok(indexOf('collecting') < indexOf('resolving_relationships'));
    assert.ok(indexOf('resolving_relationships') < indexOf('validating'));
    assert.ok(indexOf('validating') < indexOf('publishing'));
    // There is no percentage anywhere in the payload.
    const { body: full } = await getJob(h.base, body.jobId);
    assert.equal(JSON.stringify(full).includes('percent'), false);
    assert.equal(JSON.stringify(full).includes('progress'), false);
  } finally {
    await h.close();
  }
});

// -------------------------------------------------------------- deduplication

test('two simultaneous cold requests for the same repository run the analyzer once', async () => {
  const h = await harness({ phaseDelayMs: 60 });
  try {
    const [a, b] = await Promise.all([
      post(h.base, '/api/analysis/me/project'),
      post(h.base, '/api/analysis/me/project'),
    ]);

    assert.equal(a.status, 202);
    assert.equal(b.status, 202);
    // Same job, not two.
    assert.equal(a.body.jobId, b.body.jobId);
    assert.equal(a.body.joined, false);
    assert.equal(b.body.joined, true, 'the second request joined the first');

    await waitForPhase(h.base, a.body.jobId, ['complete']);
    assert.equal(h.analysesRun(), 1, 'exactly one analyzer run for concurrent duplicate requests');
  } finally {
    await h.close();
  }
});

test('a third client attaching mid-analysis joins rather than restarting', async () => {
  const h = await harness({ phaseDelayMs: 80 });
  try {
    const first = await post(h.base, '/api/analysis/me/project');
    await waitForPhase(h.base, first.body.jobId, ['collecting']);
    const second = await post(h.base, '/api/analysis/me/project');
    assert.equal(second.body.jobId, first.body.jobId);
    assert.equal(second.body.joined, true);
    await waitForPhase(h.base, first.body.jobId, ['complete']);
    assert.equal(h.analysesRun(), 1);
  } finally {
    await h.close();
  }
});

test('a different repository is a different job', async () => {
  const h = await harness({ phaseDelayMs: 40 });
  try {
    const a = await post(h.base, '/api/analysis/me/project');
    const b = await post(h.base, '/api/analysis/other/repo');
    assert.notEqual(a.body.jobId, b.body.jobId);
    await waitForPhase(h.base, a.body.jobId, ['complete']);
    await waitForPhase(h.base, b.body.jobId, ['complete']);
    assert.equal(h.analysesRun(), 2);
  } finally {
    await h.close();
  }
});

// ------------------------------------------------------------------- failure

test('a failing analysis reports failed with a typed error and stays retryable', async () => {
  const h = await harness({ fail: true, phaseDelayMs: 10 });
  try {
    const { body } = await post(h.base, '/api/analysis/me/project');
    const final = await waitForPhase(h.base, body.jobId, ['failed']);
    assert.equal(final.status, 'failed');
    assert.equal(final.error.code, 'analysis_failed');
    assert.match(final.error.message, /exploded/);
    assert.equal(final.graphUrl, undefined, 'a failed job publishes no result URL');

    // Retryable: the same repository can be requested again and gets a new job
    // rather than being permanently poisoned.
    const again = await post(h.base, '/api/analysis/me/project');
    assert.equal(again.status, 202);
    assert.notEqual(again.body.jobId, body.jobId);
    await waitForPhase(h.base, again.body.jobId, ['failed']);
  } finally {
    await h.close();
  }
});

// ------------------------------------------------------------ result endpoints

test('the result endpoints answer analysis_pending instead of blocking', async () => {
  const h = await harness({ phaseDelayMs: 150 });
  try {
    const { body } = await post(h.base, '/api/analysis/me/project');
    await waitForPhase(h.base, body.jobId, ['collecting']);

    for (const endpoint of ['/api/graph/me/project', '/api/view/me/project']) {
      // The assertion is that it returns while analysis is still running. The
      // budget is generous because the first probe of an unstubbed repository
      // may touch the network; what matters is that it is far shorter than the
      // analysis it declines to wait for.
      const started = Date.now();
      const response = await fetch(`${h.base}${endpoint}`);
      const elapsed = Date.now() - started;
      assert.equal(response.status, 202, `${endpoint} is 202 while pending`);
      assert.ok(elapsed < 3000, `${endpoint} returned in ${elapsed}ms rather than waiting`);
      // And the analysis was genuinely still in flight.
      const job = await getJob(h.base, body.jobId);
      assert.equal(isTerminalPhase(job.body.data.status), false, 'it did not wait for completion');
      const payload = (await response.json()) as any;
      assert.equal(payload.ok, false);
      assert.equal(payload.error.code, 'analysis_pending');
      assert.equal(payload.meta.jobId, body.jobId, 'it names the job already running');
      assert.equal(payload.meta.statusUrl, `/api/analysis/jobs/${body.jobId}`);
    }

    // Once complete, the successful representation is unchanged.
    await waitForPhase(h.base, body.jobId, ['complete']);
    const graph = await fetch(`${h.base}/api/graph/me/project`);
    assert.equal(graph.status, 200);
    const envelope = (await graph.json()) as any;
    assert.equal(envelope.ok, true);
    assert.equal(envelope.meta.endpoint, 'canonical-graph');
    assert.equal(envelope.data.schemaVersion, GRAPH_SCHEMA_VERSION);
    assert.ok(validateGraph(envelope.data as LineageGraph).valid);

    const view = await fetch(`${h.base}/api/view/me/project`);
    assert.equal(view.status, 200);
    const viewEnvelope = (await view.json()) as any;
    assert.equal(viewEnvelope.ok, true);
    assert.equal(viewEnvelope.meta.endpoint, 'view-model');
    assert.ok(Array.isArray(viewEnvelope.data.nodes));
  } finally {
    await h.close();
  }
});

test('a completed artifact is served from cache without starting a job', async () => {
  const h = await harness();
  try {
    const first = await post(h.base, '/api/analysis/me/project');
    await waitForPhase(h.base, first.body.jobId, ['complete']);
    const before = h.analysesRun();

    // The artifact is cached, so a second POST reports completion with no work.
    const second = await post(h.base, '/api/analysis/me/project');
    assert.equal(second.status, 200);
    assert.equal(second.body.status, 'complete');
    assert.equal(second.body.cacheHit, true);
    assert.equal(typeof second.body.resolvedRevision, 'string');
    assert.equal(second.body.graphUrl, '/api/graph/me/project');
    assert.equal(second.body.viewUrl, '/api/view/me/project');
    assert.equal(h.analysesRun(), before, 'a cache hit launched no analysis');
  } finally {
    await h.close();
  }
});

// ---------------------------------------------------------- rate limiting

test('new analyses are metered per address, and cached reads are free', async () => {
  // Budget of two new analyses, plus a generous window so nothing is refused for
  // an unrelated reason: only the limiter should refuse.
  const h = await harness({ analysesPerIp: 2, phaseDelayMs: 20 });
  try {
    // Spend the budget on two distinct repositories.
    const r1 = await post(h.base, '/api/analysis/me/one');
    assert.equal(r1.status, 202, 'first new analysis is allowed');
    const r2 = await post(h.base, '/api/analysis/me/two');
    assert.equal(r2.status, 202, 'second new analysis is allowed');

    // Budget spent: a third *new* repository is refused, typed, with Retry-After.
    const limited = await post(h.base, '/api/analysis/me/three');
    assert.equal(limited.status, 429);
    assert.equal(limited.body.error.code, 'analysis_rate_limited');
    assert.ok(Number(limited.body.retryAfterSeconds ?? 0) > 0, 'the body carries a retry hint');
    assert.equal(limited.body.meta.limit, 2);

    // The refusal carries a Retry-After header too.
    const raw = await fetch(`${h.base}/api/analysis/me/four`, { method: 'POST' });
    assert.equal(raw.status, 429);
    assert.ok(Number(raw.headers.get('retry-after') ?? '0') > 0);

    // Metering does not apply to ordinary result reads: those stay available and
    // report pending rather than refusing.
    const view = await fetch(`${h.base}/api/view/me/one`);
    assert.equal(view.status, 202, 'a result read is never rate limited; it reports pending instead');
    assert.equal(((await view.json()) as any).error.code, 'analysis_pending');

    // A cache hit is free, so it is served even though the budget is spent.
    await waitForPhase(h.base, r1.body.jobId, ['complete']);
    const cached = await post(h.base, '/api/analysis/me/one');
    assert.equal(cached.status, 200, 'a cache hit is free and never metered');
    assert.equal(cached.body.status, 'complete');
    assert.equal(cached.body.cacheHit, true);
  } finally {
    await h.close();
  }
});

test('joining an in-flight job is free even with the budget spent', async () => {
  // The abuse-relevant case: a visitor reloading the page must never be punished
  // for a job that is already running, because it costs no new work.
  const h = await harness({ analysesPerIp: 1, phaseDelayMs: 60 });
  try {
    const first = await post(h.base, '/api/analysis/me/project');
    assert.equal(first.status, 202);
    await waitForPhase(h.base, first.body.jobId, ['collecting']);

    // Budget is spent; a genuinely new repository is refused.
    const refused = await post(h.base, '/api/analysis/me/other');
    assert.equal(refused.status, 429);

    // Rejoining the running job is still allowed.
    const rejoined = await post(h.base, '/api/analysis/me/project');
    assert.equal(rejoined.status, 202);
    assert.equal(rejoined.body.jobId, first.body.jobId);
    assert.equal(rejoined.body.joined, true);

    await waitForPhase(h.base, first.body.jobId, ['complete']);
    assert.equal(h.analysesRun(), 1);
  } finally {
    await h.close();
  }
});

test('a separate address has its own budget', async () => {
  const h = await harness({ analysesPerIp: 1 });
  try {
    const limiter = new AnalysisRateLimiter({ analysesPerIp: 1 });
    assert.equal(limiter.charge('1.1.1.1').allowed, true);
    assert.equal(limiter.charge('1.1.1.1').allowed, false);
    // A different address is unaffected.
    assert.equal(limiter.charge('2.2.2.2').allowed, true);
  } finally {
    await h.close();
  }
});

test('the limiter refuses only after the budget, and reports remaining', () => {
  let now = 1_000;
  const limiter = new AnalysisRateLimiter({ analysesPerIp: 3, windowMs: 1000 }, () => now);
  assert.equal(limiter.charge('ip').remaining, 2);
  assert.equal(limiter.charge('ip').remaining, 1);
  assert.equal(limiter.charge('ip').remaining, 0);
  const refused = limiter.charge('ip');
  assert.equal(refused.allowed, false);
  assert.equal(refused.code, 'analysis_rate_limited');
  assert.equal(refused.retryAfterSeconds, 1);

  // The window rolls over rather than the bucket growing forever.
  now += 1001;
  assert.equal(limiter.charge('ip').allowed, true);
});

test('peek reports the budget without spending it', () => {
  let now = 5_000;
  const limiter = new AnalysisRateLimiter({ analysesPerIp: 2, windowMs: 1000 }, () => now);
  assert.equal(limiter.peek('ip').remaining, 2);
  assert.equal(limiter.peek('ip').remaining, 2, 'peek is free');
  limiter.charge('ip');
  assert.equal(limiter.peek('ip').remaining, 1);
  now += 1001;
  assert.equal(limiter.peek('ip').remaining, 2);
});

// --------------------------------------------------------- client identity

test('client identity comes from the socket unless a proxy is trusted', () => {
  const socketAddress = '10.0.0.7';
  const request = {
    socket: { remoteAddress: socketAddress },
    headers: {
      // A forged header: a caller could send anything here.
      'x-forwarded-for': '203.0.113.9, 10.0.0.1',
      'cf-connecting-ip': '198.51.100.4',
    },
  } as any;

  // No declared proxy: the socket wins, so nothing a caller sends can move it.
  assert.equal(clientIp(request, null), socketAddress);

  // A declared proxy header is honoured, and only its first hop — the address the
  // trusted proxy itself observed.
  assert.equal(clientIp(request, 'cf-connecting-ip'), '198.51.100.4');
  assert.equal(clientIp(request, 'x-forwarded-for'), '203.0.113.9');

  // A trusted header that is absent falls back to the socket rather than
  // collapsing every such client into one shared identity.
  assert.equal(clientIp({ ...request, headers: {} } as any, 'cf-connecting-ip'), socketAddress);
  assert.equal(clientIp({ ...request, headers: { 'cf-connecting-ip': '  ' } } as any, 'cf-connecting-ip'), socketAddress);

  // A request with no socket address still gets a stable identity.
  assert.equal(clientIp({ socket: {}, headers: {} } as any, null), 'unknown');
});

// ------------------------------------------------- concurrency and the queue

test('the concurrency cap bounds simultaneous analyses', async () => {
  const h = await harness({ maxConcurrent: 1, analysesPerIp: 100, phaseDelayMs: 120 });
  try {
    const a = await post(h.base, '/api/analysis/me/one');
    assert.equal(a.status, 202);
    // With a cap of one, the next repository must wait rather than run.
    const b = await post(h.base, '/api/analysis/me/two');
    assert.equal(b.status, 202);
    assert.equal(b.body.jobId !== a.body.jobId, true);
    // The second job is queued, not running.
    const jobB = await getJob(h.base, b.body.jobId);
    assert.equal(jobB.body.data.status, 'queued');

    await waitForPhase(h.base, a.body.jobId, ['complete']);
    await waitForPhase(h.base, b.body.jobId, ['complete']);
    assert.equal(h.analysesRun(), 2);
  } finally {
    await h.close();
  }
});

test('a full queue returns a typed overload response with Retry-After', async () => {
  const h = await harness({ maxConcurrent: 1, maxQueueDepth: 1, analysesPerIp: 100, phaseDelayMs: 200 });
  try {
    assert.equal((await post(h.base, '/api/analysis/me/one')).status, 202);
    assert.equal((await post(h.base, '/api/analysis/me/two')).status, 202);
    // One running, one queued: the queue is now full.
    const overloaded = await post(h.base, '/api/analysis/me/three');
    assert.equal(overloaded.status, 503);
    assert.equal(overloaded.body.error.code, 'analysis_overloaded');
    assert.ok(overloaded.body.retryAfterSeconds > 0);
    assert.equal(overloaded.body.meta.maxConcurrent, 1);
    assert.equal(overloaded.body.meta.maxQueueDepth, 1);
    // And the overload response carries the header.
    const raw = await fetch(`${h.base}/api/analysis/me/four`, { method: 'POST' });
    assert.equal(raw.status, 503);
    assert.ok(Number(raw.headers.get('retry-after') ?? '0') > 0);
  } finally {
    await h.close();
  }
});

// -------------------------------------------------------------- persistence

test('job state is written outside the Git working tree and survives a reload', async () => {
  const h = await harness({ phaseDelayMs: 30 });
  try {
    const { body } = await post(h.base, '/api/analysis/me/project');
    await waitForPhase(h.base, body.jobId, ['complete']);

    // Persisted as one file per job, outside the repository.
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(h.jobStoreRoot);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^[0-9a-f-]{36}\.json$/);

    const stored = JSON.parse(await readFile(join(h.jobStoreRoot, files[0]!), 'utf8'));
    assert.equal(stored.jobId, body.jobId);
    assert.equal(stored.phase, 'complete');
    assert.equal(stored.owner, 'me');
    assert.equal(stored.name, 'project');
    // Internal detail is persisted but is not part of the public shape.
    assert.equal('pid' in stored, true);
  } finally {
    await h.close();
  }
});

test('a job interrupted by a restart is failed, not left running', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitlineage-restart-'));
  const jobRoot = join(root, 'jobs');
  try {
    // First process: a job is created and left mid-flight, as if the server died.
    const store = new JobStore({ root: jobRoot, schemaVersion: '2.0.0', analyzerVersion: '0.2.0' });
    await store.init();
    const created = await store.create({
      dedupKey: 'key-a',
      owner: 'me',
      name: 'project',
      resolvedRevision: 'abc',
    });
    await store.markStarted(created.jobId);
    await store.markPhase(created.jobId, 'collecting');
    assert.equal(store.get(created.jobId)!.phase, 'collecting');

    // Second process: recovery must not leave it looking permanently running.
    const reopened = new JobStore({ root: jobRoot, schemaVersion: '2.0.0', analyzerVersion: '0.2.0' });
    const recovered = await reopened.recoverInterrupted();

    assert.equal(recovered.length, 1);
    assert.equal(recovered[0]!.jobId, created.jobId);
    assert.equal(recovered[0]!.phase, 'failed');
    assert.equal(recovered[0]!.error?.code, 'interrupted_by_restart');
    assert.ok(reopened.findActive('key-a') === null, 'a failed job does not block a retry');

    // Retryable: a new job can be created for the same work immediately.
    const retry = await reopened.create({ dedupKey: 'key-a', owner: 'me', name: 'project', resolvedRevision: 'abc' });
    assert.notEqual(retry.jobId, created.jobId);
    assert.equal(retry.phase, 'queued');
    assert.ok(reopened.findActive('key-a'), 'the new job is active');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a truncated or unreadable job file is discarded, not trusted', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitlineage-corrupt-'));
  const jobRoot = join(root, 'jobs');
  try {
    await mkdir(jobRoot, { recursive: true });
    const uuid = '11111111-2222-3333-4444-555555555555';
    // A half-written file, which is what a crash mid-write leaves behind.
    await writeFile(join(jobRoot, `${uuid}.json`), '{"jobId":"1111', 'utf8');
    // A leftover .tmp must never be read at all.
    await writeFile(join(jobRoot, `${uuid}.json.tmp`), '{"jobId":"nope","phase":"running"}', 'utf8');

    const store = new JobStore({ root: jobRoot, schemaVersion: '2.0.0', analyzerVersion: '0.2.0' });
    const recovered = await store.recoverInterrupted();
    assert.equal(recovered.length, 0);
    assert.equal(store.get(uuid), null);

    const { readdir } = await import('node:fs/promises');
    const remaining = await readdir(jobRoot);
    assert.equal(remaining.includes(`${uuid}.json`), false, 'the untrustworthy file is removed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the store refuses a job id that is not a generated uuid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitlineage-id-'));
  try {
    const store = new JobStore({ root: join(root, 'jobs'), schemaVersion: '2.0.0', analyzerVersion: '0.2.0' });
    await store.init();
    // A traversal attempt must not resolve to a path outside the job directory.
    await assert.rejects(() => store.update('../../etc/passwd', { phase: 'failed' }));
    await assert.rejects(() => store.update('not-a-uuid', { phase: 'failed' }));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('recovery runs without any request arriving, so a restart cannot strand a job', async () => {
  const root = await mkdtemp(join(tmpdir(), 'gitlineage-boot-recovery-'));
  const cacheRoot = join(root, 'cache');
  const jobStoreRoot = join(root, 'jobs');
  try {
    // An orphaned in-flight job from a previous process.
    const seed = new JobStore({ root: jobStoreRoot, schemaVersion: '2.0.0', analyzerVersion: '0.2.0' });
    await seed.init();
    const orphaned = await seed.create({ dedupKey: 'k', owner: 'me', name: 'project', resolvedRevision: 'abc' });
    await seed.markStarted(orphaned.jobId);
    await seed.markPhase(orphaned.jobId, 'collecting');

    // A server that boots and is then asked nothing at all.
    const { server, app } = await serve(
      { port: 0, cacheRoot, jobStoreRoot, depth: 0, maxCandidates: 0, enableGit: false, enableRegistry: false },
      {},
      { jobStoreRoot },
    );
    try {
      // Recovery is triggered by the constructor; await the store directly so
      // the assertion does not race the background start.
      await app.analysis.ready();

      const record = app.analysis.status(orphaned.jobId);
      assert.ok(record, 'the job record still exists after restart');
      assert.equal(record.phase, 'failed', 'it is failed rather than left in-flight');
      assert.equal(record.error?.code, 'interrupted_by_restart');

      // And it is not treated as active work.
      assert.equal(app.analysis.queuedCount, 0);
      assert.equal(app.analysis.runningCount, 0);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
      app.analysis.shutdown();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an unknown job id is a typed 404', async () => {
  const h = await harness();
  try {
    const { status, body } = await getJob(h.base, '99999999-8888-7777-6666-555555555555');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'unknown_job');
  } finally {
    await h.close();
  }
});