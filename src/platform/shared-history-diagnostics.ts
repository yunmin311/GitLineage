/**
 * Shared-history probe diagnostics.
 *
 * A sidecar, deliberately outside the canonical artifact.
 *
 * There is an unresolved, historical question about `shares_history_with`: a
 * single live run once omitted the signal for a fork pair, and it has not
 * recurred in 23 controlled cold analyses of the same repository at the same
 * revision, each with an isolated cache. The relationship is produced by
 * intersecting two *bounded* `rev-list` windows, so the plausible mechanism is a
 * fetch that occasionally yields a different window, and a shallow boundary
 * that lands differently.
 *
 * This records what the probe saw, so that if it ever recurs the next occurrence
 * can be diagnosed rather than guessed at. It is evidence-gathering, not a
 * behaviour change:
 *
 *   - graph.json is never touched; a test asserts byte-identical output with the
 *     sidecar enabled and disabled;
 *   - fetch depth is untouched;
 *   - nothing partial or incomplete is introduced, because that is a graph
 *     contract decision and there is no evidence for one;
 *   - relationship semantics are untouched;
 *   - every write is best-effort: a diagnostic failure can never fail an
 *     analysis, because a broken observability path must not become an outage;
 *   - the record is bounded, written atomically, retention-capped, and scrubbed.
 *
 * Nothing here can carry a credential: the record is assembled from repository
 * refs, commit shas and counts. The scrub exists anyway, so that a future caller
 * cannot turn an observability file into a secret store.
 */
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** One probe: the root window against one candidate window. */
export interface SharedHistoryProbeRecord {
  /** Ties every probe of one analysis to the same analysis header. */
  analysisId: string;
  repository: string;
  candidate: string;
  resolvedRevision: string;
  analyzerVersion: string;
  schemaVersion: string;
  /** Per-side fetch facts, so the two windows can be compared. */
  rootWindow: WindowFacts;
  candidateWindow: WindowFacts;
  /** The shas the probe required, and whether each was locally present. */
  requiredCommits: { sha: string; presentLocally: boolean }[];
  /** How many of the required commits the candidate's clone did not contain. */
  requiredCommitsMissingLocally: number;
  /** True when the required list was cut short by the cap. */
  requiredCommitsTruncatedByCap: boolean;
  probe: {
    method: 'commit-set-intersection';
    rootCommitCount: number;
    candidateCommitCount: number;
    requiredCount: number;
    sharedCount: number;
    sharedSample: string[];
  };
  emitted: boolean;
  /** Entity endpoints, which is how a sidecar record joins to a graph edge. */
  subjectEntityId: string;
  objectEntityId: string;
}

export interface WindowFacts {
  requestedDepth: number;
  effectiveDepth: number;
  refspec: string;
  blobFilter: string | null;
  isShallow: boolean;
  shallowBoundaryCount: number;
  /** True when a required commit sits exactly on the shallow boundary. */
  boundaryTruncated: boolean;
  commitCount: number;
  truncated: boolean;
}

/** The per-analysis header, written once. */
export interface AnalysisDiagnosticHeader {
  analysisId: string;
  repository: string;
  resolvedRevision: string;
  analyzerVersion: string;
  schemaVersion: string;
  startedAt: string;
  depthRequested: number;
  maxCandidates: number;
}

export interface SidecarOptions {
  /** Directory for sidecar files. Diagnostics are disabled when empty. */
  directory: string;
  /** Maximum sidecar files kept; the oldest are pruned. */
  retention: number;
  /** Rejects any record that grows past this, as a backstop. */
  maxBytes: number;
}

export const DEFAULT_SIDECAR: Omit<SidecarOptions, 'directory'> = { retention: 200, maxBytes: 256 * 1024 };

/**
 * Credential shapes, matched defensively.
 *
 * The record is built from public repository references and commit shas, so
 * nothing here should match. It is scrubbed anyway: an observability file is the
 * last place a token should ever end up, and a guard that is only correct
 * because of how every current caller happens to behave is not a guard.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  /\b(?:authorization|proxy-authorization)\s*[:=]\s*\S+/gi,
  /\b(?:bearer|token|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/**
 * URL userinfo, applied first and separately: the scheme and host are the useful
 * part of a diagnostic, so only the credentials are dropped. It is not in the
 * list above because its replacement differs from the blanket redaction.
 */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi;

const REDACTED = '[redacted]';

/** Replacement for URL userinfo, which keeps the scheme and host. */
const REDACTED_USERINFO = `$1${REDACTED}@`;

/** Replaces credential-shaped substrings anywhere in a JSON string. */
export function scrub(value: string): string {
  let out = value.replace(URL_USERINFO, REDACTED_USERINFO);
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, REDACTED);
  return out;
}

/**
 * Serialises a record defensively.
 *
 * Returns null rather than throwing when the record cannot be safely written, so
 * that the caller can simply skip it.
 */
