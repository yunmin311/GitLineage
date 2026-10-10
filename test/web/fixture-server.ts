/** Pinned canonical fixtures with a controlled scheduler clock for FSM assertions. */
import { serve } from '../../src/web/serve.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { LineageGraph } from '../../src/core/model.ts';
import { canonicalGraph } from '../helpers/canonical-fixtures.ts';

export const A = 'Kuddev/pebrel';
export const B = 'yunmin311/obsidian-config';
export const C = 'grpc/grpc';
export const D = 'nachocebey/is';
export const E = 'yunmin311/GitLineage';
type FixtureServerOptions = { phaseDelayMs?: number };
export async function fixtureServer(previewOptions: FixtureServerOptions = {}) {
  const { phaseDelayMs = 4000 } = previewOptions;
  const graphs = new Map<string, LineageGraph>();
  for (const [repo, name] of [
    [A, 'mobile-kuddev-pebrel-51514bd'],
    [B, 'mobile-yunmin311-obsidian-config-3982a219'],
    [C, 'mobile-grpc-grpc-724b3ccb'],
    [D, 'nachocebey__is'],
    [E, 'gitlineage-root'],
  ] as const) graphs.set(repo.toLowerCase(), canonicalGraph(name));
  const graphFor = (target: string) => {
    const graph = graphs.get(target.replace(/^https:\/\/github.com\//, '').toLowerCase());
    if (!graph) throw new Error(`missing fixture: ${target}`);
    return graph;
  };
  const root = await mkdtemp(resolve(tmpdir(), 'gitlineage-ui-'));
  const app = await serve({ port: 0, clientDir: resolve('dist/web'), cacheRoot: root, jobStoreRoot: resolve(root, 'jobs'),
    probeRevisionOverride: async repo => ({ commit: graphFor(`${repo.owner}/${repo.name}`).graph.revision.commit }),
    analyzeOverride: async target => graphFor(target),
    schedulerAnalyzeOverride: async options => {
      const graph = graphFor(options.target);
      for (const phase of ['resolving', 'collecting', 'resolving_relationships', 'validating', 'publishing'] as const) {
        options.onPhase?.(phase);
        if (phaseDelayMs > 0 && graph.graph.rootEntityId === graphFor(B).graph.rootEntityId) {
          await new Promise(r => setTimeout(r, phaseDelayMs));
        }
      }
      return { graph, cacheHit: false };
    },
  }, { GITLINEAGE_NO_CLIENT: '' });
  return { ...app, fixtureCacheRoot: root, cleanup: async () => {
    await new Promise<void>((r, j) => app.server.close(e => e ? j(e) : r()));
    // Closing HTTP does not drain scheduler jobs. Keep their store until every
    // phase and terminal write has finished, even if the UI test finishes first.
    await app.app.analysis.whenIdle();
    app.app.analysis.shutdown();
    await rm(root, { recursive: true, force: true });
  } };
}
