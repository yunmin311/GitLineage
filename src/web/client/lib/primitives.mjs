/**
 * Entity primitives.
 *
 * `node.type` is the canonical entity type, carried by `/api/view` straight from
 * the graph's `entity.type`. It is the only authoritative source of node
 * identity in the client.
 *
 * The renderer must not re-derive identity from `node.isPackage`. That boolean
 * answers one question ("is this a Package?") and collapses every other
 * canonical type into "not a Package", so a new type would silently inherit
 * Repository's primitive. Selecting on the full union keeps that impossible.
 *
 * `isPackage` stays on the payload for compatibility and must agree with
 * `type`; a test enforces that, so the two cannot drift apart.
 *
 * Note on scope: the frozen Direction A design draws three primitives
 * (Repository, Package, ExternalProject). The canonical union is larger, so the
 * remaining types are mapped explicitly here rather than defaulted. Their
 * primitives arrive in the depth/primitives slice; until then they carry class
 * names with no styling attached, which is exactly how they render today.
 */

/** Every canonical entity type, in the order the ontology declares them. */
export const CANONICAL_ENTITY_TYPES = Object.freeze([
  'Repository',
  'Package',
  'Commit',
  'Release',
  'SourceArtifact',
  'ExternalProject',
]);

/** The three primitives the frozen design differentiates visually. */
const PRIMITIVE_BY_TYPE = Object.freeze({
  Repository: 'is-repository',
  Package: 'is-package',
  ExternalProject: 'is-external-project',
  Commit: 'is-commit',
  Release: 'is-release',
  SourceArtifact: 'is-source-artifact',
});

/**
 * A type that is not in the canonical union.
 *
 * It gets its own marker class instead of falling back to Repository, so an
 * ontology addition can never be rendered as a repository without that being
 * visible in the DOM.
 */
export const UNKNOWN_PRIMITIVE = 'is-unknown-entity-type';

/** Whether `type` is one of the canonical entity types. */
export function isCanonicalEntityType(type) {
  return Object.prototype.hasOwnProperty.call(PRIMITIVE_BY_TYPE, type);
}

/**
 * The primitive class for a node, from its canonical type.
 *
 * Never throws and never guesses: an unrecognised type yields
 * `UNKNOWN_PRIMITIVE`, which deliberately has no styling.
 */
export function nodePrimitive(type) {
  if (!isCanonicalEntityType(type)) return UNKNOWN_PRIMITIVE;
  return PRIMITIVE_BY_TYPE[type];
}

/**
 * Corner radius for a node's plate.
 *
 * Package keeps the tighter radius it has always had. Every other type keeps the
 * default, so switching the renderer to this selector changed nothing on screen.
 */
export function nodePrimitiveRadius(type) {
  return type === 'Package' ? 3 : 4;
}