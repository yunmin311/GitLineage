import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import type { Cache } from './cache.ts';
import { assertPublicHttpsUrl } from './url.ts';
import { LIMITS } from './limits.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;
  /**
   * A stable, machine-readable reason. The web layer maps this onto a job
   * failure code, so a caller can distinguish "GitHub is rate limiting us" from
   * "this repository does not exist" without parsing prose.
   */
  readonly code: string;
  /** Set when the failure carries a usable `Retry-After` hint, in milliseconds. */
  readonly retryAfterMs: number | null;
  /** Whether retrying the same request later could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    message: string,
    status: number,
    url: string,
    options: { code?: string; retryAfterMs?: number | null; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.code = options.code ?? `upstream_http_${status}`;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.retryable = options.retryable ?? false;
  }
}

/**
 * What the upstream said about a 403 or 429, or null when the response is not a
 * rate limit at all.
 *
 * The distinction matters more than it looks. GitHub answers a *primary* rate
 * limit with `x-ratelimit-remaining: 0` and a reset up to an hour away, and
 * answers a genuine authorization failure with an ordinary 403. Treating both as
 * "rate limited, sleep and retry" made the analyser hold a worker for minutes
 * before failing with a message that said nothing useful.
 */
export interface RateLimitSignal {
  /** How long until the limit clears, or 0 when the upstream gave no usable hint. */
  waitMs: number;
  /** Where the number came from, for the log and the failure detail. */
  source: 'retry-after' | 'x-ratelimit-reset' | 'status-only' | 'no-hint';
}

export function classifyRateLimit(response: {
  status: number;
  headers: { get(name: string): string | null };
}): RateLimitSignal | null {
  const { status } = response;
  if (status !== 403 && status !== 429) return null;

  // `Retry-After` is authoritative: the upstream is telling us exactly how long.
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter !== null) {
    const trimmed = retryAfter.trim();
    if (/^\d+$/.test(trimmed)) return { waitMs: Number(trimmed) * 1000, source: 'retry-after' };
    const at = Date.parse(trimmed);
    if (!Number.isNaN(at)) return { waitMs: Math.max(at - Date.now(), 0), source: 'retry-after' };
  }

  const remaining = response.headers.get('x-ratelimit-remaining');
  const resetRaw = response.headers.get('x-ratelimit-reset');
  if (remaining !== null && remaining.trim() === '0') {
    const reset = Number(resetRaw ?? '');
    if (Number.isFinite(reset) && reset > 0) {
      return { waitMs: Math.max(reset * 1000 - Date.now(), 0), source: 'x-ratelimit-reset' };
    }
    return { waitMs: 0, source: 'no-hint' };
  }

  // 429 is a limit by definition even without headers. A 403 with budget left is
  // an authorization failure and must not be retried at all.
  if (status === 429) return { waitMs: 0, source: 'status-only' };
  return null;
}

export interface HttpResponse {
  status: number;
  body: Buffer;
  etag: string | null;
  fromCache: boolean;
  url: string;
}

export interface HttpClientOptions {
  cache: Cache;
  allowlist: ReadonlySet<string>;
  token?: string | undefined;
  userAgent?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRetries?: number;
  maxRedirects?: number;
  /**
   * The longest upstream rate-limit wait this client will sit through before
   * giving up on the request.
   *
   * A short secondary limit resolves in a second or two and is worth waiting
   * for. A primary limit resets on the hour, and sleeping through it would hold
   * a worker and end in a failure that looks like a timeout rather than the rate
   * limit it is. The default leaves the choice explicit.
   */
  maxRateLimitWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

interface CacheEntry {
  etag: string | null;
  lastModified: string | null;
  url: string;
  accept: string;
  fetchedAt: string;
  /** File name inside the cache's http directory, never an absolute path. */
  bodyFile: string;
}

/**
 * The only outbound network path of GitLineage.
 *
 * Guarantees: https only, allowlisted hosts only, no redirects (which removes
 * the redirect-based SSRF bypass), a hard response size cap, a request timeout,
 * conditional-request caching, and a bounded retry policy for rate limits.
 */
export class HttpClient {
  readonly cache: Cache;
  readonly allowlist: ReadonlySet<string>;
  private readonly token: string | undefined;
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly maxRetries: number;
  private readonly maxRedirects: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: HttpClientOptions) {
    this.cache = options.cache;
    this.allowlist = options.allowlist;
    this.token = options.token;
    this.userAgent = options.userAgent ?? 'gitlineage-analyzer/0.1.0';
    this.timeoutMs = options.timeoutMs ?? LIMITS.http.timeoutMs;
    this.maxBytes = options.maxBytes ?? LIMITS.http.maxResponseBytes;
    this.maxRetries = options.maxRetries ?? LIMITS.http.maxRetries;
    this.maxRedirects = options.maxRedirects ?? 3;
    this.maxRateLimitWaitMs = options.maxRateLimitWaitMs ?? LIMITS.http.maxRateLimitWaitMs;
    this.sleep = options.sleep ?? ((ms: number) => delay(ms));
  }

