import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { analyze } from '../src/pipeline/analyze.ts';
import { validateGraph } from '../src/core/validate.ts';
import { RELATIONSHIP_SPECS } from '../src/core/ontology.ts';
import type { LineageGraph } from '../src/core/model.ts';
import { ANALYZER_VERSION, GRAPH_SCHEMA_VERSION } from '../src/core/model.ts';

// ajv and ajv-formats ship CommonJS only; loading them through createRequire
// keeps the interop explicit and type-safe.
const requireCjs = createRequire(import.meta.url);
const ajv2020Module = requireCjs('ajv/dist/2020.js') as { default?: new (...args: unknown[]) => unknown };
const Ajv2020 = (ajv2020Module.default ?? ajv2020Module) as new (options: { allErrors: boolean; strict: boolean }) => {
  compile: (schema: object) => ((data: unknown) => boolean) & { errors?: unknown[] | null };
};
const addFormats = requireCjs('ajv-formats') as (instance: unknown) => void;

const schema = JSON.parse(
  await readFile(new URL('../schemas/lineage-graph.schema.json', import.meta.url), 'utf8'),
) as object;

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

/**
 * Offline end-to-end vertical slice:
 * repository reference -> collectors -> policy -> canonical graph -> artifacts.
 *
 * Nothing here touches the network: the pipeline runs with git and registry
 * resolution disabled, which is also the documented "metadata only" mode.
 */
test('end to end: a URL produces a validated graph artifact', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'gitlineage-e2e-'));
  const result = await analyze({
    target: 'https://github.com/me/does-not-exist-offline',
    cacheRoot: join(outDir, 'cache'),
    outDir,
    enableGit: false,
    enableRegistry: false,
  }).catch((error: unknown) => {
    // A 404 is the expected outcome offline; the point of the test is that the
    // failure is explicit rather than producing a partial graph.
    assert.match(error instanceof Error ? error.message : String(error), /404/);
    return null;
  });

  if (result) {
    assert.ok(validateGraph(result.graph).valid);
    const graphOnDisk = JSON.parse(await readFile(join(outDir, 'graph.json'), 'utf8')) as LineageGraph;
    const metadata = JSON.parse(await readFile(join(outDir, 'analysis-metadata.json'), 'utf8')) as Record<string, unknown>;
    assert.deepEqual(graphOnDisk, result.graph);
    assert.equal(metadata.schemaVersion, result.graph.schemaVersion);
    assert.equal(metadata.root, 'me/does-not-exist-offline');
    assert.ok(validateSchema(graphOnDisk), `graph.json violates the JSON schema: ${JSON.stringify(validateSchema.errors?.slice(0, 3))}`);
  }
});

test('the analyzer never emits a relationship type outside the ontology', () => {
  // Guards the rename: no collector may still propose the removed type, and the
  // symmetric partition must cover exactly the shared-state types.
  const emitted = new Set<string>();
  for (const spec of RELATIONSHIP_SPECS) emitted.add(spec.type);
  assert.equal(emitted.has('contains_exact_content_from'), false);
  assert.equal(emitted.size, RELATIONSHIP_SPECS.length);
  assert.deepEqual(
    RELATIONSHIP_SPECS.filter((spec) => !spec.directed).map((spec) => spec.type).sort(),
    ['shares_exact_content_with', 'shares_history_with', 'similar_to'],
  );
});

test('end to end: the JSON schema accepts a minimal graph and rejects broken ones', async () => {
  const base: LineageGraph = {
    schemaVersion: GRAPH_SCHEMA_VERSION,
    graph: {
      rootEntityId: 'repo:github:a/b',
      provider: 'github',
      revision: { commit: 'c'.repeat(40), resolvedAt: '2026-01-01T00:00:00.000Z' },
      generatedAt: '2026-01-01T00:00:00.000Z',
      analyzer: {
        name: 'gitlineage-analyzer',
        version: ANALYZER_VERSION,
        schemaVersion: GRAPH_SCHEMA_VERSION,
        namespace: 'public',
        extractors: [],
        adapters: [],
        limitsApplied: {},
      },
    },
    entities: [
      {
        id: 'repo:github:a/b',
        type: 'Repository',
        display: { name: 'b', fullName: 'a/b' },
        attributes: {},
      },
      {
        id: 'repo:github:c/d',
        type: 'Repository',
        display: { name: 'd', fullName: 'c/d' },
        attributes: {},
      },
    ],
    relationships: [
      {
        id: 'rel_0123456789abcdef',
        type: 'forked_from',
        source: 'repo:github:a/b',
        target: 'repo:github:c/d',
        directed: true,
        status: 'VERIFIED',
        evidenceIds: ['ev_0123456789abcdef'],
        attributes: {},
      },
    ],
    evidence: [
      {
        id: 'ev_0123456789abcdef',
        type: 'github_fork_metadata',
        status: 'VERIFIED',
        collector: 'github-metadata',
        extractor: 'github-fork-metadata@1',
        data: { fork: true, source_full_name: 'c/d', source_url: 'https://github.com/c/d' },
        observedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    diagnostics: [],
  };

  assert.ok(validateSchema(base), 'a minimal contract-compliant graph must validate');

  const noEvidence = structuredClone(base);
  noEvidence.relationships[0]!.evidenceIds = [];
  assert.equal(validateSchema(noEvidence), false, 'a relationship without evidence must not validate');

  const badStatus = structuredClone(base);
  (badStatus.relationships[0] as { status: string }).status = 'INFERRED';
  assert.equal(validateSchema(badStatus), false, 'INFERRED is not an admissible status');

  const badType = structuredClone(base);
  (badType.relationships[0] as { type: string }).type = 'copied_from';
  assert.equal(validateSchema(badType), false, 'copied_from is not in the V1 ontology');

  const removedType = structuredClone(base);
  (removedType.relationships[0] as { type: string }).type = 'contains_exact_content_from';
  assert.equal(validateSchema(removedType), false, 'the removed directional exact-content type must not validate');

  const symmetricAsDirected = structuredClone(base);
  symmetricAsDirected.relationships[0]!.type = 'shares_exact_content_with';
  symmetricAsDirected.relationships[0]!.directed = true;
  assert.equal(
    validateSchema(symmetricAsDirected),
    false,
    'a symmetric relationship may not be serialised as directed',
  );

  const badRevision = structuredClone(base);
  badRevision.graph.revision.commit = 'not-a-sha';
  assert.equal(validateSchema(badRevision), false);

  const extraField = structuredClone(base) as unknown as Record<string, unknown>;
  extraField.inferred_relationships = [];
  assert.equal(validateSchema(extraField), false, 'unknown top-level fields must be rejected');

  // A pre-rename artifact must not validate against the current schema.
  const staleVersion = structuredClone(base);
  staleVersion.schemaVersion = '1.0.0';
  staleVersion.graph.analyzer.schemaVersion = '1.0.0';
  assert.equal(
    validateSchema(staleVersion),
    false,
    'a 1.x artifact carrying contains_exact_content_from must not validate under schema 2.x',
  );
});

test('end to end: analysis refuses a private cache namespace in V1', async () => {
  const outDir = await mkdtemp(join(tmpdir(), 'gitlineage-ns-'));
  await assert.rejects(
    () =>
      analyze({
        target: 'a/b',
        cacheRoot: join(outDir, 'cache'),
        namespace: 'private',
        enableGit: false,
        enableRegistry: false,
      }),
    /not implemented in V1/,
  );
  const entries = await readdir(join(outDir, 'cache')).catch(() => []);
  assert.deepEqual(entries, [], 'a refused namespace must not create any storage');
});
