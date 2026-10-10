import type { EntityRef, JsonValue, Observation } from '../../core/model.ts';
import type { RepositoryRef } from '../../platform/url.ts';
import { LIMITS } from '../../platform/limits.ts';
import type {
  AnalysisDiagnosticHeader,
  SharedHistoryDiagnosticSink,
  SharedHistoryProbeRecord,
  WindowFacts,
} from '../../platform/shared-history-diagnostics.ts';

export const COLLECTOR_GIT = 'git-analyzer';
export const EXTRACTOR_SHARED_COMMITS = 'git-shared-commits@1';
export const EXTRACTOR_CONTAINMENT = 'git-history-containment@1';

export interface HistorySample {
  ref: RepositoryRef;
  /** Commit shas in `git rev-list` order (newest first), bounded by depth. */
  commits: readonly string[];
  /** Whether the sampled window hit the depth bound, i.e. history is partial. */
  truncated: boolean;
  createdAt: string;
  htmlUrl: string;
  /**
   * Fetch completeness facts. If supplied, unknown/shallow state cannot prove
   * complete containment; callers without fetch facts retain the explicit truncated contract.
   */
  fetch?: {
    depth?: number;
    refspec?: string;
    blobFilter?: string | null;
    isShallow?: boolean;
    shallowBoundary?: readonly string[];
  };
}

export interface HistoryComparisonInput {
  root: RepositoryRef;
  rootSample: HistorySample;
  candidates: readonly HistorySample[];
  /** Identity of the analysis, for correlating diagnostics. */
  analysisId?: string;
  resolvedRevision?: string;
  analyzerVersion?: string;
  schemaVersion?: string;
  /** Disabled by default; when absent nothing is recorded anywhere. */
  diagnostics?: SharedHistoryDiagnosticSink | undefined;
}

export interface HistoryComparisonResult {
  observations: Observation[];
  diagnostics: { code: string; message: string; context?: Record<string, JsonValue> }[];
}

function intersect(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const value of b) if (a.has(value)) out.push(value);
  return out;
}

/**
 * Compares bounded commit windows.
 *
 * `shares_history_with` requires only identical commit objects, which is a
 * machine-verifiable fact. `derived_from` is far stricter: it requires that
 * the whole sampled window of the source is contained in the source window,
 * that the source carries additional commits, that neither window is truncated
 * (otherwise containment cannot be proven), and that the source repository is
 * older. Anything less stays at `shares_history_with`.
 */
export function compareHistories(input: HistoryComparisonInput): HistoryComparisonResult {
  const observations: Observation[] = [];
  const diagnostics: HistoryComparisonResult['diagnostics'] = [];
  const root = input.root;
  const rootSample = input.rootSample;
  const rootCommits = new Set(rootSample.commits);
  const rootRefEntity: EntityRef = { kind: 'repository', provider: 'github', owner: root.owner, name: root.name };
  const sink = input.diagnostics;

  // The per-analysis header, written once, before any probe. Failures are
  // swallowed by the sink, and a missing sink is not an error.
  void Promise.resolve(sink?.header({
    analysisId: input.analysisId ?? 'unknown',
    repository: `${root.owner}/${root.name}`,
    resolvedRevision: input.resolvedRevision ?? 'unknown',
    analyzerVersion: input.analyzerVersion ?? 'unknown',
    schemaVersion: input.schemaVersion ?? 'unknown',
    startedAt: new Date().toISOString(),
    depthRequested: rootSample.fetch?.depth ?? 0,
    maxCandidates: input.candidates.length,
  } satisfies AnalysisDiagnosticHeader)).catch(() => {
    // Observability must never fail an analysis.
  });

  for (const candidate of input.candidates) {
    if (candidate.commits.length === 0) continue;
    const candidateCommits = new Set(candidate.commits);
    const shared = intersect(rootCommits, candidateCommits);

    if (sink) {
      // Not awaited: compareHistories is synchronous, and the sink is
      // best-effort by contract. The promise is internally guarded, so a rejected
      // write cannot become an unhandled rejection.
      void recordProbe(input, rootSample, candidate, candidateCommits, shared);
    }

    if (shared.length === 0) continue;

    const samples = shared.slice(0, LIMITS.history.maxSharedCommitSamples);
    const candidateRefEntity: EntityRef = {
      kind: 'repository',
      provider: 'github',
      owner: candidate.ref.owner,
      name: candidate.ref.name,
    };

    observations.push({
      collector: COLLECTOR_GIT,
      extractor: EXTRACTOR_SHARED_COMMITS,
      subject: rootRefEntity,
      object: candidateRefEntity,
      relationship: 'shares_history_with',
      directed: false,
      evidence: {
        type: 'git_shared_commits',
        status: 'VERIFIED',
        repository: { kind: 'repository', provider: 'github', owner: root.owner, name: root.name },
        sourceUrl: candidate.htmlUrl,
        observedText: `${shared.length} identical commit object(s)`,
        data: {
          shared_commit_count: shared.length,
          shared_commit_samples: samples,
          sampled_commit_count: Math.min(rootSample.commits.length, candidate.commits.length),
          root_window_truncated: rootSample.truncated,
          candidate_window_truncated: candidate.truncated,
          comparison: 'commit-object-identity',
        },
      },
      relationshipAttributes: {
        shared_commit_count: shared.length,
        evidence_truncated: shared.length > samples.length,
        root_history_truncated: rootSample.truncated,
        candidate_history_truncated: candidate.truncated,
      },
    });

    const sourceOnly = [...candidateCommits].filter((sha) => !rootCommits.has(sha)).length;
    const targetOnly = [...rootCommits].filter((sha) => !candidateCommits.has(sha)).length;
    const contained = targetOnly === 0 && sourceOnly > 0;
    const temporallyOrdered = Date.parse(candidate.createdAt) < Date.parse(rootSample.createdAt);
    const completeWindow = (sample: HistorySample): boolean => !sample.truncated &&
      (sample.fetch === undefined || (sample.fetch.isShallow === false && (sample.fetch.shallowBoundary?.length ?? 0) === 0));
    const complete = completeWindow(rootSample) && completeWindow(candidate);

    if (contained && temporallyOrdered && complete) {
      observations.push({
        collector: COLLECTOR_GIT,
        extractor: EXTRACTOR_CONTAINMENT,
        subject: rootRefEntity,
        object: candidateRefEntity,
        relationship: 'derived_from',
        directed: true,
        evidence: {
          type: 'git_history_containment',
          status: 'VERIFIED',
          repository: { kind: 'repository', provider: 'github', owner: root.owner, name: root.name },
          sourceUrl: candidate.htmlUrl,
          observedText: `${rootSample.commits.length} sampled commit(s) fully contained in ${candidate.ref.owner}/${candidate.ref.name}`,
          data: {
            source_only_commit_count: sourceOnly,
            target_only_commit_count: targetOnly,
            shared_commit_count: shared.length,
            shared_commit_samples: samples,
            root_window_truncated: rootSample.truncated,
            candidate_window_truncated: candidate.truncated,
            source_created_at: candidate.createdAt,
            target_created_at: rootSample.createdAt,
            rule: 'containment+ordering',
          },
        },
        relationshipAttributes: {
          source_only_commit_count: sourceOnly,
          shared_commit_count: shared.length,
        },
      });
    } else if (contained) {
      diagnostics.push({
        code: 'containment_not_asserted',
        message: `history of ${candidate.ref.owner}/${candidate.ref.name} contains the analysed history but containment was not asserted`,
        context: {
          target: `${candidate.ref.owner}/${candidate.ref.name}`,
          temporally_ordered: temporallyOrdered,
          root_window_truncated: rootSample.truncated,
          candidate_window_truncated: candidate.truncated,
        },
      });
    }
  }

  return { observations, diagnostics };
}

