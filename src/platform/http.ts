import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import type { Cache } from './cache.ts';
import { assertPublicHttpsUrl } from './url.ts';
import { LIMITS } from './limits.ts';

export class HttpError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
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
  sleep?: (ms: number) => Promise<void>;
}

interface CacheEntry {
  etag: string | null;
  lastModified: string | null;
  url: string;
  accept: string;
  fetchedAt: string;
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
  ): Promise<{ status: number; location: string | null; response: HttpResponse }> {
    const key = this.cache.hashKey(`${url.toString()}|${accept}`);
    const entryPath = this.cache.path('http', `${key}.json`);
    const cached = await this.cache.readJson<CacheEntry>(entryPath);

    const headers: Record<string, string> = {
      accept,
      'user-agent': this.userAgent,
    };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (cached?.etag) headers['if-none-match'] = cached.etag;
    if (cached?.lastModified) headers['if-modified-since'] = cached.lastModified;

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
          const body = cached ? await this.cache.readBuffer(cached.bodyFile) : null;
          if (body) {
            return {
              status: 200,
              location: null,
              response: { status: 200, body, etag: cached?.etag ?? null, fromCache: true, url: url.toString() },
            };
          }
          // The cache entry is unusable; fall through and refetch unconditionally.
          delete headers['if-none-match'];
          delete headers['if-modified-since'];
        }

        if (response.status === 403 || response.status === 429) {
          const remaining = response.headers.get('x-ratelimit-remaining');
          const reset = Number(response.headers.get('x-ratelimit-reset') ?? '0');
          if (remaining === '0' && reset > 0 && attempt < this.maxRetries) {
            const waitMs = Math.min(Math.max(reset * 1000 - Date.now(), 1000), 60_000);
            await this.sleep(waitMs);
            lastError = new HttpError('rate limited', response.status, url.toString());
            continue;
          }
        }

        if (!response.ok) {
          throw new HttpError(`unexpected status ${response.status} for ${url.toString()}`, response.status, url.toString());
        }

        const body = await this.readBounded(response, url);
        const etag = response.headers.get('etag');
        const lastModified = response.headers.get('last-modified');
        const bodyFile = this.cache.path('http', `${key}.bin`);
        await this.cache.writeAtomic(bodyFile, body);
        await this.cache.writeJsonAtomic(entryPath, {
          etag,
          lastModified,
          url: url.toString(),
          accept,
          fetchedAt: new Date().toISOString(),
          bodyFile,
        } satisfies CacheEntry);

        return {
          status: response.status,
          location: null,
          response: { status: response.status, body, etag, fromCache: false, url: url.toString() },
        };
      } catch (error) {
        if (error instanceof HttpError && error.status !== 403 && error.status !== 429) throw error;
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
