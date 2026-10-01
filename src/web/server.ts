import { Buffer } from 'node:buffer';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { analyze } from '../pipeline/analyze.ts';
import { analyzeWithCache } from '../pipeline/cached-analyze.ts';
import { buildView, type ViewGraph } from './view-model.ts';
import { validateGraph } from '../core/validate.ts';
import { DIRECTIONAL_RELATIONSHIPS, SYMMETRIC_RELATIONSHIPS } from '../core/ontology.ts';
import { GRAPH_SCHEMA_VERSION, ANALYZER_VERSION } from '../core/model.ts';
import { Cache } from '../platform/cache.ts';
import { GitHubClient } from '../collectors/github/client.ts';
import { HttpClient, resolveGitHubToken } from '../platform/http.ts';
import { OUTBOUND_ALLOWLIST } from '../pipeline/analyze.ts';
import { resolveRepositoryRef, UnsupportedRepositoryRefError } from '../platform/url.ts';
import type { LineageGraph, RepositoryRefLike } from './types.ts';

export interface ServerOptions {
  port: number;
  host: string;
  cacheRoot: string;
  /** Directory with the static client. Optional: API-only mode. */
  clientDir?: string | undefined;
  analysisDepth: number;
  maxCandidates: number;
  enableGit: boolean;
  enableRegistry: boolean;
  /** Test seam: injected instead of real network analysis. */
  analyzeOverride?: ((repository: string, options: AnalyzeOverride) => Promise<LineageGraph>) | undefined;
}

export interface AnalyzeOverride {
  depth: number;
  maxCandidates: number;
  enableGit: boolean;
  enableRegistry: boolean;
  cacheRoot: string;
}

export interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; detail?: string };
  meta?: Record<string, unknown>;
}

export type Route =
  | { kind: 'health' }
  | { kind: 'contract' }
  | { kind: 'graph'; repository: RepositoryRefLike }
  | { kind: 'view'; repository: RepositoryRefLike }
  | { kind: 'client'; path: string }
  | { kind: 'not-found' };

const ASSET = /^\/(app\.css|app\.js|favicon\.ico|robots\.txt)$/;

