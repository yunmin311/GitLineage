import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from '../src/core/resolver.ts';
import { validateGraph } from '../src/core/validate.ts';
import { checkObservation, resolveRelationshipStatus } from '../src/core/policy.ts';
import {
  RELATIONSHIP_SPECS,
  EVIDENCE_ALLOWED_STATUSES,
  EVIDENCE_REQUIRED_DATA_KEYS,
  DIRECTIONAL_RELATIONSHIPS,
  SYMMETRIC_RELATIONSHIPS,
  canonicalEndpoints,
  isDirectional,
  isRelationshipType,
  isSymmetric,
  relationshipSpec,
} from '../src/core/ontology.ts';
import type { EntityRef, LineageGraph, Observation, RelationshipType } from '../src/core/model.ts';

const ROOT: EntityRef = { kind: 'repository', provider: 'github', owner: 'me', name: 'project' };
const OTHER: EntityRef = { kind: 'repository', provider: 'github', owner: 'other', name: 'thing' };
const PKG: EntityRef = { kind: 'package', ecosystem: 'npm', name: 'left-pad' };

function buildGraph(observations: Observation[]): LineageGraph {
  const { graph } = resolve({
    root: ROOT,
    observations,
    revision: { commit: 'a'.repeat(40), resolvedAt: '2026-09-30T00:00:00.000Z' },
    namespace: 'public',
    extractors: ['test@1'],
    observedAt: '2026-09-30T00:00:00.000Z',
  });
  return graph;
}

function blobEvidence(overrides: Partial<Observation['evidence']> = {}): Observation['evidence'] {
  return {
    type: 'git_blob_identity',
    status: 'VERIFIED',
    data: { first_blob: 'b'.repeat(40), second_blob: 'b'.repeat(40), first_path: 'a.ts', second_path: 'b.ts' },
    ...overrides,
  };
}

test('a relationship with no evidence never enters the graph', () => {
  const graph = buildGraph([]);
  assert.equal(graph.relationships.length, 0);
  assert.equal(graph.evidence.length, 0);
  assert.ok(validateGraph(graph).valid);
});

test('multiple evidence records merge into one relationship, not into duplicates', () => {
  const graph = buildGraph([
    {
      collector: 'github-metadata',
      extractor: 'github-fork-metadata@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'forked_from',
      directed: true,
      evidence: {
        type: 'github_fork_metadata',
        status: 'VERIFIED',
        data: { fork: true, source_full_name: 'other/thing', source_url: 'https://github.com/other/thing' },
      },
    },
    {
      collector: 'documents',
      extractor: 'explicit-attribution@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'forked_from',
      directed: true,
      evidence: {
        type: 'document_attribution',
        status: 'DECLARED',
        locator: { path: 'README.md', lineStart: 3 },
        data: { phrase: 'fork of', matched_text: 'Fork of other/thing', path: 'README.md' },
      },
    },
  ]);
  assert.equal(graph.relationships.length, 1);
  assert.equal(graph.relationships[0]?.evidenceIds.length, 2);
  assert.equal(graph.relationships[0]?.status, 'VERIFIED', 'the strongest admissible evidence status wins');
  assert.ok(validateGraph(graph).valid);
});

test('identical evidence from the same extractor is deduplicated, not duplicated', () => {
  const observation: Observation = {
    collector: 'git-analyzer',
    extractor: 'git-shared-commits@1',
    subject: ROOT,
    object: OTHER,
    relationship: 'shares_history_with',
    directed: false,
    evidence: {
      type: 'git_shared_commits',
      status: 'VERIFIED',
      data: { shared_commit_count: 3, shared_commit_samples: ['a'.repeat(40)], sampled_commit_count: 50 },
    },
  };
  const graph = buildGraph([observation, structuredClone(observation)]);
  assert.equal(graph.relationships.length, 1);
  assert.equal(graph.evidence.length, 1);
});

// ---------------------------------------------------------------------------
// The three no-upgrade regression tests that encode the product principles.
// ---------------------------------------------------------------------------

