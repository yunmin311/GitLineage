import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { GitLineageServer } from './server.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import type { AnalyzeInvocation } from './analysis/scheduler.ts';
import { logEvent, logStartup } from './analysis/logging.ts';
import type { LineageGraph } from './types.ts';

export interface ServeOptions {
  /** Opt-in local experiment seam. Normal CLI never installs a handler. */
  previewHandler?: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  /** Explicit private service seam; normal CLI does not install it. */
  privateBetaHandler?: (request: IncomingMessage, response: ServerResponse) => Promise<void>;
  port?: number;
  host?: string;
  cacheRoot?: string;
  clientDir?: string | null;
  /**
   * Durable job registry directory. Defaults beside the artifact cache. Must be
   * outside the Git working tree so job state can never be committed.
   */
  jobStoreRoot?: string;
  depth?: number;
  maxCandidates?: number;
  enableGit?: boolean;
  enableRegistry?: boolean;
  analysisTimeoutMs?: number;
  /**
   * Test seam. When present the server uses this instead of real network
   * analysis, which keeps the HTTP contract testable without GitHub.
   */
  analyzeOverride?: (
    repository: string,
    options: { depth: number; maxCandidates: number; enableGit: boolean; enableRegistry: boolean; cacheRoot: string },
  ) => Promise<LineageGraph>;
  /**
   * Test seam for the async job scheduler. When set, jobs resolve through this
   * instead of the real analyzer, so the job lifecycle can be tested without
   * GitHub. It should call `onPhase` for the state machine to be observable.
   */
  schedulerAnalyzeOverride?: ((options: AnalyzeInvocation) => Promise<{ graph: LineageGraph; cacheHit: boolean }>) | undefined;
  /**
   * Test seam for the cheap revision probe, so job lifecycle tests do not depend
   * on GitHub reachability.
   */
  probeRevisionOverride?: ((repository: { owner: string; name: string }) => Promise<{ commit: string | null }>) | undefined;
}

export async function serve(
  options: ServeOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  overrides: Partial<ServerConfig> = {},
): Promise<{ server: Server; url: string; app: GitLineageServer }> {
  // One effective configuration, resolved once.
  //
  // This used to keep two: `loadConfig(env)` for the server and a separate
  // merge of the CLI flags for everything the server actually used. The second
  // was the truth and the first was what /healthz, /api/contract and the startup
  // log reported, so a server started with `--cache /srv/gitlineage/cache`
  // announced `.cache`. An operator debugging persistence would be told the
  // wrong path by the one endpoint whose job is to tell the truth.
  const loaded: ServerConfig = { ...loadConfig(env), ...overrides };
  const config: ServerConfig = {
    ...loaded,
    host: options.host ?? loaded.host,
    port: options.port ?? loaded.port,
    cacheRoot: options.cacheRoot ?? loaded.cacheRoot,
    clientDir: options.clientDir === undefined ? loaded.clientDir : options.clientDir,
    jobStoreRoot: options.jobStoreRoot ?? loaded.jobStoreRoot,
    analysisDepth: options.depth ?? loaded.analysisDepth,
    maxCandidates: options.maxCandidates ?? loaded.maxCandidates,
    enableGit: options.enableGit ?? loaded.enableGit,
    enableRegistry: options.enableRegistry ?? loaded.enableRegistry,
    analysisTimeoutMs: options.analysisTimeoutMs ?? loaded.analysisTimeoutMs,
  };
  const { host, port, cacheRoot, clientDir } = config;

  const app = new GitLineageServer(
    {
      port,
      host,
      cacheRoot,
      clientDir: clientDir ?? undefined,
      analysisDepth: config.analysisDepth,
      maxCandidates: config.maxCandidates,
      enableGit: config.enableGit,
      enableRegistry: config.enableRegistry,
      analysisTimeoutMs: config.analysisTimeoutMs,
      extraAllowHosts: config.extraAllowHosts,
      analyzeOverride: options.analyzeOverride,
      schedulerAnalyzeOverride: options.schedulerAnalyzeOverride,
      probeRevisionOverride: options.probeRevisionOverride,
    },
    config,
  );

const server = createServer((request, response) => {
      // Only the explicitly installed private service receives frame protection.
      if (options.privateBetaHandler) {
        response.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
        response.setHeader('X-Frame-Options', 'DENY');
      }
      if (options.privateBetaHandler && /^\/(?:api\/(?:deep-search|private-beta)(?:\/|$)|private-beta(?:\/|$))/.test(request.url ?? '')) {
        void options.privateBetaHandler(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500, {'content-type':'application/json'});
          response.end('{"error":"private_beta_unavailable"}');
        });
        return;
      }
      if (!options.previewHandler && request.method === 'GET' && request.url === '/api/deep-search/capabilities') {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end('{"enabled":false}');
        return;
      }
      if (options.previewHandler && /^\/(?:api\/deep-search(?:\/|$)|preview-access\/)/.test(request.url ?? '')) {
        // Bootstrap capabilities are private and must not enter HTTP logs.
        void options.previewHandler(request, response).catch(() => {
          if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
          response.end('{"error":"preview_internal"}');
        });
        return;
      }
      const startedAt = Date.now();
      const method = request.method ?? 'GET';
      // The path is recorded without its query string: view state is already
      // public, but the log does not need it, and dropping it keeps any
      // hand-typed parameter out of the log entirely.
      const path = (request.url ?? '/').split('?')[0] ?? '/';
      response.on('finish', () => {
        // Static assets are frequent and uninteresting; they are counted but
        // not logged individually.
        if (path.startsWith('/assets/') || path === '/app.css' || path === '/app.js') return;
        logEvent('http.request', {
          method,
          path,
          status: response.statusCode,
          requestMs: Date.now() - startedAt,
          queued: app.analysis.queuedCount,
          running: app.analysis.runningCount,
          queueDepth: app.analysis.queuedCount,
        });
      });
      void app.handle(request, response).catch((error: unknown) => {
        logEvent('analysis.failed', {
          code: 'internal_error',
          path,
          method,
          message: error instanceof Error ? error.message : String(error),
        });
        if (!response.headersSent) response.writeHead(500, { 'content-type': 'application/json' });
        response.end('{"ok":false,"error":{"code":"internal","message":"unhandled server error"}}\n');
      });
    });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  // Report the port the OS actually bound, which matters when port 0 was asked for.
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;
  return { server, url: `http://${host}:${boundPort}`, app };
}

