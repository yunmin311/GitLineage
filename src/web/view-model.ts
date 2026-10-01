import type {
  Diagnostic,
  Entity,
  EntityId,
  Evidence,
  EvidenceStatus,
  LineageGraph,
  Relationship,
  RelationshipType,
} from '../core/model.ts';
import {
  DIRECTIONAL_RELATIONSHIPS,
  SYMMETRIC_RELATIONSHIPS,
  isDirectional,
  relationshipSpec,
} from '../core/ontology.ts';

/**
 * Presentation layer.
 *
 * Everything here is a *view* of the canonical graph. Nothing in this module
 * may add a field to the graph, change a relationship type, change a status, or
 * invent evidence. The core contract is the source of truth; this file decides
 * only where a node sits, what a label says, what is visible by default, and
 * how many evidence records an edge carries.
 *
 * Two rules are load-bearing and are covered by tests:
 *
 * 1. **Arrow direction comes from the relationship, never from the subject.**
 *    `ViewEdge.arrow` is derived from `relationship.directed`, which the resolver
 *    stamped from the ontology. The renderer may not recompute it.
 * 2. **Symmetric edges never carry an arrow.** Endpoint order in the canonical
 *    graph is a storage detail; the UI may focus either endpoint without
 *    changing what the relationship means.
 */

/** Where a node sits in the R3.1 subject-centric layout. */
export type LayoutSlot =
  | 'subject'
  | 'upstream'
  | 'downstream'
  | 'dependency'
  | 'shared-near'
  | 'attribution-far'
  | 'similarity';

export type RelationFamily = 'ancestry' | 'dependency' | 'attribution' | 'source-identity' | 'similarity';

/** What the subject's role is on this edge, independent of arrow direction. */
export type EdgeRole = 'outbound' | 'inbound' | 'peer';

/**
 * Whether an edge is drawn by default.
 *
 * R3.1's density target is roughly seven edges per view. Real monorepos do not
 * cooperate: analysing `vitest-dev/vitest` yields 83 `depends_on` edges from 24
 * manifest files alone. Rather than truncate silently or widen the canvas, the
 * presentation layer classifies edges and bundles the bulk ones, and the header
 * states how many were bundled. This is presentation only: the canonical graph
 * and its relationship set are untouched, and every bundled edge stays
 * reachable in the Evidence drawer.
 */
export type EdgeVisibility = 'primary' | 'bundled';

export interface ViewNode {
  id: string;
  type: Entity['type'];
  slot: LayoutSlot;
  /** Human label, e.g. `sindresorhus/is`. Never an ontology name. */
  label: string;
  owner?: string;
  name?: string;
  url?: string;
  /** Mono fact line shown under the label. */
  fact?: string;
  isSubject: boolean;
  /** Package nodes are drawn weaker than repository nodes. */
  isPackage: boolean;
  /** Entity ids that this node depends on for the current hop. */
  outboundRelationshipIds: string[];
  inboundRelationshipIds: string[];
  peerRelationshipIds: string[];
}

export interface ViewEdge {
  id: string;
  relationshipType: RelationshipType;
  family: RelationFamily;
  status: EvidenceStatus;
  /**
   * Canonical direction, from `relationship.directed`. The renderer must use
   * this field verbatim. It must never be derived from `source`/`target` order
   * or from which endpoint is focused.
   */
  directed: boolean;
  /** Rendered arrow. Always 'none' for symmetric relationships. */
  arrow: 'none' | 'end' | 'end-weak';
  /** Which endpoint the arrowhead sits on, in canonical terms. */
  arrowheadAt?: EntityId;
  source: string;
  target: string;
  /** Human label written from the subject's point of view. */
  label: string;
  /** Stable relation name, e.g. `shares history`. */
  relationLabel: string;
  /** The subject's role on this edge. Affects wording only, never arrows. */
  subjectRole: EdgeRole;
  visibility: EdgeVisibility;
  /** Bundle key for collapsed edges, e.g. `depends_on/DECLARED`. */
  bundleKey?: string;
  evidenceCount: number;
  evidenceIds: string[];
  /** True when evidence records were capped and the count exceeds the sample. */
  evidenceTruncated: boolean;
  /** Extra mono detail, e.g. `×19 blobs`. */
  badge?: string;
}

export interface ViewEvidenceCard {
  id: string;
  type: Evidence['type'];
  status: EvidenceStatus;
  collector: string;
  extractor: string;
  repository?: string;
  sourceUrl?: string;
  /** `README.md:41-42`, or `.gitmodules → submodule.x.path`. */
  locator?: string;
  observedText?: string;
  data: Record<string, unknown>;
  observedAt: string;
}

