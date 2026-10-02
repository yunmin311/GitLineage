/**
 * Async analysis client.
 *
 * The job owns the analysis; this only observes it. Nothing here holds a request
 * open for the duration of an analysis, and nothing here invents progress: the
 * phases rendered are the phases the server reports, which the server only
 * reports when they have genuinely been reached.
 *
 * The phase names are duplicated rather than imported because this file is a
 * browser module served to the client, and the server-side state machine lives
 * behind a Node-only module boundary. The duplication is deliberate and is
 * covered by the test asserting both lists agree.
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
];

const TERMINAL = new Set(['complete', 'failed']);

export function isTerminal(status) {
  return TERMINAL.has(status);
}

export function isAnalysisPhase(value) {
  return ANALYSIS_PHASES.includes(value);
}

/** What the client should do, derived only from real server state. */
export function parseStart(payload, headers) {
  const body = payload ?? {};
  const retryAfterSeconds = (headers && headers.get && headers.get('retry-after')) ?? null;

  if (body.status === 'complete') {
    return { kind: 'complete', resolvedRevision: String(body.resolvedRevision ?? '') };
  }
if (typeof body.jobId === 'string' && body.jobId.length > 0) {
  const hint = positiveInt(retryAfterSeconds, 0) * 1000;
  return {
    kind: 'polling',
    jobId: body.jobId,
    // The phase the server reported with the acceptance. Falls back to `queued`,
    // which is the state an accepted job is in by definition.
    status: isAnalysisPhase(body.status) ? body.status : 'queued',
    statusUrl: String(body.statusUrl ?? `/api/analysis/jobs/${body.jobId}`),
    retryAfterMs: hint > 0 ? hint : positiveInt(body.retryAfterMs, 1500),
    joined: body.joined === true,
  };
}
  if (body.error && typeof body.error.code === 'string') {
    const hint = positiveInt(retryAfterSeconds, 30);
    return {
      kind: 'refused',
      code: body.error.code,
      message: String(body.error.message ?? 'analysis could not be started'),
      retryAfterMs: hint * 1000,
    };
  }
  return { kind: 'invalid', message: 'the server returned an unrecognised response' };
}

/** Parses `GET /api/analysis/jobs/:jobId`. Returns null for anything unknown. */
export function parseJob(payload) {
  const body = payload ?? {};
  const envelope = body.data ?? body;
  const status = envelope.status;
  if (!isAnalysisPhase(status)) return null;
  return {
    jobId: String(envelope.jobId ?? ''),
    status,
    repository: String(envelope.repository ?? ''),
    resolvedRevision: envelope.resolvedRevision ?? null,
    createdAt: String(envelope.createdAt ?? ''),
    error: envelope.error ?? null,
  };
}

/**
 * Phases a visitor is shown, in order.
 *
 * `queued` is included because waiting behind the concurrency cap is a real
 * state. There is no percentage anywhere: there is nothing honest to
 * interpolate between two stages.
 */
export const VISIBLE_PHASES = [
  'queued',
  'resolving',
  'collecting',
  'resolving_relationships',
  'validating',
  'publishing',
];

/** Plain-language description of each phase. */
export const PHASE_TEXT = {
  queued: 'Waiting for an analysis slot',
  resolving: 'Resolving the repository and its revision',
  collecting: 'Reading manifests, documents and git history',
  resolving_relationships: 'Matching candidate repositories',
  validating: 'Checking the graph against the contract',
  publishing: 'Writing the artifact',
  complete: 'Analysis complete',
  failed: 'Analysis failed',
};

/** Index of the current phase, for a stepped indicator. */
export function phaseIndex(status) {
  const index = VISIBLE_PHASES.indexOf(status);
  return index < 0 ? 0 : index;
}

/**
 * Whether to keep polling.
 *
 * Stops on a terminal phase and on an unrecognised one, so the client can never
 * spin forever on a server it does not understand.
 */
export function shouldPoll(status) {
  return status !== null && status !== undefined && !isTerminal(status) && isAnalysisPhase(status);
}

/**
 * Next poll delay, bounded so neither a server hint nor a long wait can stall or
 * thrash the page.
 */
export function nextDelayMs(hintMs, elapsedSinceLastPollMs) {
  const hinted = positiveInt(String(hintMs ?? ''), 1500);
  const backoff = Math.min(Number(elapsedSinceLastPollMs ?? 0) / 4000, 1);
  return Math.min(Math.round(hinted * (1 + backoff)), 5000);
}

/**
 * The message for a refused request.
 *
 * A rate limit and a full queue are different problems for the visitor, so they
 * are not collapsed into one generic error.
 */
export function refusalText(outcome) {
  switch (outcome.code) {
    case 'analysis_rate_limited':
      return 'Too many analyses have been started from this address. Try again shortly.';
    case 'analysis_overloaded':
      return 'Every analysis slot is busy and the queue is full. Try again in a moment.';
    case 'analysis_timeout':
      return 'The analysis took too long and was stopped. Asking again starts a fresh one.';
    case 'interrupted_by_restart':
      return 'The server restarted during this analysis. Asking again starts a fresh one.';
    default:
      return outcome.message;
  }
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}