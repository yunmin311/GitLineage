/**
 * Input URL handling.
 *
 * Every external URL that reaches the network or becomes a repository identity
 * passes through this module. Anything that is not a plain, credential-free
 * GitHub repository reference is rejected before it can be used.
 */

export interface RepositoryRef {
  provider: 'github';
  owner: string;
  name: string;
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9._-]+$/;
const GITHUB_HOSTS = new Set(['github.com', 'www.github.com', 'raw.githubusercontent.com', 'api.github.com']);

/**
 * GitHub's own top-level routes, which are therefore never user accounts.
 *
 * A GitHub repository URL is structurally two segments after the host, and so is
 * `github.com/settings/profile` or `github.com/sponsors/sindresorhus`. Nothing in
 * the URL distinguishes them, which is why two-segment github.com paths used to be
 * accepted as repositories: `settings/profile` became an owner called `settings`
 * and a repository called `profile`, was attempted as a candidate, 404ed, and was
 * emitted into the graph as a `Repository` entity with no URL at all.
 *
 * This is a category check rather than a blacklist of the two observed strings.
 * GitHub reserves these names, so no account can hold them, and any github.com
 * page under one of them is a site route. A caller whose repository genuinely
 * lived under such a path could not exist on GitHub, so rejecting it loses
 * nothing real and prevents the misclassification from recurring for the next
 * route nobody has seen yet.
 */
const GITHUB_RESERVED_ROUTES: ReadonlySet<string> = new Set([
  'about', 'account', 'admin', 'apps', 'applications', 'assets', 'blog', 'business',
  'careers', 'cases', 'codespaces', 'collections', 'contact', 'customer-stories',
  'dashboard', 'developer', 'discussions', 'docs', 'downloads', 'education',
  'enterprise', 'events', 'explore', 'features', 'gist', 'github', 'issues', 'join',
  'login', 'logout', 'marketplace', 'new', 'notifications', 'organizations', 'orgs',
  'plans', 'pricing', 'pulls', 'readme', 'search', 'security', 'sessions', 'settings',
  'signup', 'site', 'sponsors', 'stars', 'topics', 'trending', 'users', 'watching',
]);

/**
 * Whether a first path segment names a GitHub site route rather than an account.
 *
 * Exported so the entity classifier and the reference parser agree, instead of
 * each keeping its own idea of what a repository URL looks like.
 */
export function isGitHubReservedRoute(segment: string): boolean {
  return GITHUB_RESERVED_ROUTES.has(segment.trim().toLowerCase());
}

export class UnsupportedRepositoryRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedRepositoryRefError';
  }
}

/**
 * Accepts `owner/name`, `github.com/owner/name`, a full GitHub URL, an `ssh`
 * or `git+https` remote, or a tree/blob URL, and returns a plain repository
 * reference. Rejects credentials, non-GitHub hosts, non-default ports and
 * path traversal.
 */
