import { join } from 'node:path';
import type { Diagnostic, EntityDraft, JsonValue, LineageGraph, Observation } from '../core/model.ts';
import { GRAPH_SCHEMA_VERSION, ANALYZER_VERSION } from '../core/model.ts';
import { resolve } from '../core/resolver.ts';
import { validateGraph } from '../core/validate.ts';
import { Cache, type CacheNamespace } from '../platform/cache.ts';
import { HttpClient, resolveGitHubToken } from '../platform/http.ts';
import { fetchShallowHistory, isGitAvailable, type ShallowHistory } from '../platform/git.ts';
import { resolveRepositoryRef, type RepositoryRef } from '../platform/url.ts';
import { LIMITS } from '../platform/limits.ts';
import { GitHubClient } from '../collectors/github/client.ts';
import { collectRepositoryMetadata } from '../collectors/github/metadata.ts';
import { collectSubmodules } from '../collectors/submodules/collector.ts';
import { collectPackageDependencies, type ManifestFile } from '../collectors/packages/collector.ts';
import { PackageRegistryResolver } from '../collectors/packages/registry.ts';
import { isScannableDocument, scanDocument } from '../collectors/documents/attribution.ts';
import { compareHistories, type HistorySample } from '../collectors/git/history.ts';
import type { SharedHistoryDiagnosticSink } from '../platform/shared-history-diagnostics.ts';
import { buildBlobIndex, compareBlobIndexes } from '../collectors/git/blobs.ts';

export const OUTBOUND_ALLOWLIST: ReadonlySet<string> = new Set([
  'api.github.com',
  'raw.githubusercontent.com',
  'registry.npmjs.org',
  'pypi.org',
]);

/** Relationship types that justify deeper (blob) comparison against a candidate. */
const LINEAGE_RELATIONSHIPS: ReadonlySet<string> = new Set([
  'forked_from',
  'derived_from',
  'shares_history_with',
  'uses_submodule',
]);

export interface AnalyzeOptions {
  target: string;
  ref?: string | undefined;
  /**
   * Optional cheap resolver for the revision, used to look up a cached
   * artifact before doing the full analysis. Omit it to always analyse.
   */
  probeRevision?: ((repository: RepositoryRef) => Promise<{ commit: string | null }>) | undefined;
  /**
   * Optional progress observer, called once as each pipeline stage is entered.
   *
   * Purely additive instrumentation: it reports what the function is about to do
   * at the existing stage boundaries and changes no behaviour, no evidence and no
   * graph content. The web job runner uses it so a reported phase has genuinely
   * been reached, rather than being interpolated from a timer.
   */
  onPhase?: ((phase: AnalysisPhase) => void) | undefined;
  depth?: number | undefined;
  cacheRoot: string;
  namespace?: CacheNamespace;
  outDir?: string | undefined;
  enableGit?: boolean;
  enableRegistry?: boolean;
  enableBlobs?: boolean;
  blobComparison?: 'lineage-only' | 'all';
  maxCandidates?: number;
  maxBlobCandidates?: number;
  maxDocuments?: number;
  maxManifests?: number;
  token?: string | undefined;
  now?: () => Date;
  /**
   * Optional sidecar sink for shared-history probe diagnostics.
   *
   * Purely observational: it receives records and never influences the graph.
   * Omit it and nothing is recorded anywhere, which is the default.
   */
  diagnostics?: SharedHistoryDiagnosticSink | undefined;
  /** Identity for correlating diagnostics; defaults to the resolved revision. */
  analysisId?: string | undefined;
}

export interface AnalyzeResult {
  graph: LineageGraph;
  diagnostics: Diagnostic[];
  rootRef: RepositoryRef;
  candidates: string[];
  artifacts: { graph: string; metadata: string } | null;
}

/**
 * The pipeline stages, in order.
 *
 * Re-declared here rather than imported from the web layer so the core pipeline
 * keeps no dependency on the server. The web job runner uses the same names.
 */
export type AnalysisPhase =
  | 'resolving'
  | 'collecting'
  | 'resolving_relationships'
  | 'validating'
  | 'publishing';

interface Candidate {
  ref: RepositoryRef;
  reasons: string[];
}

function entityRepository(ref: RepositoryRef): { kind: 'repository'; provider: 'github'; owner: string; name: string } {
  return { kind: 'repository', provider: 'github', owner: ref.owner, name: ref.name };
}

function refKey(ref: RepositoryRef): string {
  return `${ref.owner}/${ref.name}`;
}

