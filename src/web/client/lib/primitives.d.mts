/**
 * Types for the entity-primitive module. See `url-state.d.mts` for why these are
 * declared rather than compiled.
 */
import type { EntityType } from '../../../core/model.ts';

/** Every canonical entity type. */
export declare const CANONICAL_ENTITY_TYPES: readonly EntityType[];

/**
 * Marker class for a type outside the canonical union.
 *
 * Intentionally has no styling: an unrecognised entity type must be obvious
 * rather than quietly drawn as a repository.
 */
export declare const UNKNOWN_PRIMITIVE: 'is-unknown-entity-type';

export declare function isCanonicalEntityType(type: unknown): boolean;

/** The primitive class for a node, selected from its canonical `entity.type`. */
export declare function nodePrimitive(type: EntityType | string): string;

/** Corner radius for a node's plate. Package keeps its tighter radius. */
export declare function nodePrimitiveRadius(type: EntityType | string): number;

/**
 * Topological depth tiers.
 *
 * `Flat` is the absence of a tier: a surface with no topological part must have
 * no shadow rule to override.
 */
export declare const DepthTier: Readonly<{
  Subject: 'subject';
  Selected: 'selected';
  Plate: 'plate';
  Flat: 'flat';
}>;

export interface DepthInput {
  isSubject?: boolean;
  isSelected?: boolean;
  /** True for a member drawn inside a plate, which is content rather than topology. */
  isRow?: boolean;
}

/**
 * The depth tier for a drawn object.
 *
 * The subject outranks a selected plate, so a selection can never outrank the
 * anchor. Rows are flat regardless of selection.
 */
export declare function depthTier(input?: DepthInput): 'subject' | 'selected' | 'plate' | 'flat';

/** The CSS class carrying a tier, or '' for the flat tier. */
export declare function depthClass(tier: string): string;

/**
 * The ladder's hard offsets in px: subject 6, selected 5, plate 4, flat 0.
 *
 * Geometry, not styling: `box-shadow` does not paint on an SVG `rect`, so the
 * offset is drawn as a real shape behind the plate.
 */
export declare const DEPTH_OFFSET: Readonly<Record<string, number>>;

/** The hard offset for a tier in px; 0 for the flat tier. */
export declare function depthOffset(tier: string): number;

/** The CSS class for the offset shape drawn behind a plate, or '' when flat. */
export declare function depthShadowClass(tier: string): string;