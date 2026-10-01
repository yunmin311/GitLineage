/**
 * Canonical data model for the GitLineage V1 provenance core.
 *
 * Three object kinds are kept strictly separate and are never merged:
 *   Entity       - a node (repository, package, commit, release, artifact, project)
 *   Relationship - a typed, directed-or-not edge between two entities
 *   Evidence     - the reviewable observation that supports a relationship
 *
 * Evidence is first-class data. It is not a description string and it is not
 * only meaningful to a renderer: exporters, APIs and future adapters consume
 * the same records.
 */

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * Version of the serialized LineageGraph contract.
 *
 * MAJOR is bumped for any breaking change: a removed or renamed relationship
 * type, a removed evidence field, a changed status rule, or a changed direction.
 *
 * 2.0.0 — breaking: `contains_exact_content_from` was replaced by the symmetric
 *         `shares_exact_content_with`, and `git_blob_identity` evidence keys
 *         moved from `source_*`/`target_*` to `first_*`/`second_*`. A 1.x
 *         artifact must never be served, cached or validated under 2.x.
 */
export const GRAPH_SCHEMA_VERSION = '2.0.0';

/** Versions this build can read. Anything else must be treated as stale. */
export const SUPPORTED_GRAPH_SCHEMA_VERSIONS: readonly string[] = [GRAPH_SCHEMA_VERSION];

export const ANALYZER_VERSION = '0.2.0';

export type EvidenceStatus = 'VERIFIED' | 'DECLARED' | 'DETECTED';

export const EVIDENCE_STATUSES: readonly EvidenceStatus[] = ['VERIFIED', 'DECLARED', 'DETECTED'] as const;

export type RelationshipType =
  | 'forked_from'
  | 'derived_from'
  | 'shares_history_with'
  | 'depends_on'
  | 'uses_submodule'
  | 'declared_inspiration'
  | 'references'
  | 'shares_exact_content_with'
  | 'similar_to'
  | 'evolved_into';

export const RELATIONSHIP_TYPES: readonly RelationshipType[] = [
  'forked_from',
  'derived_from',
  'shares_history_with',
  'depends_on',
  'uses_submodule',
  'declared_inspiration',
  'references',
  'shares_exact_content_with',
  'similar_to',
  'evolved_into',
] as const;

export type EntityType = 'Repository' | 'Package' | 'Commit' | 'Release' | 'SourceArtifact' | 'ExternalProject';

export const ENTITY_TYPES: readonly EntityType[] = [
  'Repository',
  'Package',
  'Commit',
  'Release',
  'SourceArtifact',
  'ExternalProject',
] as const;

export type EvidenceType =
  | 'github_repository_identity'
  | 'github_fork_metadata'
  | 'git_shared_commits'
  | 'git_history_containment'
  | 'git_blob_identity'
  | 'git_submodule_entry'
  | 'package_manifest'
  | 'package_lockfile'
  | 'package_registry_metadata'
  | 'document_attribution'
  | 'document_reference'
  | 'token_fingerprint';

export const EVIDENCE_TYPES: readonly EvidenceType[] = [
  'github_repository_identity',
  'github_fork_metadata',
  'git_shared_commits',
  'git_history_containment',
  'git_blob_identity',
  'git_submodule_entry',
  'package_manifest',
  'package_lockfile',
  'package_registry_metadata',
  'document_attribution',
  'document_reference',
  'token_fingerprint',
] as const;

export type EntityId = string;
export type RelationshipId = string;
export type EvidenceId = string;

/**
 * A not-yet-materialised reference to an entity. Collectors emit refs; the
 * resolver turns them into `Entity` records. This keeps collectors free of
 * identity/registry bookkeeping.
 */
export type EntityRef =
  | { kind: 'repository'; provider: 'github'; owner: string; name: string }
  | { kind: 'package'; ecosystem: string; name: string }
  | { kind: 'commit'; sha: string }
  | { kind: 'release'; repository: EntityRefRepository; tag: string }
  | { kind: 'source_artifact'; repository: EntityRefRepository; path: string; blob: string }
  | { kind: 'external_project'; slug: string };

export type EntityRefRepository = { kind: 'repository'; provider: 'github'; owner: string; name: string };

