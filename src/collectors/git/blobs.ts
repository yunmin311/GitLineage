import type { Observation } from '../../core/model.ts';
import type { RepositoryRef } from '../../platform/url.ts';
import { LIMITS } from '../../platform/limits.ts';
import type { GitHubTreeEntry } from '../github/client.ts';

export const COLLECTOR_GIT_BLOBS = 'git-blob-analyzer';
export const EXTRACTOR_BLOB_IDENTITY = 'git-blob-identity@1';

export interface BlobIndex {
  /** blob sha -> lexicographically smallest path inside the repository. */
  readonly paths: ReadonlyMap<string, string>;
  readonly blobCount: number;
  readonly truncated: boolean;
}

/**
 * Builds a blob identity index from one commit tree.
 *
 * Blob identity is a cryptographic fact: the same Git blob id means the same
 * byte content, regardless of file name, directory or repository. This is the
 * cheapest and strongest exact-content signal available, and it is preferred
 * over any fuzzy similarity computation.
 */
export function buildBlobIndex(entries: readonly GitHubTreeEntry[]): BlobIndex {
  const paths = new Map<string, string>();
  let truncated = false;
  let considered = 0;
  for (const entry of entries) {
    if (entry.type !== 'blob') continue;
    if (typeof entry.size === 'number' && entry.size === 0) continue;
    considered += 1;
    if (considered > LIMITS.tree.maxBlobPairsCompared) {
      truncated = true;
      break;
    }
    const existing = paths.get(entry.sha);
    if (existing === undefined || entry.path < existing) paths.set(entry.sha, entry.path);
  }
  return { paths, blobCount: paths.size, truncated };
}

export interface BlobComparisonResult {
  observations: Observation[];
  sharedBlobCount: number;
  truncated: boolean;
}

export interface BlobComparisonInput {
  root: RepositoryRef;
  rootIndex: BlobIndex;
  rootCommit: string;
  candidate: RepositoryRef;
  candidateIndex: BlobIndex;
  candidateCommit: string;
}

/**
 * Emits `contains_exact_content_from` for every blob present in both trees.
 *
 * Only identical Git blob ids are used. There is no fuzzy matching, no
 * threshold and no similarity score: either the content is byte-identical or
 * no relationship is produced. Trivially small or empty blobs are excluded by
 * the index builder so that shared boilerplate does not dominate a graph.
 */
export function compareBlobIndexes(input: BlobComparisonInput): BlobComparisonResult {
  const observations: Observation[] = [];
  const rootIndex = input.rootIndex;
  const candidateIndex = input.candidateIndex;

  const sharedBlobs: string[] = [];
  for (const sha of rootIndex.paths.keys()) {
    if (candidateIndex.paths.has(sha)) sharedBlobs.push(sha);
    if (sharedBlobs.length > LIMITS.tree.maxSharedBlobSamples) break;
  }

  const totalShared = [...rootIndex.paths.keys()].filter((sha) => candidateIndex.paths.has(sha)).length;
  const sampleLimit = LIMITS.tree.maxBlobEvidenceRecords;
  const sample = sharedBlobs.slice(0, sampleLimit);
  const truncated = totalShared > sample.length;

  for (const sha of sample) {
    const sourcePath = rootIndex.paths.get(sha)!;
    const targetPath = candidateIndex.paths.get(sha)!;
    observations.push({
      collector: COLLECTOR_GIT_BLOBS,
      extractor: EXTRACTOR_BLOB_IDENTITY,
      subject: { kind: 'repository', provider: 'github', owner: input.root.owner, name: input.root.name },
      object: { kind: 'repository', provider: 'github', owner: input.candidate.owner, name: input.candidate.name },
      relationship: 'contains_exact_content_from',
      directed: true,
      evidence: {
        type: 'git_blob_identity',
        status: 'VERIFIED',
        repository: { kind: 'repository', provider: 'github', owner: input.root.owner, name: input.root.name },
        sourceUrl: `https://github.com/${input.root.owner}/${input.root.name}/blob/${input.rootCommit}/${sourcePath
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        locator: { path: sourcePath, field: sha },
        observedText: `identical git blob ${sha}`,
        data: {
          source_blob: sha,
          target_blob: sha,
          source_path: sourcePath,
          target_path: targetPath,
          source_commit: input.rootCommit,
          target_commit: input.candidateCommit,
        },
      },
      relationshipAttributes: {
        matched_blob_count: totalShared,
        evidence_truncated: truncated,
        source_blob_count: rootIndex.blobCount,
        target_blob_count: candidateIndex.blobCount,
        candidate_index_truncated: candidateIndex.truncated || rootIndex.truncated,
      },
    });
  }

  return { observations, sharedBlobCount: totalShared, truncated };
}
