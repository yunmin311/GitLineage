/**
 * Graph search and layer filtering.
 *
 * Pure functions. Search covers nodes and relationships; layer filtering only
 * hides edges, and never changes a relationship's type, status or direction.
 */

export function normalizeQuery(raw) {
  return String(raw || '').trim().toLowerCase();
}

/** Matches nodes by label or id. */
export function searchNodes(view, query) {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return [];
  const hits = [];
  for (const node of view.nodes) {
    const haystack = `${node.label} ${node.id} ${node.type} ${node.fact || ''}`.toLowerCase();
    if (haystack.includes(needle)) hits.push(node.id);
  }
  return hits.sort();
}

/** Matches relationships by type, label and status. */
export function searchEdges(view, query) {
  const needle = normalizeQuery(query);
  if (needle.length === 0) return [];
  const hits = [];
  for (const edge of view.edges) {
    const haystack = `${edge.relationshipType} ${edge.label} ${edge.relationLabel} ${edge.status}`.toLowerCase();
    if (haystack.includes(needle)) hits.push(edge.id);
  }
  return hits.sort();
}

/** Every relationship touching a node, in either direction. */
export function edgesForNode(view, nodeId) {
  return view.edges.filter((edge) => edge.source === nodeId || edge.target === nodeId).map((edge) => edge.id);
}

const FAMILIES = ['ancestry', 'dependency', 'attribution', 'source-identity', 'similarity'];

/** Default layer state: everything visible. */
export function allLayersOn() {
  const layers = {};
  for (const family of FAMILIES) layers[family] = true;
  return layers;
}

export function layerCount(view, layers) {
  const counts = {};
  for (const family of FAMILIES) {
    counts[family] = view.edges.filter((edge) => edge.family === family && layers[family] !== false).length;
  }
  return counts;
}

/**
 * Applies layers and bundles to produce the edge set the canvas draws.
 *
 * A bundled relationship is drawn only when its bundle is expanded. Layers can
 * only remove edges; they never reclassify one.
 */
export function visibleEdges(view, { layers, expandedBundles }) {
  const layerState = layers || allLayersOn();
  const expanded = expandedBundles || new Set();
  return view.edges.filter((edge) => {
    if (layerState[edge.family] === false) return false;
    if (edge.visibility === 'primary') return true;
    return expanded.has(edge.bundleKey);
  });
}

/**
 * Whether the canvas would have any relationship to draw.
 *
 * `expressjs/express` produces 48 real one-hop relationships, all `depends_on`
 * and `references`, so all of them are bundled. The default view then draws
 * nothing, which is indistinguishable from a repository that genuinely has no
 * lineage. The client needs to tell those two cases apart.
 */
export function hasDrawnEdges(view, options) {
  return visibleEdges(view, options).length > 0;
}

/**
 * Bundles with no drawn representative.
 *
 * A bundle is represented once at least one of its members is drawn, so this is
 * empty in a normal view and holds every bundle when nothing is drawn.
 */
export function orphanBundles(view, options) {
  const drawn = visibleEdges(view, options);
  const represented = new Set(
    drawn.map((edge) => edge.bundleKey).filter((key) => typeof key === 'string'),
  );
  return (view.bundles || []).filter((bundle) => !represented.has(bundle.key));
}