const MANIFEST_CANDIDATES: readonly RegExp[] = [
  /^(?:package\.json|package-lock\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/,
  /^requirements(?:[-_][a-z0-9]+)*\.txt$/i,
  /^(?:[\w.-]+\/){1,2}(?:package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/,
];

/**
 * The V1 provenance pipeline.
 *
 *   repository reference
 *     -> collectors (raw observations only)
 *     -> policy-gated resolution
 *     -> canonical lineage graph
 *     -> graph.json + analysis-metadata.json
 *
 * Collectors never see the graph and the graph is never built by a collector.
 */
export async function analyze(options: AnalyzeOptions): Promise<AnalyzeResult> {
  const startedAt = (options.now ?? (() => new Date()))();
  const observedAt = startedAt.toISOString();
  const phase = options.onPhase;
  phase?.('resolving');
  const rootRef = resolveRepositoryRef(options.target);

  const cache = new Cache(options.cacheRoot, options.namespace ?? 'public');
  cache.assertSupported();

  const token = options.token ?? (await resolveGitHubToken());
  const http = new HttpClient({ cache, allowlist: OUTBOUND_ALLOWLIST, token });
  const github = new GitHubClient(http);

  const observations: Observation[] = [];
  const entityDrafts: EntityDraft[] = [];
  const diagnostics: Diagnostic[] = [];
  const candidates = new Map<string, Candidate>();
  const extractors = new Set<string>();
  const adapters: string[] = [];

  const addDiagnostics = (items: readonly { code: string; message: string; context?: Record<string, JsonValue> }[]): void => {
    for (const item of items) {
      diagnostics.push({ code: item.code, level: 'warning', message: item.message, ...(item.context ? { context: item.context } : {}) });
    }
  };

  const addCandidate = (ref: RepositoryRef, reason: string): void => {
    if (ref.owner === rootRef.owner && ref.name === rootRef.name) return;
    const key = refKey(ref);
    const existing = candidates.get(key);
    if (existing) {
      if (!existing.reasons.includes(reason)) existing.reasons.push(reason);
      return;
    }
    candidates.set(key, { ref, reasons: [reason] });
  };

  const repository = await github.getRepository(rootRef);
  phase?.('collecting');
  const metadata = collectRepositoryMetadata({ repository, ref: rootRef });
  observations.push(...metadata.observations);
  entityDrafts.push(metadata.draft);
  for (const candidate of metadata.candidates) addCandidate(candidate, 'github-fork-metadata');
  extractors.add('github-fork-metadata@1');
  extractors.add('github-repository-identity@1');

  const revisionName = options.ref ?? repository.default_branch;
  const commit = await github.getCommitSha(rootRef, revisionName);
  const tree = await github.getTree(rootRef, commit);
  if (tree.truncated) {
    diagnostics.push({
      code: 'tree_truncated',
      level: 'warning',
      message: `the file tree of ${refKey(rootRef)} was truncated at ${LIMITS.tree.maxEntries} entries; some evidence may be missing`,
    });
  }

  // ---- submodules -------------------------------------------------------
  const hasGitmodules = tree.tree.some((entry) => entry.type === 'blob' && entry.path === '.gitmodules');
  if (hasGitmodules) {
    const file = await github.getTextFile(rootRef, '.gitmodules', { revision: commit, maxBytes: LIMITS.submodule.maxBytes });
    if (file) {
      const submodules = await collectSubmodules({
        root: rootRef,
        commit,
        gitmodulesText: file.text,
        treeEntries: tree.tree,
      });
      observations.push(...submodules.observations);
      addDiagnostics(submodules.diagnostics);
      for (const candidate of submodules.candidates) addCandidate(candidate, 'gitmodules');
      extractors.add('gitmodules-entry@1');
    }
  }

  // ---- package manifests ------------------------------------------------
  const manifestPaths = tree.tree
    .filter((entry) => entry.type === 'blob' && MANIFEST_CANDIDATES.some((pattern) => pattern.test(entry.path)))
    .map((entry) => entry.path)
    .sort()
    .slice(0, options.maxManifests ?? 24);

  const manifests: ManifestFile[] = [];
  for (const path of manifestPaths) {
    const file = await github.getTextFile(rootRef, path, { revision: commit, maxBytes: LIMITS.manifest.maxBytes });
    if (file) manifests.push({ path, text: file.text });
  }
  if (manifests.length > 0) {
    const packages = collectPackageDependencies({ root: rootRef, commit, manifests });
    observations.push(...packages.observations);
    addDiagnostics(packages.diagnostics);
    for (const candidate of packages.candidates) addCandidate(candidate, 'manifest-git-dependency');
    extractors.add('manifest-dependency@1');
    extractors.add('lockfile-dependency@1');

    if (options.enableRegistry !== false) {
      adapters.push('package-registry');
      const registry = new PackageRegistryResolver(http);
      const targets = packages.facts
        .filter((fact) => fact.ecosystem === 'npm' || fact.ecosystem === 'pypi')
        .filter((fact) => fact.scope === 'runtime')
        .slice(0, LIMITS.registry.maxLookups);
      for (const fact of targets) {
        const resolved = await registry.resolve({ ecosystem: fact.ecosystem, name: fact.name });
        if (!resolved) continue;
        if (resolved.owner === rootRef.owner && resolved.name === rootRef.name) continue;
        addCandidate(resolved, 'package-registry');
        observations.push({
          collector: 'package-registry',
          extractor: 'package-registry-metadata@1',
          subject: { kind: 'package', ecosystem: fact.ecosystem, name: fact.name },
          object: entityRepository(resolved),
          relationship: 'references',
          directed: true,
          evidence: {
            type: 'package_registry_metadata',
            status: 'DECLARED',
            sourceUrl: registryUrl(fact.ecosystem, fact.name),
            locator: { field: fact.name, spec: fact.ecosystem },
            observedText: `${fact.ecosystem}:${fact.name} -> ${refKey(resolved)}`,
            data: {
              ecosystem: fact.ecosystem,
              package_name: fact.name,
              registry_url: registryUrl(fact.ecosystem, fact.name),
              resolved_repository: refKey(resolved),
              relationship_semantics: 'registry metadata records a source repository; this is not a lineage claim',
            },
          },
        });
      }
      extractors.add('package-registry-metadata@1');
    }
  }

  // ---- documents --------------------------------------------------------
  const documentPaths = tree.tree
    .filter((entry) => entry.type === 'blob' && isScannableDocument(entry.path))
    .map((entry) => entry.path)
    .sort()
    .slice(0, options.maxDocuments ?? LIMITS.document.maxFiles);

  let documentsScanned = 0;
  for (const path of documentPaths) {
    const file = await github.getTextFile(rootRef, path, { revision: commit, maxBytes: LIMITS.document.maxBytes });
    if (!file) continue;
    documentsScanned += 1;
    const scan = scanDocument({ path, text: file.text, root: rootRef, htmlUrl: file.htmlUrl });
    observations.push(...scan.observations);
    for (const observation of scan.observations) {
      const object = observation.object;
      if (object.kind === 'repository') addCandidate({ owner: object.owner, name: object.name, provider: 'github' }, 'document-reference');
    }
    addDiagnostics(scan.diagnostics);
  }
  if (documentsScanned > 0) {
    extractors.add('explicit-attribution@1');
    extractors.add('explicit-reference@1');
  }

  // ---- candidate analysis (git history + blob identity) -----------------
  const depth = options.depth ?? LIMITS.history.maxDepth;
  const maxCandidates = options.maxCandidates ?? LIMITS.candidates.maxRepositories;
  const boundedCandidates = [...candidates.values()]
    .sort((a, b) => refKey(a.ref).localeCompare(refKey(b.ref)))
    .slice(0, maxCandidates);
  if (candidates.size > boundedCandidates.length) {
    diagnostics.push({
      code: 'candidate_limit_applied',
      level: 'warning',
      message: `only the first ${boundedCandidates.length} of ${candidates.size} candidate repositories were analysed`,
      context: { dropped: candidates.size - boundedCandidates.length },
    });
  }

  const rootLoad = await loadHistory(cache, rootRef, options.ref, depth);
  const rootHistory = rootLoad.history;
  if (rootLoad.error) {
    diagnostics.push({
      code: 'root_history_unavailable',
      level: 'warning',
      message: `bounded git history for the analysed repository is unavailable: ${rootLoad.error}`,
    });
  }
  const candidateSamples: HistorySample[] = [];
  const candidateTrees = new Map<string, { commit: string; index: ReturnType<typeof buildBlobIndex> }>();
  const gitEnabled = options.enableGit !== false && (await isGitAvailable());
  if (!gitEnabled) {
    diagnostics.push({
      code: 'git_analysis_unavailable',
      level: 'info',
      message: 'git analysis was skipped because the git executable is unavailable or disabled',
    });
  }

  if (gitEnabled && rootHistory) {
    for (const candidate of boundedCandidates) {
      try {
        const repositoryMetadata = await github.getRepository(candidate.ref);
        entityDrafts.push(candidateDraft(repositoryMetadata, candidate.ref));
        const candidateLoad = await loadHistory(cache, candidate.ref, undefined, depth);
        if (candidateLoad.error) {
          diagnostics.push({
            code: 'candidate_history_unavailable',
            level: 'warning',
            message: `bounded git history for candidate ${refKey(candidate.ref)} is unavailable: ${candidateLoad.error}`,
          });
        }
        const history = candidateLoad.history;
        if (!history) continue;
        candidateSamples.push({
          ref: candidate.ref,
          commits: history.commits,
          truncated: history.truncated,
          createdAt: repositoryMetadata.created_at,
          htmlUrl: repositoryMetadata.html_url,
          // Recorded for the diagnostics sidecar only; never read by the comparison.
          fetch: {
            depth: history.fetchDepth,
            refspec: history.fetchRefspec,
            blobFilter: history.blobFilter,
            isShallow: history.isShallow,
            shallowBoundary: history.shallowBoundary,
          },
        });
        if (options.enableBlobs !== false) {
          try {
            const candidateCommit = await github.getCommitSha(candidate.ref, repositoryMetadata.default_branch);
            const candidateTree = await github.getTree(candidate.ref, candidateCommit);
            candidateTrees.set(refKey(candidate.ref), { commit: candidateCommit, index: buildBlobIndex(candidateTree.tree) });
          } catch (error) {
            diagnostics.push({
              code: 'candidate_tree_unavailable',
              level: 'warning',
              message: `tree of candidate ${refKey(candidate.ref)} could not be read: ${error instanceof Error ? error.message : String(error)}`,
            });
          }
        }
      } catch (error) {
        diagnostics.push({
          code: 'candidate_unavailable',
          level: 'warning',
          message: `candidate ${refKey(candidate.ref)} could not be analysed: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }

    if (candidateSamples.length > 0) {
      const comparison = compareHistories({
        root: rootRef,
        rootSample: {
          ref: rootRef,
          commits: rootHistory.commits,
          truncated: rootHistory.truncated,
          createdAt: repository.created_at,
          htmlUrl: repository.html_url,
          fetch: {
            depth: rootHistory.fetchDepth,
            refspec: rootHistory.fetchRefspec,
            blobFilter: rootHistory.blobFilter,
            isShallow: rootHistory.isShallow,
            shallowBoundary: rootHistory.shallowBoundary,
          },
        },
        candidates: candidateSamples,
        diagnostics: options.diagnostics,
        analysisId: options.analysisId ?? commit,
        resolvedRevision: commit,
        analyzerVersion: ANALYZER_VERSION,
        schemaVersion: GRAPH_SCHEMA_VERSION,
      });
      observations.push(...comparison.observations);
      addDiagnostics(comparison.diagnostics);
      if (comparison.observations.length > 0) {
        extractors.add('git-shared-commits@1');
        extractors.add('git-history-containment@1');
      }
    }
  }

  // ---- exact blob comparison -------------------------------------------
  if (options.enableBlobs !== false && rootHistory) {
    const rootIndex = buildBlobIndex(tree.tree);
    const lineageTargets = new Set<string>();
    for (const observation of observations) {
      if (!LINEAGE_RELATIONSHIPS.has(observation.relationship)) continue;
      const other = observation.subject.kind === 'repository' && refKey(rootRef) === `${observation.subject.owner}/${observation.subject.name}`
        ? observation.object
        : observation.subject;
      if (other.kind === 'repository') lineageTargets.add(refKey({ owner: other.owner, name: other.name, provider: 'github' }));
    }
    const blobMode = options.blobComparison ?? 'lineage-only';
    const allowed =
      blobMode === 'all' ? [...candidateTrees.keys()] : [...lineageTargets].filter((key) => candidateTrees.has(key)).sort();
    for (const key of allowed.slice(0, options.maxBlobCandidates ?? 12)) {
      const candidate = candidates.get(key);
      const target = candidateTrees.get(key);
      if (!candidate || !target) continue;
      const comparison = compareBlobIndexes({
        root: rootRef,
        rootIndex,
        rootCommit: commit,
        candidate: candidate.ref,
        candidateIndex: target.index,
        candidateCommit: target.commit,
      });
      observations.push(...comparison.observations);
      if (comparison.observations.length > 0) {
        extractors.add('git-blob-identity@1');
        diagnostics.push({
          code: 'exact_content_detected',
          level: 'info',
          message: `${comparison.sharedBlobCount} identical blob(s) shared with ${key}`,
          context: { target: key, matched_blob_count: comparison.sharedBlobCount, evidence_truncated: comparison.truncated },
        });
      }
    }
  }

  phase?.('resolving_relationships');
  const { graph, diagnostics: resolveDiagnostics } = resolve({
    root: entityRepository(rootRef),
    observations,
    entityDrafts,
    preDiagnostics: diagnostics,
    revision: {
      commit,
      ...(options.ref ? { ref: options.ref } : {}),
      defaultBranch: repository.default_branch,
      resolvedAt: observedAt,
    },
    namespace: options.namespace ?? 'public',
    extractors: [...extractors],
    adapters,
    limitsApplied: {
      history_depth: depth,
      tree_entries: LIMITS.tree.maxEntries,
      document_bytes: LIMITS.document.maxBytes,
      manifest_bytes: LIMITS.manifest.maxBytes,
      dependency_facts: LIMITS.manifest.maxDependencies,
      registry_lookups: LIMITS.registry.maxLookups,
      candidate_count: maxCandidates,
    },
    observedAt,
    analyzerVersion: ANALYZER_VERSION,
    schemaVersion: GRAPH_SCHEMA_VERSION,
  });

  diagnostics.push(...resolveDiagnostics);

  phase?.('validating');
  const validation = validateGraph(graph);
  if (!validation.valid) {
    throw new Error(`internal contract violation: produced graph failed validation:\n${validation.errors.join('\n')}`);
  }

  let artifacts: AnalyzeResult['artifacts'] = null;
  if (options.outDir) {
    phase?.('publishing');
    const graphPath = join(options.outDir, 'graph.json');
    const metadataPath = join(options.outDir, 'analysis-metadata.json');
    await cache.writeJsonAtomic(graphPath, graph);
    await cache.writeJsonAtomic(metadataPath, {
      schemaVersion: graph.schemaVersion,
      analyzer: graph.graph.analyzer,
      root: refKey(rootRef),
      rootUrl: repository.html_url,
      revision: graph.graph.revision,
      generatedAt: graph.graph.generatedAt,
      documentFilesScanned: documentsScanned,
      manifestFilesParsed: manifests.length,
      candidateCount: candidates.size,
      candidatesAnalysed: boundedCandidates.length,
      relationshipCounts: countBy(graph.relationships.map((relationship) => relationship.type)),
      statusCounts: countBy(graph.relationships.map((relationship) => relationship.status)),
      diagnosticCounts: countBy(diagnostics.map((item) => `${item.level}:${item.code}`)),
    });
    artifacts = { graph: graphPath, metadata: metadataPath };
  }

  return {
    graph,
    diagnostics,
    rootRef,
    candidates: [...candidates.values()].map((entry) => `${refKey(entry.ref)} [${entry.reasons.join(', ')}]`),
    artifacts,
  };
}

function countBy(values: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const value of [...values].sort()) out[value] = (out[value] ?? 0) + 1;
  return out;
}

function candidateDraft(repository: { full_name: string; name: string; owner?: { login?: string }; created_at: string; default_branch: string; html_url: string; fork?: boolean }, ref: RepositoryRef): EntityDraft {
  return {
    ref: entityRepository(ref),
    display: { name: repository.name, fullName: repository.full_name, url: repository.html_url },
    sourceUrl: repository.html_url,
    attributes: {
      provider: 'github',
      full_name: repository.full_name,
      default_branch: repository.default_branch,
      created_at: repository.created_at,
      is_fork: repository.fork === true,
      url: repository.html_url,
    },
  };
}

function registryUrl(ecosystem: string, name: string): string {
  if (ecosystem === 'npm') return `https://registry.npmjs.org/${name}`;
  if (ecosystem === 'pypi') return `https://pypi.org/project/${name}/`;
  return `https://registry.npmjs.org/${name}`;
}

async function loadHistory(
  cache: Cache,
  ref: RepositoryRef,
  refName: string | undefined,
  depth: number,
): Promise<{ history: ShallowHistory | null; error?: string }> {
  const repoDir = cache.path('git', ref.owner, `${ref.name}.git`);
  try {
    const history = await fetchShallowHistory({
      repoDir,
      remoteUrl: `https://github.com/${ref.owner}/${ref.name}.git`,
      ref: refName,
      depth,
      sandboxHome: cache.path('git', '_sandbox'),
    });
    return { history };
  } catch (error) {
    return { history: null, error: error instanceof Error ? error.message : String(error) };
  }
}