/**
 * A collapsed group of secondary edges.
 *
 * Every member is still present in `edges` and still reachable in the Evidence
 * drawer; the bundle is a display convenience with a real count, never a
 * silent drop.
 */
export interface ViewBundle {
  key: string;
  relationshipType: RelationshipType;
  family: RelationFamily;
  status: EvidenceStatus;
  count: number;
  label: string;
  /** Representative evidence id, so the drawer can still show something real. */
  sampleRelationshipId: string;
  totalEvidenceCount: number;
}

export interface ViewGraph {
  schemaVersion: string;
  analyzer: {
    name: string;
    version: string;
    schemaVersion: string;
    extractors: string[];
    adapters: string[];
  };
  revision: {
    commit: string;
    shortCommit: string;
    ref?: string;
    defaultBranch?: string;
    analyzedAt: string;
  };
  subject: ViewNode;
  nodes: ViewNode[];
  edges: ViewEdge[];
  /** One-hop edges only, which is the whole point of this view. */
  edgeCount: number;
  /** Edges drawn individually on the canvas. */
  primaryEdgeCount: number;
  /** Edges collapsed into bundles. Still present, still auditable. */
  bundledEdgeCount: number;
  bundles: ViewBundle[];
  hiddenRelationshipCount: number;
  statusCounts: Record<EvidenceStatus, number>;
  familyCounts: Record<RelationFamily, number>;
  directionContract: {
    directional: RelationshipType[];
    symmetric: RelationshipType[];
  };
  empty: {
    isEmpty: boolean;
    reason: string;
  };
  partial: {
    isPartial: boolean;
    notes: Diagnostic[];
  };
  /** Human-readable evidence, resolved from evidenceIds. */
  evidenceByRelationship: Record<string, ViewEvidenceCard[]>;
}

export interface BuildViewOptions {
  /** Overrides which entity is the subject. Defaults to the graph root. */
  subjectId?: string;
  /** Cap on evidence cards inlined per relationship. */
  evidenceCardLimit?: number;
  maxHop?: number;
}

const FAMILY: Readonly<Record<RelationshipType, RelationFamily>> = {
  forked_from: 'ancestry',
  derived_from: 'ancestry',
  evolved_into: 'ancestry',
  shares_history_with: 'ancestry',
  uses_submodule: 'dependency',
  depends_on: 'dependency',
  declared_inspiration: 'attribution',
  references: 'attribution',
  shares_exact_content_with: 'source-identity',
  similar_to: 'similarity',
};

/**
 * Relationship types that answer "where did this come from" and are therefore
 * drawn individually. Everything else is bundled by default.
 *
 * `depends_on` and `references` are the two bulk families in real repositories.
 * Bundling them keeps a monorepo readable without deleting evidence: the count
 * is displayed, and each member remains addressable.
 */
const PRIMARY_TYPES: ReadonlySet<RelationshipType> = new Set<RelationshipType>([
  'forked_from',
  'derived_from',
  'evolved_into',
  'shares_history_with',
  'shares_exact_content_with',
  'uses_submodule',
  'declared_inspiration',
  'similar_to',
]);

/**
 * How many lineage-bearing edges are drawn individually before the remainder are
 * grouped. Bulk families (`depends_on`, `references`) are always bundled;
 * this cap only limits the overflow when a repository has an unusually large
 * number of submodules or identity matches.
 *
 * Chosen from real data: `grpc/grpc` produces 20 `uses_submodule` plus 5
 * `shares_exact_content_with` edges, which is the actual story of that
 * repository and must stay drawn. `vitest-dev/vitest` produces 83
 * `depends_on` edges, which must not.
 */
const PRIMARY_DRAW_CAP = 30;

/**
 * Relative significance, used only to decide what to group when the cap is hit.
 * Never affects status, direction, or evidence.
 */
const SIGNIFICANCE: Readonly<Record<RelationshipType, number>> = {
  forked_from: 100,
  derived_from: 100,
  evolved_into: 95,
  declared_inspiration: 90,
  shares_history_with: 85,
  uses_submodule: 70,
  shares_exact_content_with: 65,
  similar_to: 40,
  references: 20,
  depends_on: 10,
};