export function serialise(record: unknown, maxBytes: number): string | null {
  let text: string;
  try {
    text = JSON.stringify(record, null, 1) ?? '';
  } catch {
    return null;
  }
  if (text.length === 0) return null;
  if (Buffer.byteLength(text, 'utf8') > maxBytes) return null;
  // Scrub the serialised form rather than the object graph, so a nested field
  // cannot reintroduce a secret after the object was inspected.
  const scrubbed = scrub(text);
  if (/(authorization|password|secret|private[_-]?key)\s*"?\s*[:=]/i.test(scrubbed)) {
    // A key name that suggests a credential survived; refuse the record rather
    // than publish it. Names are checked because a value-only scrub would miss a
    // field whose value happens to look harmless.
    return null;
  }
  return scrubbed;
}

/** A stable filename, so repeated probes join one analysis's record set. */
export function recordName(parts: { analysisId: string; repository: string; suffix?: string }): string {
  // Separators become underscores, and any surviving `..` is collapsed as well, so
  // a name can never contain a traversal sequence even before it reaches join().
  const clean = (value: string, max: number): string =>
    (value || 'unknown')
      .replace(/[^A-Za-z0-9._-]+/g, '_')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+/, '')
      .slice(0, max);
  const slug = clean(parts.repository, 80);
  const id = clean(parts.analysisId, 64);
  const suffix = parts.suffix ? `.${clean(parts.suffix, 80)}` : '';
  return `${slug}--${id}${suffix}.json`;
}

/**
 * Writes one sidecar file atomically, then prunes.
 *
 * Atomic by writing a temporary file and renaming, so a reader never sees a
 * half-written record and a crash mid-write cannot leave a corrupt one that
 * later looks like evidence.
 */
export async function writeSidecar(
  options: SidecarOptions,
  filename: string,
  record: unknown,
  now: () => number = Date.now,
): Promise<string | null> {
  if (!options.directory) return null;
  const text = serialise(record, options.maxBytes);
  if (text === null) return null;

  let written: string | null = null;
  try {
    await mkdir(options.directory, { recursive: true });
    const target = join(options.directory, filename);
    const temporary = `${target}.${now()}.tmp`;
    await writeFile(temporary, text, { encoding: 'utf8', mode: 0o640 });
    await rename(temporary, target);
    written = target;
  } catch {
    // Best effort by contract: observability must never fail an analysis.
    return null;
  }

  // Pruning is also best effort, and happens after the record is durable.
  try {
    await prune(options, now);
  } catch {
    /* ignored */
  }
  return written;
}

/** Keeps the newest `retention` files and removes the rest. */
export async function prune(options: SidecarOptions, now: () => number = Date.now): Promise<number> {
  if (!options.directory || options.retention <= 0) return 0;
  const names = await readdir(options.directory);
  const files = names.filter((n) => n.endsWith('.json'));
  if (files.length <= options.retention) return 0;

  const stamped = await Promise.all(
    files.map(async (name) => {
      try {
        const info = await stat(join(options.directory, name));
        return { name, mtimeMs: info.mtimeMs };
      } catch {
        return null;
      }
    }),
  );
  const present = stamped.filter((v): v is { name: string; mtimeMs: number } => v !== null);
  present.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const doomed = present.slice(options.retention);
  await Promise.all(doomed.map((f) => rm(join(options.directory, f.name), { force: true })));
  return doomed.length;
}

/**
 * The sink passed into the history collector.
 *
 * An interface rather than a concrete writer so tests can capture records without
 * touching a filesystem, and so the collector has no way to reach credentials.
 */
export interface SharedHistoryDiagnosticSink {
  header(header: AnalysisDiagnosticHeader): Promise<void>;
  probe(record: SharedHistoryProbeRecord): Promise<void>;
}

/**
 * Builds a sink writing into `directory`, or a no-op sink when diagnostics are
 * off. The no-op is the default, so behaviour is unchanged unless configured.
 */
export function createDiagnosticSink(
  directory: string,
  overrides: Partial<SidecarOptions> = {},
  now: () => number = Date.now,
): SharedHistoryDiagnosticSink {
  if (!directory) {
    return { header: async () => {}, probe: async () => {} };
  }
  const options: SidecarOptions = { directory, ...DEFAULT_SIDECAR, ...overrides };
  return {
    async header(header) {
      // One header per analysis, named without a suffix so repeated writes to the
      // same analysis overwrite rather than accumulate.
      const name = recordName({ analysisId: header.analysisId, repository: header.repository });
      await writeSidecar(options, name, header, now);
    },
    async probe(record) {
      const name = recordName({
        analysisId: record.analysisId,
        repository: record.repository,
        suffix: `probe-${record.candidate}`,
      });
      await writeSidecar(options, name, record, now);
    },
  };
}