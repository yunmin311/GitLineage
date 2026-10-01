/**
 * Shared shapes for the Web boundary.
 *
 * `LineageGraph` is re-exported from the core so that the API, the view-model
 * and the tests all speak about the same canonical type. Nothing here defines a
 * second graph format.
 */
export type {
  Diagnostic,
  Entity,
  EntityId,
  Evidence,
  EvidenceId,
  EvidenceStatus,
  LineageGraph,
  Relationship,
  RelationshipId,
  RelationshipType,
  Revision,
} from '../core/model.ts';

export interface RepositoryRefLike {
  owner: string;
  name: string;
}