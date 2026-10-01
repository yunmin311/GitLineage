import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyze } from '../../src/pipeline/analyze.ts';
import { validateGraph } from '../../src/core/validate.ts';
import type { LineageGraph } from '../../src/core/model.ts';

const LIVE = process.env.GITLINEAGE_LIVE === '1';
const live = LIVE ? test : test.skip;

interface Expectation {
  type: string;
  target: string;
  status: string;
  directed?: boolean;
}

interface Case {
  id: string;
  repository: string;
  family: string;
  description: string;
  expectRelationship?: Expectation;
  expectAlsoPresent?: Expectation[];
  expectAbsent?: string[];
  minimumSubmoduleCount?: number;
  expectNoCandidateEvidenceFor?: string;
  expectDirection?: { type: string; directed: boolean };
  expectNoMirroredEdge?: string;
}

const fixture = JSON.parse(
  await readFile(new URL('../../fixtures/integration/real-repositories.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

function find(graph: LineageGraph, expectation: Expectation) {
  return graph.relationships.find(
    (relationship) => relationship.type === expectation.type && relationship.target === expectation.target,
  );
}

live('live integration: real repository families', async (t) => {
  for (const testCase of fixture.cases) {
    await t.test(`${testCase.id}: ${testCase.repository}`, async () => {
      const result = await analyze({
        target: testCase.repository,
        cacheRoot: process.env.GITLINEAGE_CACHE ?? '.cache',
        depth: 200,
        maxCandidates: 12,
      });

      // The contract must hold on real data, not only on fixtures.
      const validation = validateGraph(result.graph);
      assert.ok(validation.valid, `graph violated the contract: ${validation.errors.join('; ')}`);

      for (const expectation of [testCase.expectRelationship, ...(testCase.expectAlsoPresent ?? [])]) {
        if (!expectation) continue;
        const relationship = find(result.graph, expectation);
        assert.ok(
          relationship,
          `expected ${expectation.type} -> ${expectation.target} in ${JSON.stringify(
            result.graph.relationships.map((item) => `${item.type}->${item.target}`),
          )}`,
        );
        assert.equal(relationship.status, expectation.status);
        assert.ok(relationship.evidenceIds.length > 0, 'every relationship must carry evidence');
        if (expectation.directed !== undefined) {
          assert.equal(
            relationship.directed,
            expectation.directed,
            `${expectation.type} direction must follow the ontology contract, not the endpoint order`,
          );
        }
        // A symmetric relationship must never also exist as its own mirror.
        if (relationship.directed === false) {
          const mirror = result.graph.relationships.find(
            (item) => item.type === relationship.type && item.source === relationship.target && item.target === relationship.source,
          );
          assert.equal(mirror, undefined, `${relationship.type} must not produce a mirrored duplicate edge`);
        }
      }

      if (testCase.expectDirection) {
        const relationship = result.graph.relationships.find((item) => item.type === testCase.expectDirection!.type);
        assert.ok(relationship, `expected a ${testCase.expectDirection!.type} relationship`);
        assert.equal(relationship.directed, testCase.expectDirection!.directed);
      }

      if (testCase.expectNoMirroredEdge) {
        const mirrors = result.graph.relationships.filter(
          (item) => item.type === testCase.expectNoMirroredEdge && item.source === result.graph.graph.rootEntityId,
        );
        assert.equal(mirrors.length, 1, `exactly one ${testCase.expectNoMirroredEdge} edge may originate from the root`);
      }

      if (testCase.minimumSubmoduleCount !== undefined) {
        const submodules = result.graph.relationships.filter((relationship) => relationship.type === 'uses_submodule');
        assert.ok(
          submodules.length >= testCase.minimumSubmoduleCount,
          `expected at least ${testCase.minimumSubmoduleCount} submodule relationships, found ${submodules.length}`,
        );
        for (const submodule of submodules) {
          const evidence = result.graph.evidence.find((item) => item.id === submodule.evidenceIds[0]);
          assert.equal(evidence?.type, 'git_submodule_entry');
          assert.ok(evidence?.data.pinned_commit, 'a submodule edge must carry its pinned commit');
        }
      }

      for (const absent of testCase.expectAbsent ?? []) {
        if (absent.endsWith('_to_repository')) continue;
        const found = result.graph.relationships.filter((relationship) => relationship.type === absent);
        assert.deepEqual(
          found.map((relationship) => relationship.target),
          [],
          `${absent} must not be produced for ${testCase.repository}`,
        );
      }

      if (testCase.expectNoCandidateEvidenceFor) {
        const evidence = result.graph.evidence.filter(
          (item) => JSON.stringify(item.data).includes(testCase.expectNoCandidateEvidenceFor!),
        );
        assert.deepEqual(evidence, [], 'unrelated repositories must not appear as evidence');
      }
    });
  }
});

live('live integration: the same revision produces a stable artifact', async () => {
  const target = 'nachocebey/is';
  const first = await analyze({ target, cacheRoot: '.cache-live', enableRegistry: false });
  const second = await analyze({ target, cacheRoot: '.cache-live', enableRegistry: false });
  // Identical revision must produce an identical graph; only the observation
  // timestamps may differ between two runs.
  const strip = (graph: LineageGraph): string =>
    JSON.stringify({
      ...graph,
      graph: { ...graph.graph, generatedAt: '', revision: { ...graph.graph.revision, resolvedAt: '' } },
      evidence: graph.evidence.map((record) => ({ ...record, observedAt: '' })),
    });
  assert.equal(strip(first.graph), strip(second.graph), 'analysis of an unchanged revision must be reproducible');
});

live('live integration: the private cache namespace is refused in V1', async () => {
  await assert.rejects(
    () => analyze({ target: 'octocat/Spoon-Knife', cacheRoot: '.cache-live', namespace: 'private' }),
    /not implemented in V1/,
  );
});