test('README link != declared_inspiration when there is no declaration phrase', () => {
  const graph = buildGraph([
    {
      collector: 'documents',
      extractor: 'explicit-reference@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'references',
      directed: true,
      evidence: {
        type: 'document_reference',
        status: 'DECLARED',
        data: { matched_text: 'see https://github.com/other/thing', path: 'README.md' },
      },
    },
  ]);
  assert.deepEqual(
    graph.relationships.map((relationship) => relationship.type),
    ['references'],
  );
});

test('package dependency != derived_from', () => {
  const graph = buildGraph([
    {
      collector: 'packages',
      extractor: 'manifest-dependency@1',
      subject: ROOT,
      object: PKG,
      relationship: 'depends_on',
      directed: true,
      evidence: {
        type: 'package_manifest',
        status: 'DECLARED',
        data: { ecosystem: 'npm', package_name: 'left-pad', range: '^1.0.0', manifest_path: 'package.json' },
      },
    },
  ]);
  assert.deepEqual(
    graph.relationships.map((relationship) => relationship.type),
    ['depends_on'],
  );
  assert.equal(graph.relationships[0]?.status, 'DECLARED');
});

test('token_fingerprint evidence is symmetric-only, matching its relationship', () => {
  // similar_to is symmetric, so the evidence keys are also origin-free.
  const spec = relationshipSpec('similar_to');
  assert.equal(spec.directed, false);
  assert.deepEqual([...spec.allowedEvidenceTypes], ['token_fingerprint']);
});

test('similarity != provenance: a detector cannot claim derived_from', () => {
  const attempt: Observation = {
    collector: 'similarity',
    extractor: 'token-fingerprint@1',
    subject: ROOT,
    object: OTHER,
    relationship: 'derived_from',
    directed: true,
    evidence: {
      type: 'token_fingerprint',
      status: 'DETECTED',
      data: { algorithm: 'token_fingerprint', source_path: 'a.ts', target_path: 'b.ts', similarity: 0.97 },
    },
  };
  const result = checkObservation(attempt);
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.rejection.code, 'evidence_type_not_allowed');

  const graph = buildGraph([{ ...attempt, relationship: 'similar_to', directed: false }]);
  assert.deepEqual(
    graph.relationships.map((relationship) => relationship.type),
    ['similar_to'],
  );
  assert.equal(graph.relationships[0]?.status, 'DETECTED');
  assert.equal(graph.relationships[0]?.directed, false);
});

test('a package dependency can never be reported as verified', () => {
  const graph = buildGraph([
    {
      collector: 'packages',
      extractor: 'manifest-dependency@1',
      subject: ROOT,
      object: PKG,
      relationship: 'depends_on',
      directed: true,
      evidence: {
        type: 'package_manifest',
        status: 'VERIFIED',
        data: { ecosystem: 'npm', package_name: 'left-pad', range: '^1.0.0', manifest_path: 'package.json' },
      },
    },
  ]);
  assert.equal(graph.relationships.length, 0, 'the observation is rejected, not downgraded');
  assert.equal(graph.diagnostics[0]?.code, 'evidence_status_not_valid_for_type');
});

test('detected evidence can never produce a verified relationship', () => {
  const graph = buildGraph([
    {
      collector: 'git-blob-analyzer',
      extractor: 'git-blob-identity@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'shares_exact_content_with',
      directed: false,
      evidence: blobEvidence({ status: 'DETECTED' }),
    },
  ]);
  assert.equal(graph.relationships.length, 0);
  assert.equal(graph.diagnostics[0]?.code, 'evidence_status_not_valid_for_type');
});

test('a declaration can never be reported as a verified fact', () => {
  const graph = buildGraph([
    {
      collector: 'documents',
      extractor: 'explicit-attribution@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'forked_from',
      directed: true,
      evidence: {
        type: 'document_attribution',
        status: 'VERIFIED',
        data: { phrase: 'fork of', matched_text: 'Fork of other/thing', path: 'README.md' },
      },
    },
  ]);
  assert.equal(graph.relationships.length, 0);
  assert.equal(graph.diagnostics[0]?.code, 'evidence_status_not_valid_for_type');
});

