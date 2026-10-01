import { resolve } from 'node:path';

/**
 * Runtime configuration.
 *
 * Everything deployment-specific lives here and is read from the environment, so
 * the same build runs locally, in a container and behind a public domain without
 * a code change. There are no localhost assumptions anywhere in the server or
 * the client: the canonical graph carries its own `provider` and the client
 * builds absolute URLs from `window.location`, never from a hard-coded host.
 */
export interface ServerConfig {
  host: string;
  port: number;
  cacheRoot: string;
  clientDir: string | null;
  analysisDepth: number;
  maxCandidates: number;
  enableGit: boolean;
  enableRegistry: boolean;
  /** Comma-separated outbound allowlist extension. */
  extraAllowHosts: string[];
  /** Milliseconds a single analysis request may take before it is aborted. */
  analysisTimeoutMs: number;
  /** Public base URL used only for documentation and link building. */
  publicOrigin: string | null;
  nodeEnv: string;
}

function int(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : fallback;
}

function bool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key];
  if (raw === undefined) return fallback;
  return raw === '1' || raw.toLowerCase() === 'true';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const clientDir = env.GITLINEAGE_CLIENT_DIR ?? 'src/web/client';
  return {
    // Bind to loopback by default so a dev machine is not exposed by accident.
    host: env.GITLINEAGE_HOST ?? '127.0.0.1',
    port: int(env, 'PORT', int(env, 'GITLINEAGE_PORT', 4317)),
    cacheRoot: env.GITLINEAGE_CACHE ?? '.cache',
    clientDir: bool(env, 'GITLINEAGE_NO_CLIENT', false) ? null : resolve(clientDir),
    analysisDepth: int(env, 'GITLINEAGE_DEPTH', 200),
    maxCandidates: int(env, 'GITLINEAGE_MAX_CANDIDATES', 12),
    enableGit: bool(env, 'GITLINEAGE_NO_GIT', false) === false,
    enableRegistry: bool(env, 'GITLINEAGE_NO_REGISTRY', false) === false,
    extraAllowHosts: (env.GITLINEAGE_EXTRA_ALLOW_HOSTS ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
    analysisTimeoutMs: int(env, 'GITLINEAGE_ANALYSIS_TIMEOUT_MS', 15 * 60_000),
    publicOrigin: env.GITLINEAGE_PUBLIC_ORIGIN ?? null,
    nodeEnv: env.NODE_ENV ?? 'development',
  };
}

/** Config as exposed by the health and contract endpoints. Never includes secrets. */
export function publicConfig(config: ServerConfig): Record<string, unknown> {
  return {
    nodeEnv: config.nodeEnv,
    analysisDepth: config.analysisDepth,
    maxCandidates: config.maxCandidates,
    gitEnabled: config.enableGit,
    registryEnabled: config.enableRegistry,
    clientServed: config.clientDir !== null,
    analysisTimeoutMs: config.analysisTimeoutMs,
  };
}