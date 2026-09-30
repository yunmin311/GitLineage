import type { EntityDraft, JsonValue, Observation } from '../../core/model.ts';
import { normalizeRepositoryRef, repositoryUrl } from '../../core/ids.ts';
import { resolveRepositoryRef, type RepositoryRef } from '../../platform/url.ts';
import type { GitHubRepository } from './client.ts';

export const COLLECTOR_GITHUB_METADATA = 'github-metadata';
export const EXTRACTOR_FORK_METADATA = 'github-fork-metadata@1';
export const EXTRACTOR_REPO_IDENTITY = 'github-repository-identity@1';

export interface RepositoryMetadataResult {
  draft: EntityDraft;
  observations: Observation[];
  candidates: RepositoryRef[];
}

function toRef(repository: GitHubRepository): RepositoryRef | null {
  try {
    const fullName = repository.full_name;
    if (typeof fullName !== 'string') return null;
    return resolveRepositoryRef(fullName);
  } catch {
    return null;
  }
}

function nullableString(value: unknown): JsonValue {
  return typeof value === 'string' ? value : null;
}

/**
 * Reads platform-recorded repository identity and fork metadata.
 *
 * GitHub metadata is a platform assertion, not Git truth: it is treated as one
 * strong signal for `forked_from` and as a candidate generator only. Fork
 * absence proves nothing, so this collector never emits a negative claim.
 */
export function collectRepositoryMetadata(input: {
  repository: GitHubRepository;
  ref: RepositoryRef;
}): RepositoryMetadataResult {
  const { repository, ref } = input;
  const normalized = normalizeRepositoryRef({ kind: 'repository', provider: 'github', owner: ref.owner, name: ref.name });

  const draft: EntityDraft = {
    ref: { ...normalized },
    display: { name: repository.name, fullName: repository.full_name, url: repository.html_url },
    sourceUrl: repository.html_url,
    attributes: {
      provider: 'github',
      owner: repository.owner?.login ?? normalized.owner,
      name: repository.name,
      full_name: repository.full_name,
      default_branch: repository.default_branch,
      created_at: repository.created_at,
      updated_at: repository.updated_at,
      pushed_at: nullableString(repository.pushed_at),
      is_fork: repository.fork === true,
      archived: repository.archived === true,
      homepage: nullableString(repository.homepage),
      description: nullableString(repository.description),
      topics: Array.isArray(repository.topics) ? repository.topics.slice(0, 20) : [],
      license_spdx: nullableString(repository.license?.spdx_id),
      repository_size_kb: typeof repository.size === 'number' ? repository.size : null,
      url: repository.html_url,
    },
  };

  const observations: Observation[] = [];
  const candidates: RepositoryRef[] = [];

  const parent = repository.parent ? toRef(repository.parent) : null;
  const source = repository.source ? toRef(repository.source) : null;
  const origin = parent ?? source;
  if (origin) candidates.push(origin);
  if (source && (!parent || source.owner !== parent.owner || source.name !== parent.name)) candidates.push(source);

  if (repository.fork === true && origin) {
    const originRepository = repository.parent ?? repository.source;
    observations.push({
      collector: COLLECTOR_GITHUB_METADATA,
      extractor: EXTRACTOR_FORK_METADATA,
      subject: { ...normalized },
      object: { kind: 'repository', provider: 'github', owner: origin.owner, name: origin.name },
      relationship: 'forked_from',
      directed: true,
      evidence: {
        type: 'github_fork_metadata',
        status: 'VERIFIED',
        repository: { ...normalized },
        sourceUrl: originRepository?.html_url ?? repositoryUrl({ kind: 'repository', provider: 'github', owner: origin.owner, name: origin.name }),
        locator: { field: 'parent.full_name' },
        observedText: `fork: ${String(originRepository?.fork === true)}`,
        data: {
          fork: true,
          source_full_name: `${origin.owner}/${origin.name}`,
          source_url: originRepository?.html_url ?? repositoryUrl({ kind: 'repository', provider: 'github', owner: origin.owner, name: origin.name }),
          parent_full_name: parent ? `${parent.owner}/${parent.name}` : null,
          root_full_name: source ? `${source.owner}/${source.name}` : null,
          recorded_by: 'github-rest-api',
        },
      },
      objectPatch: {
        attributes: { provider: 'github', url: originRepository?.html_url ?? null },
      },
    });
  }

  return { draft, observations, candidates };
}
