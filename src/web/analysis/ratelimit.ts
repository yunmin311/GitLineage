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
  /** Set false to disable metering entirely (single-user or trusted deployment). */
  enabled: boolean;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  analysesPerIp: 5,
  windowMs: 60_000,
  maxConcurrent: 2,
  maxQueueDepth: 20,
  trustedProxyHeader: null,
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
 * The client address.
 *
 * Prefers the socket, which cannot be forged. A proxy header is consulted only
 * when the deployment has declared that header trustworthy, and then only its
 * first hop, because that is the address the trusted proxy actually observed.
 */
export function clientIp(request: IncomingMessage, trustedProxyHeader: string | null): string {
  const socket = (request.socket as { remoteAddress?: string } | undefined)?.remoteAddress;
  const base = socket && socket.length > 0 ? socket : 'unknown';
  if (!trustedProxyHeader) return base;
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