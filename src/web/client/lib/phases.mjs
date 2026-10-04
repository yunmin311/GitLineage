/**
 * Analysis-phase dial.
 *
 * Six real phases, an arm that eases to the current one and stops, and a settled
 * resting state. There is no percentage anywhere: the server reports a phase only
 * once it has reached it, and between two stages there is nothing honest to
 * interpolate.
 */
/**
 * The phases the analyser actually reports, in order.
 *
 * Read from `VISIBLE_PHASES` rather than declared here. The client already owns the
 * canonical list, the server's own transition guard is built from the same order, and
 * a dial with its own copy would drift from both -- which is how a UI ends up
 * promising a stage the analyser never reaches.
 *
 * `failed` is deliberately absent: a failed analysis is not a point on the progress
 * dial, it is an outcome, and the failure overlay says so in words.
 */
import { VISIBLE_PHASES, PHASE_TEXT } from './analysis.mjs';

export const PHASES = Object.freeze([...VISIBLE_PHASES, 'complete']);

/** The settled phase, which the analyser's terminal transition reaches. */
export const SETTLED_PHASE = 'complete';

/** How long the arm takes to reach a notch, in ms. Long enough to read as motion. */
export const ARM_EASE_MS = 420;

/** The label for a notch, in the client's own plain language. */
export function phaseLabel(phase) {
  return PHASE_TEXT[phase] || phase;
}

/** The dial's sweep, in degrees. A half turn: enough to read, not a gauge. */
export const DIAL_SWEEP_DEG = 150;

/**
 * The angle for a phase.
 *
 * Index 0 sits at the start of the sweep and the last phase at its end, so the arm
 * travels once across the whole analysis and rests on the final notch.
 */
export function phaseAngle(index) {
  const clamped = Math.max(0, Math.min(PHASES.length - 1, Math.floor(index)));
  if (PHASES.length === 1) return 0;
  return -DIAL_SWEEP_DEG / 2 + (DIAL_SWEEP_DEG * clamped) / (PHASES.length - 1);
}

/**
 * The index of a phase in the dial.
 *
 * Distinct from `analysis.mjs`'s helper on purpose: the dial includes the settled
 * phase, which `VISIBLE_PHASES` does not, because the arm has to come to rest
 * somewhere.
 *
 * An unknown or missing phase resolves to 0 rather than to the end: reporting an
 * analysis as finished because the phase name was not recognised would be a lie
 * about work nobody has shown to be done.
 */
export function phaseIndex(phase) {
  const index = PHASES.indexOf(phase);
  // An unrecognised phase resolves to the start, never to the end: reporting an
  // analysis as finished because a phase name was not recognised would be a lie
  // about work nobody has shown to be done.
  return index === -1 ? 0 : index;
}

/** Whether the dial has settled: the analysis reported its final phase. */
export function isSettled(phase) {
  return phase === SETTLED_PHASE;
}

/**
 * The transition to apply, or null when the phase has not moved.
 *
 * Returning null matters: a re-render at the same phase must not restart the
 * easing, or the arm would twitch on every poll. The server polls repeatedly while
 * an analysis runs, and a phase that has not changed is the common case.
 */
export function phaseTransition(previous, next) {
  if (next === previous) return null;
  return { from: phaseIndex(previous), to: phaseIndex(next), ms: ARM_EASE_MS };
}