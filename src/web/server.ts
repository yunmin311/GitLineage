import { Buffer } from 'node:buffer';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { analyze } from '../pipeline/analyze.ts';
import { analyzeWithCache } from '../pipeline/cached-analyze.ts';
import { buildView, type ViewGraph } from './view-model.ts';
import { validateGraph } from '../core/validate.ts';
import { DIRECTIONAL_RELATIONSHIPS, SYMMETRIC_RELATIONSHIPS } from '../core/ontology.ts';
import { GRAPH_SCHEMA_VERSION, ANALYZER_VERSION } from '../core/model.ts';
import type { AnalysisPhase, AnalyzeOptions } from '../pipeline/analyze.ts';
import { Cache } from '../platform/cache.ts';
import { GitHubClient } from '../collectors/github/client.ts';
import { HttpClient, resolveGitHubToken } from '../platform/http.ts';
import { OUTBOUND_ALLOWLIST } from '../pipeline/analyze.ts';
import { resolveRepositoryRef, UnsupportedRepositoryRefError } from '../platform/url.ts';
import { loadConfig, publicConfig, type ServerConfig } from './config.ts';
import { AnalysisScheduler, type AnalyzeInvocation } from './analysis/scheduler.ts';
import { JobStore } from './analysis/store.ts';
import { AnalysisRateLimiter, clientIp } from './analysis/ratelimit.ts';
import { ANALYSIS_PHASES, isTerminal, toStatus, type JobRecord } from './analysis/types.ts';
import type { AnalysisPhase as JobPhase } from './analysis/types.ts';
import type { LineageGraph, RepositoryRefLike } from './types.ts';

export interface AnalyzeResultMeta {
  graph: LineageGraph;
  /** True when the artifact came from the version-keyed cache. */
  cacheHit: boolean;
  resolvedRevision: string;
  resolvedRef: string | undefined;
  defaultBranch: string | undefined;
  elapsedMs: number;
}

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
  analysisTimeoutMs?: number;
  /**
   * Test seam for the cheap revision probe. When set, job lifecycle tests do not
   * depend on GitHub reachability.
   */
  probeRevisionOverride?: ((repository: { owner: string; name: string }) => Promise<{ commit: string | null }>) | undefined;
  /** Additional outbound hosts, from configuration only. */
  extraAllowHosts?: string[];
  /** Test seam: injected instead of real network analysis. */
  analyzeOverride?: ((repository: string, options: AnalyzeOverride) => Promise<LineageGraph>) | undefined;
  /** Reports the canonical graph for a repository without the view-model. */
  graphOverride?: ((repository: string, options: AnalyzeOverride) => Promise<AnalyzeResultMeta>) | undefined;
  /**
   * Test seam for the async scheduler. When set, jobs resolve through this
   * instead of the real analyzer, so job lifecycle can be tested without
   * GitHub. It must honour `onPhase` for the state machine to be observable.
   */
  schedulerAnalyzeOverride?: ((options: AnalyzeInvocation) => Promise<{ graph: LineageGraph; cacheHit: boolean }>) | undefined;
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
  | { kind: 'analysis'; repository: RepositoryRefLike }
  | { kind: 'analysis-job'; jobId: string }
  | { kind: 'client'; path: string }
  | { kind: 'not-found' };

/**
 * Static assets.
 *
 * Covers both the unbundled client (`/app.js`) and the production build, which
 * writes content-hashed bundles under `/assets/`. A request that is not an asset
 * is the SPA shell, so this list decides which paths address a file at all.
 * Directory containment is still enforced when the file is read.
 */
const ASSET_FILE = /^\/(?:[\w.-]+\/)*[\w.-]+\.(?:css|js|mjs|map|json|svg|ico|txt|webmanifest|woff2?)$/;
const ASSET_EXACT = /^\/(?:favicon\.ico|robots\.txt)$/;

function isAsset(pathname: string): boolean {
  return ASSET_FILE.test(pathname) || ASSET_EXACT.test(pathname);
}

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;
/** Job ids are server-generated UUIDs; nothing else is addressable. */
const JOB_ID = /^[0-9a-f-]{36}$/;

/**
 * Parses `/owner/repo` and `/owner/repo/...` into a validated repository
 * reference. Anything else is not found.
 *
 * The route shape is the product's URL-first promise: `/owner/repo` is a
 * primary route, so replacing the domain later needs no routing change.
 */
