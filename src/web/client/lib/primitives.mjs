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

/**
 * Topological depth tiers.
 *
 * Depth says one thing only: how far a thing participates in the graph's
 * topology. It is not decoration and not generic card elevation, so the tiers are
 * named for their role and never applied to a surface that has no topological
 * part in the scene.
 */
export const DepthTier = Object.freeze({
  /** The subject. The strongest visual mass, and the only 6px tier. */
  Subject: 'subject',
  /** A selected plate. One step below the subject, so selection never outranks it. */
  Selected: 'selected',
  /** A directly connected plate in the topology. */
  Plate: 'plate',
  /**
   * No topological part. Rows inside a plate, the context rail, census, legend,
   * naming rules, the camera key, the analysis strip and the Drawer are all flat.
   */
  Flat: 'flat',
});

/**
 * The depth tier for a drawn object.
 *
 * The subject outranks everything, including a selected plate: a selection must
 * never make the composition read as if the anchor had changed. Selection raises
 * the plate that owns the selection, which is why the tier is a property of the
 * object rather than of the row inside it.
 *
 * `isRow` is the escape hatch for the members drawn inside a plate. They are
 * content of that plate, not participants in the topology, so they stay flat even
 * when they are the thing that is selected.
 */
export function depthTier({ isSubject = false, isSelected = false, isRow = false } = {}) {
  if (isRow) return DepthTier.Flat;
  if (isSubject) return DepthTier.Subject;
  if (isSelected) return DepthTier.Selected;
  return DepthTier.Plate;
}

/**
 * The ladder itself: how far each tier's hard offset shadow is thrown, in px.
 *
 * These are geometry, so they live here rather than in CSS. `box-shadow` does
 * not paint on an SVG `<rect>` -- the property computes but renders nothing --
 * so the offset is drawn as a real shape behind the plate. Keeping the numbers in
 * one place means the CSS only has to supply the shadow colour.
 *
 * Colour is a CSS concern: the subject and the selected plate use `--rule-2`,
 * the plate uses `--rule`.
 */
export const DEPTH_OFFSET = Object.freeze({
  [DepthTier.Subject]: 6,
  [DepthTier.Selected]: 5,
  [DepthTier.Plate]: 4,
  [DepthTier.Flat]: 0,
});

/** The hard offset for a tier, in px. The flat tier throws nothing. */
export function depthOffset(tier) {
  const offset = DEPTH_OFFSET[tier];
  return Number.isFinite(offset) ? offset : 0;
}

/**
 * The CSS class that carries a depth tier.
 *
 * Empty for the flat tier, so a flat surface has no shadow rule to override and
 * cannot inherit one.
 */
export function depthClass(tier) {
  return tier === DepthTier.Flat ? '' : `depth-${tier}`;
}

/** The CSS class for the offset shape drawn behind a plate of this tier. */
export function depthShadowClass(tier) {
  return tier === DepthTier.Flat ? '' : `depth-shadow depth-shadow-${tier}`;
}