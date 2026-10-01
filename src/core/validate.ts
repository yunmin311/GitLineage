import {
  EVIDENCE_STATUSES,
  ENTITY_TYPES,
  EVIDENCE_TYPES,
  RELATIONSHIP_TYPES,
  type EvidenceStatus,
  type LineageGraph,
} from './model.ts';
import { EVIDENCE_ALLOWED_STATUSES, EVIDENCE_REQUIRED_DATA_KEYS, relationshipSpec } from './ontology.ts';
import { resolveRelationshipStatus } from './policy.ts';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates a canonical lineage graph against the contract, including the
 * invariants that encode the product principles:
 *
 *   - every relationship carries at least one evidence record;
 *   - every evidence id resolves;
 *   - no relationship is stronger than its evidence;
 *   - relationship direction matches the ontology;
 *   - forbidden relationship/status combinations (such as a VERIFIED
 *     dependency, or a non-DETECTED similarity) cannot exist.
 */
export function validateGraph(graph: LineageGraph): ValidationResult {
  const errors: string[] = [];

  if (typeof graph.schemaVersion !== 'string' || graph.schemaVersion.length === 0) {
    errors.push('schemaVersion must be a non-empty string');
  }
  if (!graph.graph || typeof graph.graph.rootEntityId !== 'string') {
    errors.push('graph.rootEntityId must be a string');
  }
  if (!Array.isArray(graph.entities) || !Array.isArray(graph.relationships) || !Array.isArray(graph.evidence)) {
    errors.push('entities, relationships and evidence must be arrays');
    return { valid: false, errors };
  }

  const entityIds = new Set<string>();
  for (const entity of graph.entities) {
    if (entityIds.has(entity.id)) errors.push(`duplicate entity id: ${entity.id}`);
    entityIds.add(entity.id);
    if (!ENTITY_TYPES.includes(entity.type)) errors.push(`entity ${entity.id} has unknown type ${entity.type}`);
    if (entity.type === 'Repository' && !entity.id.startsWith('repo:')) {
      errors.push(`Repository entity ${entity.id} must use a repo: identifier`);
    }
  }

  if (!entityIds.has(graph.graph?.rootEntityId ?? '')) {
    errors.push(`root entity ${graph.graph?.rootEntityId} is not present in entities`);
  }

  const evidenceById = new Map<string, LineageGraph['evidence'][number]>();
  for (const evidence of graph.evidence) {
    if (evidenceById.has(evidence.id)) errors.push(`duplicate evidence id: ${evidence.id}`);
    evidenceById.set(evidence.id, evidence);
    if (!EVIDENCE_TYPES.includes(evidence.type)) errors.push(`evidence ${evidence.id} has unknown type ${evidence.type}`);
    if (!EVIDENCE_STATUSES.includes(evidence.status)) {
      errors.push(`evidence ${evidence.id} has unknown status ${evidence.status}`);
      continue;
    }
    const required = EVIDENCE_REQUIRED_DATA_KEYS[evidence.type];
    if (required) {
      for (const key of required) {
        if (evidence.data?.[key] === undefined) errors.push(`evidence ${evidence.id} is missing data.${key}`);
      }
    }
    if (!evidence.collector) errors.push(`evidence ${evidence.id} has no collector`);
    if (!evidence.extractor) errors.push(`evidence ${evidence.id} has no extractor`);
  }

  const relationshipIds = new Set<string>();
  for (const relationship of graph.relationships) {
    if (relationshipIds.has(relationship.id)) errors.push(`duplicate relationship id: ${relationship.id}`);
    relationshipIds.add(relationship.id);

    if (!RELATIONSHIP_TYPES.includes(relationship.type)) {
      errors.push(`relationship ${relationship.id} has unknown type ${relationship.type}`);
      continue;
    }
    const spec = relationshipSpec(relationship.type);
    if (!entityIds.has(relationship.source)) errors.push(`relationship ${relationship.id} references unknown source ${relationship.source}`);
    if (!entityIds.has(relationship.target)) errors.push(`relationship ${relationship.id} references unknown target ${relationship.target}`);
    // Direction is part of the ontology contract, so a graph that disagrees with
    // it is invalid regardless of how the edge was produced.
    if (relationship.directed !== spec.directed) {
      errors.push(
        `relationship ${relationship.id} of type ${relationship.type} is ${spec.directed ? 'directional' : 'symmetric'} and must set directed=${spec.directed}`,
      );
    }
    if (!spec.directed) {
      const mirrored = graph.relationships.find(
        (item) =>
          item !== relationship &&
          item.type === relationship.type &&
          item.source === relationship.target &&
          item.target === relationship.source,
      );
      if (mirrored) {
        errors.push(
          `relationship ${relationship.id} mirrors ${mirrored.id}; symmetric relationships must be stored once in canonical endpoint order`,
        );
      }
    }
    if (!spec.allowedStatuses.includes(relationship.status)) {
      errors.push(
        `relationship ${relationship.id} of type ${relationship.type} may not have status ${relationship.status} (allowed: ${spec.allowedStatuses.join(', ')})`,
      );
    }
    if (relationship.evidenceIds.length === 0) {
      errors.push(`relationship ${relationship.id} has no evidence`);
      continue;
    }

    const statuses: EvidenceStatus[] = [];
    for (const evidenceIdValue of relationship.evidenceIds) {
      const evidence = evidenceById.get(evidenceIdValue);
      if (!evidence) {
        errors.push(`relationship ${relationship.id} references unknown evidence ${evidenceIdValue}`);
        continue;
      }
      if (!spec.allowedEvidenceTypes.includes(evidence.type)) {
        errors.push(
          `relationship ${relationship.id} of type ${relationship.type} is supported by evidence type ${evidence.type}, which is not allowed`,
        );
      }
      if (!EVIDENCE_ALLOWED_STATUSES[evidence.type].includes(evidence.status)) {
        errors.push(
          `evidence ${evidence.id} of type ${evidence.type} may not carry status ${evidence.status}`,
        );
      }
      if (!spec.allowedStatuses.includes(evidence.status)) {
        errors.push(
          `relationship ${relationship.id} of type ${relationship.type} is supported by ${evidence.status} evidence, which is not allowed`,
        );
      }
      statuses.push(evidence.status);
    }

    const expected = resolveRelationshipStatus(relationship.type, statuses);
    if (expected !== relationship.status) {
      errors.push(
        `relationship ${relationship.id} status ${relationship.status} does not match its evidence (expected ${expected ?? 'none'})`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}
