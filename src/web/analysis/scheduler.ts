/**
 * Analysis scheduler: the thing that actually owns an analysis.
 *
 * The HTTP request that asks for work returns as soon as the job is registered.
 * From then on the job owns its own lifecycle: a browser that closes, a proxy
 * that times out, or a Cloudflare edge that drops the connection cannot stop it,
 * because none of them own the promise.
 *
 * Deduplication happens here rather than in the store, so two simultaneous
 * requests for the same repository produce one job and one analyzer run. The
 * revision-aware artifact cache still does the real caching; this only stops
 * duplicate *work*.
 */
import { AnalysisCache, analyzeWithCache } from '../../pipeline/cached-analyze.ts';
import type { AnalyzeOptions, AnalysisPhase as PipelinePhase } from '../../pipeline/analyze.ts';
import type { LineageGraph } from '../../core/model.ts';
import type { RepositoryRef } from '../../platform/url.ts';
import { JobStore } from './store.ts';
import { AnalysisRateLimiter, type RateDecision } from './ratelimit.ts';
import { dedupKey } from './dedup.ts';
import { canAdvance, canTransition, isTerminal, type AnalysisPhase, type JobRecord } from './types.ts';
import { logEvent } from './logging.ts';
import type { LogEvent } from './logging.ts';

/** Options handed to the analyzer. `onPhase` is how the state machine advances. */
export type AnalyzeInvocation = AnalyzeOptions & {
  cacheRoot: string;
  onPhase?: ((phase: PipelinePhase) => void) | undefined;
};

export interface SchedulerOptions {
  store: JobStore;
  limiter: AnalysisRateLimiter;
  cacheRoot: string;
  depth: number;
  maxCandidates: number;
  enableGit: boolean;
  enableRegistry: boolean;
  /** Graph schema version, part of the dedup key. */
  schemaVersion: string;
  /** Analyzer version, part of the dedup key. */
  analyzerVersion: string;
  /**
   * Cheap revision resolver, used to find an artifact before doing real work.
   *
   * Every accepted request pays for one probe, so it is bounded by
   * `probeTimeoutMs`. A probe that times out or fails is not fatal: it only costs
   * the cache lookup and makes the dedup key coarser, never wrong.
   */
  probeRevision: (repository: RepositoryRef) => Promise<{ commit: string | null }>;
  /** Ceiling on one probe, so a slow network cannot delay an accepted request. */
  probeTimeoutMs?: number;
  /** How long one analysis may run before the job is reported failed. */
  timeoutMs: number;
  /** Test seam: injects a failure to exercise the failed path. */
  analyzeOverride?: ((options: AnalyzeInvocation) => Promise<{ graph: LineageGraph; cacheHit: boolean }>) | undefined;
}

export type RequestOutcome =
  /** A valid artifact already existed. Nothing was started. */
  | { kind: 'complete'; graph: LineageGraph; resolvedRevision: string; artifactPath: string }
  /** A job is running or queued for this work. */
  | { kind: 'accepted'; job: JobRecord; joined: boolean; retryAfterMs: number }
  /** The caller has spent their budget for new analyses. */
  | { kind: 'rate_limited'; retryAfterSeconds: number; message: string }
  /** The queue is full; the work is not lost, it just cannot start now. */
  | { kind: 'overloaded'; retryAfterSeconds: number; message: string };

export class AnalysisScheduler {
  private readonly options: SchedulerOptions;
  private readonly cache: AnalysisCache;
  private readonly queue: string[] = [];
  private running = 0;
  /**
   * Resolves once restart recovery has run, and never rejects.
   *
   * Every entry point awaits this. Calling it from the request paths alone is
   * not enough: a server that starts and is then asked nothing would leave an
   * orphaned job marked in-flight forever, which is precisely what restart
   * recovery exists to prevent.
   */
  private readyPromise: Promise<JobRecord[]> | null = null;
  private idleWaiters: (() => void)[] = [];
  /**
   * Dedup keys whose job is being created right now.
   *
   * Creating a job is asynchronous, so two simultaneous requests for the same
   * repository would both observe "no active job" and both create one. This map
   * is written synchronously in the same turn as the active-job check, and holds
   * the in-flight creation promise so the second request can join it rather than
   * start a duplicate analysis.
   */
  private readonly creating = new Map<string, Promise<JobRecord>>();
  /** Timers that must not keep the process alive after a job settles. */
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(options: SchedulerOptions) {
    this.options = options;
    this.cache = new AnalysisCache(options.cacheRoot, 'public');
  }

