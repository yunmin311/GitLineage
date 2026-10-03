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
  /**
   * Directory for the durable analysis job registry. Must live outside the Git
   * working tree so job state can never be committed.
   */
  jobStoreRoot: string;
  /** Analysis creations allowed per client address per window. */
  rateLimitAnalysesPerIp: number;
  rateLimitWindowMs: number;
  /** Analyses allowed to run at the same time. */
  maxConcurrentAnalyses: number;
  /** Jobs allowed to wait behind the concurrency cap. */
  maxQueueDepth: number;
  /**
   * Header carrying the real client address, trusted only when a reverse proxy
   * is known to set it. `null` means the socket address is used, which cannot be
   * forged.
   */
  trustedProxyHeader: string | null;
  /**
   * Socket addresses, or CIDR blocks, allowed to set {@link trustedProxyHeader}.
   * Empty means the header is ignored even when it is declared.
   */
  trustedProxyPeers: string[];
  /** Set to 0 to disable analysis metering entirely. */
  rateLimitEnabled: boolean;
  /**
   * Directory for the shared-history diagnostic sidecar, or empty for disabled.
   *
   * The sidecar records what a probe saw so an intermittent signal can be
   * diagnosed after the fact. It is written outside the canonical artifact and
   * never influences the graph. Empty means nothing is recorded.
   */
  diagnosticsDir: string;
  /**
   * Ceiling on the cheap revision probe every accepted request performs. Keeps
   * a slow network from delaying a 202.
   */
  analysisProbeTimeoutMs: number;
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
    // GITLINEAGE_PORT is checked first on purpose. `PORT` is a generic name that
    // plenty of platforms and process supervisors set for their own purposes, so
    // letting it win would silently move the service to a port nobody configured
    // for it. The project-specific name must be the one that counts.
    //
    // 4317 was the old default and it was a bad one: that is the OpenTelemetry
    // collector's gRPC port, which is commonly already bound on a real host. A
    // default that collides with standard telemetry is a bad way to meet a host.
    port: int(env, 'GITLINEAGE_PORT', int(env, 'PORT', 8080)),
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
    // Default beside the artifact cache, which is already required to be outside
    // the working tree in a deployment.
    jobStoreRoot: resolve(env.GITLINEAGE_JOB_STORE ?? resolve(env.GITLINEAGE_CACHE ?? '.cache', 'jobs')),
    rateLimitAnalysesPerIp: int(env, 'GITLINEAGE_RATE_LIMIT_PER_IP', 5),
    rateLimitWindowMs: int(env, 'GITLINEAGE_RATE_LIMIT_WINDOW_MS', 60_000),
    maxConcurrentAnalyses: int(env, 'GITLINEAGE_MAX_CONCURRENT_ANALYSES', 2),
    maxQueueDepth: int(env, 'GITLINEAGE_MAX_QUEUE_DEPTH', 20),
    trustedProxyHeader: env.GITLINEAGE_TRUSTED_PROXY_HEADER ?? null,
    // Both halves are required before a forwarding header is honoured, so the
    // peers are parsed alongside it rather than separately by each call site.
    trustedProxyPeers: (env.GITLINEAGE_TRUSTED_PROXY_PEERS ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
    rateLimitEnabled: int(env, 'GITLINEAGE_RATE_LIMIT_ENABLED', 1) !== 0,
    diagnosticsDir: (env.GITLINEAGE_DIAGNOSTICS_DIR ?? '').trim(),
    analysisProbeTimeoutMs: int(env, 'GITLINEAGE_PROBE_TIMEOUT_MS', 8_000),
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
    analysis: {
      jobs: 'async',
      maxConcurrent: config.maxConcurrentAnalyses,
      maxQueueDepth: config.maxQueueDepth,
      rateLimitEnabled: config.rateLimitEnabled,
      analysesPerIp: config.rateLimitAnalysesPerIp,
      rateLimitWindowMs: config.rateLimitWindowMs,
      // Whether a declared proxy header is honoured. Never the header value.
      trustedProxyHeader: config.trustedProxyHeader,
      // Whether the socket peer is checked before that header is believed. The
      // peer list itself is a deployment detail and is not published.
      proxyPeerTrust: config.trustedProxyPeers.length > 0,
    },
  };
}