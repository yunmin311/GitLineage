/**
 * Abuse protection for analysis creation.
 *
 * The public deployment will happily start an unbounded number of cold
 * analyses, and each one costs GitHub API quota and local compute. Cached reads
 * are cheap and stay unmetered; only *new expensive work* is counted.
 *
 * Three independent brakes, because each covers a case the others miss:
 *
 *  - **Per-IP budget.** Stops one visitor from spending the deployment's quota.
 *  - **Global concurrency cap.** Stops many IPs from saturating the box at once.
 *  - **Bounded queue.** When the queue is full the answer is a typed refusal
 *    with `Retry-After`, not an unbounded backlog that fails slowly.
 *
 * Client identity comes from the socket, unless a proxy is explicitly declared
 * trusted. Trusting `X-Forwarded-For` unconditionally would let any caller
 * forge an identity and bypass the per-IP budget entirely.
 */
import type { IncomingMessage } from 'node:http';

export interface RateLimitConfig {
  /** Analysis creations allowed per IP within the window. */
  analysesPerIp: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Analyses allowed to run at the same time across all clients. */
  maxConcurrent: number;
  /** Jobs that may wait behind the concurrency cap before new work is refused. */
  maxQueueDepth: number;
  /**
   * Header carrying the real client address, set only when a trusted reverse
   * proxy is known to set it and to overwrite anything a client sends. When
   * null, the socket address is used.
   */
  trustedProxyHeader: string | null;
  /**
   * Socket addresses, or CIDR blocks, of the proxies allowed to speak for a
   * client via {@link trustedProxyHeader}.
   *
   * Naming the header alone is not enough. Behind a reverse proxy every
   * connection arrives from the proxy's own address, so the header is the only
   * way to tell clients apart -- but a forwarding header is attacker-controlled
   * unless the peer is checked first. Both halves are therefore required: the
   * header is honoured only when the socket peer is one of these. With an empty
   * list the header is ignored entirely, which falls back to the socket address
   * and therefore to one shared budget rather than to a forged identity.
   */
  trustedProxyPeers: readonly string[];
  /** Set false to disable metering entirely (single-user or trusted deployment). */
  enabled: boolean;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  analysesPerIp: 5,
  windowMs: 60_000,
  maxConcurrent: 2,
  maxQueueDepth: 20,
  trustedProxyHeader: null,
  trustedProxyPeers: [],
  enabled: true,
};

export interface RateDecision {
  allowed: boolean;
  /** Seconds to put in `Retry-After`, when the refusal is temporary. */
  retryAfterSeconds?: number;
  code?: string;
  message?: string;
  /** Present on success, for the response headers. */
  remaining?: number;
}

/**
 * Parses an address into 4 or 16 bytes, tolerating the `::ffff:` prefix Node
 * puts in front of IPv4 socket addresses.
 */
function toBytes(address: string): Uint8Array | null {
  let text = address.trim().toLowerCase();
  if (text.startsWith('::ffff:') && text.includes('.')) text = text.slice(7);
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const parts = v4.slice(1, 5).map(Number);
    if (parts.some((n) => n > 255)) return null;
    return Uint8Array.from(parts);
  }
  if (!text.includes(':')) return null;
  // A full IPv6 expansion; the two forms GitLineage can actually see are the
  // loopback address and the IPv4-mapped loopback.
  if (text === '::1') return Uint8Array.from([...Array(15).fill(0), 1]);
  return null;
}

/** Whether `address` falls inside `cidr`, which may be a plain address. */
export function addressMatches(address: string, cidr: string): boolean {
  const slash = cidr.lastIndexOf('/');
  if (slash === -1) return addressMatches(address, `${cidr}/32`);
  const base = toBytes(cidr.slice(0, slash));
  const candidate = toBytes(address);
  if (!base || !candidate || base.length !== candidate.length) return false;
  const prefix = Number(cidr.slice(slash + 1));
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > base.length * 8) return false;
  const fullBytes = Math.floor(prefix / 8);
  for (let i = 0; i < fullBytes; i += 1) {
    if (base[i] !== candidate[i]) return false;
  }
  const spareBits = prefix % 8;
  if (spareBits === 0) return true;
  const mask = (0xff << (8 - spareBits)) & 0xff;
  return (base[fullBytes]! & mask) === (candidate[fullBytes]! & mask);
}

