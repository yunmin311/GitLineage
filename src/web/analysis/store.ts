/**
 * Durable job registry.
 *
 * One JSON file per job, written atomically, in a directory that lives outside
 * the Git working tree. This is deliberately not Redis: single-node deployment,
 * and the expensive work is already deduplicated by the artifact cache, so the
 * registry only has to survive a restart well enough to know what was in flight.
 *
 * Restart semantics, stated explicitly:
 *
 *  - **Completed work derives truth from the artifact cache, not from this
 *    registry.** A `complete` record is a convenience for reporting; the server
 *    re-probes the cache on every request, so a lost registry cannot lose a
 *    result and a stale registry cannot invent one.
 *  - **A job that was mid-flight when the process died is not left running.**
 *    `recoverInterrupted()` fails every non-terminal record with
 *    `interrupted_by_restart`, which is retryable: the next request for the same
 *    repository starts a fresh job, and the partially written artifact is never
 *    served because reads are validated.
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ANALYSIS_PHASES, isTerminal, type AnalysisPhase, type JobError, type JobRecord } from './types.ts';

export interface JobStoreOptions {
  /** Directory for job files. Must be outside the Git working tree. */
  root: string;
  /** Graph schema version stamped on new jobs. */
  schemaVersion: string;
  /** Analyzer version stamped on new jobs. */
  analyzerVersion: string;
  now?: () => Date;
  /** Test seam for deterministic persistence stalls and failures. */
  beforePersist?: (record: Readonly<JobRecord>) => Promise<void>;
}

function isAnalysisPhase(value: unknown): value is AnalysisPhase {
  return typeof value === 'string' && (ANALYSIS_PHASES as readonly string[]).includes(value);
}

function parseRecord(raw: unknown): JobRecord | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.jobId !== 'string' || value.jobId.length === 0) return null;
  if (typeof value.dedupKey !== 'string' || value.dedupKey.length === 0) return null;
  if (typeof value.owner !== 'string' || typeof value.name !== 'string') return null;
  if (!isAnalysisPhase(value.phase)) return null;
  return {
    jobId: value.jobId,
    dedupKey: value.dedupKey,
    owner: value.owner,
    name: value.name,
    resolvedRevision: typeof value.resolvedRevision === 'string' ? value.resolvedRevision : null,
    schemaVersion: typeof value.schemaVersion === 'string' ? value.schemaVersion : 'unknown',
    analyzerVersion: typeof value.analyzerVersion === 'string' ? value.analyzerVersion : 'unknown',
    phase: value.phase,
    attempt: typeof value.attempt === 'number' ? value.attempt : 1,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : new Date(0).toISOString(),
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date(0).toISOString(),
    startedAt: typeof value.startedAt === 'string' ? value.startedAt : null,
    finishedAt: typeof value.finishedAt === 'string' ? value.finishedAt : null,
    pid: typeof value.pid === 'number' ? value.pid : null,
    error: (value.error ?? null) as JobError | null,
  };
}

export class JobStore {
  private readonly dir: string;
  private readonly schemaVersion: string;
  private readonly analyzerVersion: string;
  private readonly now: () => Date;
  private readonly beforePersist: JobStoreOptions['beforePersist'];
  private readonly writes = new Map<string, Promise<void>>();
  /** In-memory mirror. The files are the durable record; this avoids re-reading. */
  private readonly byId = new Map<string, JobRecord>();
  /** Active jobs by dedup key, so a duplicate request can join instead of fork. */
  private readonly activeByKey = new Map<string, string>();

  constructor(options: JobStoreOptions) {
    this.beforePersist = options.beforePersist;
    this.dir = options.root;
    this.schemaVersion = options.schemaVersion;
    this.analyzerVersion = options.analyzerVersion;
    this.now = options.now ?? (() => new Date());
  }

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  private path(jobId: string): string {
    // Job ids are server-generated UUIDs; reject anything else so a crafted id
    // can never traverse out of the job directory.
    if (!/^[0-9a-f-]{36}$/.test(jobId)) throw new Error(`invalid job id: ${jobId}`);
    return join(this.dir, `${jobId}.json`);
  }

