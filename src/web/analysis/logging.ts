/**
 * Records one structured line per notable deployment event.
 *
 * Deliberately small: line-delimited JSON on stdout, which every process
 * supervisor and log shipper already handles. No metrics stack, no exporter, no
 * new dependency — the platform's own log retention is the store.
 *
 * Nothing here ever logs a credential, a token or a cookie. The only free-form
 * text that reaches a log line is a repository reference and an error message,
 * both of which are already public -- but "already public" is a claim about the
 * caller, not a guarantee about this module, so every string is passed through
 * `redact` first. An error message is built from whatever the network returned,
 * and a hostile or merely careless repository can put anything in it.
 */
export type LogEvent =
  | 'analysis.accepted'
  | 'analysis.joined'
  | 'analysis.cacheHit'
  | 'analysis.started'
  | 'analysis.phase'
  | 'analysis.completed'
  | 'analysis.failed'
  | 'analysis.refused'
  | 'job.recovered'
  | 'http.request';

export interface LogFields {
  jobId?: string | undefined;
  repository?: string | undefined;
  dedupKey?: string | undefined;
  /** The commit an analysis resolved to. Public data, safe to log. */
  resolvedRevision?: string | null | undefined;
  phase?: string | undefined;
  durationMs?: number | undefined;
  cacheHit?: boolean | undefined;
  joined?: boolean | undefined;
  code?: string | undefined;
  /** Seconds to wait, mirrored from the `Retry-After` sent to the client. */
  retryAfterSeconds?: number | undefined;
  method?: string | undefined;
  path?: string | undefined;
  status?: number | undefined;
  requestMs?: number | undefined;
  queued?: number | undefined;
  running?: number | undefined;
  queueDepth?: number | undefined;
  message?: string | undefined;
}

/**
 * Credential shapes that must never survive into an operational log.
 *
 * Matched rather than allowlisted on purpose: an allowlist of "known secrets"
 * misses anything new, while these patterns are stable across providers. Order
 * matters only in that the private-key block is consumed whole.
 */
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  // An Authorization header, with or without its scheme: keep the fact that a
  // header was present, drop the value.
  /\b(?:authorization|proxy-authorization)\s*[:=]\s*\S+/gi,
  /\b(?:bearer|token|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/**
 * URL userinfo, applied separately because its replacement keeps the scheme and
 * host: "https://[redacted]@github.com/o/r" still tells an operator which host
 * failed, which a bare "[redacted]" would not.
 */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

const REDACTED = '[redacted]';

/**
 * Replaces credential-shaped substrings with a fixed marker.
 *
 * A fixed marker rather than a hash or a partial value: a log line is not the
 * place to keep a secret recognisable, and an operator needs to see that
 * something was removed.
 */
export function redact(value: string): string {
  let output = value.replace(URL_USERINFO, `$1${REDACTED}@`);
  for (const pattern of CREDENTIAL_PATTERNS) output = output.replace(pattern, REDACTED);
  return output;
}

/** Applies {@link redact} to every string field, at any depth. */
function scrub(value: unknown, depth = 0): unknown {
  // Bounded: a log line is not a place to serialize an unbounded structure.
  if (depth > 4) return '[truncated]';
  if (typeof value === 'string') return redact(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrub(item, depth + 1));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      output[key] = scrub(item, depth + 1);
    }
    return output;
  }
  return value;
}

/**
 * Emits one JSON line.
 *
 * Synchronous by design: an analysis that fails must still have its failure
 * recorded before the process exits, and an async logger would lose it.
 */
export function logEvent(event: LogEvent, fields: LogFields = {}): void {
  const line: Record<string, unknown> = scrub({
    ts: new Date().toISOString(),
    event,
    ...fields,
  }) as Record<string, unknown>;
  // `undefined` is dropped by JSON.stringify, but explicit keys are trimmed so a
  // log line never carries an empty field.
  for (const key of Object.keys(line)) {
    if (line[key] === undefined) delete line[key];
  }
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/** Human-readable one-liner used by the CLI-style startup banner. */
export function logStartup(details: Record<string, unknown>): void {
  const line = scrub({
    ts: new Date().toISOString(),
    event: 'server.started' as const,
    ...details,
  }) as Record<string, unknown>;
  process.stdout.write(`${JSON.stringify(line)}\n`);
}