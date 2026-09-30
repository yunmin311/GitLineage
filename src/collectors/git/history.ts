import type { EntityRef, JsonValue, Observation } from '../../core/model.ts';
import type { RepositoryRef } from '../../platform/url.ts';
import { LIMITS } from '../../platform/limits.ts';

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
}

export interface HistoryComparisonInput {
  root: RepositoryRef;
  rootSample: HistorySample;
  candidates: readonly HistorySample[];
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

  for (const candidate of input.candidates) {
    if (candidate.commits.length === 0) continue;
    const candidateCommits = new Set(candidate.commits);
    const shared = intersect(rootCommits, candidateCommits);
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
    const complete = !rootSample.truncated && !candidate.truncated;

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