  async fetchAllowlisted(url: URL, accept: string): Promise<HttpResponse> {
    assertPublicHttpsUrl(url, this.allowlist);
    return this.fetchWithRedirects(url, accept, 0);
  }

  /**
   * Follows a small number of same-allowlist redirects. GitHub answers a
   * renamed or transferred repository with a redirect, and refusing it would
   * break the URL-first promise. Each hop is re-validated, so a redirect can
   * never move a request off the allowlist.
   */
  private async fetchWithRedirects(url: URL, accept: string, hops: number): Promise<HttpResponse> {
    const response = await this.request(url, accept);
    if (response.status >= 300 && response.status < 400 && response.location && hops < this.maxRedirects) {
      const next = new URL(response.location, url);
      assertPublicHttpsUrl(next, this.allowlist);
      return this.fetchWithRedirects(next, accept, hops + 1);
    }
    return response.response;
  }

  private async request(
    url: URL,
    accept: string,
    allowConditional = true,
  ): Promise<{ status: number; location: string | null; response: HttpResponse }> {
    const key = this.cache.hashKey(`${url.toString()}|${accept}`);
    const entryPath = this.cache.path('http', `${key}.json`);
    // Cache entries store only a file name, so a cache directory copied between
    // machines, users or working directories stays readable.
    const cached = await this.cache.readJson<CacheEntry>(entryPath);

    const headers: Record<string, string> = {
      accept,
      'user-agent': this.userAgent,
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (allowConditional) {
      if (cached?.etag) headers['if-none-match'] = cached.etag;
      if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(url, {
          headers,
          redirect: 'manual',
          signal: controller.signal,
        });

        // 304 is a 3xx but it is a cache hit, not a redirect.
        if (response.status !== 304 && response.status >= 300 && response.status < 400) {
          return {
            status: response.status,
            location: response.headers.get('location'),
            response: { status: response.status, body: Buffer.alloc(0), etag: null, fromCache: false, url: url.toString() },
          };
        }

        if (response.status === 304) {
          const body = cached?.bodyFile ? await this.cache.readBuffer(this.cache.path('http', cached.bodyFile)) : null;
          if (body) {
            return {
              status: 200,
              location: null,
              response: { status: 200, body, etag: cached?.etag ?? null, fromCache: true, url: url.toString() },
            };
          }
          // The server confirmed an unchanged resource but the cached body is
          // gone, so refetch once without conditional headers.
          return this.request(url, accept, false);
        }

        if (response.status === 403 || response.status === 429) {
          const signal = classifyRateLimit(response);
          if (signal) {
            const waitable = signal.waitMs > 0 && signal.waitMs <= this.maxRateLimitWaitMs;
            if (waitable && attempt < this.maxRetries) {
              // Honour Retry-After (or the reset hint) for a short limit, then
              // try once more. Capped so a hostile or mistaken upstream cannot
              // park this worker indefinitely.
              await this.sleep(signal.waitMs);
              lastError = new HttpError(
                `rate limited by upstream (${signal.source})`,
                response.status,
                url.toString(),
                { code: 'upstream_rate_limited', retryAfterMs: signal.waitMs, retryable: true },
              );
              continue;
            }
            // Waiting would cost more than the request is worth. Fail now, typed,
            // carrying when the limit clears so the caller can defer the work.
            const resetsIn = signal.waitMs > 0 ? `retry in ${Math.ceil(signal.waitMs / 1000)}s` : 'retry later';
            throw new HttpError(
              `upstream rate limit reached (${signal.source}); ${resetsIn}`,
              response.status,
              url.toString(),
              { code: 'upstream_rate_limited', retryAfterMs: signal.waitMs, retryable: true },
            );
          }
          // A 403 with budget remaining is an authorization failure: the token is
          // wrong, lacks access, or the resource is forbidden. Retrying cannot
          // change that, so it fails immediately and says so.
          throw new HttpError(
            `upstream refused the request with ${response.status}`,
            response.status,
            url.toString(),
            { code: response.status === 403 ? 'upstream_forbidden' : 'upstream_rate_limited', retryable: false },
          );
        }

        if (!response.ok) {
          // 5xx and other transient statuses keep their retry budget; everything
          // else is a permanent answer from the upstream.
          const transient = response.status >= 500 && response.status < 600;
          throw new HttpError(
            `unexpected status ${response.status} for ${url.toString()}`,
            response.status,
            url.toString(),
            { code: `upstream_http_${response.status}`, retryable: transient },
          );
        }

        const body = await this.readBounded(response, url);
        const etag = response.headers.get('etag');
        const lastModified = response.headers.get('last-modified');
        const bodyFileName = `${key}.bin`;
        await this.cache.writeAtomic(this.cache.path('http', bodyFileName), body);
        await this.cache.writeJsonAtomic(entryPath, {
          etag,
          lastModified,
          url: url.toString(),
          accept,
          fetchedAt: new Date().toISOString(),
          bodyFile: bodyFileName,
        } satisfies CacheEntry);

        return {
          status: response.status,
          location: null,
          response: { status: response.status, body, etag, fromCache: false, url: url.toString() },
        };
      } catch (error) {
          // 403 and 429 have already been classified above: either they were
          // retried after a short wait, or they threw a typed non-retryable or
          // rate-limit error. Letting them fall through to the generic retry
          // path is what spent minutes on failures that cannot improve.
          if (error instanceof HttpError && (error.status === 403 || error.status === 429)) throw error;
          const cause = error instanceof Error ? (error.cause instanceof Error ? ` (${error.cause.message})` : '') : '';
          lastError = error instanceof Error ? new Error(`${error.message}${cause} [${url.toString()}]`) : new Error(String(error));
          if (attempt < this.maxRetries) {
            await this.sleep(500 * (attempt + 1));
            continue;
          }
        } finally {
        clearTimeout(timer);
      }
    }

    throw lastError ?? new Error(`request failed: ${url.toString()}`);
  }

