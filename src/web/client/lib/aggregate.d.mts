/**
 * Types for the presentation-aggregation module. See `url-state.d.mts` for why
 * these are declared rather than compiled.
 */
import type { ViewGraph, ViewEdge, RelationFamily, RelationshipType, EvidenceStatus } from '../../../web/view-model.ts';

/**
 * How a claim was written down, as far as its evidence shows.
 *
 * `manifest` is a real declaration form: the packages collector's payload names the
 * declaring manifest, so a dependency's declaring SITE is a read of the evidence rather
 * than an inference. Without it a repository whose density is entirely manifest-declared
 * could only be presented as one `depends_on x N` mass.
 */
export declare const DeclarationForm: Readonly<{
  TableRow: 'table-row';
  Prose: 'prose';
  Manifest: 'manifest';
  Unknown: 'unknown';
}>;

/** Canvas visible-object budget. A presentation limit, not a semantic threshold. */
export declare const VISIBLE_OBJECT_BUDGET: number;

/** Smallest fan worth putting on a plate; a single relationship always stays loose. */
export declare const MIN_PLATE_SIZE: number;

/**
 * Member rows a plate lists before it states how many it is holding back.
 *
 * A readability budget, never a semantic one: the plate's count is always the full
 * count and every member stays selectable.
 */
export declare const PLATE_MEMBER_ROWS: number;

export declare function declarationForm(card: unknown): 'table-row' | 'prose' | 'manifest' | 'unknown';

/** Repository-relative file a claim was written in, from its evidence locator. */
export declare function declaringPath(card: unknown): string;

/**
 * The declaring manifest named by one evidence record, or null.
 *
 * Read from the record's structured payload (`data.manifest_path`, nested or flat).
 */
export declare function manifestPathOf(card: unknown): string | null;

export interface SubgroupMember {
  edgeId: string;
  card: unknown;
}

/**
 * Evidence-supported groups inside one fan, or `[]` when the evidence does not
 * support any grouping. Conservative: a partially understood fan stays neutral.
 */
export declare function evidenceSubgroups(members: SubgroupMember[]): AggregateSubgroup[];

/**
 * An evidence-supported group inside a fan.
 *
 * Emitted only when the evidence supports it; `[]` otherwise.
 */
export interface AggregateSubgroup {
  form: 'table-row' | 'prose' | 'manifest';
  /** The declaring file, shown as secondary text on the row. */
  meta: string;
  label: string;
  memberEdgeIds: string[];
}

/** One member relationship as a plate row names it. */
export interface PlateMember {
  edgeId: string;
  /** The peer entity's own label. */
  label: string;
  /** The evidence locator verbatim, e.g. `docs/plugins.md:20`. */
  meta: string;
  /** The member's own evidence status, read from the relationship. */
  status: EvidenceStatus;
  /** Canonical direction, carried through so no renderer has to infer it. */
  directed: boolean;
}

/** A plate standing in for several relationships. Presentation-only, with a real count. */
export interface AggregatePlate {
  key: string;
  relationshipType: RelationshipType;
  family: RelationFamily;
  status: EvidenceStatus;
  label: string;
  count: number;
  memberEdgeIds: string[];
  /** Every member, named, so each one is individually reachable as a row. */
  members: PlateMember[];
  /** Declaring file or file count, when the evidence names one place. */
  meta?: string;
  /** The evidence form this plate was named for, or `null` for a neutral plate. */
  form?: 'table-row' | 'prose' | 'manifest' | null;
  /** Empty unless the evidence supports naming groups inside this fan. */
  subgroups: AggregateSubgroup[];
  /**
   * Whether the plate lists its rows at all.
   *
   * A neutral plate starts shut and opens on request; a plate the evidence named
   * starts open, so the first paint carries real claims rather than a bare count.
   */
  open: boolean;
  /** Whether the plate lists every member rather than a capped few. */
  expanded: boolean;
}

export interface Composition {
  subjectId: string | undefined;
  /** Relationships drawn individually rather than inside a plate. */
  looseEdgeIds: string[];
  /** Promoted relationships: drawn directly and exempt from the budget. */
  promotedEdgeIds: string[];
  /**
   * Everything the canvas draws: loose, promoted and plate members.
   *
   * Promoted relationships used to be drawn while appearing in none of the other
   * lists, so the composition could not prove it had lost nothing.
   */
  drawnEdgeIds: string[];
  plates: AggregatePlate[];
  budget: number;
  empty: boolean;
}

export interface AggregateOptions {
  budget?: number;
  edges?: ViewEdge[];
  expandedAggregates?: Set<string>;
  /**
   * Relationships the regime promoted to direct presence.
   *
   * Always drawn, and counted against the budget: a promoted relationship occupies
   * the field exactly as a loose one does. Treating promotion as free meant it added
   * to the direct count rather than trading against it, and the fan-out it was meant
   * to relieve came back as spokes.
   */
  directEdgeIds?: string[];
  /**
   * Relationships that must be aggregated regardless of the budget.
   *
   * A homogeneous fan is not a direct-topology candidate: no peer earns its own
   * place, so it collapses whether or not it would fit. Left to the budget it drew
   * as loose edges, because the question of room is the wrong one.
   */
  aggregateEdgeIds?: string[];
}

/**
 * The composition the canvas draws.
 *
 * Deterministic under reordered input: fans are ranked by size then key, and
 * every emitted list is sorted.
 */
export declare function buildComposition(view: ViewGraph, options?: AggregateOptions): Composition;

/**
 * The rows a plate shows: one per member relationship, capped unless the plate is
 * expanded, so each individual relationship is selectable rather than only the first
 * member of each group.
 */
export declare function plateRows(plate: AggregatePlate): Array<{
  edgeId: string;
  label: string;
  meta: string;
  status: EvidenceStatus;
  directed: boolean;
  memberEdgeIds: string[];
}>;

/** How many member rows a plate is holding back, so the plate can state it. */
export declare function plateHiddenRows(plate: AggregatePlate): number;