/** Parses the comma-separated `GITLINEAGE_TRUSTED_PROXY_PEERS` value. */
export function parseTrustedPeers(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/**
 * The client address.
 *
 * Prefers the socket, which cannot be forged. A forwarding header is consulted
 * only when the deployment declares that header trustworthy **and** the socket
 * peer is one of the declared proxies; only then is the header's first hop used,
 * because that is the address the trusted proxy actually observed.
 *
 * Declaring a header without declaring peers leaves the header inert, which
 * costs per-client accuracy but never costs security.
 */
export function clientIp(
  request: IncomingMessage,
  trustedProxyHeader: string | null,
  trustedProxyPeers: readonly string[] = [],
): string {
  const socket = (request.socket as { remoteAddress?: string } | undefined)?.remoteAddress;
  const base = socket && socket.length > 0 ? socket : 'unknown';
  if (!trustedProxyHeader) return base;
  if (trustedProxyPeers.length === 0 || base === 'unknown') return base;
  if (!trustedProxyPeers.some((peer) => addressMatches(base, peer))) return base;
  const raw = request.headers[trustedProxyHeader.toLowerCase()];
  const header = Array.isArray(raw) ? raw[0] : raw;
  if (typeof header !== 'string' || header.trim().length === 0) return base;
  const first = header.split(',')[0]?.trim();
  return first && first.length > 0 ? first : base;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window per-IP counter.
 *
 * Fixed rather than sliding so the memory cost is one entry per active IP per
 * window, and so `Retry-After` is exact rather than approximate.
 */
export class AnalysisRateLimiter {
  private readonly config: RateLimitConfig;
  private readonly buckets = new Map<string, Bucket>();
  private readonly now: () => number;

  constructor(config: Partial<RateLimitConfig> = {}, now: () => number = Date.now) {
    this.config = { ...DEFAULT_RATE_LIMIT, ...config };
    this.now = now;
  }

  get settings(): RateLimitConfig {
    return this.config;
  }

  /** Drops windows that have expired, so the map cannot grow without bound. */
  private sweep(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  /** Charges one analysis creation against an address. */
  charge(address: string): RateDecision {
    if (!this.config.enabled) return { allowed: true, remaining: Infinity };
    this.sweep();
    const now = this.now();
    const existing = this.buckets.get(address);
    if (!existing || existing.resetAt <= now) {
      const bucket = { count: 1, resetAt: now + this.config.windowMs };
      this.buckets.set(address, bucket);
      return { allowed: true, remaining: this.config.analysesPerIp - 1 };
    }
    if (existing.count >= this.config.analysesPerIp) {
      const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      return {
        allowed: false,
        retryAfterSeconds,
        code: 'analysis_rate_limited',
        message: `too many analyses started from this address; retry in ${retryAfterSeconds}s`,
      };
    }
    existing.count += 1;
    return { allowed: true, remaining: this.config.analysesPerIp - existing.count };
  }

  /** Reports the budget without spending it, for a pre-flight response. */
  peek(address: string): RateDecision {
    if (!this.config.enabled) return { allowed: true, remaining: Infinity };
    const bucket = this.buckets.get(address);
    if (!bucket || bucket.resetAt <= this.now()) {
      return { allowed: true, remaining: this.config.analysesPerIp };
    }
    if (bucket.count >= this.config.analysesPerIp) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - this.now()) / 1000)),
      };
    }
    return { allowed: true, remaining: this.config.analysesPerIp - bucket.count };
  }

  get trackedAddresses(): number {
    this.sweep();
    return this.buckets.size;
  }

  reset(): void {
    this.buckets.clear();
  }
}