export function parseRoute(pathname: string): Route {
  const clean = pathname.split('?')[0]!.replace(/\/+$/, '');
  // The root is the landing page, not a 404.
  if (clean === '' || clean === '/') return { kind: 'client', path: '/index.html' };
  if (clean === '/healthz') return { kind: 'health' };
  if (clean === '/api/contract') return { kind: 'contract' };
  if (isAsset(clean)) return { kind: 'client', path: clean };

  const segments = clean.split('/').filter((segment) => segment.length > 0);

  if (segments[0] === 'api') {
    // Job status is a single-segment route: /api/analysis/jobs/<jobId>
    if (segments.length === 4 && segments[1] === 'analysis' && segments[2] === 'jobs') {
      const jobId = segments[3]!;
      return JOB_ID.test(jobId) ? { kind: 'analysis-job', jobId } : { kind: 'not-found' };
    }
    if (segments.length !== 4) return { kind: 'not-found' };
    const [, , owner, name] = segments as [string, string, string, string];
    if (segments[1] === 'analysis') {
      if (!OWNER.test(owner) || !NAME.test(name)) return { kind: 'not-found' };
      return { kind: 'analysis', repository: { owner: owner.toLowerCase(), name: name.toLowerCase() } };
    }
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

/**
 * Revision and freshness facts every analysis endpoint returns.
 *
 * The client needs to know whether it is looking at a cached artifact and which
 * revision that artifact represents, otherwise "reload gives the same result"
 * is an unfalsifiable claim.
 */
function revisionMeta(result: AnalyzeResultMeta): Record<string, unknown> {
  return {
    cacheHit: result.cacheHit,
    resolvedRevision: result.resolvedRevision,
    resolvedRef: result.resolvedRef ?? null,
    defaultBranch: result.defaultBranch ?? null,
    elapsedMs: result.elapsedMs,
  };
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
  private readonly config: ServerConfig;
  /** Owns every analysis. Requests observe jobs; they never hold one open. */
  private readonly scheduler: AnalysisScheduler;
  private readonly limiter: AnalysisRateLimiter;
  private schedulerReady: Promise<JobRecord[]> | null = null;

  constructor(options: ServerOptions, config?: ServerConfig) {
    this.options = options;
    this.cache = new Cache(options.cacheRoot, 'public');
    this.config = config ?? loadConfig();
    this.limiter = new AnalysisRateLimiter({
      analysesPerIp: this.config.rateLimitAnalysesPerIp,
      windowMs: this.config.rateLimitWindowMs,
      maxConcurrent: this.config.maxConcurrentAnalyses,
      maxQueueDepth: this.config.maxQueueDepth,
      trustedProxyHeader: this.config.trustedProxyHeader,
      enabled: this.config.rateLimitEnabled,
    });
    this.scheduler = new AnalysisScheduler({
      store: new JobStore({
        root: this.config.jobStoreRoot,
        schemaVersion: GRAPH_SCHEMA_VERSION,
        analyzerVersion: ANALYZER_VERSION,
      }),
      limiter: this.limiter,
      cacheRoot: this.options.cacheRoot,
      depth: this.options.analysisDepth,
      maxCandidates: this.options.maxCandidates,
      enableGit: this.options.enableGit,
      enableRegistry: this.options.enableRegistry,
      schemaVersion: GRAPH_SCHEMA_VERSION,
      analyzerVersion: ANALYZER_VERSION,
      probeRevision: (repository) => this.probeRevision(repository),
      probeTimeoutMs: this.config.analysisProbeTimeoutMs,
      timeoutMs: this.options.analysisTimeoutMs ?? 15 * 60_000,
      analyzeOverride: options.schedulerAnalyzeOverride,
    });
    // Recovery starts with the process, not with the first request: a server
    // that starts and is then asked nothing must still fix orphaned jobs.
    this.scheduler.recoverInBackground();
  }

  /** Effective runtime configuration, for health and diagnostics endpoints. */
  get runtimeConfig(): ServerConfig {
    return this.config;
  }

  /** Exposed for tests and diagnostics: what the scheduler is doing now. */
  get analysis(): AnalysisScheduler {
    return this.scheduler;
  }

  get rateLimiter(): AnalysisRateLimiter {
    return this.limiter;
  }

  /**
   * Runs restart recovery exactly once.
   *
   * A job that was mid-flight when the process stopped is failed here rather
   * than being left to look permanently running.
   */
  private async ensureSchedulerReady(): Promise<void> {
    this.schedulerReady ??= this.scheduler.ready();
    await this.schedulerReady;
  }

  async handle(request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const route = parseRoute(url.pathname);

    switch (route.kind) {
      case 'health':
        send(response, 200, ok({ status: 'ok', graphSchemaVersion: GRAPH_SCHEMA_VERSION, analyzerVersion: ANALYZER_VERSION, config: publicConfig(this.config) }));
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
        await this.serveGraph(route.repository, request, response);
        return;
      case 'view':
        await this.serveView(route.repository, request, response);
        return;
      case 'analysis':
        await this.serveAnalysisStart(route.repository, request, response);
        return;
      case 'analysis-job':
        this.serveAnalysisJob(route.jobId, response);
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
   * Resolves the revision cheaply.
   *
   * Used to find an existing artifact and to key a job on the exact revision.
   * A failure here is not fatal: it only costs the cache lookup and makes the
   * dedup key coarser, never wrong.
   */
  private async probeRevision(repository: { owner: string; name: string }): Promise<{ commit: string | null }> {
    if (this.options.probeRevisionOverride) return this.options.probeRevisionOverride(repository);
    try {
      const token = await resolveGitHubToken();
      const http = new HttpClient({ cache: this.cache, allowlist: this.allowlist(), token });
      const github = new GitHubClient(http);
      const ref = { provider: 'github' as const, owner: repository.owner, name: repository.name };
      const meta = await github.getRepository(ref);
      return { commit: await github.getCommitSha(ref, meta.default_branch) };
    } catch {
      return { commit: null };
    }
  }

  /**
   * Resolves a completed artifact, or explains that analysis is pending.
   *
   * The result endpoints never block on a cold analysis. A cold repository takes
   * minutes, which outlives any proxy deadline, so a caller that has no
   * completed artifact is told so, with a job to observe. The *successful*
   * representation is unchanged: a v2 canonical graph or its view-model.
   */
  private async completedArtifact(
    repository: RepositoryRefLike,
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<AnalyzeResultMeta | null> {
    const startedAt = Date.now();
    try {
      resolveRepositoryRef(`${repository.owner}/${repository.name}`);
    } catch (error) {
      send(response, 400, fail('invalid_repository', 'That is not a usable repository reference.', error instanceof Error ? error.message : String(error)));
      return null;
    }

    await this.ensureSchedulerReady();

    // A pinned override is a test seam and stays synchronous.
    if (this.options.graphOverride || this.options.analyzeOverride) {
      try {
        return await this.analyze(`${repository.owner}/${repository.name}`);
      } catch (error) {
        send(response, 502, fail('analysis_failed', 'Could not analyse the requested repository.', error instanceof Error ? error.message : String(error)));
        return null;
      }
    }

    const address = clientIp(request, this.config.trustedProxyHeader);
    const outcome = await this.scheduler.request(
      { provider: 'github', owner: repository.owner, name: repository.name },
      address,
    );

    if (outcome.kind === 'complete') {
      return this.describe(outcome.graph, true, startedAt, undefined, undefined);
    }
    if (outcome.kind === 'rate_limited') {
      this.sendWithRetryAfter(response, 429, fail(outcome.message ? 'analysis_rate_limited' : 'analysis_rate_limited', outcome.message, undefined), outcome.retryAfterSeconds);
      return null;
    }
    if (outcome.kind === 'overloaded') {
      this.sendWithRetryAfter(response, 503, fail('analysis_overloaded', outcome.message), outcome.retryAfterSeconds);
      return null;
    }

    // Accepted: the caller gets a typed, actionable refusal rather than a hang.
    send(
      response,
      202,
      {
        ok: false,
        error: {
          code: 'analysis_pending',
          message: 'analysis is not finished for this repository yet; poll the job it names',
        },
        meta: {
          jobId: outcome.job.jobId,
          status: outcome.job.phase,
          statusUrl: `/api/analysis/jobs/${outcome.job.jobId}`,
          retryAfterMs: outcome.retryAfterMs,
          joined: outcome.joined,
          ...(outcome.job.resolvedRevision ? { resolvedRevision: outcome.job.resolvedRevision } : {}),
        },
      },
    );
    return null;
  }

  private sendWithRetryAfter(
    response: import('node:http').ServerResponse,
    status: number,
    body: unknown,
    retryAfterSeconds: number,
  ): void {
    send(response, status, body, { 'retry-after': String(retryAfterSeconds) });
  }

  /**
   * `POST /api/analysis/:owner/:repo`
   *
   * Starts or joins an analysis and returns immediately. Never holds the
   * connection for the duration of the work.
   */
  private async serveAnalysisStart(
    repository: RepositoryRefLike,
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const target = `${repository.owner}/${repository.name}`;
    try {
      resolveRepositoryRef(target);
    } catch (error) {
      send(response, 400, fail('invalid_repository', 'That is not a usable repository reference.', error instanceof Error ? error.message : String(error)));
      return;
    }
    await this.ensureSchedulerReady();

    const address = clientIp(request, this.config.trustedProxyHeader);
    const outcome = await this.scheduler.request(
      { provider: 'github', owner: repository.owner, name: repository.name },
      address,
    );

    if (outcome.kind === 'complete') {
      send(
        response,
        200,
        {
          status: 'complete',
          cacheHit: true,
          resolvedRevision: outcome.resolvedRevision,
          repository: target,
          graphUrl: `/api/graph/${target}`,
          viewUrl: `/api/view/${target}`,
        },
      );
      return;
    }
    if (outcome.kind === 'rate_limited') {
      this.sendWithRetryAfter(
        response,
        429,
        {
          ok: false,
          error: { code: 'analysis_rate_limited', message: outcome.message },
          // `Retry-After` appears both as a header and in the body, so a client
          // that only parses JSON still gets the hint.
          retryAfterSeconds: outcome.retryAfterSeconds,
          meta: { limit: this.config.rateLimitAnalysesPerIp, windowMs: this.config.rateLimitWindowMs },
        },
        outcome.retryAfterSeconds,
      );
      return;
    }
    if (outcome.kind === 'overloaded') {
      this.sendWithRetryAfter(
        response,
        503,
        {
          ok: false,
          error: { code: 'analysis_overloaded', message: outcome.message },
          retryAfterSeconds: outcome.retryAfterSeconds,
          meta: {
            running: this.scheduler.runningCount,
            queued: this.scheduler.queuedCount,
            maxConcurrent: this.config.maxConcurrentAnalyses,
            maxQueueDepth: this.config.maxQueueDepth,
          },
        },
        outcome.retryAfterSeconds,
      );
      return;
    }

    send(
      response,
      202,
      {
        status: outcome.job.phase,
        jobId: outcome.job.jobId,
        repository: target,
        statusUrl: `/api/analysis/jobs/${outcome.job.jobId}`,
        retryAfterMs: outcome.retryAfterMs,
        joined: outcome.joined,
        ...(outcome.job.resolvedRevision ? { resolvedRevision: outcome.job.resolvedRevision } : {}),
      },
      { 'retry-after': String(Math.ceil(outcome.retryAfterMs / 1000)) },
    );
  }

  /** `GET /api/analysis/jobs/:jobId` — the observable state machine. */
  private serveAnalysisJob(jobId: string, response: import('node:http').ServerResponse): void {
    const record = this.scheduler.status(jobId);
    if (!record) {
      send(response, 404, fail('unknown_job', 'No such analysis job.', `jobId: ${jobId}`));
      return;
    }
    const status = toStatus(record);
    const terminal = isTerminal(record.phase);
    send(
      response,
      200,
      ok(status, {
        phases: ANALYSIS_PHASES,
        // A terminal job is done; a running one is worth retrying after the hint.
        ...(terminal ? {} : { retryAfterMs: this.scheduler.retryAfterMs() }),
      }),
      terminal ? {} : { 'retry-after': String(Math.ceil(this.scheduler.retryAfterMs() / 1000)) },
    );
  }

  /**
   * Returns the canonical LineageGraph **unchanged**.
   *
   * This endpoint is the source of truth for the product. It adds no view
   * fields, renames nothing, and re-serialises the object exactly as the
   * analyzer produced it. It is a completed-result endpoint: when no artifact
   * exists yet it returns the typed `analysis_pending` response rather than
   * blocking the connection on a multi-minute analysis.
   */
  private async serveGraph(
    repository: RepositoryRefLike,
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const result = await this.completedArtifact(repository, request, response);
    if (!result) return;
    // Defence in depth: never serve a graph that fails its own contract.
    const validation = validateGraph(result.graph);
    if (!validation.valid) {
      send(response, 500, fail('contract_violation', 'The analyzed graph failed contract validation.', validation.errors.join('; ')));
      return;
    }
    send(response, 200, ok(result.graph, {
      endpoint: 'canonical-graph',
      note: 'canonical LineageGraph, unmodified',
      ...revisionMeta(result),
    }));
  }

  /**
   * Returns the presentation view-model derived from the canonical graph.
   *
   * Also a completed-result endpoint: it answers from a valid artifact or with
   * the typed `analysis_pending` response, never by holding the request open.
   */
  private async serveView(
    repository: RepositoryRefLike,
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const result = await this.completedArtifact(repository, request, response);
    if (!result) return;
    const view = buildView(result.graph);
    send(response, 200, ok(view, {
      endpoint: 'view-model',
      derivedFrom: '/api/graph',
      schemaVersion: result.graph.schemaVersion,
      ...revisionMeta(result),
    }));
  }

  private async analyze(target: string): Promise<AnalyzeResultMeta> {
    // Fail fast on an unusable reference before any network work.
    resolveRepositoryRef(target);

    const startedAt = Date.now();

    if (this.options.graphOverride) {
      return this.options.graphOverride(target, this.analysisOptions());
    }

    if (this.options.analyzeOverride) {
      const graph = await this.options.analyzeOverride(target, this.analysisOptions());
      return this.describe(graph, false, startedAt);
    }

    this.cache.assertSupported();
    const token = await resolveGitHubToken();
    const http = new HttpClient({ cache: this.cache, allowlist: this.allowlist(), token });
    const github = new GitHubClient(http);

    const outcome = await analyzeWithCache({
      target,
      cacheRoot: this.options.cacheRoot,
      depth: this.options.analysisDepth,
      maxCandidates: this.options.maxCandidates,
      enableGit: this.options.enableGit,
      enableRegistry: this.options.enableRegistry,
      probeRevision: async (repository) => {
        try {
          const ref = { provider: 'github' as const, owner: repository.owner, name: repository.name };
          const meta = await github.getRepository(ref);
          return { commit: await github.getCommitSha(ref, meta.default_branch) };
        } catch {
          // Falling through to a full analysis is correct; the probe only
          // exists to find a cache hit.
          return { commit: null };
        }
      },
    });

    return this.describe(outcome.graph, outcome.cacheHit, startedAt, outcome.graph.graph.revision.ref, outcome.graph.graph.revision.defaultBranch);
  }

  private describe(
    graph: LineageGraph,
    cacheHit: boolean,
    startedAt: number,
    ref?: string,
    defaultBranch?: string,
  ): AnalyzeResultMeta {
    return {
      graph,
      cacheHit,
      resolvedRevision: graph.graph.revision.commit,
      resolvedRef: ref,
      defaultBranch,
      elapsedMs: Date.now() - startedAt,
    };
  }

  private analysisOptions(): AnalyzeOverride {
    return {
      depth: this.options.analysisDepth,
      maxCandidates: this.options.maxCandidates,
      enableGit: this.options.enableGit,
      enableRegistry: this.options.enableRegistry,
      cacheRoot: this.options.cacheRoot,
    };
  }

  private allowlist(): ReadonlySet<string> {
    const hosts = new Set(OUTBOUND_ALLOWLIST);
    for (const extra of (this.options.extraAllowHosts ?? [])) hosts.add(extra);
    return hosts;
  }

  private async serveClient(pathname: string, response: import('node:http').ServerResponse): Promise<void> {
    if (!this.options.clientDir) {
      send(response, 503, fail('no_client', 'This server is running in API-only mode.'));
      return;
    }
    const root = resolve(this.options.clientDir);
    // Asset requests address a file; every other client route is the SPA shell.
    // `decodeURIComponent` is deliberately not applied to the path: the segments
    // are validated by `isAsset` and then contained by the check below, so an
    // encoded separator cannot be used to reach outside the client directory.
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