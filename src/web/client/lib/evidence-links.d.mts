/**
 * Types for the client evidence-link module. See `url-state.d.mts` for why these
 * are declared rather than compiled.
 *
 * `EvidenceRecord` is deliberately a structural minimum rather than a copy of
 * `ViewEvidenceCard`: the link builder only reads fields it can use, and a
 * record missing them still yields no link rather than a fabricated one.
 */
export interface EvidenceRecord {
  locator?: string | undefined;
  sourceUrl?: string | undefined;
  collector?: string | undefined;
  extractor?: string | undefined;
  data?: Record<string, unknown> | undefined;
}

export declare function withLineAnchor(
  url: string | null,
  path: string | undefined,
  lineStart?: number,
  lineEnd?: number,
): string | null;
export declare function commitUrl(owner: string, name: string, commit: string | undefined): string | null;
export declare function blobUrl(
  owner: string,
  name: string,
  commit: string | undefined,
  path: string | undefined,
): string | null;
export declare function evidenceSourceUrl(
  record: EvidenceRecord,
  owner: string,
  name: string,
): string | null;
export declare function evidenceAnchorText(record: EvidenceRecord): string;
export declare const SIMILARITY_DISCLAIMER: string;