import { analyze, type AnalyzeOptions, type AnalyzeResult } from './analyze.ts';
import type { EntityRefRepository, LineageGraph } from '../core/model.ts';
import { validateGraph } from '../core/validate.ts';
import { Cache } from '../platform/cache.ts';
import { graphArtifactPaths } from '../platform/git.ts';
import { resolveRepositoryRef, type RepositoryRef } from '../platform/url.ts';

export interface CachedAnalysis {
  graph: LineageGraph;
  fromCache: boolean;
  cacheHit: boolean;
  /** Where the artifact lives, for logging and for the API to disclose. */
  artifactPath: string;
}

export class StaleArtifactError extends Error {
  readonly path: string;
  readonly found: string;
  readonly expected: string;

  constructor(path: string, found: string, expected: string) {
    super(`cached artifact at ${path} has schemaVersion ${found}, this build requires ${expected}`);
    this.name = 'StaleArtifactError';
    this.path = path;
    this.found = found;
    this.expected = expected;
  }
}

/**
 * Version-aware analysis cache.
 *
 * Two independent guarantees:
 *
 * 1. **Path contains the contract version.** Artifacts live under
 *    `graphs/<namespace>/<owner>/<name>@<commit>/v<schemaVersion>/`, so a build
 *    with a different contract literally cannot find an older artifact.
 * 2. **Read is validated, never trusted.** Even if a path matched, the stored
 *    `schemaVersion` is checked and the graph is revalidated before it can be
 *    returned. A stale or corrupt artifact is discarded and recomputed.
 */
export class AnalysisCache {
  private readonly cache: Cache;
  private readonly namespace: string;

  constructor(cacheRoot: string, namespace: 'public' | 'private' = 'public') {
    this.cache = new Cache(cacheRoot, namespace);
    this.cache.assertSupported();
    this.namespace = namespace;
  }

  async read(repository: RepositoryRef, commit: string): Promise<LineageGraph | null> {
    const paths = graphArtifactPaths(this.cache, repository, commit, this.namespace);
    const stored = await this.cache.readJson<LineageGraph>(paths.graph);
    if (!stored) return null;

    const validation = validateGraph(stored);
    if (!validation.valid) {
      // Never serve an artifact this build cannot fully vouch for.
      return null;
    }
    return stored;
  }

  async write(repository: RepositoryRef, commit: string, graph: LineageGraph): Promise<string> {
    const paths = graphArtifactPaths(this.cache, repository, commit, this.namespace);
    await this.cache.writeJsonAtomic(paths.graph, graph);
    return paths.graph;
  }

  async store(repository: RepositoryRef, commit: string, graph: LineageGraph): Promise<string> {
    return this.write(repository, commit, graph);
  }

  /** Path for a revision, used by the API to report where an artifact lives. */
  pathFor(repository: RepositoryRef, commit: string): string {
    return graphArtifactPaths(this.cache, repository, commit, this.namespace).graph;
  }
}

/**
 * Analyses a repository, reusing a cached artifact only when the contract
 * version matches and the graph still validates.
 */
export async function analyzeWithCache(
  options: AnalyzeOptions & { cacheRoot: string },
): Promise<CachedAnalysis> {
  const repositoryRef = resolveRepositoryRef(options.target);
  const cache = new AnalysisCache(options.cacheRoot, options.namespace ?? 'public');

  // A cheap metadata read gives the resolved commit, which is part of the key.
  const commit = options.probeRevision ? (await options.probeRevision(repositoryRef)).commit : null;

  if (commit) {
    const cached = await cache.read(repositoryRef, commit);
    if (cached) {
      return {
        graph: cached,
        fromCache: true,
        cacheHit: true,
        artifactPath: cache.pathFor(repositoryRef, commit),
      };
    }
  }

  const result: AnalyzeResult = await analyze(options);
  await cache.store(repositoryRef, result.graph.graph.revision.commit, result.graph);
  return {
    graph: result.graph,
    fromCache: false,
    cacheHit: false,
    artifactPath: cache.pathFor(repositoryRef, result.graph.graph.revision.commit),
  };
}

export type { EntityRefRepository };