export interface EvidenceLocator {
  /** Repository-relative path of the observed file. */
  path?: string;
  lineStart?: number;
  lineEnd?: number;
  /** Manifest field, lockfile key, or other structural locator. */
  field?: string;
  /** Name of the parsing rule set, e.g. `pyproject.toml`. */
  spec?: string;
}

export interface Evidence {
  id: EvidenceId;
  type: EvidenceType;
  status: EvidenceStatus;
  /** Collector that produced the observation. */
  collector: string;
  /** Extractor rule/version, e.g. `github-fork-metadata@1`. */
  extractor: string;
  /** Entity in which the observation was made, when meaningful. */
  repository?: EntityId;
  /** Canonical source location a reviewer can open. */
  sourceUrl?: string;
  locator?: EvidenceLocator;
  /** Exact text or value that was observed. */
  observedText?: string;
  /** Typed, reviewable payload specific to the evidence type. */
  data: Record<string, JsonValue>;
  observedAt: string;
}

export interface Entity {
  id: EntityId;
  type: EntityType;
  display: {
    name: string;
    fullName?: string;
    url?: string;
  };
  attributes: Record<string, JsonValue>;
  sourceUrl?: string;
}

export interface Relationship {
  id: RelationshipId;
  type: RelationshipType;
  source: EntityId;
  target: EntityId;
  /** False only for relationship types that carry no direction by construction. */
  directed: boolean;
  status: EvidenceStatus;
  evidenceIds: EvidenceId[];
  attributes: Record<string, JsonValue>;
}

export interface GraphNode {
  id: EntityId;
  type: EntityType;
  display: {
    name: string;
    fullName?: string;
    url?: string;
  };
  attributes: Record<string, JsonValue>;
  sourceUrl?: string;
}

export interface Diagnostic {
  /** Stable machine code, e.g. `evidence_status_not_allowed`. */
  code: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  collector?: string;
  context?: Record<string, JsonValue>;
}

export interface Revision {
  /** Commit the analysis was performed against. */
  commit: string;
  /** Branch or tag requested by the user, if any. */
  ref?: string;
  defaultBranch?: string;
  resolvedAt: string;
}

export interface AnalyzerInfo {
  name: string;
  version: string;
  schemaVersion: string;
  /** Cache namespace; `public` and `private` never share storage. */
  namespace: 'public' | 'private';
  /** Extractor identifiers that participated in this analysis. */
  extractors: string[];
  /** Optional external adapters that were enabled, even if not installed. */
  adapters: string[];
  limitsApplied: Record<string, JsonValue>;
}

export interface LineageGraph {
  schemaVersion: string;
  graph: {
    rootEntityId: EntityId;
    provider: string;
    revision: Revision;
    generatedAt: string;
    analyzer: AnalyzerInfo;
  };
  entities: Entity[];
  relationships: Relationship[];
  evidence: Evidence[];
  diagnostics: Diagnostic[];
}

/** Explicit entity registration requested by a collector that knows more than a ref. */
export interface EntityDraft {
  ref: EntityRef;
  display?: { name?: string; fullName?: string; url?: string };
  attributes?: Record<string, JsonValue>;
  sourceUrl?: string;
}

/** Draft produced by a collector before the resolver validates it. */
export interface EvidenceDraft {
  type: EvidenceType;
  status: EvidenceStatus;
  repository?: EntityRef;
  sourceUrl?: string;
  locator?: EvidenceLocator;
  observedText?: string;
  data: Record<string, JsonValue>;
}

export interface EntityDraftPatch {
  display?: { name?: string; fullName?: string; url?: string };
  attributes?: Record<string, JsonValue>;
  sourceUrl?: string;
}

/**
 * A single collector proposal. A collector may only state what it observed;
 * whether the proposal is admissible is decided by the resolver policy.
 */
export interface Observation {
  collector: string;
  extractor: string;
  subject: EntityRef;
  object: EntityRef;
  relationship: RelationshipType;
  directed: boolean;
  evidence: EvidenceDraft;
  subjectPatch?: EntityDraftPatch;
  objectPatch?: EntityDraftPatch;
  /** Aggregate facts about the relationship that no single evidence record carries. */
  relationshipAttributes?: Record<string, JsonValue>;
}
