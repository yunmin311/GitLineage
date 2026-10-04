/**
 * Types for the analysis tracer. See `url-state.d.mts` for why these are
 * declared rather than compiled.
 */

/** The phases the analyser reports, in order, read from the canonical list. */
export declare const PHASES: readonly string[];

/** The settled phase the tracer rests on. */
export declare const SETTLED_PHASE: string;

/** The plain-language label for a phase. */
export declare function phaseLabel(phase: string): string;

/** How long the tracer takes to arrive on a segment, in ms. */
export declare const TRACER_EASE_MS: number;

/** The arc's sweep in degrees. Open by construction: not a circle. */
export declare const TRACER_SWEEP_DEG: number;

/** One segment's share of the sweep. */
export declare const TRACER_STEP_DEG: number;

/** The arc's centre and radius, in the tracer SVG's own units. */
export declare const TRACER_ARC: Readonly<{ cx: number; cy: number; r: number }>;

export interface PhaseTransition {
  from: number;
  to: number;
  ms: number;
}

/** The start angle of a phase's segment, in degrees. */
export declare function phaseStartAngle(index: number): number;

/** The end angle of a phase's segment, in degrees. */
export declare function phaseEndAngle(index: number): number;

/** The `d` for one phase's segment. */
export declare function arcSegment(index: number): string;

/** Where the tracer rests on a phase. */
export declare function tracerPoint(index: number): { x: number; y: number };

/** The index of a named phase; 0 for an unrecognised phase. */
export declare function phaseIndex(phase: string | undefined): number;

/** Whether the analysis has reported its final phase. */
export declare function isSettled(phase: string | undefined): boolean;

/** The transition to apply, or null when the phase has not moved. */
export declare function phaseTransition(
  previous: string | undefined,
  next: string | undefined,
): PhaseTransition | null;