test('every evidence type declares the statuses it may carry', () => {
  for (const [type, statuses] of Object.entries(EVIDENCE_ALLOWED_STATUSES)) {
    assert.ok(statuses.length > 0, `${type} must allow at least one status`);
    for (const status of statuses) {
      assert.ok(['VERIFIED', 'DECLARED', 'DETECTED'].includes(status), `${type}/${status}`);
    }
  }
  assert.deepEqual([...EVIDENCE_ALLOWED_STATUSES.document_attribution], ['DECLARED']);
  assert.deepEqual([...EVIDENCE_ALLOWED_STATUSES.token_fingerprint], ['DETECTED']);
  assert.deepEqual([...EVIDENCE_ALLOWED_STATUSES.package_manifest], ['DECLARED']);
  assert.deepEqual([...EVIDENCE_ALLOWED_STATUSES.git_blob_identity], ['VERIFIED']);
  assert.deepEqual([...EVIDENCE_ALLOWED_STATUSES.git_shared_commits], ['VERIFIED']);
});

test('shared history cannot claim one-way derivation without containment', () => {
  const graph = buildGraph([
    {
      collector: 'git-analyzer',
      extractor: 'git-shared-commits@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'derived_from',
      directed: true,
      evidence: {
        type: 'git_shared_commits',
        status: 'VERIFIED',
        data: { shared_commit_count: 12, shared_commit_samples: ['a'.repeat(40)], sampled_commit_count: 200 },
      },
    },
  ]);
  assert.equal(graph.relationships.length, 0);
  assert.equal(graph.diagnostics[0]?.code, 'evidence_type_not_allowed');
});

test('a relationship can never be stronger than its own evidence', () => {
  for (const spec of RELATIONSHIP_SPECS) {
    const allowed = new Set<string>(spec.allowedStatuses);
    for (const evidenceType of EVIDENCE_REQUIRED_DATA_KEYS ? spec.allowedEvidenceTypes : []) {
      for (const status of ['VERIFIED', 'DECLARED', 'DETECTED'] as const) {
        if (allowed.has(status)) continue;
        const result = resolveRelationshipStatus(spec.type, [status]);
        assert.equal(result, null, `${spec.type} must reject ${status}`);
      }
    }
  }
});

test('ontology invariants hold for every relationship type', () => {
  for (const spec of RELATIONSHIP_SPECS) {
    assert.ok(spec.allowedStatuses.length > 0, `${spec.type} needs at least one admissible status`);
    assert.ok(spec.allowedEvidenceTypes.length > 0, `${spec.type} needs at least one evidence type`);
    for (const evidenceType of spec.allowedEvidenceTypes) {
      assert.ok(EVIDENCE_REQUIRED_DATA_KEYS[evidenceType].length > 0, `${evidenceType} needs required data keys`);
    }
    for (const status of spec.allowedStatuses) {
      assert.ok(['VERIFIED', 'DECLARED', 'DETECTED'].includes(status));
    }
  }
  assert.deepEqual([...DIRECTIONAL_RELATIONSHIPS].sort(), [
    'declared_inspiration',
    'depends_on',
    'derived_from',
    'evolved_into',
    'forked_from',
    'references',
    'uses_submodule',
  ]);
  assert.deepEqual([...SYMMETRIC_RELATIONSHIPS].sort(), [
    'shares_exact_content_with',
    'shares_history_with',
    'similar_to',
  ]);
  assert.equal(DIRECTIONAL_RELATIONSHIPS.length + SYMMETRIC_RELATIONSHIPS.length, RELATIONSHIP_SPECS.length);
  for (const type of SYMMETRIC_RELATIONSHIPS) assert.equal(isSymmetric(type), true);
  for (const type of DIRECTIONAL_RELATIONSHIPS) assert.equal(isDirectional(type), true);
});

