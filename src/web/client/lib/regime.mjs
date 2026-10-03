/**
 * Presentation regimes.
 *
 * How much of the topology is exposed directly is a presentation decision, made
 * from visible relationship pressure rather than from anything repository-specific.
 * The same graph always gets the same regime: it is derived from counts, so a
 * reload cannot change the composition.
 *
 * Three regimes, inside one L/C/R grammar:
 *
 *   sparse   direct topology can breathe, everything loose is placed
 *   medium   a limited number of direct entities, the rest aggregated
 *   dense    aggregate-first; only the highest-ranked direct entities are exposed
 *
 * Canonical semantics never change between regimes. Nothing here creates, removes
 * or reclassifies a relationship -- it decides which relationships are *drawn
 * individually* and which are represented by a plate, and every relationship is
 * still accounted for either way.
 */

import { capacity } from './compose.mjs';

/**
 * The authored field's capacity, read from the geometry rather than restated.
 *
 * It was declared in two places and they disagreed: the field reported 5 while
 * the budget said 18. One derivation, imported here so the composition budget
 * cannot drift from the field it spends.
 */
export const DRAWABLE_CAPACITY = capacity();

/** The regimes, ordered by increasing pressure. */
export const Regime = Object.freeze({
  Sparse: 'sparse',
  Medium: 'medium',
  Dense: 'dense',
});

/**
 * Visible relationship pressure at or below which the topology is drawn directly.
 *
 * This is an aesthetic bound, not the field's capacity. Setting it to the capacity
 * made "sparse" mean "as many as physically fit", and `yunmin311/obsidian-config`
 * -- fourteen one-hop references -- then rendered as fourteen direct spokes with no
 * plate at all. That is precisely the regression the aggregate mechanism exists to
 * prevent, and it survived because a capacity and a composition judgement were
 * treated as the same number.
 *
 * Eight is the frozen design's own figure: direct topology is legible below it, and
 * a wider fan-out reads better as a plate with the members available on expansion.
 * The field can hold more; the composition chooses not to.
 */
export const DIRECT_PRESSURE_LIMIT = 8;

/**
 * The authored field's capacity, which is also the composition budget.
 *
 * Read from the field geometry rather than restated, because it was declared in two
 * places and they disagreed: the field reported 5 while the budget said 18. One
 * derivation, imported here so the budget cannot drift from the field it spends.
 */
/** Above this, the composition is aggregate-first. */
export const DENSE_PRESSURE = 16;

/** How many direct entities a dense graph still exposes. */
export const DENSE_DIRECT_EXPOSURE = 4;

/** How many direct entities a medium graph exposes. */
export const MEDIUM_DIRECT_EXPOSURE = 6;

/**
 * The regime for a set of visible relationships.
 *
 * Pressure is the number of distinct peers, because that is what has to be placed
 * in the field. Counting relationships instead would treat several relationships
 * to one peer as several things to draw, which is exactly the fan-out the plates
 * exist to absorb.
 */
export function regimeFor(peerCount) {
  const count = Number.isFinite(peerCount) ? Math.max(0, Math.floor(peerCount)) : 0;
  if (count <= DIRECT_PRESSURE_LIMIT) return Regime.Sparse;
  if (count >= DENSE_PRESSURE) return Regime.Dense;
  return Regime.Medium;
}

/**
 * How many peers may be placed directly in this regime.
 *
 * Sparse exposes everything it can hold; the others reserve room for the plates,
 * which is why a dense graph is not a longer list.
 */
export function directExposure(regime, peerCount) {
  const count = Number.isFinite(peerCount) ? Math.max(0, Math.floor(peerCount)) : 0;
  if (regime === Regime.Sparse) return Math.min(count, DIRECT_PRESSURE_LIMIT);
  if (regime === Regime.Dense) return Math.min(count, DENSE_DIRECT_EXPOSURE);
  return Math.min(count, MEDIUM_DIRECT_EXPOSURE);
}

/**
 * Decides which peers are shown directly and which are represented by a plate.
 *
 * Ranking is deterministic and by real signal, never by array order: a peer whose
 * relationships are verified outranks a peer that is only declared, and ties break
 * on the peer's id. That is what stops an arbitrary slot from acquiring visual
 * centrality, which was the defect in the two-column arrangement.
 *
 * Every peer appears in exactly one of the two lists, so nothing is dropped.
 */
/**
 * Whether every peer in a fan carries exactly one identical relationship.
 *
 * Fourteen peers with one `references` relationship each is not fourteen pieces of
 * topology. It is one kind of claim repeated, and any choice of which peers to show
 * directly would be decided by something other than what the graph says.
 */
export function isHomogeneousFan(peers) {
  if (peers.length < 2) return false;
  return peers.every((peer) => peer.relationshipCount === 1);
}

/**
 * Splits peers into those drawn directly and those represented by a plate.
 *
 * A homogeneous fan is aggregated in full; see `isHomogeneousFan`.
 *
 * Ranking is deterministic
 *
 * A homogeneous fan is aggregated in full. When every peer carries exactly one
 * relationship of the same type and status, there is no peer that stands out: the
 * graph is making fourteen identical claims, and exposing six of them because their
 * ids sort first is presentation decided by spelling. The aggregate is the honest
 * rendering, and the members are one click away.
 *
 * Ranking among genuinely varied peers is by verified evidence, then relationship
 * count, then id -- deterministic, and never by array position.
 */
export function partitionPeers(peers, regime) {
  const homogeneous = isHomogeneousFan(peers);
  if (homogeneous) return { direct: [], aggregated: [...peers] };

  const ordered = [...peers].sort((a, b) => {
    // Strongest evidence first: a verified relationship is a fact about the peer,
    // a declared one is a claim, and the composition should not present them as
    // equals.
    if (a.verified !== b.verified) return b.verified - a.verified;
    if (a.relationshipCount !== b.relationshipCount) return b.relationshipCount - a.relationshipCount;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const keep = directExposure(regime, ordered.length);
  return { direct: ordered.slice(0, keep), aggregated: ordered.slice(keep) };
}