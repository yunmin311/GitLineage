import type { JsonValue, Observation } from '../../core/model.ts';
import { parseGitmodules, type GitmodulesEntry } from '../../platform/git.ts';
import { resolveRepositoryRef, type RepositoryRef } from '../../platform/url.ts';
import { LIMITS } from '../../platform/limits.ts';
import type { GitHubTreeEntry } from '../github/client.ts';

export const COLLECTOR_SUBMODULES = 'submodules';
export const EXTRACTOR_GITMODULES = 'gitmodules-entry@1';

export interface SubmoduleCollectorInput {
  root: RepositoryRef;
  commit: string;
  gitmodulesText: string;
  treeEntries: readonly GitHubTreeEntry[];
}

export interface SubmoduleCollectorResult {
  observations: Observation[];
  candidates: RepositoryRef[];
  entries: GitmodulesEntry[];
  diagnostics: { code: string; message: string; context?: Record<string, JsonValue> }[];
}

interface Diagnostic {
  code: string;
  message: string;
  context?: Record<string, JsonValue>;
}

/**
 * `.gitmodules` is an explicit, machine-readable declaration that the analysed
 * repository consumes another Git repository. The submodule URL is resolved
 * against the supported forges; unsupported remotes are reported and skipped
 * rather than guessed. The pinned commit is taken from the tree's gitlink
 * entry, which is authoritative, rather than from the branch name.
 */
export async function collectSubmodules(input: SubmoduleCollectorInput): Promise<SubmoduleCollectorResult> {
  const diagnostics: Diagnostic[] = [];
  if (Buffer.byteLength(input.gitmodulesText, 'utf8') > LIMITS.submodule.maxBytes) {
    return {
      observations: [],
      candidates: [],
      entries: [],
      diagnostics: [{ code: 'gitmodules_too_large', message: `.gitmodules exceeds ${LIMITS.submodule.maxBytes} bytes` }],
    };
  }

  let entries: GitmodulesEntry[] = [];
  try {
    entries = await parseGitmodules(input.gitmodulesText);
  } catch (error) {
    diagnostics.push({
      code: 'gitmodules_parse_failed',
      message: `.gitmodules could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { observations: [], candidates: [], entries: [], diagnostics };
  }

  if (entries.length > LIMITS.submodule.maxEntries) {
    entries = entries.slice(0, LIMITS.submodule.maxEntries);
    diagnostics.push({
      code: 'gitmodules_limit_applied',
      message: `only the first ${LIMITS.submodule.maxEntries} submodule entries were read`,
    });
  }

  const gitlinks = new Map<string, string>();
  for (const entry of input.treeEntries) {
    if (entry.type === 'commit' && entry.mode === '160000') gitlinks.set(entry.path, entry.sha);
  }

  const observations: Observation[] = [];
  const candidates: RepositoryRef[] = [];

  for (const entry of entries) {
    let target: RepositoryRef | null = null;
    try {
      target = resolveRepositoryRef(entry.url);
    } catch {
      target = null;
    }
    if (!target) {
      diagnostics.push({
        code: 'submodule_unsupported_remote',
        message: `submodule ${entry.name} points at an unsupported remote and was not converted into a relationship`,
        context: { name: entry.name, url: entry.url },
      });
      continue;
    }
    if (target.owner === input.root.owner && target.name === input.root.name) continue;

    const pinned = gitlinks.get(entry.path) ?? null;
    candidates.push(target);

    observations.push({
      collector: COLLECTOR_SUBMODULES,
      extractor: EXTRACTOR_GITMODULES,
      subject: { kind: 'repository', provider: 'github', owner: input.root.owner, name: input.root.name },
      object: { kind: 'repository', provider: 'github', owner: target.owner, name: target.name },
      relationship: 'uses_submodule',
      directed: true,
      evidence: {
        type: 'git_submodule_entry',
        status: 'VERIFIED',
        repository: { kind: 'repository', provider: 'github', owner: input.root.owner, name: input.root.name },
        sourceUrl: `https://github.com/${input.root.owner}/${input.root.name}/blob/${input.commit}/.gitmodules`,
        locator: { path: '.gitmodules', field: `submodule.${entry.name}.path` },
        observedText: `submodule "${entry.name}" at ${entry.path} -> ${entry.url}`,
        data: {
          submodule_name: entry.name,
          path: entry.path,
          url: entry.url,
          pinned_commit: pinned,
          ...(entry.branch ? { branch: entry.branch } : {}),
        },
      },
      relationshipAttributes: {
        submodule_path: entry.path,
        pinned_commit: pinned,
      },
    });
  }

  return { observations, candidates, entries, diagnostics };
}