export function resolveRepositoryRef(input: string): RepositoryRef {
  const trimmed = input.trim();
  const raw = normaliseRemoteForm(trimmed);
  if (raw.length === 0) throw new UnsupportedRepositoryRefError('repository reference must not be empty');
  if (raw.length > 512) throw new UnsupportedRepositoryRefError('repository reference is too long');
  if (/[\s<>"'`\\]/.test(raw)) throw new UnsupportedRepositoryRefError('repository reference contains illegal characters');
  if (raw.includes('..')) throw new UnsupportedRepositoryRefError('repository reference must not contain ".."');

  const scpLike = raw.match(/^(?:(?:[^@/]+)@)?([A-Za-z0-9.-]+):(.+)$/);
  let pathPart: string;
  let host: string | null = null;

  if (scpLike && !raw.includes('://')) {
    host = scpLike[1]!;
    pathPart = scpLike[2]!;
  } else if (raw.includes('://')) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new UnsupportedRepositoryRefError(`unparseable URL: ${input}`);
    }
    if (url.protocol !== 'https:') throw new UnsupportedRepositoryRefError(`only https is supported, received ${url.protocol}`);
    if (url.username || url.password) throw new UnsupportedRepositoryRefError('credentials in URL are not supported');
    if (url.port !== '' && url.port !== '443') throw new UnsupportedRepositoryRefError(`non-default port is not supported: ${url.port}`);
    host = url.hostname;
    pathPart = url.pathname;
  } else {
    pathPart = raw;
  }

  if (host !== null && !GITHUB_HOSTS.has(host.toLowerCase())) {
    throw new UnsupportedRepositoryRefError(`only github.com is supported, received host: ${host}`);
  }

  const segments = pathPart
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter((segment) => segment.length > 0);

  // A bare `github.com/owner/name` reference carries the host in the first segment.
  if (segments.length >= 3 && GITHUB_HOSTS.has(segments[0]!.toLowerCase())) segments.shift();

  if (segments.length < 2) throw new UnsupportedRepositoryRefError(`expected owner/name, received: ${input}`);

  const owner = segments[0]!;
  const name = segments[1]!.replace(/\.git$/i, '');

  if (!OWNER.test(owner)) throw new UnsupportedRepositoryRefError(`invalid repository owner: ${owner}`);
  if (isGitHubReservedRoute(owner)) {
    // `settings/profile` is not a repository. Treating the first segment as an
    // owner produced Repository entities for GitHub's own pages, and spent
    // candidate slots on requests that could only ever 404.
    throw new UnsupportedRepositoryRefError(`"${owner}" is a GitHub site route, not a repository owner`);
  }
  if (!NAME.test(name) || name.length > 100) throw new UnsupportedRepositoryRefError(`invalid repository name: ${name}`);

  return { provider: 'github', owner: owner.toLowerCase(), name: name.toLowerCase() };
}

/**
 * Rewrites the supported remote spellings onto one canonical `https` or scp-like
 * form before validation: `git+https://`, `ssh://git@`, `git@host:owner/name`.
 */
function normaliseRemoteForm(input: string): string {
  let value = input.replace(/^git\+/, '');
  value = value.replace(/^ssh:\/\/(?:[^@/]+@)?/i, 'https://');
  if (!value.includes('://')) {
    value = value.replace(/^(?:[^@/]+@)?([A-Za-z0-9.-]+):(.+)$/, 'https://$1/$2');
  }
  return value;
}

export function isGitHubHost(hostname: string): boolean {
  return GITHUB_HOSTS.has(hostname.toLowerCase());
}

/** Guards raw network calls made on behalf of untrusted input. */
export function assertPublicHttpsUrl(url: URL, allowlist: ReadonlySet<string>): void {
  if (url.protocol !== 'https:') throw new Error(`refusing non-https request to ${url.protocol}//${url.hostname}`);
  if (url.username || url.password) throw new Error('refusing request to URL with embedded credentials');
  if (url.port !== '' && url.port !== '443') throw new Error(`refusing request to non-default port ${url.port}`);
  const host = url.hostname.toLowerCase();
  if (!allowlist.has(host)) throw new Error(`host is not in the outbound allowlist: ${host}`);
}

/**
 * Finds a supported repository reference inside arbitrary document text.
 * Returns `null` rather than throwing, so hostile text can never abort a scan.
 */
export function extractRepositoryRefFromText(text: string): RepositoryRef | null {
  if (typeof text !== 'string' || text.length === 0) return null;
  const bounded = text.length > 2_048 ? text.slice(0, 2_048) : text;
  const candidates = bounded.match(
    /(?:https?:\/\/|git\+|git@|ssh:\/\/git@)?(?:www\.)?github\.com[/:][^\s"'`)\]}>,;]+/gi,
  );
  if (!candidates) return null;
  for (const candidate of candidates.slice(0, 32)) {
    try {
      return resolveRepositoryRef(candidate.replace(/[),.;:]+$/, ''));
    } catch {
      continue;
    }
  }
  return null;
}
