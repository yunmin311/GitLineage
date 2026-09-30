import type { EvidenceLocator, JsonValue, Observation, RelationshipType } from '../../core/model.ts';
import { refToId } from '../../core/ids.ts';
import { resolveRepositoryRef, type RepositoryRef } from '../../platform/url.ts';
import { LIMITS } from '../../platform/limits.ts';

export const COLLECTOR_DOCUMENTS = 'documents';
export const EXTRACTOR_ATTRIBUTION = 'explicit-attribution@1';
export const EXTRACTOR_REFERENCE = 'explicit-reference@1';

/**
 * Attribution phrases and the relationship each one may support.
 *
 * The mapping is deliberately narrow. A bare link never becomes inspiration,
 * and an acknowledgement ("Thanks to X") is a reference, not a claim of
 * derivation. Anything outside this table is not read as a declaration.
 */
export const ATTRIBUTION_PHRASES: readonly { pattern: RegExp; label: string; relationship: RelationshipType }[] = [
  { pattern: /\b(?:originally\s+based\s+on|based\s+on)\b/i, label: 'based on', relationship: 'declared_inspiration' },
  { pattern: /\binspired\s+by\b/i, label: 'inspired by', relationship: 'declared_inspiration' },
  { pattern: /\bderived\s+from\b/i, label: 'derived from', relationship: 'derived_from' },
  { pattern: /\badapted\s+from\b/i, label: 'adapted from', relationship: 'derived_from' },
  { pattern: /\bport\s+of\b/i, label: 'port of', relationship: 'derived_from' },
  { pattern: /\bfork\s+of\b/i, label: 'fork of', relationship: 'forked_from' },
  { pattern: /\bthanks\s+to\b/i, label: 'thanks to', relationship: 'references' },
] as const;