/**
 * CLI flags override the environment, in this order:
 * `--host`, `--port`, `--cache`, `--client <dir>`, `--no-client`,
 * `--depth`, `--max-candidates`, `--timeout-ms`.
 */
function cliOverrides(argv: string[]): ServeOptions {
  const overrides: ServeOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    switch (flag) {
      case '--host':
        overrides.host = next;
        index += 1;
        break;
      case '--port':
        overrides.port = Number.parseInt(String(next), 10);
        index += 1;
        break;
      case '--cache':
        overrides.cacheRoot = next;
        index += 1;
        break;
      case '--client':
        overrides.clientDir = next;
        index += 1;
        break;
      case '--no-client':
        overrides.clientDir = null;
        break;
      case '--depth':
        overrides.depth = Number.parseInt(String(next), 10);
        index += 1;
        break;
      case '--max-candidates':
        overrides.maxCandidates = Number.parseInt(String(next), 10);
        index += 1;
        break;
      case '--timeout-ms':
        overrides.analysisTimeoutMs = Number.parseInt(String(next), 10);
        index += 1;
        break;
      default:
        break;
    }
  }
  return overrides;
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('serve.ts');
if (isMain) {
  const overrides = cliOverrides(process.argv.slice(2));
  const { server, url, app } = await serve(overrides);
  logStartup({
    url,
    nodeEnv: app.runtimeConfig.nodeEnv,
    cacheRoot: app.runtimeConfig.cacheRoot,
    jobStoreRoot: app.runtimeConfig.jobStoreRoot,
    analysisDepth: app.runtimeConfig.analysisDepth,
    maxConcurrentAnalyses: app.runtimeConfig.maxConcurrentAnalyses,
    maxQueueDepth: app.runtimeConfig.maxQueueDepth,
    rateLimitEnabled: app.runtimeConfig.rateLimitEnabled,
    analysesPerIp: app.runtimeConfig.rateLimitAnalysesPerIp,
    // The header name is safe to log; its value never appears in any log line.
    trustedProxyHeader: app.runtimeConfig.trustedProxyHeader,
  });

  // Graceful shutdown: stop accepting connections, let in-flight requests and
  // analyses finish, and report that this happened rather than dying silently.
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logEvent('http.request', { code: 'shutdown_started', message: signal });
    const force = setTimeout(() => {
      logEvent('analysis.failed', { code: 'shutdown_forced', message: 'did not drain in time' });
      process.exit(1);
    }, 30_000);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      app.analysis.shutdown();
      logEvent('http.request', { code: 'shutdown_complete' });
      process.exit(0);
    });
    // Existing connections are told to stop; new ones are refused immediately.
    server.closeIdleConnections?.();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
