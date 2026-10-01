import {
  ANALYZER_VERSION,
  GRAPH_SCHEMA_VERSION,
  type AnalyzerInfo,
  type Diagnostic,
  type Entity,
  type EntityDraft,
  type EntityId,
  type EntityRef,
  type Evidence,
  type EvidenceId,
  type JsonValue,
  type LineageGraph,
  type Observation,
  type Relationship,
  type Revision,
} from './model.ts';
import { refToDisplayName, refToEntityType, refToId, relationshipId, evidenceId } from './ids.ts';
import { canonicalEndpoints, checkObservation, isDirectional, resolveRelationshipStatus } from './policy.ts';
import { LIMITS } from '../platform/limits.ts';

export interface ResolveInput {
  root: EntityRef;
  observations: Observation[];
  entityDrafts?: EntityDraft[];
  /** Notes produced by collectors or the pipeline, carried into the artifact. */
  preDiagnostics?: Diagnostic[];
  revision: Revision;
  namespace: 'public' | 'private';
  extractors: string[];
  adapters?: string[];
  limitsApplied?: Record<string, JsonValue>;
  observedAt: string;
  analyzerVersion?: string;
  schemaVersion?: string;
}

export interface ResolveResult {
  graph: LineageGraph;
  diagnostics: Diagnostic[];
}

interface NormalizedObservation {
  observation: Observation;
  subjectId: EntityId;
  objectId: EntityId;
  /** Canonical endpoints after applying the ontology's direction contract. */
  sourceId?: EntityId;
  targetId?: EntityId;
  evidence: Evidence;
  repositoryId?: EntityId;
  subjectRef?: EntityRef;
  objectRef?: EntityRef;
}

function diagnostic(code: string, level: Diagnostic['level'], message: string, extra?: Partial<Diagnostic>): Diagnostic {
  return { code, level, message, ...extra };
}

function mergeAttributes(target: Record<string, JsonValue>, patch: Record<string, JsonValue> | undefined): void {
  if (!patch) return;
  for (const key of Object.keys(patch).sort()) {
    const value = patch[key];
    if (value === undefined || value === null) continue;
    target[key] = value;
  }
}

/**
 * Turns raw collector observations into the canonical lineage graph.
 *
 * Responsibilities, and nothing beyond them:
 *   - admit or reject observations through the policy gate;
 *   - merge multiple evidence records into a single relationship;
 *   - refuse to let evidence strength upgrade a relationship beyond its type;
 *   - produce a deterministic, sorted, machine-readable graph.
 */
