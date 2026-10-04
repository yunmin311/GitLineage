/**
 * Types for the analysis-phase dial. See `url-state.d.mts` for why these are
 * declared rather than compiled.
 */

/** The phases the analyser reports, in order, read from the canonical list. */
export declare const PHASES: readonly string[];

/** The settled phase the arm rests on. */
export declare const SETTLED_PHASE: string;

/** The plain-language label for a notch. */
export declare function phaseLabel(phase: string): string;

/** How long the arm takes to reach a notch, in ms. */
export declare const ARM_EASE_MS: number;

/** The dial's sweep in degrees. */
export declare const DIAL_SWEEP_DEG: number;

export interface PhaseTransition {
  from: number;
  to: number;
  ms: number;
}

/** The angle for a phase index, in degrees. */
export declare function phaseAngle(index: number): number;

/** The index of a named phase; 0 for an unrecognised phase. */
export declare function phaseIndex(phase: string | undefined): number;

/** Whether the analysis has reported its final phase. */
export declare function isSettled(phase: string | undefined): boolean;

/** The transition to apply, or null when the phase has not moved. */
export declare function phaseTransition(
  previous: string | undefined,
  next: string | undefined,
): PhaseTransition | null;