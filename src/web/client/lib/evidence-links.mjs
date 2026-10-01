/**
 * Evidence source navigation.
 *
 * Builds real GitHub URLs for evidence records, with line anchors where GitHub
 * supports them. Pure functions.
 *
 * GitHub navigation is always secondary to the Evidence Drawer: an edge click
 * opens the drawer, and only the explicit "view source" affordance leaves the
 * page.
 */

const GITHUB_HOST = 'https://github.com';

/**
 * Appends a line-range anchor to a blob URL when the evidence carries one.
 *
 * `README.md:41-43` becomes `.../blob/<sha>/README.md#L41-L43`. Returns the URL
 * unchanged when there is no usable path or revision, rather than inventing one.
 */
export function withLineAnchor(url, path, lineStart, lineEnd) {
  if (!url) return null;
  if (!path || !Number.isInteger(lineStart) || lineStart < 1) return url;
  const hash =
    Number.isInteger(lineEnd) && lineEnd > lineStart ? `#L${lineStart}-L${lineEnd}` : `#L${lineStart}`;
  return `${url.split('#')[0]}${hash}`;
}

/** Commit permalink from the evidence's own recorded commit. */
export function commitUrl(owner, name, commit) {
  if (!owner || !name || !commit) return null;
  return `${GITHUB_HOST}/${owner}/${name}/commit/${commit}`;
}

/** Blob permalink from a path and revision. */
export function blobUrl(owner, name, commit, path) {
  if (!owner || !name || !commit || !path) return null;
  return `${GITHUB_HOST}/${owner}/${name}/blob/${commit}/${encodePath(path)}`;
}

function encodePath(path) {
  return String(path)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Resolves the best "open the original" URL for one evidence record.
 *
 * Priority: an explicit `sourceUrl` recorded by the collector, then a commit
 * permalink, then nothing. The drawer's per-evidence link uses this; it never
 * fabricates a path that the analyzer did not observe.
 */
export function evidenceSourceUrl(record, owner, name) {
  if (record.sourceUrl) {
    const locator = record.locator || '';
    const lineMatch = /:(\d+)(?:-(\d+))?$/.exec(locator);
    if (/\/blob\//.test(record.sourceUrl) && lineMatch) {
      const pathPart = record.locator.split(':')[0];
      return withLineAnchor(
        record.sourceUrl,
        pathPart,
        Number(lineMatch[1]),
        lineMatch[2] ? Number(lineMatch[2]) : undefined,
      );
    }
    return record.sourceUrl;
  }
  const commit = record.data && (record.data.first_commit || record.data.source_commit || record.data.target_commit);
  return commitUrl(owner, name, commit);
}

/**
 * Human-readable "where this observation came from", used as the drawer's
 * verification anchor. Never a summary: it cites a locator or a URL.
 */
export function evidenceAnchorText(record) {
  const parts = [];
  if (record.locator) parts.push(record.locator);
  if (record.collector) parts.push(`${record.collector}/${record.extractor}`);
  return parts.join(' · ');
}

/** The fixed sentence for the weakest evidence class. */
export const SIMILARITY_DISCLAIMER =
  'Similarity does not establish provenance or direction of copying.';