/**
 * Records one probe to the sidecar.
 *
 * "Required commits" are the shas the root window contributes and the candidate
 * is asked about. For each, `presentLocally` records whether the candidate's
 * own bounded clone actually contains the object. That is the fact that
 * distinguishes a genuine absence from a shallow boundary that happened to land
 * differently -- the plausible mechanism behind a `shares_history_with` signal
 * that appeared once and never again. Recording it as always-true would have
 * been worse than recording nothing.
 *
 * The entire body is inside a try/catch: a diagnostic failure cannot fail an
 * analysis, and cannot change its result.
 */
async function recordProbe(
  input: HistoryComparisonInput,
  rootSample: HistorySample,
  candidate: HistorySample,
  candidateCommits: ReadonlySet<string>,
  shared: readonly string[],
): Promise<void> {
  try {
    const sink = input.diagnostics;
    if (!sink) return;

    const toWindow = (sample: HistorySample): WindowFacts => {
      const boundary = new Set(sample.fetch?.shallowBoundary ?? []);
      return {
        requestedDepth: sample.fetch?.depth ?? 0,
        effectiveDepth: sample.fetch?.depth ?? 0,
        refspec: sample.fetch?.refspec ?? 'unknown',
        blobFilter: sample.fetch?.blobFilter ?? null,
        isShallow: sample.fetch?.isShallow ?? false,
        shallowBoundaryCount: boundary.size,
        boundaryTruncated: [...boundary].some((sha) => sample.commits.includes(sha)),
        commitCount: sample.commits.length,
        truncated: sample.truncated,
      };
    };

    // Bounded: a repository with a deep window must not produce an unbounded file.
    const cap = LIMITS.history.maxSharedCommitSamples + 16;
    const required = rootSample.commits.slice(0, cap).map((sha) => ({
      sha,
      presentLocally: candidateCommits.has(sha),
    }));
    const missing = required.filter((r) => !r.presentLocally).length;

    const record: SharedHistoryProbeRecord = {
      analysisId: input.analysisId ?? 'unknown',
      repository: `${input.root.owner}/${input.root.name}`,
      candidate: `${candidate.ref.owner}/${candidate.ref.name}`,
      resolvedRevision: input.resolvedRevision ?? 'unknown',
      analyzerVersion: input.analyzerVersion ?? 'unknown',
      schemaVersion: input.schemaVersion ?? 'unknown',
      rootWindow: toWindow(rootSample),
      candidateWindow: toWindow(candidate),
      requiredCommits: required,
      requiredCommitsMissingLocally: missing,
      requiredCommitsTruncatedByCap: rootSample.commits.length > cap,
      probe: {
        method: 'commit-set-intersection',
        rootCommitCount: rootSample.commits.length,
        candidateCommitCount: candidate.commits.length,
        requiredCount: required.length,
        sharedCount: shared.length,
        sharedSample: shared.slice(0, LIMITS.history.maxSharedCommitSamples),
      },
      emitted: shared.length > 0,
      subjectEntityId: `repo:github:${input.root.owner}/${input.root.name}`,
      objectEntityId: `repo:github:${candidate.ref.owner}/${candidate.ref.name}`,
    };
    await sink.probe(record);
  } catch {
    // Intentionally empty. Observability must never fail an analysis.
  }
}
