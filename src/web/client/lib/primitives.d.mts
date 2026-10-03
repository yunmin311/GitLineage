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