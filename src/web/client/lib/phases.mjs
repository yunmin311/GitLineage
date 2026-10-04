/**
 * The analysis tracer.
 *
 * Seven real phases on an OPEN ARC, a tracer resting on the one the analyser has
 * actually reached, and a settled resting state. No percentage anywhere: the server
 * reports a phase only once it has reached it, and between two phases there is
 * nothing honest to interpolate.
 *
 * It replaces a closed dial with an arm, and the reason is not decoration. A closed
 * dial with a hand is a clock, and a clock on a screen is read as a claim about
 * elapsed time -- which nobody can verify, because the instrument is the only source
 * of its own duration. An open arc makes no such claim: it is a row of seven marks,
 * some filled, with one tracer on it. It says which step, not how long.
 */
import { VISIBLE_PHASES, PHASE_TEXT } from './analysis.mjs';

/**
 * The phases the analyser actually reports, in order.
 *
 * Read from `VISIBLE_PHASES` rather than declared here. The client already owns the
 * canonical list, the server's own transition guard is built from the same order, and
 * a tracer with its own copy would drift from both -- which is how a UI ends up
 * promising a stage the analyser never reaches.
 *
 * `failed` is deliberately absent: a failed analysis is not a point on the tracer, it
 * is an outcome, and the failure overlay says so in words.
 */
export const PHASES = Object.freeze([...VISIBLE_PHASES, 'complete']);

/** The settled phase, which the analyser's terminal transition reaches. */
export const SETTLED_PHASE = 'complete';

/** How long the tracer takes to arrive on a segment, in ms. Long enough to read as motion. */
export const TRACER_EASE_MS = 420;

/** The label for a phase, in the client's own plain language. */
export function phaseLabel(phase) {
  return PHASE_TEXT[phase] || phase;
}

/**
 * The arc's geometry, in the tracer's own SVG units.
 *
 * A shallow downward-bulging arc, 110 degrees of it, drawn from a centre that sits
 * *above* the curve. Three consequences, all of them the point:
 *
 *  - The ends are visibly open. There is no ring, so there is no dial face, and
 *    nothing about the shape invites reading it as one.
 *  - It is short enough to sit in a 46px strip beside seven names, which is where the
 *    phases now live.
 *  - The tracer moves along a path whose length is proportional to real progress, so
 *    resting further along means strictly more work done -- the one thing the old
 *    dial got right.
 */
export const TRACER_ARC = Object.freeze({ cx: 21, cy: 4, r: 13 });

/** The arc's sweep in degrees. Open by construction: 110 is not a circle. */
export const TRACER_SWEEP_DEG = 110;

/** One segment's share of the sweep. */
export const TRACER_STEP_DEG = TRACER_SWEEP_DEG / PHASES.length;

/**
 * The start angle of a phase's segment.
 *
 * Index 0 sits at the start of the sweep and the last phase at its end, so the tracer
 * travels once across the whole analysis and rests on the final segment.
 *
 * Angles are in SVG space: y grows downward, so 90 degrees is the bottom of the arc.
 */
export function phaseStartAngle(index) {
  const clamped = clampIndex(index);
  // 90 - sweep/2 puts the middle of the sweep at the bottom of the arc, which is where
  // the bulge belongs.
  return 90 - TRACER_SWEEP_DEG / 2 + TRACER_STEP_DEG * clamped;
}

/** The end angle of a phase's segment. */
export function phaseEndAngle(index) {
  return phaseStartAngle(index) + TRACER_STEP_DEG;
}

/** Clamps an index into the arc's range; an out-of-range index bends to the ends. */
function clampIndex(index) {
  const value = Number.isFinite(index) ? Math.floor(index) : 0;
  return Math.max(0, Math.min(PHASES.length - 1, value));
}

/** A point on the arc, at an angle in degrees. */
function arcPoint(deg) {
  const rad = (deg * Math.PI) / 180;
  return {
    x: TRACER_ARC.cx + TRACER_ARC.r * Math.cos(rad),
    y: TRACER_ARC.cy + TRACER_ARC.r * Math.sin(rad),
  };
}

/**
 * The `d` for one phase's segment.
 *
 * A true elliptical arc, not a polyline: at 15.7 degrees a chord approximation is
 * visibly faceted at this size, and a faceted segment next to smooth neighbours reads
 * as a rendering fault rather than as a step. Sweep flag 1 walks clockwise in SVG's
 * coordinate system, which is what increasing angle means here.
 */
export function arcSegment(index) {
  const clamped = clampIndex(index);
  const from = arcPoint(phaseStartAngle(clamped));
  const to = arcPoint(phaseEndAngle(clamped));
  return `M ${round(from.x)} ${round(from.y)} A ${TRACER_ARC.r} ${TRACER_ARC.r} 0 0 1 ${round(to.x)} ${round(to.y)}`;
}

/**
 * Where the tracer rests on a phase.
 *
 * The midpoint of that phase's segment, so the dot is on the mark it is reporting
 * rather than on the boundary between two of them.
 */
export function tracerPoint(index) {
  const clamped = clampIndex(index);
  return arcPoint((phaseStartAngle(clamped) + phaseEndAngle(clamped)) / 2);
}

/** Two decimals is well inside a pixel at this size and keeps the markup readable. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * The index of a phase on the tracer.
 *
 * Distinct from `analysis.mjs`'s helper on purpose: the tracer includes the settled
 * phase, which `VISIBLE_PHASES` does not, because the tracer has to come to rest
 * somewhere.
 *
 * An unknown or missing phase resolves to 0 rather than to the end: reporting an
 * analysis as finished because the phase name was not recognised would be a lie
 * about work nobody has shown to be done.
 */
export function phaseIndex(phase) {
  const index = PHASES.indexOf(phase);
  return index === -1 ? 0 : index;
}

/** Whether the tracer has settled: the analysis reported its final phase. */
export function isSettled(phase) {
  return phase === SETTLED_PHASE;
}

/**
 * The transition to apply, or null when the phase has not moved.
 *
 * Returning null matters: a re-render at the same phase must not restart the
 * animation, or the tracer would pulse on every poll. The client polls repeatedly
 * while an analysis runs, and a phase that has not changed is the common case.
 */
export function phaseTransition(previous, next) {
  if (next === previous) return null;
  return { from: phaseIndex(previous), to: phaseIndex(next), ms: TRACER_EASE_MS };
}