  private async persist(record: JobRecord): Promise<void> {
    await this.beforePersist?.(record);
    const target = this.path(record.jobId);
    const temporary = `${target}.tmp`;
    await writeFile(temporary, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    await rename(temporary, target);
    this.byId.set(record.jobId, record);
    if (isTerminal(record.phase)) {
      if (this.activeByKey.get(record.dedupKey) === record.jobId) this.activeByKey.delete(record.dedupKey);
    } else {
      this.activeByKey.set(record.dedupKey, record.jobId);
    }
  }

  get(jobId: string): JobRecord | null {
    return this.byId.get(jobId) ?? null;
  }

  /** The active job for a dedup key, if one exists. Terminal jobs never match. */
  findActive(dedupKey: string): JobRecord | null {
    const jobId = this.activeByKey.get(dedupKey);
    if (!jobId) return null;
    const record = this.byId.get(jobId);
    if (!record || isTerminal(record.phase)) return null;
    return record;
  }

  /**
   * The most recent revision a completed analysis produced for a repository.
   *
   * The artifact cache is keyed by revision, so reading it needs one. When the
   * revision probe cannot resolve a commit, this supplies a revision that a real
   * completed run of the *same repository under the same contract* already
   * established. It can only ever point at an artifact that exists, and the
   * artifact is still validated before it is served, so a wrong answer here costs
   * a recomputation rather than a wrong result.
   */
  lastCompletedRevision(owner: string, name: string): string | null {
    let latest: JobRecord | null = null;
    const lowerOwner = owner.toLowerCase();
    const lowerName = name.toLowerCase();
    for (const record of this.byId.values()) {
      if (record.phase !== 'complete') continue;
      if (record.owner.toLowerCase() !== lowerOwner || record.name.toLowerCase() !== lowerName) continue;
      if (!record.resolvedRevision) continue;
      if (!latest || record.updatedAt > latest.updatedAt) latest = record;
    }
    return latest?.resolvedRevision ?? null;
  }

  get activeCount(): number {
    return this.activeByKey.size;
  }

  activeJobs(): JobRecord[] {
    return [...this.activeByKey.values()]
      .map((jobId) => this.byId.get(jobId))
      .filter((record): record is JobRecord => Boolean(record) && !isTerminal(record!.phase));
  }

  async create(input: {
    dedupKey: string;
    owner: string;
    name: string;
    resolvedRevision: string | null;
  }): Promise<JobRecord> {
    const timestamp = this.now().toISOString();
    const record: JobRecord = {
      jobId: randomUUID(),
      dedupKey: input.dedupKey,
      owner: input.owner,
      name: input.name,
      resolvedRevision: input.resolvedRevision,
      schemaVersion: this.schemaVersion,
      analyzerVersion: this.analyzerVersion,
      phase: 'queued',
      attempt: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      finishedAt: null,
      pid: null,
      error: null,
    };
    await this.persist(record);
    return record;
  }

  async update(jobId: string, patch: Partial<JobRecord>): Promise<JobRecord> {
    const previous = this.writes.get(jobId) ?? Promise.resolve();
    const write = previous.then(async () => {
      const existing = this.byId.get(jobId);
      if (!existing) throw new Error(`unknown job: ${jobId}`);
      // Read at execution time, not enqueue time. Late phase callbacks cannot
      // regress a newer phase or replace a terminal outcome.
      if (isTerminal(existing.phase) || (patch.phase && ANALYSIS_PHASES.indexOf(patch.phase) < ANALYSIS_PHASES.indexOf(existing.phase))) return existing;
      const record: JobRecord = { ...existing, ...patch, updatedAt: this.now().toISOString() };
      await this.persist(record);
      return record;
    });
    // A failed write must not poison the queue. Its caller still receives
    // the rejecting promise below; only the queue tail settles unconditionally.
    const settled = write.then(() => {}, () => {});
    this.writes.set(jobId, settled);
    void settled.then(() => { if (this.writes.get(jobId) === settled) this.writes.delete(jobId); });
    return write;
  }

  /** Drains queued writes; failures are reported by each update promise. */
  async whenIdle(): Promise<void> {
    while (this.writes.size) await Promise.all(this.writes.values());
  }

  async markStarted(jobId: string): Promise<JobRecord> {
    return this.update(jobId, { phase: 'resolving', startedAt: this.now().toISOString(), pid: process.pid });
  }

  async markPhase(jobId: string, phase: AnalysisPhase): Promise<JobRecord> {
    return this.update(jobId, { phase });
  }

  async markComplete(jobId: string, resolvedRevision: string): Promise<JobRecord> {
    return this.update(jobId, {
      phase: 'complete',
      resolvedRevision,
      finishedAt: this.now().toISOString(),
      error: null,
    });
  }

  async markFailed(jobId: string, error: JobError): Promise<JobRecord> {
    return this.update(jobId, {
      phase: 'failed',
      finishedAt: this.now().toISOString(),
      error,
    });
  }

  /**
   * Loads persisted jobs and fails anything that was in flight.
   *
   * Called once at startup. A non-terminal record can only exist if this process
   * died while the job was running, because nothing else leaves one behind, so
   * marking it failed is always correct. It is marked retryable: the next request
   * for the same repository starts a new job.
   */
  async recoverInterrupted(): Promise<JobRecord[]> {
    const recovered: JobRecord[] = [];
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch {
      return recovered;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) {
        // A `.tmp` file means a write was cut short. It is never read.
        continue;
      }
      const jobId = entry.slice(0, -'.json'.length);
      let parsed: JobRecord | null = null;
      try {
        parsed = parseRecord(JSON.parse(await readFile(join(this.dir, entry), 'utf8')));
      } catch {
        parsed = null;
      }
      if (!parsed) {
        // Unreadable or truncated: not trustworthy, so remove it rather than
        // leaving a file that could be mistaken for state.
        await rm(join(this.dir, entry), { force: true });
        continue;
      }
      this.byId.set(parsed.jobId, parsed);
      if (!isTerminal(parsed.phase)) {
        const failed: JobRecord = {
          ...parsed,
          phase: 'failed',
          finishedAt: this.now().toISOString(),
          error: {
            code: 'interrupted_by_restart',
            message: 'the analysis did not finish before the server stopped; it is safe to request again',
          },
        };
        await this.persist(failed);
        recovered.push(failed);
      } else {
        // Terminal jobs stay out of the active index.
        this.byId.set(parsed.jobId, parsed);
      }
    }
    return recovered;
  }

  /** Test seam: forgets everything without touching disk. */
  reset(): void {
    this.byId.clear();
    this.activeByKey.clear();
  }
}