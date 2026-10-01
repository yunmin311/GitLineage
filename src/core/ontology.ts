import type { EvidenceStatus, EvidenceType, RelationshipType } from './model.ts';

/**
 * The V1 relationship ontology.
 *
 * Each relationship type declares:
 *   - whether it is directional by construction;
 *   - which evidence statuses may ever describe it;
 *   - which evidence types may support it.
 *
 * The resolver enforces these tables. A collector cannot invent a stronger
 * relationship type or a stronger status than its evidence allows.
 */
export interface RelationshipSpec {
  readonly type: RelationshipType;
  readonly directed: boolean;
  readonly allowedStatuses: readonly EvidenceStatus[];
  readonly allowedEvidenceTypes: readonly EvidenceType[];
  readonly description: string;
}

export const RELATIONSHIP_SPECS: readonly RelationshipSpec[] = [
  {
    type: 'forked_from',
    directed: true,
    allowedStatuses: ['VERIFIED', 'DECLARED'],
    allowedEvidenceTypes: ['github_fork_metadata', 'document_attribution'],
    description: 'The source repository is a fork of the target repository.',
  },
  {
    type: 'derived_from',
    directed: true,
    allowedStatuses: ['VERIFIED', 'DECLARED'],
    allowedEvidenceTypes: ['git_history_containment', 'document_attribution'],
    description: 'Git history containment plus temporal ordering proves historical derivation.',
  },
  {
    type: 'shares_history_with',
    directed: false,
    allowedStatuses: ['VERIFIED', 'DECLARED'],
    allowedEvidenceTypes: ['git_shared_commits', 'document_attribution'],
    description:
      'Both repositories contain at least one identical Git commit object. Symmetric: a shared ancestor implies no copying direction.',
  },
  {
    type: 'depends_on',
    directed: true,
    allowedStatuses: ['DECLARED'],
    allowedEvidenceTypes: ['package_manifest', 'package_lockfile'],
    description: 'The source repository declares a package dependency. Never an ancestry claim.',
  },
  {
    type: 'uses_submodule',
    directed: true,
    allowedStatuses: ['VERIFIED', 'DECLARED'],
    allowedEvidenceTypes: ['git_submodule_entry', 'document_attribution'],
    description: 'The source repository pins the target Git repository as a submodule.',
  },
  {
    type: 'declared_inspiration',
    directed: true,
    allowedStatuses: ['DECLARED'],
    allowedEvidenceTypes: ['document_attribution'],
    description: 'The authors explicitly stated that the project was inspired by or based on the target.',
  },
  {
    type: 'references',
    directed: true,
    allowedStatuses: ['DECLARED', 'DETECTED'],
    allowedEvidenceTypes: ['document_reference', 'document_attribution', 'package_registry_metadata'],
    description: 'The source explicitly links to the target. The weakest documented relationship.',
  },
  {
    type: 'shares_exact_content_with',
    directed: false,
    allowedStatuses: ['VERIFIED'],
    allowedEvidenceTypes: ['git_blob_identity'],
    description:
      'The two repositories contain byte-identical source content. Symmetric: identical content establishes neither direction nor provenance.',
  },
  {
    type: 'similar_to',
    directed: false,
    allowedStatuses: ['DETECTED'],
    allowedEvidenceTypes: ['token_fingerprint'],
    description:
      'A deterministic algorithm found source similarity. Symmetric: never provenance, never a direction of copying.',
  },
  {
    type: 'evolved_into',
    directed: true,
    allowedStatuses: ['VERIFIED'],
    allowedEvidenceTypes: ['git_history_containment', 'github_fork_metadata'],
    description: 'A later repository or release state in the same lineage. Reserved: not emitted in V1.',
  },
] as const;

const RELATIONSHIP_SPEC_BY_TYPE = new Map<RelationshipType, RelationshipSpec>(
  RELATIONSHIP_SPECS.map((spec) => [spec.type, spec]),
);

export function relationshipSpec(type: RelationshipType): RelationshipSpec {
  const spec = RELATIONSHIP_SPEC_BY_TYPE.get(type);
  if (!spec) throw new Error(`unknown relationship type: ${type}`);
  return spec;
}