test('the direction split is exactly the documented concept split', () => {
  const documentedDirectional = [
    'forked_from',
    'derived_from',
    'depends_on',
    'uses_submodule',
    'declared_inspiration',
    'references',
    'evolved_into',
  ];
  const documentedSymmetric = ['shares_history_with', 'shares_exact_content_with', 'similar_to'];
  assert.deepEqual([...DIRECTIONAL_RELATIONSHIPS].sort(), [...documentedDirectional].sort());
  assert.deepEqual([...SYMMETRIC_RELATIONSHIPS].sort(), [...documentedSymmetric].sort());
});

test('symmetric relationships normalise their endpoints into canonical order', () => {
  const forward = canonicalEndpoints('shares_exact_content_with', 'repo:a', 'repo:b');
  const reversed = canonicalEndpoints('shares_exact_content_with', 'repo:b', 'repo:a');
  assert.deepEqual(forward, reversed, 'a symmetric edge must not depend on observation order');
  assert.equal(forward.source <= forward.target, true);

  assert.deepEqual(
    canonicalEndpoints('shares_history_with', 'repo:z', 'repo:a'),
    canonicalEndpoints('shares_history_with', 'repo:a', 'repo:z'),
  );
});

test('directional relationships preserve endpoint order', () => {
  const forward = canonicalEndpoints('forked_from', 'repo:fork', 'repo:upstream');
  const reversed = canonicalEndpoints('forked_from', 'repo:upstream', 'repo:fork');
  assert.deepEqual(forward, { source: 'repo:fork', target: 'repo:upstream' });
  assert.notDeepEqual(forward, reversed, 'a directional edge must keep its meaning when reversed');
});

test('a symmetric relationship observed from both sides yields one edge, not two', () => {
  const shared = 'a'.repeat(40);
  const evidence = {
    type: 'git_blob_identity' as const,
    status: 'VERIFIED' as const,
    data: { first_blob: shared, second_blob: shared, first_path: 'a.ts', second_path: 'b.ts' },
  };
  const graph = buildGraph([
    {
      collector: 'git-blob-analyzer',
      extractor: 'git-blob-identity@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'shares_exact_content_with',
      directed: false,
      evidence,
    },
    {
      collector: 'git-blob-analyzer',
      extractor: 'git-blob-identity@2',
      subject: OTHER,
      object: ROOT,
      relationship: 'shares_exact_content_with',
      directed: false,
      evidence: { ...evidence, data: { ...evidence.data, first_path: 'b.ts', second_path: 'a.ts' } },
    },
  ]);
  assert.equal(graph.relationships.length, 1, 'mirrored observations must merge into a single symmetric edge');
  assert.equal(graph.relationships[0]?.directed, false);
  assert.equal(graph.relationships[0]?.evidenceIds.length, 2, 'both observations remain as evidence');
  assert.ok(validateGraph(graph).valid);
});

test('the resolver stamps direction from the ontology, ignoring a collector claim', () => {
  // A collector that wrongly claims direction is rejected outright.
  const rejected = checkObservation({
    collector: 'git-blob-analyzer',
    extractor: 'git-blob-identity@1',
    subject: ROOT,
    object: OTHER,
    relationship: 'shares_exact_content_with',
    directed: true,
    evidence: {
      type: 'git_blob_identity',
      status: 'VERIFIED',
      data: { first_blob: 'a'.repeat(40), second_blob: 'a'.repeat(40), first_path: 'a.ts', second_path: 'b.ts' },
    },
  });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.ok === false && rejected.rejection.code, 'direction_mismatch');

  // And the graph it produces always carries the contract value.
  const graph = buildGraph([
    {
      collector: 'git-blob-analyzer',
      extractor: 'git-blob-identity@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'shares_exact_content_with',
      directed: false,
      evidence: {
        type: 'git_blob_identity',
        status: 'VERIFIED',
        data: { first_blob: 'a'.repeat(40), second_blob: 'a'.repeat(40), first_path: 'a.ts', second_path: 'b.ts' },
      },
    },
  ]);
  assert.equal(graph.relationships[0]?.directed, isDirectional('shares_exact_content_with'));
  assert.equal(graph.relationships[0]?.directed, false);
});