export function resolve(input: ResolveInput): ResolveResult {
  const diagnostics: Diagnostic[] = [...(input.preDiagnostics ?? [])];
  const normalized: NormalizedObservation[] = [];

  for (const observation of input.observations) {
    let subjectId: EntityId;
    let objectId: EntityId;
    let repositoryId: EntityId | undefined;
    try {
      subjectId = refToId(observation.subject);
      objectId = refToId(observation.object);
      repositoryId = observation.evidence.repository ? refToId(observation.evidence.repository) : undefined;
    } catch (error) {
      diagnostics.push(
        diagnostic('invalid_entity_ref', 'warning', error instanceof Error ? error.message : String(error), {
          collector: observation.collector,
        }),
      );
      continue;
    }

    const record: Evidence = {
      id: evidenceId({
        type: observation.evidence.type,
        status: observation.evidence.status,
        collector: observation.collector,
        extractor: observation.extractor,
        repository: repositoryId,
        sourceUrl: observation.evidence.sourceUrl,
        locator: observation.evidence.locator as unknown as JsonValue | undefined,
        observedText: observation.evidence.observedText,
        data: observation.evidence.data,
      }),
      type: observation.evidence.type,
      status: observation.evidence.status,
      collector: observation.collector,
      extractor: observation.extractor,
      ...(repositoryId ? { repository: repositoryId } : {}),
      ...(observation.evidence.sourceUrl ? { sourceUrl: observation.evidence.sourceUrl } : {}),
      ...(observation.evidence.locator ? { locator: observation.evidence.locator } : {}),
      ...(observation.evidence.observedText ? { observedText: observation.evidence.observedText } : {}),
      data: observation.evidence.data,
      observedAt: input.observedAt,
    };

    normalized.push({
      observation,
      subjectId,
      objectId,
      evidence: record,
      subjectRef: observation.subject,
      objectRef: observation.object,
      ...(repositoryId ? { repositoryId } : {}),
    });
  }

  const accepted: NormalizedObservation[] = [];
  for (const candidate of normalized) {
    const result = checkObservation(candidate.observation);
    if (result.ok) {
      accepted.push(candidate);
      continue;
    }
    diagnostics.push(
      diagnostic(result.rejection.code, 'warning', result.rejection.message, {
        collector: candidate.observation.collector,
        ...(result.rejection.context ? { context: result.rejection.context } : {}),
      }),
    );
  }

  accepted.sort((a, b) => {
    const keyA = `${a.observation.relationship}|${a.subjectId}|${a.objectId}|${a.observation.extractor}|${a.evidence.id}`;
    const keyB = `${b.observation.relationship}|${b.subjectId}|${b.objectId}|${b.observation.extractor}|${b.evidence.id}`;
    return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
  });

  // Direction comes from the ontology, never from the observation. Endpoints are
  // canonicalised so a symmetric relationship merges into one edge instead of two
  // mirrored ones.
  const groups = new Map<string, NormalizedObservation[]>();
  for (const item of accepted) {
    const type = item.observation.relationship;
    const { source, target } = canonicalEndpoints(type, item.subjectId, item.objectId);
    item.sourceId = source;
    item.targetId = target;
    const key = `${type}|${source}|${target}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }

  const evidenceById = new Map<EvidenceId, Evidence>();
  const relationships: Relationship[] = [];
  const relationshipKeys = new Map<string, Relationship>();

  for (const key of [...groups.keys()].sort()) {
    const bucket = groups.get(key);
    if (!bucket || bucket.length === 0) continue;
    const first = bucket[0]!;
    const type = first.observation.relationship;

    const uniqueEvidence = new Map<EvidenceId, Evidence>();
    for (const item of bucket) {
      if (!uniqueEvidence.has(item.evidence.id)) uniqueEvidence.set(item.evidence.id, item.evidence);
      evidenceById.set(item.evidence.id, item.evidence);
    }
    const evidenceList = [...uniqueEvidence.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const status = resolveRelationshipStatus(
      type,
      evidenceList.map((record) => record.status),
    );

    if (status === null) {
      diagnostics.push(
        diagnostic(
          'no_admissible_evidence_status',
          'warning',
          `relationship ${type} between ${first.sourceId} and ${first.targetId} has no admissible evidence status and was dropped`,
          { collector: first.observation.collector, context: { relationship: type } },
        ),
      );
      continue;
    }

    const existing = relationshipKeys.get(key);
    if (existing) {
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...evidenceList.map((r) => r.id)])].sort();
      for (const item of bucket) {
        mergeAttributes(existing.attributes, item.observation.relationshipAttributes);
      }
      existing.status =
        resolveRelationshipStatus(
          type,
          existing.evidenceIds.map((id) => evidenceById.get(id)!.status),
        ) ?? existing.status;
      continue;
    }

    const relationship: Relationship = {
      id: relationshipId(type, first.sourceId!, first.targetId!, isDirectional(type)),
      type,
      source: first.sourceId!,
      target: first.targetId!,
      // Authoritative, copied from the ontology rather than from a collector.
      directed: isDirectional(type),
      status,
      evidenceIds: evidenceList.map((record) => record.id),
      attributes: {},
    };
    for (const item of bucket) {
      mergeAttributes(relationship.attributes, item.observation.relationshipAttributes);
    }
    relationships.push(relationship);
    relationshipKeys.set(key, relationship);
  }

  const entityMap = new Map<EntityId, { ref: EntityRef; entity: Entity }>();
  const ensureEntity = (ref: EntityRef): Entity => {
    const id = refToId(ref);
    const existing = entityMap.get(id);
    if (existing) return existing.entity;
    const display = refToDisplayName(ref);
    const entity: Entity = {
      id,
      type: refToEntityType(ref),
      display: { name: display.name, ...(display.fullName ? { fullName: display.fullName } : {}) },
      attributes: {},
    };
    entityMap.set(id, { ref, entity });
    return entity;
  };

  ensureEntity(input.root);
  for (const item of accepted) {
    const subject = ensureEntity(item.subjectRef!);
    const object = ensureEntity(item.objectRef!);
    if (item.observation.subjectPatch) {
      mergeAttributes(subject.attributes, item.observation.subjectPatch.attributes);
      if (item.observation.subjectPatch.display) {
        subject.display = { ...subject.display, ...stripUndefined(item.observation.subjectPatch.display) };
      }
      if (item.observation.subjectPatch.sourceUrl) subject.sourceUrl = item.observation.subjectPatch.sourceUrl;
    }
    if (item.observation.objectPatch) {
      mergeAttributes(object.attributes, item.observation.objectPatch.attributes);
      if (item.observation.objectPatch.display) {
        object.display = { ...object.display, ...stripUndefined(item.observation.objectPatch.display) };
      }
      if (item.observation.objectPatch.sourceUrl) object.sourceUrl = item.observation.objectPatch.sourceUrl;
    }
    if (item.repositoryId && item.observation.evidence.repository) ensureEntity(item.observation.evidence.repository);
  }

  for (const draft of input.entityDrafts ?? []) {
    const entity = ensureEntity(draft.ref);
    mergeAttributes(entity.attributes, draft.attributes);
    if (draft.display) entity.display = { ...entity.display, ...stripUndefined(draft.display) };
    if (draft.sourceUrl) entity.sourceUrl = draft.sourceUrl;
  }

  let entities = [...entityMap.values()]
    .map((entry) => entry.entity)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  relationships.sort((a, b) => {
    const keyA = `${a.type}|${a.source}|${a.target}`;
    const keyB = `${b.type}|${b.source}|${b.target}`;
    if (keyA !== keyB) return keyA < keyB ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  let evidenceList = [...evidenceById.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (relationships.length > LIMITS.graph.maxRelationships) {
    diagnostics.push(
      diagnostic(
        'graph_relationship_cap_applied',
        'warning',
        `graph exceeded ${LIMITS.graph.maxRelationships} relationships; excess relationships were dropped`,
      ),
    );
    relationships.length = LIMITS.graph.maxRelationships;
  }
  if (entities.length > LIMITS.graph.maxEntities) {
    diagnostics.push(
      diagnostic('graph_entity_cap_applied', 'warning', `graph exceeded ${LIMITS.graph.maxEntities} entities; excess entities were dropped`),
    );
    entities.length = LIMITS.graph.maxEntities;
  }
  if (evidenceList.length > LIMITS.graph.maxEvidence) {
    diagnostics.push(
      diagnostic('graph_evidence_cap_applied', 'warning', `graph exceeded ${LIMITS.graph.maxEvidence} evidence records; excess were dropped`),
    );
    evidenceList.length = LIMITS.graph.maxEvidence;
  }

  const survivingEvidence = new Set(evidenceList.map((record) => record.id));
  for (const relationship of relationships) {
    relationship.evidenceIds = relationship.evidenceIds.filter((id) => survivingEvidence.has(id));
  }

  const finalRelationships = relationships.filter((relationship) => {
    if (relationship.evidenceIds.length > 0) return true;
    diagnostics.push(
      diagnostic('relationship_without_evidence', 'error', `relationship ${relationship.id} had no surviving evidence and was dropped`),
    );
    return false;
  });
  for (const relationship of finalRelationships) {
    const statuses = relationship.evidenceIds.map((id) => evidenceById.get(id)?.status).filter((s): s is Evidence['status'] => Boolean(s));
    const status = resolveRelationshipStatus(relationship.type, statuses);
    if (status === null) {
      diagnostics.push(
        diagnostic('relationship_status_unresolvable', 'error', `relationship ${relationship.id} has no admissible status`),
      );
    } else {
      relationship.status = status;
    }
  }

  const analyzer: AnalyzerInfo = {
    name: 'gitlineage-analyzer',
    version: input.analyzerVersion ?? ANALYZER_VERSION,
    schemaVersion: input.schemaVersion ?? GRAPH_SCHEMA_VERSION,
    namespace: input.namespace,
    extractors: [...new Set(input.extractors)].sort(),
    adapters: [...new Set(input.adapters ?? [])].sort(),
    limitsApplied: input.limitsApplied ?? {},
  };

  const graph: LineageGraph = {
    schemaVersion: analyzer.schemaVersion,
    graph: {
      rootEntityId: refToId(input.root),
      provider: 'github',
      revision: input.revision,
      generatedAt: input.observedAt,
      analyzer,
    },
    entities,
    relationships: finalRelationships,
    evidence: evidenceList,
    diagnostics,
  };

  return { graph, diagnostics };
}

function stripUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out as Partial<T>;
}