export function isRelationshipType(value: string): value is RelationshipType {
  return RELATIONSHIP_SPEC_BY_TYPE.has(value as RelationshipType);
}

/**
 * The authoritative direction split.
 *
 * A renderer must read edge direction from this contract, never from which
 * entity happens to be the currently focused node. Symmetric relationship types
 * carry no direction at all: neither repository contains the other, neither is
 * derived from the other, and neither copied the other.
 */
export const DIRECTIONAL_RELATIONSHIPS: readonly RelationshipType[] = RELATIONSHIP_SPECS.filter(
  (spec) => spec.directed,
).map((spec) => spec.type);

export const SYMMETRIC_RELATIONSHIPS: readonly RelationshipType[] = RELATIONSHIP_SPECS.filter(
  (spec) => !spec.directed,
).map((spec) => spec.type);

export function isDirectional(type: RelationshipType): boolean {
  return relationshipSpec(type).directed;
}

export function isSymmetric(type: RelationshipType): boolean {
  return !relationshipSpec(type).directed;
}

/**
 * Normalises the endpoints of a relationship into canonical order.
 *
 * For symmetric relationships the two endpoints are interchangeable, so the
 * edge identity must not depend on which side happened to be observed first.
 * This is what makes a symmetric relationship merge into a single edge instead
 * of two mirrored ones.
 */
export function canonicalEndpoints(
  type: RelationshipType,
  left: string,
  right: string,
): { source: string; target: string } {
  if (relationshipSpec(type).directed) return { source: left, target: right };
  return left <= right ? { source: left, target: right } : { source: right, target: left };
}

/** Data keys every evidence record of a given type must carry to be reviewable. */
export const EVIDENCE_REQUIRED_DATA_KEYS: Readonly<Record<EvidenceType, readonly string[]>> = {
  github_repository_identity: ['full_name', 'html_url'],
  github_fork_metadata: ['fork', 'source_full_name', 'source_url'],
  git_shared_commits: ['shared_commit_count', 'shared_commit_samples', 'sampled_commit_count'],
  git_history_containment: ['source_only_commit_count', 'target_only_commit_count', 'shared_commit_count'],
  // Symmetric evidence: the two sides are named by observation order, never by
  // origin. `source_*`/`target_*` keys would imply a direction the fact does not
  // support.
  git_blob_identity: ['first_blob', 'second_blob', 'first_path', 'second_path'],
  git_submodule_entry: ['submodule_name', 'path', 'url', 'pinned_commit'],
  package_manifest: ['ecosystem', 'package_name', 'range', 'manifest_path'],
  package_lockfile: ['ecosystem', 'package_name', 'resolved_version', 'manifest_path'],
  package_registry_metadata: ['ecosystem', 'package_name', 'registry_url'],
  document_attribution: ['phrase', 'matched_text', 'path'],
  document_reference: ['matched_text', 'path'],
  token_fingerprint: ['algorithm', 'source_path', 'target_path', 'similarity'],
} as const;

/**
 * The statuses each evidence type may ever carry.
 *
 * This is a second, independent constraint next to the per-relationship status
 * table. A `document_attribution` record can therefore never be `VERIFIED`
 * (a README sentence is a declaration), and a `token_fingerprint` record can
 * never be anything but `DETECTED`.
 */
export const EVIDENCE_ALLOWED_STATUSES: Readonly<Record<EvidenceType, readonly EvidenceStatus[]>> = {
  github_repository_identity: ['VERIFIED'],
  github_fork_metadata: ['VERIFIED'],
  git_shared_commits: ['VERIFIED'],
  git_history_containment: ['VERIFIED'],
  git_blob_identity: ['VERIFIED'],
  git_submodule_entry: ['VERIFIED', 'DECLARED'],
  package_manifest: ['DECLARED'],
  package_lockfile: ['DECLARED'],
  package_registry_metadata: ['DECLARED'],
  document_attribution: ['DECLARED'],
  document_reference: ['DECLARED'],
  token_fingerprint: ['DETECTED'],
} as const;

/** Ordering used when a relationship is supported by several evidence records. */
export const STATUS_STRENGTH: Readonly<Record<EvidenceStatus, number>> = {
  VERIFIED: 3,
  DECLARED: 2,
  DETECTED: 1,
} as const;