test('the removed directional exact-content type no longer exists', () => {
  assert.equal(isRelationshipType('contains_exact_content_from'), false);
  assert.equal(RELATIONSHIP_SPECS.some((spec) => spec.type.includes('contains')), false);
  assert.throws(() => relationshipSpec('contains_exact_content_from' as never));
});

test('self relationships are rejected', () => {
  const result = checkObservation({
    collector: 'x',
    extractor: 'x@1',
    subject: ROOT,
    object: { ...ROOT },
    relationship: 'references',
    directed: true,
    evidence: { type: 'document_reference', status: 'DECLARED', data: { matched_text: 'x', path: 'README.md' } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.rejection.code, 'self_relationship');
});

test('direction is fixed by the ontology, not by the collector', () => {
  const directedAttempt = checkObservation({
    collector: 'x',
    extractor: 'x@1',
    subject: ROOT,
    object: OTHER,
    relationship: 'similar_to',
    directed: true,
    evidence: {
      type: 'token_fingerprint',
      status: 'DETECTED',
      data: { algorithm: 'token_fingerprint', source_path: 'a', target_path: 'b', similarity: 0.8 },
    },
  });
  assert.equal(directedAttempt.ok, false);
  assert.equal(directedAttempt.ok === false && directedAttempt.rejection.code, 'direction_mismatch');
});

test('evidence without its required reviewable data is rejected', () => {
  const result = checkObservation({
    collector: 'x',
    extractor: 'x@1',
    subject: ROOT,
    object: OTHER,
    relationship: 'shares_exact_content_with',
    directed: false,
    evidence: { type: 'git_blob_identity', status: 'VERIFIED', data: { first_blob: 'b'.repeat(40) } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.rejection.code, 'evidence_data_incomplete');
});

test('graph output is deterministic and stably ordered', () => {
  const observations: Observation[] = [
    {
      collector: 'git-blob-analyzer',
      extractor: 'git-blob-identity@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'shares_exact_content_with',
      directed: false,
      evidence: blobEvidence(),
    },
    {
      collector: 'packages',
      extractor: 'manifest-dependency@1',
      subject: ROOT,
      object: PKG,
      relationship: 'depends_on',
      directed: true,
      evidence: {
        type: 'package_manifest',
        status: 'DECLARED',
        data: { ecosystem: 'npm', package_name: 'left-pad', range: '^1.0.0', manifest_path: 'package.json' },
      },
    },
  ];
  const first = buildGraph(observations);
  const second = buildGraph([...observations].reverse());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(
    first.entities.map((entity) => entity.id),
    ['pkg:npm:left-pad', 'repo:github:me/project', 'repo:github:other/thing'],
  );
});

test('the validator catches a hand-written graph that breaks the contract', () => {
  const graph = buildGraph([
    {
      collector: 'git-blob-analyzer',
      extractor: 'git-blob-identity@1',
      subject: ROOT,
      object: OTHER,
      relationship: 'shares_exact_content_with',
      directed: false,
      evidence: blobEvidence(),
    },
  ]);
  assert.ok(validateGraph(graph).valid);

  const tampered = structuredClone(graph) as LineageGraph;
  tampered.relationships[0]!.evidenceIds = [];
  const withoutEvidence = validateGraph(tampered);
  assert.equal(withoutEvidence.valid, false);
  assert.ok(withoutEvidence.errors.some((error) => error.includes('has no evidence')));

  const tamperedStatus = structuredClone(graph) as LineageGraph;
  tamperedStatus.relationships[0]!.status = 'DECLARED';
  assert.equal(validateGraph(tamperedStatus).valid, false);

  // A hand-written graph claiming the wrong direction for the type is rejected.
  const tamperedDirection = structuredClone(graph) as LineageGraph;
  tamperedDirection.relationships[0]!.directed = true;
  assert.equal(validateGraph(tamperedDirection).valid, false);
  assert.ok(
    validateGraph(tamperedDirection).errors.some((error) => error.includes('symmetric')),
    'the error must name the direction contract',
  );
});
