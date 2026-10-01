/**
 * URL-first routing and shareable state.
 *
 * Pure functions, no DOM, so they are unit-tested in Node and reused by the
 * browser client unchanged.
 *
 * Two rules:
 *  - `/owner/repo` is the primary route, so replacing the host later needs no
 *    route-schema change.
 *  - Meaningful view state lives in the query string, so a URL opened by someone
 *    else shows the same frame.
 */

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * @typedef {{ owner: string, name: string }} RepositoryRef
 */

/** `/owner/repo` → a repository reference, or null for anything else. */
export function parseRepositoryPath(pathname) {
  const segments = String(pathname || '')
    .split('?')[0]
    .replace(/\/+$/, '')
    .split('/')
    .filter((segment) => segment.length > 0);
  if (segments.length !== 2) return null;
  const owner = segments[0];
  const name = segments[1];
  if (!OWNER.test(owner) || !NAME.test(name)) return null;
  return { owner: owner.toLowerCase(), name: name.toLowerCase() };
}

/**
 * Normalises anything a user can paste into one repository reference.
 *
 * Accepts a full GitHub URL, a `tree`/`blob` URL, an `owner/repo` shorthand and
 * a pasted link. Non-GitHub hosts are rejected rather than silently trimmed.
 */
export function resolveRepositoryInput(input) {
  const raw = String(input || '').trim();
  if (raw.length === 0 || raw.length > 512) return null;
  if (/[\s<>"'`]/.test(raw)) return null;

  // `github:owner/repo`, as produced by tools that clone with a rewritten host.
  const prefixed = raw.replace(/^github:/i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  if (prefixed !== raw) {
    const segments = prefixed.split('/').filter(Boolean);
    if (segments.length === 2) return parseRepositoryPath(`/${segments.join('/')}`);
  }

  // Plain owner/repo.
  const shorthand = raw.replace(/\.git$/i, '').replace(/\/+$/, '');
  const shorthandSegments = shorthand.split('/').filter(Boolean);
  if (shorthandSegments.length === 2) {
    return parseRepositoryPath(`/${shorthand}`);
  }

  // Any URL-ish form.
  const urlLike = /^([a-z][a-z0-9+.-]*):\/\//i.test(raw) ? raw : `https://${raw}`;
  let url;
  try {
    url = new URL(urlLike);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host !== 'github.com' && host !== 'www.github.com') return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length < 2) return null;
  // A clone URL carries `.git`; the repository name does not.
  const name = segments[1].replace(/\.git$/i, '');
  return parseRepositoryPath(`/${segments[0]}/${name}`);
}

export function repositoryPath(repository) {
  return `/${repository.owner}/${repository.name}`;
}

export const VIEW_DEFAULTS = {
  edge: '',
  node: '',
  layers: '',
  search: '',
  bundles: '',
  depth: '',
};

/** Canonical layer order. Serialisation follows it, never object key order. */
export const LAYER_KEYS = ['ancestry', 'dependency', 'attribution', 'source-identity', 'similarity'];
export const DEFAULT_LAYER_STATE = LAYER_KEYS.join(',');

export function readViewState(search) {
  const params = new URLSearchParams(String(search || '').replace(/^\?/, ''));
  const depth = params.get('depth') || '';
  return {
    edge: params.get('edge') || '',
    node: params.get('node') || '',
    layers: params.get('layers') || '',
    search: params.get('q') || '',
    bundles: params.get('bundles') || '',
    // Depth arrives from a URL, so it is validated here rather than trusted.
    depth: /^\d{1,6}$/.test(depth) ? depth : '',
  };
}

/**
 * Rebuilds the query string from state, omitting defaults so a shared link stays
 * short and a default view has a clean URL.
 */
export function writeViewState(state) {
  const params = new URLSearchParams();
  if (state.edge) params.set('edge', state.edge);
  if (state.node) params.set('node', state.node);
  if (state.layers && state.layers !== DEFAULT_LAYER_STATE) params.set('layers', state.layers);
  if (state.search) params.set('q', state.search);
  if (state.bundles) params.set('bundles', state.bundles);
  if (state.depth && state.depth !== '200') params.set('depth', state.depth);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Layer toggles, encoded as a comma-separated set of family keys. */
export function parseLayerState(raw) {
  const active = new Set(String(raw || '').split(',').filter(Boolean));
  const layers = {};
  for (const key of LAYER_KEYS) layers[key] = active.has(key);
  return layers;
}

/** Only the layers that are on, in canonical order. */
export function serializeLayerState(layers) {
  return LAYER_KEYS.filter((key) => layers[key]).join(',');
}

/** True when every layer is on, i.e. the URL does not need a `layers` parameter. */
export function isDefaultLayerState(layers) {
  return serializeLayerState(layers) === DEFAULT_LAYER_STATE;
}