  /** Idempotent, and safe to await from anywhere. */
  ready(): Promise<JobRecord[]> {
    this.readyPromise ??= (async () => {
      await this.options.store.init();
      const recovered = await this.options.store.recoverInterrupted();
      // Recovery is itself an operational event: it proves what a restart did
      // to in-flight work, which is otherwise invisible.
      for (const record of recovered) {
        logEvent('job.recovered', {
          jobId: record.jobId,
          repository: `${record.owner}/${record.name}`,
          code: record.error?.code ?? 'interrupted_by_restart',
        });
      }
      return recovered;
    })();
    return this.readyPromise;
  }

  /**
   * Starts recovery in the background, without waiting for it.
   *
   * Called from the server constructor so a restart fixes orphaned jobs even if
   * no request ever arrives. Request handlers additionally await `ready()`, so
   * correctness never depends on this having finished.
   */
  recoverInBackground(): void {
    void this.ready().catch(() => {
      // A registry that cannot be read must not stop the server from starting;
      // the request path awaits `ready()` and will surface the real error.
    });
  }

  get runningCount(): number {
    return this.running;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  status(jobId: string): JobRecord | null {
    return this.options.store.get(jobId);
  }

  /**
   * Handles a request for analysis.
   *
   * Order matters and is the whole design: an artifact is checked first (free),
   * then an existing job (free), and only then is a rate-limit token spent on
   * new work. A burst of identical requests therefore costs one token and one
   * analyzer run.
   */
  async request(repository: RepositoryRef, address: string): Promise<RequestOutcome> {
    // Restart recovery must be complete before any decision is made, so a job
    // orphaned by a previous process can never be mistaken for active work.
    await this.ready();
    const startedAt = Date.now();

    // The probe is bounded: an accepted request must not inherit a slow
    // network. If it does not answer in time we proceed without a revision,
    // which costs the artifact lookup and widens the dedup key but is safe.
    let resolvedRevision: string | null = null;
    try {
      const budget = this.options.probeTimeoutMs ?? 8_000;
      const outcome = await Promise.race([
        this.options.probeRevision(repository).then((value) => ({ kind: 'ok', value }) as const),
        new Promise<{ kind: 'timeout' }>((resolve) => {
          const timer = setTimeout(() => resolve({ kind: 'timeout' }), budget);
          timer.unref?.();
        }),
      ]);
      if (outcome.kind === 'ok') resolvedRevision = outcome.value.commit;
    } catch {
      resolvedRevision = null;
    }

    // Try the probed revision first, then any revision a previous completed run
    // of this repository established. The artifact itself is validated on read,
    // so a revision that turns out to have no artifact simply costs a recompute.
    const candidateRevisions = [resolvedRevision, this.options.store.lastCompletedRevision(repository.owner, repository.name)]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);

    for (const revision of candidateRevisions) {
      const artifact = await this.readArtifact(repository, revision);
      if (artifact) {
        logEvent('analysis.cacheHit', {
          repository: `${repository.owner}/${repository.name}`,
          resolvedRevision: revision,
          durationMs: Date.now() - startedAt,
        });
        return {
          kind: 'complete',
          graph: artifact.graph,
          resolvedRevision: revision,
          artifactPath: artifact.artifactPath,
        };
      }
    }

    // The key uses the probed revision, which is null when it could not be
    // resolved. That makes the key coarser and therefore safe: it can only join
    // requests that share an owner, name and contract version, never split one.
    const key = dedupKey({
      owner: repository.owner,
      name: repository.name,
      resolvedRevision,
      schemaVersion: this.options.schemaVersion,
      analyzerVersion: this.options.analyzerVersion,
    });

    const existing = this.options.store.findActive(key);
    if (existing) {
      // Joining is not new work, so it costs no rate-limit token.
      logEvent('analysis.joined', {
        jobId: existing.jobId,
        repository: `${repository.owner}/${repository.name}`,
        phase: existing.phase,
        queued: this.queuedCount,
        running: this.runningCount,
      });
      return { kind: 'accepted', job: existing, joined: true, retryAfterMs: this.retryAfterMs() };
    }

    // A creation for this key is already in flight: join it. Checked in the same
    // synchronous turn as the active-job lookup above, before any await, which is
    // what makes two simultaneous requests share one analysis.
    const inFlight = this.creating.get(key);
    if (inFlight) {
      const job = await inFlight;
      logEvent('analysis.joined', {
        jobId: job.jobId,
        repository: `${repository.owner}/${repository.name}`,
        phase: job.phase,
        queued: this.queuedCount,
        running: this.runningCount,
      });
      return { kind: 'accepted', job, joined: true, retryAfterMs: this.retryAfterMs() };
    }

    const decision: RateDecision = this.options.limiter.charge(address);
    if (!decision.allowed) {
      logEvent('analysis.refused', {
        repository: `${repository.owner}/${repository.name}`,
        code: 'analysis_rate_limited',
        retryAfterSeconds: decision.retryAfterSeconds,
        queueDepth: this.queue.length,
        running: this.running,
      });
      return {
        kind: 'rate_limited',
        retryAfterSeconds: decision.retryAfterSeconds ?? 60,
        message: decision.message ?? 'too many analyses started from this address',
      };
    }

    const limits = this.options.limiter.settings;
    if (this.queue.length >= limits.maxQueueDepth) {
      logEvent('analysis.refused', {
        repository: `${repository.owner}/${repository.name}`,
        code: 'analysis_overloaded',
        queueDepth: this.queue.length,
        running: this.running,
      });
      return {
        kind: 'overloaded',
        retryAfterSeconds: 30,
        message: `the analysis queue is full (${this.queue.length}/${limits.maxQueueDepth}); retry shortly`,
      };
    }

    // Claim the key before awaiting, so a concurrent request sees it immediately.
    const creation = this.options.store.create({
      dedupKey: key,
      owner: repository.owner,
      name: repository.name,
      resolvedRevision,
    });
    this.creating.set(key, creation);
    let job: JobRecord;
    try {
      job = await creation;
    } finally {
      this.creating.delete(key);
    }
    this.queue.push(job.jobId);
    logEvent('analysis.accepted', {
      jobId: job.jobId,
      repository: `${repository.owner}/${repository.name}`,
      dedupKey: job.dedupKey,
      resolvedRevision,
      queueDepth: this.queue.length,
      running: this.running,
      durationMs: Date.now() - startedAt,
    });
    this.pump();
    return { kind: 'accepted', job, joined: false, retryAfterMs: this.retryAfterMs() };
  }