/** Wording written from the subject's side. Never affects arrow direction. */
function relationLabel(type: RelationshipType, subjectRole: EdgeRole): string {
  switch (type) {
    case 'forked_from':
      return subjectRole === 'inbound' ? 'forked from' : 'fork source';
    case 'derived_from':
      return subjectRole === 'inbound' ? 'derived from' : 'derivation target';
    case 'shares_history_with':
      return 'shares history';
    case 'uses_submodule':
      return 'uses submodule';
    case 'depends_on':
      return 'depends on';
    case 'declared_inspiration':
      return subjectRole === 'inbound' ? 'inspired by' : 'inspired';
    case 'references':
      return subjectRole === 'inbound' ? 'referenced by' : 'references';
    case 'shares_exact_content_with':
      return 'identical content';
    case 'similar_to':
      return 'similar';
    case 'evolved_into':
      return subjectRole === 'outbound' ? 'evolved into' : 'evolved from';
    default:
      return type;
  }
}

function nodeLabel(entity: Entity): string {
  if (entity.display.fullName) return entity.display.fullName;
  return entity.display.name;
}

function nodeFact(entity: Entity): string | undefined {
  const attributes = entity.attributes;
  const parts: string[] = [];
  if (typeof attributes.default_branch === 'string') parts.push(attributes.default_branch);
  if (attributes.is_fork === true) parts.push('fork');
  if (typeof attributes.license_spdx === 'string' && attributes.license_spdx) parts.push(attributes.license_spdx);
  if (entity.type === 'Package' && typeof attributes.ecosystem === 'string') parts.push(attributes.ecosystem);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function subjectRoleOf(relationship: Relationship, subjectId: string): EdgeRole {
  if (relationship.source === subjectId && relationship.target === subjectId) return 'peer';
  if (relationship.source === subjectId) return 'outbound';
  if (relationship.target === subjectId) return 'inbound';
  // Only reachable for a symmetric edge whose endpoints exclude the subject.
  return 'peer';
}

/**
 * Layout slot for a node, derived from the *semantics* of the edge that connects
 * it to the subject, never from endpoint ordering alone.
 */
function slotForEdge(relationship: Relationship, subjectId: string): LayoutSlot {
  const role = subjectRoleOf(relationship, subjectId);
  switch (FAMILY[relationship.type]) {
    case 'ancestry':
      if (relationship.type === 'shares_history_with') return 'shared-near';
      // "Upstream" is provenance that arrives at the subject from above.
      return role === 'inbound' ? 'upstream' : 'downstream';
    case 'dependency':
      return 'dependency';
    case 'attribution':
      return 'attribution-far';
    case 'source-identity':
      return 'shared-near';
    case 'similarity':
      return 'similarity';
    default:
      return 'shared-near';
  }
}

/** `depends_on` keeps a weaker arrow: directed, but not a provenance claim. */
function arrowFor(relationship: Relationship): { arrow: ViewEdge['arrow']; arrowheadAt?: string } {
  if (!isDirectional(relationship.type)) return { arrow: 'none' };
  if (relationship.type === 'depends_on') return { arrow: 'end-weak', arrowheadAt: relationship.target };
  return { arrow: 'end', arrowheadAt: relationship.target };
}

function badgeFor(relationship: Relationship): string | undefined {
  const attributes = relationship.attributes;
  if (typeof attributes.matched_blob_count === 'number' && attributes.matched_blob_count > 0) {
    return `×${attributes.matched_blob_count} blobs`;
  }
  if (typeof attributes.shared_commit_count === 'number' && attributes.shared_commit_count > 0) {
    return `×${attributes.shared_commit_count} commits`;
  }
  if (typeof attributes.submodule_path === 'string') return attributes.submodule_path;
  return undefined;
}

function locatorOf(evidence: Evidence): string | undefined {
  const locator = evidence.locator;
  if (!locator) return undefined;
  if (locator.path && locator.lineStart) {
    const range =
      locator.lineEnd && locator.lineEnd !== locator.lineStart
        ? `${locator.lineStart}-${locator.lineEnd}`
        : `${locator.lineStart}`;
    return `${locator.path}:${range}`;
  }
  if (locator.path && locator.field) return `${locator.path} → ${locator.field}`;
  if (locator.path) return locator.path;
  if (locator.field) return locator.field;
  return undefined;
}

export function toViewEvidenceCard(evidence: Evidence): ViewEvidenceCard {
  return {
    id: evidence.id,
    type: evidence.type,
    status: evidence.status,
    collector: evidence.collector,
    extractor: evidence.extractor,
    ...(evidence.repository ? { repository: evidence.repository } : {}),
    ...(evidence.sourceUrl ? { sourceUrl: evidence.sourceUrl } : {}),
    ...(locatorOf(evidence) ? { locator: locatorOf(evidence) } : {}),
    ...(evidence.observedText ? { observedText: evidence.observedText } : {}),
    data: evidence.data as Record<string, unknown>,
    observedAt: evidence.observedAt,
  };
}

/**
 * Projects a canonical graph into the R3.1 subject-centric one-hop view.
 *
 * The input is never mutated and no field is added to it. Only one-hop
 * relationships are shown; everything else is counted in
 * `hiddenRelationshipCount` so the header can state it plainly.
 */
export function buildView(graph: LineageGraph, options: BuildViewOptions = {}): ViewGraph {
  const subjectId = options.subjectId ?? graph.graph.rootEntityId;
  const evidenceLimit = options.evidenceCardLimit ?? 12;
  const evidenceById = new Map(graph.evidence.map((evidence) => [evidence.id, evidence]));

  const oneHop = graph.relationships.filter(
    (relationship) => relationship.source === subjectId || relationship.target === subjectId,
  );
  const hidden = graph.relationships.length - oneHop.length;

  const entityById = new Map(graph.entities.map((entity) => [entity.id, entity]));

  const nodes = new Map<string, ViewNode>();
  const ensureNode = (id: string, slot: LayoutSlot): ViewNode => {
    const existing = nodes.get(id);
    if (existing) return existing;
    const entity = entityById.get(id);
    if (!entity) {
      const placeholder: ViewNode = {
        id,
        type: 'ExternalProject',
        slot,
        label: id,
        isSubject: id === subjectId,
        isPackage: false,
        outboundRelationshipIds: [],
        inboundRelationshipIds: [],
        peerRelationshipIds: [],
      };
      nodes.set(id, placeholder);
      return placeholder;
    }
    const [owner, name] = entity.display.fullName ? entity.display.fullName.split('/') : [undefined, entity.display.name];
    const node: ViewNode = {
      id,
      type: entity.type,
      slot: id === subjectId ? 'subject' : slot,
      label: nodeLabel(entity),
      ...(owner ? { owner } : {}),
      ...(name ? { name } : {}),
      ...(entity.display.url ? { url: entity.display.url } : {}),
      ...(nodeFact(entity) ? { fact: nodeFact(entity) } : {}),
      isSubject: id === subjectId,
      isPackage: entity.type === 'Package',
      outboundRelationshipIds: [],
      inboundRelationshipIds: [],
      peerRelationshipIds: [],
    };
    nodes.set(id, node);
    return node;
  };

  ensureNode(subjectId, 'subject');

  const edges: ViewEdge[] = [];
  const evidenceByRelationship: Record<string, ViewEvidenceCard[]> = {};

  // Density guard: lineage-bearing edges are drawn individually, but only up to
  // a cap. Overflow is grouped by relationship type, most significant first.
  // Nothing is dropped: grouped edges keep their ids, their direction and their
  // evidence, and remain reachable in the Evidence drawer.
  const lineageEdges = oneHop.filter((relationship) => PRIMARY_TYPES.has(relationship.type));
  const ordered = [...lineageEdges].sort((a, b) => {
    const rank = SIGNIFICANCE[b.type] - SIGNIFICANCE[a.type];
    if (rank !== 0) return rank;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const drawnIds = new Set(ordered.slice(0, PRIMARY_DRAW_CAP).map((relationship) => relationship.id));
  const densityCapExceeded = ordered.length > PRIMARY_DRAW_CAP;

  for (const relationship of oneHop) {
    const role = subjectRoleOf(relationship, subjectId);
    const slot = slotForEdge(relationship, subjectId);
    ensureNode(relationship.source, slot);
    ensureNode(relationship.target, slot);

    const { arrow, arrowheadAt } = arrowFor(relationship);
    const badge = badgeFor(relationship);
    const truncated =
      relationship.attributes.evidence_truncated === true ||
      relationship.evidenceIds.length < Number(relationship.attributes.matched_blob_count ?? 0);

    const isPrimary = drawnIds.has(relationship.id);
    const bundleKey = isPrimary ? undefined : `${relationship.type}/${relationship.status}`;

    edges.push({
      id: relationship.id,
      relationshipType: relationship.type,
      family: FAMILY[relationship.type],
      status: relationship.status,
      // Straight from the canonical contract.
      directed: relationship.directed,
      arrow,
      ...(arrowheadAt ? { arrowheadAt } : {}),
      source: relationship.source,
      target: relationship.target,
      label: relationLabel(relationship.type, role),
      relationLabel: relationship.type.replace(/_/g, ' '),
      subjectRole: role,
      visibility: isPrimary ? 'primary' : 'bundled',
      ...(bundleKey ? { bundleKey } : {}),
      evidenceCount: relationship.evidenceIds.length,
      evidenceIds: relationship.evidenceIds,
      evidenceTruncated: truncated,
      ...(badge ? { badge } : {}),
    });

    evidenceByRelationship[relationship.id] = relationship.evidenceIds
      .slice(0, evidenceLimit)
      .map((id) => evidenceById.get(id))
      .filter((evidence): evidence is Evidence => Boolean(evidence))
      .map(toViewEvidenceCard);

    for (const endpoint of [relationship.source, relationship.target]) {
      const node = nodes.get(endpoint);
      if (!node) continue;
      const bucket =
        endpoint === relationship.source ? node.outboundRelationshipIds : node.inboundRelationshipIds;
      if (!bucket.includes(relationship.id)) bucket.push(relationship.id);
    }
  }

  const statusCounts: Record<EvidenceStatus, number> = { VERIFIED: 0, DECLARED: 0, DETECTED: 0 };
  const familyCounts: Record<RelationFamily, number> = {
    ancestry: 0,
    dependency: 0,
    attribution: 0,
    'source-identity': 0,
    similarity: 0,
  };
  for (const edge of edges) {
    statusCounts[edge.status] += 1;
    familyCounts[edge.family] += 1;
  }

  const subjectNode = nodes.get(subjectId)!;
  const partialNotes = graph.diagnostics.filter((diagnostic) => diagnostic.level !== 'info');

  // Bundles are derived from the edge list, so the two can never disagree.
  const bundleMap = new Map<string, ViewBundle & { relationshipIds: string[] }>();
  for (const edge of edges) {
    if (edge.visibility !== 'bundled' || !edge.bundleKey) continue;
    const key = edge.bundleKey;
    const existing = bundleMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.totalEvidenceCount += edge.evidenceCount;
      existing.relationshipIds.push(edge.id);
      continue;
    }
    bundleMap.set(key, {
      key,
      relationshipType: edge.relationshipType,
      family: edge.family,
      status: edge.status,
      count: 1,
      label: edge.relationLabel,
      sampleRelationshipId: edge.id,
      totalEvidenceCount: edge.evidenceCount,
      relationshipIds: [edge.id],
    });
  }
  const bundles: ViewBundle[] = [...bundleMap.values()]
    .map(({ relationshipIds: _relationshipIds, ...bundle }) => bundle)
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));

  const primaryEdgeCount = edges.filter((edge) => edge.visibility === 'primary').length;
  const bundledEdgeCount = edges.length - primaryEdgeCount;

  return {
    schemaVersion: graph.schemaVersion,
    analyzer: {
      name: graph.graph.analyzer.name,
      version: graph.graph.analyzer.version,
      schemaVersion: graph.graph.analyzer.schemaVersion,
      extractors: graph.graph.analyzer.extractors,
      adapters: graph.graph.analyzer.adapters,
    },
    revision: {
      commit: graph.graph.revision.commit,
      shortCommit: graph.graph.revision.commit.slice(0, 7),
      ...(graph.graph.revision.ref ? { ref: graph.graph.revision.ref } : {}),
      ...(graph.graph.revision.defaultBranch ? { defaultBranch: graph.graph.revision.defaultBranch } : {}),
      analyzedAt: graph.graph.generatedAt,
    },
    subject: subjectNode,
    nodes: [...nodes.values()],
    edges,
    edgeCount: edges.length,
    primaryEdgeCount,
    bundledEdgeCount,
    bundles,
    hiddenRelationshipCount: hidden,
    statusCounts,
    familyCounts,
    directionContract: {
      directional: [...DIRECTIONAL_RELATIONSHIPS],
      symmetric: [...SYMMETRIC_RELATIONSHIPS],
    },
    empty: {
      isEmpty: edges.length === 0,
      reason:
        edges.length === 0
          ? 'No relationship in this repository could be supported by evidence. This is a result, not a failure.'
          : '',
    },
    partial: {
      isPartial: partialNotes.length > 0 || hidden > 0,
      notes: partialNotes,
      ...(bundledEdgeCount > 0
        ? {
            bundling: {
              bundledEdgeCount,
              reason:
                bundledEdgeCount > 0
                  ? `${bundledEdgeCount} secondary relationship(s) are collapsed into bundles. They remain in the graph and in the Evidence drawer; only the default drawing is grouped.`
                  : '',
              drawCap: PRIMARY_DRAW_CAP,
              densityCapExceeded,
            },
          }
        : {}),
    },
    evidenceByRelationship,
  };
}

/** Exposed for the client's own invariants check. */
export const VIEW_RULES = {
  symmetricTypesHaveNoArrow: SYMMETRIC_RELATIONSHIPS,
  directionalTypes: DIRECTIONAL_RELATIONSHIPS,
} as const;

export { relationshipSpec };