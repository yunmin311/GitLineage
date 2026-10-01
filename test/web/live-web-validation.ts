import { serve } from '../../src/web/serve.ts';
import { validateGraph } from '../../src/core/validate.ts';
import { isDirectional } from '../../src/core/ontology.ts';
import { SYMMETRIC_RELATIONSHIPS } from '../../src/core/ontology.ts';
import type { LineageGraph } from '../../src/core/model.ts';

/**
 * Live Web validation against the same repository families as the analyzer live
 * suite. Requires network access; run with `npm run test:web-live`.
 *
 * The point is not "does it render" but: does the HTTP boundary hand back a
 * contract-valid canonical graph, and does the derived view respect the
 * direction contract on real data?
 */

const FAMILIES = [
  { repository: 'nachocebey/is', label: 'fork + shared history + exact content' },
  { repository: 'grpc/grpc', label: 'submodule heavy' },
  { repository: 'vitest-dev/vitest', label: 'declared attribution in README' },
  { repository: 'octocat/Spoon-Knife', label: 'negative: no false lineage' },
] as const;

const failures: string[] = [];

function check(condition: boolean, message: string): void {
  if (!condition) failures.push(message);
}

async function main(): Promise<void> {
  const { server, url } = await serve({
    port: 4319,
    cacheRoot: '.cache-web-live',
    clientDir: 'src/web/client',
    depth: 200,
    maxCandidates: 12,
    enableGit: true,
    enableRegistry: true,
  });

  try {
    for (const family of FAMILIES) {
      process.stdout.write(`\n=== ${family.repository} — ${family.label} ===\n`);
      const started = Date.now();

      const viewResponse = await fetch(`${url}/api/view/${family.repository}`);
      const viewEnvelope = (await viewResponse.json()) as Record<string, any>;
      check(viewResponse.status === 200, `${family.repository}: /api/view returned ${viewResponse.status}`);
      if (viewEnvelope.ok === false) {
        failures.push(`${family.repository}: view failed: ${JSON.stringify(viewEnvelope.error)}`);
        process.stdout.write(`  FAILED: ${JSON.stringify(viewEnvelope.error)}\n`);
        continue;
      }
      const view = viewEnvelope.data;

      const graphResponse = await fetch(`${url}/api/graph/${family.repository}`);
      const graphEnvelope = (await graphResponse.json()) as Record<string, any>;
      const graph = graphEnvelope.data as LineageGraph;

      // 1. The canonical graph is contract-valid.
      const validation = validateGraph(graph);
      check(validation.valid, `${family.repository}: canonical graph invalid: ${validation.errors.join('; ')}`);

      // 2. The canonical graph carries no renderer field.
      for (const forbidden of ['arrow', 'arrowheadAt', 'slot', 'family', 'label']) {
        check(!(forbidden in (graph.relationships[0] ?? {})), `${family.repository}: canonical relationship leaked ${forbidden}`);
      }

      // 3. Every view edge agrees with the ontology direction contract.
      for (const edge of view.edges as Record<string, any>[]) {
        const expected = isDirectional(edge.relationshipType as never);
        check(edge.directed === expected, `${family.repository}: ${edge.relationshipType} directed=${edge.directed}, expected ${expected}`);
        if (!expected) {
          check(edge.arrow === 'none', `${family.repository}: symmetric ${edge.relationshipType} must have arrow 'none', got ${edge.arrow}`);
          check(edge.arrowheadAt === undefined, `${family.repository}: symmetric ${edge.relationshipType} must not carry an arrowhead anchor`);
        } else {
          check(edge.arrow !== 'none', `${family.repository}: directional ${edge.relationshipType} must be arrowed`);
          check(edge.arrowheadAt === edge.target, `${family.repository}: ${edge.relationshipType} arrowhead must sit on the canonical target`);
        }
      }

      // 4. Every shown edge has real evidence behind it.
      for (const edge of view.edges as Record<string, any>[]) {
        const cards = view.evidenceByRelationship[edge.id] ?? [];
        check(edge.evidenceCount > 0, `${family.repository}: ${edge.relationshipType} has zero evidence`);
        check(cards.length > 0, `${family.repository}: ${edge.relationshipType} has no inlined evidence cards`);
      }

      // 6. Bundling must be a presentation concern only: nothing is dropped.
      check(
        view.primaryEdgeCount + view.bundledEdgeCount === view.edgeCount,
        `${family.repository}: primary + bundled must equal the one-hop edge count`,
      );
      for (const bundle of view.bundles as Record<string, any>[]) {
        check(bundle.count > 0, `${family.repository}: bundle ${bundle.key} has no members`);
        check(
          (view.edges as Record<string, any>[]).some((edge) => edge.id === bundle.sampleRelationshipId),
          `${family.repository}: bundle ${bundle.key} sample id is not a real edge`,
        );
      }

      // 5. The page route resolves for the same repository.
      const pageResponse = await fetch(`${url}/${family.repository}`);
      check(pageResponse.status === 200, `${family.repository}: page route returned ${pageResponse.status}`);

      const counts: Record<string, number> = {};
      for (const edge of view.edges as Record<string, any>[]) {
        counts[`${edge.relationshipType}/${edge.status}/${edge.arrow}`] =
          (counts[`${edge.relationshipType}/${edge.status}/${edge.arrow}`] ?? 0) + 1;
      }

      process.stdout.write(`  revision      ${view.revision.ref ?? view.revision.defaultBranch} @ ${view.revision.shortCommit}\n`);
      process.stdout.write(`  schema        ${view.schemaVersion} (analyzer ${view.analyzer.version})\n`);
      process.stdout.write(`  one hop       ${view.edgeCount} one-hop (${view.primaryEdgeCount} drawn, ${view.bundledEdgeCount} bundled)\n`);
      process.stdout.write(`  nodes         ${view.nodes.length}\n`);
      process.stdout.write(`  status        ${view.statusCounts.VERIFIED} verified / ${view.statusCounts.DECLARED} declared / ${view.statusCounts.DETECTED} detected\n`);
      process.stdout.write(`  empty         ${view.empty.isEmpty}\n`);
      process.stdout.write(`  partial       ${view.partial.isPartial} (${view.partial.notes.length} notes)\n`);
      process.stdout.write(`  page route    ${pageResponse.status}\n`);
      process.stdout.write(`  elapsed       ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
      for (const [key, count] of Object.entries(counts).sort()) {
        process.stdout.write(`    ${String(count).padStart(3)}  ${key}\n`);
      }
    }

    // Contract endpoint smoke check.
    const contract = (await (await fetch(`${url}/api/contract`)).json()) as Record<string, any>;
    check(contract.data.directionContract.symmetric.includes('shares_exact_content_with'), 'contract: symmetric list missing shares_exact_content_with');
    check(
      !contract.data.directionContract.directional.includes('shares_exact_content_with'),
      'contract: shares_exact_content_with must not be directional',
    );
    check(contract.data.graphSchemaVersion === '2.0.0', 'contract: schema version is not 2.0.0');
    process.stdout.write(`\ncontract endpoint OK: schema ${contract.data.graphSchemaVersion}\n`);
  } finally {
    await new Promise<void>((done) => server.close(() => done()));
  }

  process.stdout.write(`\nsymmetric types in contract: ${SYMMETRIC_RELATIONSHIPS.join(', ')}\n`);
  if (failures.length > 0) {
    process.stdout.write(`\n${failures.length} FAILURES:\n`);
    for (const failure of failures) process.stdout.write(`  - ${failure}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write('\nall live web checks passed\n');
}

await main();