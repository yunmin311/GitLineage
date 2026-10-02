import { createServer, type Server } from 'node:http';
import { GitLineageServer } from './server.ts';
import { loadConfig, type ServerConfig } from './config.ts';
import type { AnalyzeInvocation } from './analysis/scheduler.ts';
import type { LineageGraph } from './types.ts';

export interface ServeOptions {
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
  const config: ServerConfig = { ...loadConfig(env), ...overrides };
  const host = options.host ?? config.host;
  const port = options.port ?? config.port;
  const cacheRoot = options.cacheRoot ?? config.cacheRoot;
  const clientDir = options.clientDir === undefined ? config.clientDir : options.clientDir;
  const jobStoreRoot = options.jobStoreRoot ?? config.jobStoreRoot;

  const app = new GitLineageServer(
    {
      port,
      host,
      cacheRoot,
      clientDir: clientDir ?? undefined,
      analysisDepth: options.depth ?? config.analysisDepth,
      maxCandidates: options.maxCandidates ?? config.maxCandidates,
      enableGit: options.enableGit ?? config.enableGit,
      enableRegistry: options.enableRegistry ?? config.enableRegistry,
      analysisTimeoutMs: options.analysisTimeoutMs ?? config.analysisTimeoutMs,
      extraAllowHosts: config.extraAllowHosts,
      analyzeOverride: options.analyzeOverride,
      schedulerAnalyzeOverride: options.schedulerAnalyzeOverride,
      probeRevisionOverride: options.probeRevisionOverride,
    },
    config,
  );

  const server = createServer((request, response) => {
    void app.handle(request, response).catch(() => {
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
  const { url } = await serve(overrides);
  process.stdout.write(`gitlineage web listening on ${url}\n`);
  process.stdout.write(`  graph  ${url}/api/graph/<owner>/<repo>\n`);
  process.stdout.write(`  view   ${url}/api/view/<owner>/<repo>\n`);
  process.stdout.write(`  page   ${url}/<owner>/<repo>\n`);
}