/**
 * Analysis job contract.
 *
 * The HTTP request that asks for an analysis must not be the thing that owns it.
 * A cold analysis of a large repository takes minutes, which is longer than any
 * reverse proxy or CDN will hold a request open, so analysis is a job with its
 * own lifecycle and the browser only observes it.
 *
 * These phases are the real stages of the pipeline. Nothing here is a
 * percentage, an estimate or a timer: `analyze()` emits each one as it reaches
 * the corresponding stage, so a phase that is reported has actually started.
 */
import type { EvidenceStatus, RelationshipType } from '../../core/model.ts';

/**
 * The finite state machine.
 *
 * ```
 * queued -> resolving -> collecting -> resolving_relationships
 *        -> validating -> publishing -> complete
 * ```
 *
 * and from any non-terminal phase, `failed`. `queued` means accepted but not yet
 * started; the intermediate phases mean started and in progress. There is no
 * percentage because there is nothing honest to interpolate.
 */
export const ANALYSIS_PHASES = [
  'queued',
  'resolving',
  'collecting',
  'resolving_relationships',
  'validating',
  'publishing',
  'complete',
  'failed',
] as const;

export type AnalysisPhase = (typeof ANALYSIS_PHASES)[number];

/** Phases from which no further transition is possible. */
export const TERMINAL_PHASES: ReadonlySet<AnalysisPhase> = new Set<AnalysisPhase>(['complete', 'failed']);

/** Phases a running job can pass through, in order. */
export const RUNNING_PHASES: readonly AnalysisPhase[] = [
  'resolving',
  'collecting',
  'resolving_relationships',
  'validating',
  'publishing',
];

/**
 * Legal transitions. Enforced rather than documented, so an out-of-order phase
 * report is a programming error that throws rather than a state a client can
 * observe.
 */
const ALLOWED: Readonly<Record<AnalysisPhase, readonly AnalysisPhase[]>> = {
  queued: ['resolving', 'failed'],
  resolving: ['collecting', 'failed'],
  collecting: ['resolving_relationships', 'failed'],
  resolving_relationships: ['validating', 'failed'],
  validating: ['publishing', 'failed'],
  publishing: ['complete', 'failed'],
  // Terminal states are terminal.
  complete: [],
  failed: [],
};

/**
 * Whether advancing to `to` is legal, treating a repeat of the current phase as a
 * no-op rather than an error.
 *
 * `resolving` is both the marked start state and the first real phase the
 * analyzer reports, so the same phase can legitimately arrive twice.
 */
export function canAdvance(from: AnalysisPhase, to: AnalysisPhase): boolean {
  return from === to || canTransition(from, to);
}

export function canTransition(from: AnalysisPhase, to: AnalysisPhase): boolean {
  return ALLOWED[from].includes(to);
}

export function isTerminal(phase: AnalysisPhase): boolean {
  return TERMINAL_PHASES.has(phase);
}

export interface JobError {
  code: string;
  message: string;
  detail?: string;
}

/**
 * A job as persisted on disk.
 *
 * This is the durable record, not the wire format: it carries the fields needed
 * to decide what to do after a restart (pid, attempt, timings) that a client has
 * no business seeing.
 */
export interface JobRecord {
  jobId: string;
  /**
   * Identity of the *work*, not of the request. Two visitors asking for the same
   * repository at the same revision and contract version share one job.
   */
  dedupKey: string;
  owner: string;
  name: string;
  /** Set once the revision is known; `null` while only the target is known. */
  resolvedRevision: string | null;
  schemaVersion: string;
  analyzerVersion: string;
  phase: AnalysisPhase;
  attempt: number;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  /** Process id of the worker, used to detect a job orphaned by a restart. */
  pid: number | null;
  error: JobError | null;
}

/** The public view of a job. No pid, no paths, no internal error detail. */
export interface JobStatus {
  jobId: string;
  status: AnalysisPhase;
  repository: string;
  resolvedRevision: string | null;
  schemaVersion: string;
  analyzerVersion: string;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: JobError | null;
  /** Present once complete. */
  graphUrl?: string;
  viewUrl?: string;
}

export function toStatus(record: JobRecord): JobStatus {
  const repository = `${record.owner}/${record.name}`;
  const status: JobStatus = {
    jobId: record.jobId,
    status: record.phase,
    repository,
    resolvedRevision: record.resolvedRevision,
    schemaVersion: record.schemaVersion,
    analyzerVersion: record.analyzerVersion,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    error: record.error,
  };
  if (record.phase === 'complete') {
    status.graphUrl = `/api/graph/${record.owner}/${record.name}`;
    status.viewUrl = `/api/view/${record.owner}/${record.name}`;
  }
  return status;
}

/** Evidence kept for the bundle representative cards the client renders. */
export interface BundleSummary {
  key: string;
  relationshipType: RelationshipType;
  status: EvidenceStatus;
  count: number;
  label: string;
}