  private async readArtifact(
    repository: RepositoryRef,
    commit: string,
  ): Promise<{ graph: LineageGraph; artifactPath: string } | null> {
    try {
      const graph = await this.cache.read(repository, commit);
      if (!graph) return null;
      return { graph, artifactPath: this.cache.pathFor(repository, commit) };
    } catch {
      return null;
    }
  }

  /** Poll interval hint. The client polls, so no stream is held open. */
  retryAfterMs(): number {
    return 1500;
  }

  private pump(): void {
    const limit = this.options.limiter.settings.maxConcurrent;
    while (this.running < limit && this.queue.length > 0) {
      const jobId = this.queue.shift()!;
      void this.run(jobId);
    }
    if (this.running === 0 && this.queue.length === 0) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const waiter of waiters) waiter();
    }
  }

  private async run(jobId: string): Promise<void> {
    this.running += 1;
    const store = this.options.store;
    let record = store.get(jobId);
    if (!record || isTerminal(record.phase)) {
      this.running -= 1;
      this.pump();
      return;
    }

    const timeout = setTimeout(() => {
      // The analyzer cannot be interrupted mid-flight, so the job is reported
      // failed and stops being tracked. If the computation later finishes it
      // writes an artifact that is validated before it is ever served, so this
      // cannot publish anything unvouched-for.
      const current = store.get(jobId);
      if (current && !isTerminal(current.phase)) {
        void store.markFailed(jobId, {
          code: 'analysis_timeout',
          message: `analysis exceeded ${this.options.timeoutMs}ms`,
        });
        logEvent('analysis.failed', {
          jobId,
          repository: `${current.owner}/${current.name}`,
          code: 'analysis_timeout',
          durationMs: Date.now() - new Date(current.createdAt).getTime(),
          queueDepth: this.queue.length,
          running: this.running,
        });
      }
    }, this.options.timeoutMs);
    this.timers.add(timeout);

    try {
      record = await store.markStarted(jobId);
      const target = `${record.owner}/${record.name}`;
      logEvent('analysis.started', {
        jobId,
        repository: target,
        resolvedRevision: record.resolvedRevision,
        queueDepth: this.queue.length,
        running: this.running,
      });

      // Phases come from the analyzer itself, not from a timer, so a reported
      // phase has genuinely been reached.
      const onPhase = (phase: AnalysisPhase): void => {
        const current = store.get(jobId);
        if (!current || isTerminal(current.phase)) return;
        // Idempotent: `resolving` is both the first real phase and the marked
        // start state.
        if (current.phase === phase) return;
        if (!canAdvance(current.phase, phase)) return;
        if (current.phase === phase) return;
        void store.markPhase(jobId, phase);
        logEvent('analysis.phase', {
          jobId,
          repository: `${current.owner}/${current.name}`,
          phase,
          queueDepth: this.queue.length,
          running: this.running,
        });
      };

      const repository = { provider: 'github' as const, owner: record.owner, name: record.name };
      let result: { graph: LineageGraph; cacheHit: boolean };

      if (this.options.analyzeOverride) {
        const produced = await this.options.analyzeOverride({
          target,
          depth: this.options.depth,
          cacheRoot: this.options.cacheRoot,
          maxCandidates: this.options.maxCandidates,
          enableGit: this.options.enableGit,
          enableRegistry: this.options.enableRegistry,
          probeRevision: this.options.probeRevision,
          onPhase,
        });
        // An injected analyzer bypasses the cache writer, so the artifact is
        // stored here. Without this a test or alternate pipeline would complete
        // a job and leave nothing behind for the next reader to find.
        const commit = produced.graph.graph.revision.commit;
        if (!(await this.readArtifact(repository, commit))) {
          await this.cache.write(repository, commit, produced.graph);
        }
        result = produced;
      } else {
        result = await analyzeWithCache({
          target,
          depth: this.options.depth,
          cacheRoot: this.options.cacheRoot,
          maxCandidates: this.options.maxCandidates,
          enableGit: this.options.enableGit,
          enableRegistry: this.options.enableRegistry,
          probeRevision: this.options.probeRevision,
          onPhase,
        });
      }

      // The artifact store is the last step and happens in `analyzeWithCache`,
      // not inside `analyze()`, so `publishing` is recorded here rather than
      // being inferred from a timer.
      const beforePublish = store.get(jobId);
      if (beforePublish && canTransition(beforePublish.phase, 'publishing')) {
        await store.markPhase(jobId, 'publishing');
      }
      const completed = await store.markComplete(jobId, result.graph.graph.revision.commit);
      logEvent('analysis.completed', {
        jobId,
        repository: `${record.owner}/${record.name}`,
        resolvedRevision: completed.resolvedRevision,
        cacheHit: result.cacheHit === true,
        // Server-measured, so it is trustworthy even if every poll was delayed.
        durationMs: new Date(completed.finishedAt ?? Date.now()).getTime() - new Date(record.createdAt).getTime(),
        queueDepth: this.queue.length,
        running: this.running,
      });
    } catch (error) {
      const current = store.get(jobId);
      if (current && !isTerminal(current.phase)) {
        const code = error instanceof Error && error.name === 'AbortError' ? 'analysis_aborted' : 'analysis_failed';
        await store.markFailed(jobId, {
          code: 'analysis_failed',
          message: error instanceof Error ? error.message : String(error),
        });
        logEvent('analysis.failed', {
          jobId,
          repository: `${current.owner}/${current.name}`,
          code,
          message: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - new Date(current.createdAt).getTime(),
          queueDepth: this.queue.length,
          running: this.running,
        });
      }
    } finally {
      clearTimeout(timeout);
      this.timers.delete(timeout);
      this.running -= 1;
      this.pump();
    }
  }

  /** Resolves when nothing is running or queued. Used by tests and shutdown. */
  async whenIdle(): Promise<void> {
    if (this.running === 0 && this.queue.length === 0) return;
    await new Promise<void>((resolve) => {
      this.idleWaiters.push(resolve);
    });
  }

  /** Waits for one job to reach a terminal phase. Used by tests. */
  async waitForTerminal(jobId: string, timeoutMs = 60_000): Promise<JobRecord> {
    const started = Date.now();
    for (;;) {
      const record = this.options.store.get(jobId);
      if (record && isTerminal(record.phase)) return record;
      if (Date.now() - started > timeoutMs) {
        throw new Error(`job ${jobId} did not reach a terminal phase within ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  shutdown(): void {
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
  }
}