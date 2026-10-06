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

/**
 * The five RUNNING phases, in order.
 *
 * Derived from `VISIBLE_PHASES` rather than declared, so there is still exactly one list
 * of what the analyser reports and this cannot drift from it. `queued` is removed because
 * it is not a running phase: it is the FSM state an accepted job is in while it waits for
 * a slot, before any pipeline stage has begun.
 *
 * `complete` and `failed` are absent for the same reason and are not running phases
 * either. Both are terminal, and neither is a point on a progress axis.
 */
export const RUNNING_PHASES = Object.freeze(
  VISIBLE_PHASES.filter((phase) => phase !== 'queued'),
);

/**
 * The Analysis surface's own copy for each running phase.
 *
 * Presentation only. `k` is the canonical machine identifier, which is why it is also what
 * the surface prints in mono beside the ordinal; `t` is a human sentence and is never
 * machine-parsed.
 *
 * No field here is per-repository and none is computed: `s` describes what the phase is
 * for, and `v` says what it does and -- for `collecting` -- states outright that the
 * contract has no sub-progress event, so the absence is visible rather than implied.
 */
export const ANALYSIS_PHASE_TEXT = Object.freeze({
  resolving: {
    k: 'resolving',
    t: 'Resolving the repository',
    s: 'provider metadata \u00b7 default branch \u00b7 head commit',
    v: 'Resolving the repository reference, its default branch and the head commit the analysis will read.',
  },
  collecting: {
    k: 'collecting',
    t: 'Collecting evidence',
    s: 'manifests \u00b7 documents \u00b7 submodules \u00b7 history \u00b7 blobs',
    v: 'Reading the evidence sources available in this repository. This phase does not report sub-progress, because the contract has no event for it.',
  },
  resolving_relationships: {
    k: 'resolving_relationships',
    t: 'Resolving relationships',
    s: 'evidence records \u2192 canonical relationship types',
    v: 'Each collected record is resolved against the ontology into one of ten canonical relationship types.',
  },
  validating: {
    k: 'validating',
    t: 'Validating the graph',
    s: 'schema 2.0.0',
    v: 'The assembled graph is validated against schema 2.0.0 before anything is shown.',
  },
  publishing: {
    k: 'publishing',
    t: 'Publishing',
    s: 'graph.json',
    v: 'The validated graph is written and made available to the explorer.',
  },
});

/**
 * The terminal and pre-phase states, described as FSM states rather than as progress.
 *
 * `queued` is not phase zero of five. It is a job that has been accepted and is waiting
 * for a slot, and the surface says so in words rather than pointing at a segment.
 */
export const ANALYSIS_FSM_TEXT = Object.freeze({
  queued: {
    key: 'queued',
    title: 'Waiting for an analysis slot',
    sub: 'the job is accepted \u00b7 it has not entered phase 1 yet',
    verb: 'The analysis is queued behind the concurrency cap. It has not begun resolving the repository, so no phase is current.',
  },
  complete: {
    key: 'terminal state \u00b7 complete',
    title: 'Analysis complete',
    sub: 'graph.json validated against schema 2.0.0',
    verb: 'The job reached its terminal complete state. This is a job FSM state, not one of the five running phases.',
  },
  failed: {
    key: 'terminal state \u00b7 failed',
    title: 'Analysis failed',
    sub: 'the job did not complete',
    verb: 'The job reached its terminal failed state. This is a job FSM state, not one of the five running phases.',
  },
});

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