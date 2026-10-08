/** Existing real cache artifacts, with a controlled scheduler clock for FSM assertions. */
import { serve } from '../../src/web/serve.ts';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { LineageGraph } from '../../src/core/model.ts';

export const A = 'Kuddev/pebrel';
export const B = 'yunmin311/obsidian-config';
export async function fixtureServer() {
  const paths = [
    '.cache/public/graphs/public/github/kuddev/pebrel@51514bd50094/v2.0.0/graph.json',
    '.cache/public/graphs/public/github/yunmin311/obsidian-config@3982a219c102/v2.0.0/graph.json',
  ];
  const graphs = new Map<string, LineageGraph>();
  for (const [i, path] of paths.entries()) graphs.set([A, B][i]!.toLowerCase(), JSON.parse(await readFile(path, 'utf8')));
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
        if (graph.graph.rootEntityId === graphFor(B).graph.rootEntityId) await new Promise(r => setTimeout(r, 4000));
      }
      return { graph, cacheHit: false };
    },
  }, { GITLINEAGE_NO_CLIENT: '' });
  return { ...app, cleanup: async () => {
    await new Promise<void>((r, j) => app.server.close(e => e ? j(e) : r()));
    // Closing HTTP does not drain scheduler jobs. Keep their store until every
    // phase and terminal write has finished, even if the UI test finishes first.
    await app.app.analysis.whenIdle();
    app.app.analysis.shutdown();
    await rm(root, { recursive: true, force: true });
  } };
}
