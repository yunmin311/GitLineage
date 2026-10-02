/**
 * Types for the client's async analysis module.
 *
 * See `url-state.d.mts` for why these are declared rather than compiled. The
 * phase union is spelled out explicitly rather than imported from the Node-side
 * state machine, because this module is served to the browser across a module
 * boundary; `test/web-analysis-client.test.ts` asserts the two lists agree.
 */
export type AnalysisPhase =
  | 'queued'
  | 'resolving'
  | 'collecting'
  | 'resolving_relationships'
  | 'validating'
  | 'publishing'
  | 'complete'
  | 'failed';

export interface StartComplete {
  kind: 'complete';
  resolvedRevision: string;
}

export interface StartPolling {
  kind: 'polling';
  jobId: string;
  /** The phase the server reported when it accepted the request. */
  status: AnalysisPhase;
  statusUrl: string;
  retryAfterMs: number;
  /** True when this request joined a job that was already running. */
  joined: boolean;
}

export interface StartRefused {
  kind: 'refused';
  code: string;
  message: string;
  retryAfterMs: number;
}

export interface StartInvalid {
  kind: 'invalid';
  message: string;
}

export type StartOutcome = StartComplete | StartPolling | StartRefused | StartInvalid;

export interface JobStatus {
  jobId: string;
  status: AnalysisPhase;
  repository: string;
  resolvedRevision: string | null;
  createdAt: string;
  error: { code: string; message: string; detail?: string } | null;
}

export declare const ANALYSIS_PHASES: readonly AnalysisPhase[];
export declare const VISIBLE_PHASES: readonly AnalysisPhase[];
export declare const PHASE_TEXT: Readonly<Record<AnalysisPhase, string>>;

export declare function isTerminal(status: AnalysisPhase): boolean;
export declare function isAnalysisPhase(value: unknown): value is AnalysisPhase;
export declare function parseStart(payload: unknown, headers?: Headers): StartOutcome;
export declare function parseJob(payload: unknown): JobStatus | null;
export declare function shouldPoll(status: AnalysisPhase | null | undefined): boolean;
export declare function nextDelayMs(hintMs: number | string | null | undefined, elapsedSinceLastPollMs: number): number;
export declare function phaseIndex(status: AnalysisPhase): number;
export declare function refusalText(outcome: StartRefused): string;