function isAsset(pathname: string): boolean {
  return ASSET.test(pathname);
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Parses `/owner/repo` and `/owner/repo/...` into a validated repository
 * reference. Anything else is not found.
 *
 * The route shape is the product's URL-first promise: `/owner/repo` is a
 * primary route, so replacing the domain later needs no routing change.
 */
export function parseRoute(pathname: string): Route {
  const clean = pathname.split('?')[0]!.replace(/\/+$/, '');
  if (clean === '' || clean === '/') return { kind: 'not-found' };
  if (clean === '/healthz') return { kind: 'health' };
  if (clean === '/api/contract') return { kind: 'contract' };
  if (isAsset(clean)) return { kind: 'client', path: clean };

  const segments = clean.split('/').filter((segment) => segment.length > 0);

  if (segments[0] === 'api') {
    if (segments.length !== 4) return { kind: 'not-found' };
    const [, , owner, name] = segments as [string, string, string, string];
    if (segments[1] !== 'graph' && segments[1] !== 'view') return { kind: 'not-found' };
    if (!OWNER.test(owner) || !NAME.test(name)) return { kind: 'not-found' };
    return segments[1] === 'graph'
      ? { kind: 'graph', repository: { owner: owner.toLowerCase(), name: name.toLowerCase() } }
      : { kind: 'view', repository: { owner: owner.toLowerCase(), name: name.toLowerCase() } };
  }

  if (segments.length === 2) {
    const [owner, name] = segments as [string, string];
    if (!OWNER.test(owner) || !NAME.test(name)) return { kind: 'not-found' };
    return { kind: 'client', path: '/owner/repo' };
  }

  return { kind: 'not-found' };
}

function send(response: import('node:http').ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`;
  response.writeHead(status, {
    'content-type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  response.end(payload);
}

function ok<T>(data: T, meta?: Record<string, unknown>): ApiEnvelope<T> {
  return { ok: true, data, ...(meta ? { meta } : {}) };
}

function fail(code: string, message: string, detail?: string): ApiEnvelope<never> {
  return { ok: false, error: { code, message, ...(detail ? { detail } : {}) } };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export class GitLineageServer {
  private readonly options: ServerOptions;
  private readonly cache: Cache;

  constructor(options: ServerOptions) {
    this.options = options;
    this.cache = new Cache(options.cacheRoot, 'public');
  }

  async handle(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const route = parseRoute(url.pathname);

    switch (route.kind) {
      case 'health':
        send(response, 200, ok({ status: 'ok', graphSchemaVersion: GRAPH_SCHEMA_VERSION, analyzerVersion: ANALYZER_VERSION }));
        return;
      case 'contract':
        send(
          response,
          200,
          ok({
            graphSchemaVersion: GRAPH_SCHEMA_VERSION,
            supportedGraphSchemaVersions: [GRAPH_SCHEMA_VERSION],
            analyzerVersion: ANALYZER_VERSION,
            directionContract: {
              directional: [...DIRECTIONAL_RELATIONSHIPS],
              symmetric: [...SYMMETRIC_RELATIONSHIPS],
            },
            notes: [
              'A renderer must read edge direction from the relationship, never from the focused node.',
              'Symmetric relationships have no arrow; endpoint order is a storage detail.',
              'Artifacts at any other schemaVersion are rejected and regenerated.',
            ],
          }),
        );
        return;
      case 'graph':
        await this.serveGraph(route.repository, response);
        return;
      case 'view':
        await this.serveView(route.repository, response);
        return;
      case 'client':
        await this.serveClient(url.pathname, response);
        return;
      case 'not-found':
        send(response, 404, fail('not_found', 'No such route.', `path: ${url.pathname}`));
        return;
      default:
        send(response, 405, fail('method_not_allowed', 'Only GET is supported.'));
    }
  }

  /**
   * Returns the canonical LineageGraph **unchanged**.
   *
   * This endpoint is the source of truth for the product. It adds no view
   * fields, renames nothing, and re-serialises the object exactly as the
   * analyzer produced it.
   */
  private async serveGraph(repository: RepositoryRefLike, response: import('node:http').ServerResponse): Promise<void> {
    const target = `${repository.owner}/${repository.name}`;
    try {
      const graph = await this.analyze(target);
      // Defence in depth: never serve a graph that fails its own contract.
      const validation = validateGraph(graph);
      if (!validation.valid) {
        send(response, 500, fail('contract_violation', 'The analyzed graph failed contract validation.', validation.errors.join('; ')));
        return;
      }
      send(response, 200, ok(graph, { endpoint: 'canonical-graph', note: 'canonical LineageGraph, unmodified' }));
    } catch (error) {
      const status = error instanceof UnsupportedRepositoryRefError ? 400 : 502;
      send(response, status, fail('analysis_failed', `Could not analyse ${target}.`, error instanceof Error ? error.message : String(error)));
    }
  }

  /** Returns the presentation view-model derived from the canonical graph. */
  private async serveView(repository: RepositoryRefLike, response: import('node:http').ServerResponse): Promise<void> {
    const target = `${repository.owner}/${repository.name}`;
    try {
      const graph = await this.analyze(target);
      const view = buildView(graph);
      send(response, 200, ok(view, { endpoint: 'view-model', derivedFrom: 'api/graph', schemaVersion: graph.schemaVersion }));
    } catch (error) {
      const status = error instanceof UnsupportedRepositoryRefError ? 400 : 502;
      send(response, status, fail('analysis_failed', `Could not analyse ${target}.`, error instanceof Error ? error.message : String(error)));
    }
  }

  private async analyze(target: string): Promise<LineageGraph> {
    // Fail fast on an unusable reference before any network work.
    resolveRepositoryRef(target);

    if (this.options.analyzeOverride) {
      return this.options.analyzeOverride(target, {
        depth: this.options.analysisDepth,
        maxCandidates: this.options.maxCandidates,
        enableGit: this.options.enableGit,
        enableRegistry: this.options.enableRegistry,
        cacheRoot: this.options.cacheRoot,
      });
    }

    this.cache.assertSupported();
    const token = await resolveGitHubToken();
    const http = new HttpClient({ cache: this.cache, allowlist: OUTBOUND_ALLOWLIST, token });
    const github = new GitHubClient(http);

    return analyzeWithCache({
      target,
      cacheRoot: this.options.cacheRoot,
      depth: this.options.analysisDepth,
      maxCandidates: this.options.maxCandidates,
      enableGit: this.options.enableGit,
      enableRegistry: this.options.enableRegistry,
      probeRevision: async (repository) => {
        try {
          const meta = await github.getRepository({ provider: 'github', owner: repository.owner, name: repository.name });
          return { commit: await github.getCommitSha({ provider: 'github', owner: repository.owner, name: repository.name }, meta.default_branch) };
        } catch {
          // Falling through to a full analysis is correct; the probe only
          // exists to find a cache hit.
          return { commit: null };
        }
      },
    }).then((result) => result.graph);
  }

  private async serveClient(pathname: string, response: import('node:http').ServerResponse): Promise<void> {
    if (!this.options.clientDir) {
      send(response, 503, fail('no_client', 'This server is running in API-only mode.'));
      return;
    }
    const root = resolve(this.options.clientDir);
    // Asset requests address a file; every other client route is the SPA shell.
    const requested = isAsset(pathname) ? pathname.slice(1) : 'index.html';
    const target = resolve(join(root, requested));
    // Path containment: refuse anything that escapes the client directory.
    if (target !== root && !target.startsWith(root + sep)) {
      send(response, 403, fail('forbidden', 'Path escapes the client directory.'));
      return;
    }
    try {
      const { readFile } = await import('node:fs/promises');
      const body = await readFile(target);
      response.writeHead(200, {
        'content-type': GitLineageServer.mimeFor(target),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      });
      response.end(body);
    } catch {
      send(response, 404, fail('not_found', 'Client asset not found.'));
    }
  }

  /** Used by the tests to prove static serving stays inside its directory. */
  static mimeFor(path: string): string {
    return MIME[extname(normalize(path))] ?? 'application/octet-stream';
  }
}

export { Buffer };