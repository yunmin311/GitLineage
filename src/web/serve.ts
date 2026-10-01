import { createServer, type Server } from 'node:http';
import { GitLineageServer } from './server.ts';
import type { LineageGraph } from './types.ts';

export interface ServeOptions {
  port?: number;
  host?: string;
  cacheRoot: string;
  clientDir?: string;
  depth?: number;
  maxCandidates?: number;
  enableGit?: boolean;
  enableRegistry?: boolean;
  /**
   * Test seam. When present the server uses this instead of real network
   * analysis, which keeps the HTTP contract testable without GitHub.
   */
  analyzeOverride?: (repository: string, options: { depth: number; maxCandidates: number; enableGit: boolean; enableRegistry: boolean; cacheRoot: string }) => Promise<LineageGraph>;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      index += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

export async function serve(options: ServeOptions): Promise<{ server: Server; url: string }> {
  const port = options.port ?? 4317;
  const host = options.host ?? '127.0.0.1';

  const app = new GitLineageServer({
    port,
    host,
    cacheRoot: options.cacheRoot,
    clientDir: options.clientDir,
    analysisDepth: options.depth ?? 200,
    maxCandidates: options.maxCandidates ?? 12,
    enableGit: options.enableGit ?? true,
    enableRegistry: options.enableRegistry ?? true,
    analyzeOverride: options.analyzeOverride,
  });

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
  return { server, url: `http://${host}:${boundPort}` };
}

const isMain = process.argv[1] !== undefined && process.argv[1].endsWith('serve.ts');
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const { url } = await serve({
    port: args.port ? Number(args.port) : undefined,
    host: typeof args.host === 'string' ? args.host : undefined,
    cacheRoot: typeof args.cache === 'string' ? args.cache : '.cache',
    clientDir: args['no-client'] === true ? undefined : typeof args.client === 'string' ? args.client : 'src/web/client',
    depth: args.depth ? Number(args.depth) : undefined,
    maxCandidates: args['max-candidates'] ? Number(args['max-candidates']) : undefined,
    enableGit: args['no-git'] !== true,
    enableRegistry: args['no-registry'] !== true,
  });
  process.stdout.write(`gitlineage web listening on ${url}\n`);
  process.stdout.write(`  graph  ${url}/api/graph/<owner>/<repo>\n`);
  process.stdout.write(`  view   ${url}/api/view/<owner>/<repo>\n`);
  process.stdout.write(`  page   ${url}/<owner>/<repo>\n`);
}