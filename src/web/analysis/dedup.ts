/**
 * Job identity.
 *
 * A job is identified by the *work*, not by the request. Two visitors asking for
 * the same repository at the same revision, under the same contract and analyzer
 * versions, are asking for the same graph, so they join one job instead of
 * launching a second clone and a second pass over the GitHub API.
 *
 * The revision is part of the key because that is what the artifact cache keys
 * on: the same repository at a new commit is genuinely new work. When the
 * revision is not known yet the key uses `*`, which is deliberately
 * coarser-and-therefore-safe: it can only ever join two requests that share an
 * owner, a name and a contract version, never split one.
 */
import { createHash } from 'node:crypto';

export interface DedupInput {
  owner: string;
  name: string;
  resolvedRevision: string | null | undefined;
  schemaVersion: string;
  analyzerVersion: string;
}

/** Human-readable form, used in logs and in the typed overload response. */
export function dedupKeyString(input: DedupInput): string {
  const revision = input.resolvedRevision ?? '*';
  return `${input.owner.toLowerCase()}/${input.name.toLowerCase()}@${revision}|v${input.schemaVersion}|a${input.analyzerVersion}`;
}

/** The hash used as the map key. Short, stable and safe in a URL. */
export function dedupKey(input: DedupInput): string {
  return createHash('sha256').update(dedupKeyString(input)).digest('hex').slice(0, 32);
}