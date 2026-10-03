/**
 * Types for the presentation-regime module. See `url-state.d.mts` for why these
 * are declared rather than compiled.
 */

/** Presentation regimes, ordered by increasing visible pressure. */
export declare const Regime: Readonly<{
  Sparse: 'sparse';
  Medium: 'medium';
  Dense: 'dense';
}>;

/**
 * Pressure at or below which topology is drawn directly.
 *
 * An aesthetic bound, deliberately lower than the field's capacity: a wide fan-out
 * reads better as a plate than as a row of spokes.
 */
export declare const DIRECT_PRESSURE_LIMIT: number;

/**
 * The authored field's capacity, which is also the composition budget.
 *
 * Re-exported from the field geometry so the budget and the field it spends are
 * one derivation.
 */
export declare const DRAWABLE_CAPACITY: number;

/** Pressure at or above which the composition is aggregate-first. */
export declare const DENSE_PRESSURE: number;

/** Direct entities a dense graph still exposes. */
export declare const DENSE_DIRECT_EXPOSURE: number;

/** Direct entities a medium graph exposes. */
export declare const MEDIUM_DIRECT_EXPOSURE: number;

export interface Peer {
  id: string;
  /** How many visible relationships reach this peer. */
  relationshipCount: number;
  /** How many of those are VERIFIED. */
  verified: number;
}

/** The regime for a number of distinct peers. */
export declare function regimeFor(peerCount: number): 'sparse' | 'medium' | 'dense';

/** How many peers may be placed directly in this regime. */
export declare function directExposure(regime: string, peerCount: number): number;

/**
 * Splits peers into those drawn directly and those represented by a plate.
 *
 * Ranked by verified evidence, then relationship count, then id, so the order is
 * deterministic and never depends on array position. Every peer is in exactly one
 * list.
 */
/**
 * Whether every peer carries exactly one identical relationship.
 *
 * Such a fan is a repeated claim rather than a topology, so it is aggregated in full
 * and no peer is promoted on the strength of how its id sorts.
 */
export declare function isHomogeneousFan(peers: Peer[]): boolean;

export declare function partitionPeers(
  peers: Peer[],
  regime: string,
): { direct: Peer[]; aggregated: Peer[] };