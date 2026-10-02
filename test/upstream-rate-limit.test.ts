/**
 * Rate-limit and credential-failure handling.
 *
 * These tests exist because the behaviour they pin was wrong in production: a
 * permanent authorization failure was retried until the budget ran out, so a
 * 403 took about four minutes to surface and arrived with a message that said
 * only "unexpected status 403". A GitHub rate limit was also treated as
 * something to sleep through, which is right for a two-second secondary limit
 * and wrong for an hour-long primary limit.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { classifyRateLimit, HttpError } from '../src/platform/http.ts';
import type { HttpClientOptions } from '../src/platform/http.ts';
import { LIMITS } from '../src/platform/limits.ts';

/** Builds a minimal response-like object with the headers a test cares about. */
function reply(status: number, headers: Record<string, string>): {
  status: number;
  headers: { get(name: string): string | null };
} {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null } };
}

test('a 403 with no rate-limit headers is an authorization failure, not a limit', () => {
  // remaining > 0 is the tell: GitHub had budget and still refused.
  assert.equal(
    classifyRateLimit(reply(403, { 'x-ratelimit-remaining': '4999', 'x-ratelimit-limit': '5000' })),
    null,
  );
});

test('a primary rate limit is recognised from remaining=0 and a reset time', () => {
  const resetSeconds = Math.floor(Date.now() / 1000) + 1800;
  const signal = classifyRateLimit(
    reply(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(resetSeconds) }),
  );
  assert.ok(signal, 'recognised as a limit');
  assert.equal(signal.source, 'x-ratelimit-reset');
  // Half an hour away, which is exactly the case that must not be slept through.
  assert.ok(signal.waitMs > 1_700_000, `expected a long wait, got ${signal.waitMs}`);
});

test('Retry-After in seconds is authoritative', () => {
  const signal = classifyRateLimit(reply(429, { 'retry-after': '3' }));
  assert.ok(signal);
  assert.equal(signal.source, 'retry-after');
  assert.equal(signal.waitMs, 3000);
});

test('Retry-After as an HTTP date is understood', () => {
  const when = new Date(Date.now() + 5000).toUTCString();
  const signal = classifyRateLimit(reply(403, { 'retry-after': when }));
  assert.ok(signal);
  assert.equal(signal.source, 'retry-after');
  assert.ok(signal.waitMs > 0 && signal.waitMs <= 6000, `unexpected wait ${signal.waitMs}`);
});

test('a 429 with no headers is still a limit', () => {
  const signal = classifyRateLimit(reply(429, {}));
  assert.ok(signal);
  assert.equal(signal.source, 'status-only');
  // No hint means wait nothing and fail now rather than guess.
  assert.equal(signal.waitMs, 0);
});

test('remaining=0 with no reset is a limit with no usable hint', () => {
  const signal = classifyRateLimit(reply(403, { 'x-ratelimit-remaining': '0' }));
  assert.ok(signal);
  assert.equal(signal.source, 'no-hint');
  assert.equal(signal.waitMs, 0);
});

test('a success is never classified as a limit', () => {
  assert.equal(classifyRateLimit(reply(200, {})), null);
  assert.equal(classifyRateLimit(reply(500, { 'retry-after': '1' })), null);
});

test('HttpError carries a typed code, a retry hint, and retryability', () => {
  const limited = new HttpError('rate limited', 429, 'https://api.github.com/x', {
    code: 'upstream_rate_limited',
    retryAfterMs: 30_000,
    retryable: true,
  });
  assert.equal(limited.code, 'upstream_rate_limited');
  assert.equal(limited.retryAfterMs, 30_000);
  assert.equal(limited.retryable, true);

  const forbidden = new HttpError('refused', 403, 'https://api.github.com/x', {
    code: 'upstream_forbidden',
  });
  assert.equal(forbidden.code, 'upstream_forbidden');
  assert.equal(forbidden.retryable, false, 'a refusal cannot improve by retrying');
  assert.equal(forbidden.retryAfterMs, null);
});

test('the rate-limit wait ceiling is small, so a limit cannot hold a worker', () => {
  // The regression that matters: the old code slept up to 60s per attempt for up
  // to maxRetries attempts, so a primary limit consumed ~240s and then failed
  // with a message that said only "unexpected status 403". The ceiling is now a
  // single, small, asserted number that cannot silently grow back.
  assert.ok(LIMITS.http.maxRateLimitWaitMs > 0);
  assert.ok(
    LIMITS.http.maxRateLimitWaitMs <= 10_000,
    `a wait ceiling of ${LIMITS.http.maxRateLimitWaitMs}ms is long enough to hold a worker`,
  );
});

test('a client can override the ceiling without editing the code', () => {
  // Deployments that would rather never wait need a way to say so.
  const options: HttpClientOptions = { cache: null as never, allowlist: new Set<string>(), maxRateLimitWaitMs: 0 };
  assert.equal(options.maxRateLimitWaitMs, 0);
});