/** Matches GitHub repository URLs in prose and markdown links. */
const REPO_URL = /(?:\bhttps?:\/\/github\.com\/|\bgithub\.com\/|git@github\.com:)([A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9._-]+?)(?=[)\s"'`#,;:]|$|\.git\b)/gi;

export interface DocumentScanInput {
  path: string;
  text: string;
  /** The repository the document belongs to. */
  root: RepositoryRef;
  htmlUrl: string;
}

export interface DocumentScanResult {
  observations: Observation[];
  diagnostics: { code: string; message: string; context?: Record<string, JsonValue> }[];
}

/**
 * Scans one document for explicit repository references and explicit
 * attribution.
 *
 * Conservative by construction:
 *   - fenced code blocks and indented code lines are ignored, so example shell
 *     commands are never read as declarations;
 *   - a phrase without a resolvable repository URL inside the same window
 *     produces no relationship at all;
 *   - a URL is emitted once, with the strongest relationship its context
 *     supports, instead of once per rule.
 */
export function scanDocument(input: DocumentScanInput): DocumentScanResult {
  const observations: Observation[] = [];
  const diagnostics: DocumentScanResult['diagnostics'] = [];
  const rootRef: RepositoryRef = input.root;
  const rootId = refToId({ kind: 'repository', provider: 'github', owner: rootRef.owner, name: rootRef.name });

  const text = input.text.slice(0, LIMITS.document.maxBytes);
  const lines = text.split(/\r?\n/);

  interface Candidate {
    relationship: RelationshipType;
    ref: RepositoryRef;
    lineIndex: number;
    lineEnd: number;
    phrase: string;
    matchedText: string;
  }
  const candidates = new Map<string, Candidate>();

  const inFence = (lineIndex: number): boolean => {
    let fence = false;
    for (let i = 0; i < lineIndex; i += 1) {
      if (/^\s{0,3}(?:```|~~~)/.test(lines[i] ?? '')) fence = !fence;
    }
    return fence;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    if (rawLine.trim().length === 0) continue;
    if (inFence(index)) continue;
    const isIndentedCode = /^(?: {4}|\t)/.test(rawLine);
    if (isIndentedCode) continue;
    const line = rawLine.length > LIMITS.document.maxLineLength ? rawLine.slice(0, LIMITS.document.maxLineLength) : rawLine;

    const phrases = ATTRIBUTION_PHRASES.filter((entry) => entry.pattern.test(line));
    if (phrases.length === 0) continue;

    // The declaration may wrap across lines, so the repository URL is looked up
    // in a small forward window. A blank line ends the declaration, and the
    // exact line range is recorded as evidence.
    let target: RepositoryRef | null = null;
    let matchLine = index;
    for (let offset = 0; offset <= LIMITS.document.attributionWindowLines; offset += 1) {
      const candidateLine = lines[index + offset] ?? '';
      if (offset > 0 && candidateLine.trim().length === 0) break;
      if (offset > 0 && inFence(index + offset)) break;
      REPO_URL.lastIndex = 0;
      const match = [...candidateLine.matchAll(REPO_URL)][0];
      if (!match) continue;
      const full = match[0] ?? '';
      const tail = full.slice(full.indexOf(match[1] ?? '') + (match[1] ?? '').length);
      const withSuffix = /\.git(?=$|[)\s"'`#,;:])/.test(tail) ? `${full}.git` : full;
      target = safeResolve(withSuffix);
      if (target) {
        matchLine = index + offset;
        break;
      }
    }

    if (!target) {
      diagnostics.push({
        code: 'attribution_phrase_without_repository_url',
        message: `attribution phrase in ${input.path}:${index + 1} has no repository URL within the attribution window and was not converted into a relationship`,
        context: { path: input.path, line: index + 1, phrases: phrases.map((p) => p.label) },
      });
      continue;
    }

    const targetId = refToId({ kind: 'repository', provider: 'github', owner: target.owner, name: target.name });
    if (targetId === rootId) continue;

    const observedText = lines
      .slice(index, matchLine + 1)
      .join(' ')
      .trim()
      .slice(0, 200);

    // Strongest declared meaning wins for a given (source, target) pair.
    const existing = candidates.get(targetId);
    const strongest = strongestRelationship(phrases.map((p) => p.relationship));
    if (!existing || isStronger(strongest, existing.relationship)) {
      candidates.set(targetId, {
        relationship: strongest,
        ref: target,
        lineIndex: index,
        lineEnd: matchLine,
        phrase: phrases[0]?.label ?? strongest,
        matchedText: observedText,
      });
    }
  }

  // Plain links anywhere in prose: references only. Code blocks and indented
  // code are skipped, because a link inside an example command is usage, not a
  // statement about the relationship between the two projects.
  //
  // References are capped: a README link list must never be able to bury the
  // lineage edges, and the pipeline applies the same cap across documents.
  let referenceCount = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? '';
    if (rawLine.trim().length === 0) continue;
    if (inFence(index)) continue;
    if (/^(?: {4}|\t)/.test(rawLine)) continue;
    const line = rawLine.length > LIMITS.document.maxLineLength ? rawLine.slice(0, LIMITS.document.maxLineLength) : rawLine;
    REPO_URL.lastIndex = 0;
    for (const match of line.matchAll(REPO_URL)) {
      if (candidates.size >= LIMITS.document.maxUrlMatchesPerFile) break;
      if (referenceCount >= LIMITS.document.maxReferenceRelationships) break;
      const full = match[0] ?? '';
      const target = safeResolve(full);
      if (!target) continue;
      const targetId = refToId({ kind: 'repository', provider: 'github', owner: target.owner, name: target.name });
      if (targetId === rootId) continue;
      if (candidates.has(targetId)) continue;
      candidates.set(targetId, {
        relationship: 'references',
        ref: target,
        lineIndex: index,
        lineEnd: index,
        phrase: 'link',
        matchedText: line.trim().slice(0, 200),
      });
      referenceCount += 1;
    }
  }

  for (const candidate of [...candidates.values()].sort((a, b) => a.lineIndex - b.lineIndex)) {
    const locator: EvidenceLocator = {
      path: input.path,
      lineStart: candidate.lineIndex + 1,
      lineEnd: candidate.lineEnd + 1,
    };
    const isAttribution = candidate.relationship !== 'references';
    const evidence: Observation['evidence'] = isAttribution
      ? {
          type: 'document_attribution',
          status: 'DECLARED',
          repository: { kind: 'repository', provider: 'github', owner: rootRef.owner, name: rootRef.name },
          sourceUrl: input.htmlUrl,
          locator,
          observedText: candidate.matchedText,
          data: {
            phrase: candidate.phrase,
            matched_text: candidate.matchedText,
            path: input.path,
            line_start: candidate.lineIndex + 1,
            line_end: candidate.lineEnd + 1,
            rule: 'explicit-attribution@1',
          },
        }
      : {
          type: 'document_reference',
          status: 'DECLARED',
          repository: { kind: 'repository', provider: 'github', owner: rootRef.owner, name: rootRef.name },
          sourceUrl: input.htmlUrl,
          locator,
          observedText: candidate.matchedText,
          data: {
            matched_text: candidate.matchedText,
            path: input.path,
            line_start: candidate.lineIndex + 1,
            line_end: candidate.lineEnd + 1,
            phrase: candidate.phrase,
          },
        };

    observations.push({
      collector: COLLECTOR_DOCUMENTS,
      extractor: isAttribution ? EXTRACTOR_ATTRIBUTION : EXTRACTOR_REFERENCE,
      subject: { kind: 'repository', provider: 'github', owner: rootRef.owner, name: rootRef.name },
      object: { kind: 'repository', provider: 'github', owner: candidate.ref.owner, name: candidate.ref.name },
      relationship: candidate.relationship,
      directed: true,
      evidence,
    });
  }

  return { observations, diagnostics };
}

const STRENGTH: Record<RelationshipType, number> = {
  forked_from: 6,
  derived_from: 5,
  declared_inspiration: 4,
  uses_submodule: 3,
  shares_history_with: 2,
  references: 1,
  depends_on: 1,
  contains_exact_content_from: 1,
  similar_to: 1,
  evolved_into: 1,
};

function isStronger(candidate: RelationshipType, current: RelationshipType): boolean {
  return STRENGTH[candidate] > STRENGTH[current];
}

function strongestRelationship(types: readonly RelationshipType[]): RelationshipType {
  return types.reduce((best, current) => (isStronger(current, best) ? current : best), 'references' as RelationshipType);
}

function safeResolve(text: string): RepositoryRef | null {
  const trimmed = text.replace(/[),.;]+$/, '');
  try {
    return resolveRepositoryRef(trimmed);
  } catch {
    return null;
  }
}

/** Documents that are worth scanning, ranked by how often they carry attribution. */
export const DOCUMENT_PATTERNS: readonly { pattern: RegExp; rank: number }[] = [
  { pattern: /^\.?\/?readme(\.[a-z0-9]+)?$/i, rank: 0 },
  { pattern: /^\.?\/?(notice|acknowledg(e)?ments?|credits?)(\.[a-z0-9]+)?$/i, rank: 1 },
  { pattern: /^\.?\/?(licen[cs]e|copying)(\.[a-z0-9]+)?$/i, rank: 2 },
  { pattern: /^\.?\/?(contributing|authors|maintainers)(\.[a-z0-9]+)?$/i, rank: 3 },
  { pattern: /^docs\/[a-z0-9._/-]+\.md$/i, rank: 4 },
  { pattern: /^doc\/[a-z0-9._/-]+\.md$/i, rank: 4 },
] as const;

export function isScannableDocument(path: string): boolean {
  return DOCUMENT_PATTERNS.some((entry) => entry.pattern.test(path));
}