  async fetchJson<T>(url: URL, accept = 'application/json'): Promise<T> {
    const response = await this.fetchAllowlisted(url, accept);
    const text = response.body.toString('utf8');
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new HttpError(`response was not valid JSON: ${url.toString()}`, response.status, url.toString());
    }
  }

  async fetchText(url: URL, limitBytes: number): Promise<string> {
    const response = await this.fetchAllowlisted(url, 'text/plain; charset=utf-8');
    return response.body.subarray(0, limitBytes).toString('utf8');
  }

  private async readBounded(response: Response, url: URL): Promise<Buffer> {
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > this.maxBytes) {
      throw new HttpError(`response of ${declared} bytes exceeds the ${this.maxBytes} byte cap`, response.status, url.toString());
    }
    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > this.maxBytes) {
          await reader.cancel();
          throw new HttpError(`response exceeds the ${this.maxBytes} byte cap`, response.status, url.toString());
        }
        chunks.push(Buffer.from(value));
      }
    }
    return Buffer.concat(chunks);
  }
}

/**
 * Reads a token from the environment, or from the local GitHub CLI credential
 * store. This is a local credential lookup, never a request to a target
 * repository, and it stays optional: V1 works anonymously.
 */
export async function resolveGitHubToken(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  const fromEnv = env.GITHUB_TOKEN ?? env.GH_TOKEN;
  if (fromEnv && fromEnv.trim().length > 0) return fromEnv.trim();
  if (env.GITLINEAGE_NO_CLI_TOKEN === '1') return undefined;
  try {
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('gh', ['auth', 'token'], { timeout: 10_000, windowsHide: true });
    const token = stdout.trim();
    return token.length > 0 ? token : undefined;
  } catch {
    return undefined;
  }
}
