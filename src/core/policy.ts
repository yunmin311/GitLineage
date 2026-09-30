import type { EvidenceStatus, JsonValue, Observation, RelationshipType } from './model.ts';
import { EVIDENCE_ALLOWED_STATUSES, EVIDENCE_REQUIRED_DATA_KEYS, STATUS_STRENGTH, relationshipSpec } from './ontology.ts';
import { refToId } from './ids.ts';

export interface PolicyRejection {
  code: string;
  message: string;
  context?: Record<string, JsonValue>;
}

export type PolicyResult = { ok: true } | { ok: false; rejection: PolicyRejection };

/**
 * The single admission gate for collector output.
 *
 * A collector proposes; this module disposes. Every rejection is recorded as a
 * diagnostic so that a dropped relationship is always explainable.
 */
export function checkObservation(observation: Observation): PolicyResult {
  let subjectId: string;
  let objectId: string;
  try {
    subjectId = refToId(observation.subject);
    objectId = refToId(observation.object);
  } catch (error) {
    return {
      ok: false,
      rejection: {
        code: 'invalid_entity_ref',
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }

  if (subjectId === objectId) {
    return {
      ok: false,
      rejection: { code: 'self_relationship', message: `observation links ${subjectId} to itself` },
    };
  }

  const spec = relationshipSpec(observation.relationship);

  if (observation.directed !== spec.directed) {
    return {
      ok: false,
      rejection: {
        code: 'direction_mismatch',
        message: `relationship ${spec.type} must be ${spec.directed ? 'directed' : 'undirected'}`,
        context: { proposed_directed: observation.directed },
      },
    };
  }

  if (!spec.allowedEvidenceTypes.includes(observation.evidence.type)) {
    return {
      ok: false,
      rejection: {
        code: 'evidence_type_not_allowed',
        message: `evidence ${observation.evidence.type} may not support relationship ${spec.type}`,
        context: { evidence_type: observation.evidence.type, allowed_evidence_types: [...spec.allowedEvidenceTypes] },
      },
    };
  }

  const evidenceStatuses = EVIDENCE_ALLOWED_STATUSES[observation.evidence.type];
  if (!evidenceStatuses.includes(observation.evidence.status)) {
    return {
      ok: false,
      rejection: {
        code: 'evidence_status_not_valid_for_type',
        message: `evidence ${observation.evidence.type} may not carry status ${observation.evidence.status}`,
        context: { status: observation.evidence.status, allowed: [...evidenceStatuses] },
      },
    };
  }

  if (!spec.allowedStatuses.includes(observation.evidence.status)) {
    return {
      ok: false,
      rejection: {
        code: 'evidence_status_not_allowed',
        message: `status ${observation.evidence.status} is not admissible for relationship ${spec.type}`,
        context: { status: observation.evidence.status, allowed: [...spec.allowedStatuses] },
      },
    };
  }

  const required = EVIDENCE_REQUIRED_DATA_KEYS[observation.evidence.type] ?? [];
  const missing = required.filter((key) => observation.evidence.data[key] === undefined);
  if (missing.length > 0) {
    return {
      ok: false,
      rejection: {
        code: 'evidence_data_incomplete',
        message: `evidence ${observation.evidence.type} is missing required data: ${missing.join(', ')}`,
        context: { missing },
      },
    };
  }

  return { ok: true };
}

/**
 * Collapses several evidence statuses into the status of one relationship.
 *
 * The result is the strongest admissible status among the evidence. A weaker
 * evidence record can never raise a relationship, and a status outside the
 * relationship's allowed set is ignored rather than promoted. Returns `null`
 * when no evidence status is admissible, which drops the relationship entirely.
 */
export function resolveRelationshipStatus(
  type: RelationshipType,
  statuses: readonly EvidenceStatus[],
): EvidenceStatus | null {
  const allowed = relationshipSpec(type).allowedStatuses;
  let best: EvidenceStatus | null = null;
  for (const status of statuses) {
    if (!allowed.includes(status)) continue;
    if (best === null || STATUS_STRENGTH[status] > STATUS_STRENGTH[best]) best = status;
  }
  return best;
}
