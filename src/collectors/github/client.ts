import type { HttpClient } from '../../platform/http.ts';
import { assertPublicHttpsUrl, type RepositoryRef } from '../../platform/url.ts';
import { LIMITS } from '../../platform/limits.ts';

const API_ROOT = 'https://api.github.com';
const RAW_ROOT = 'https://raw.githubusercontent.com';

export interface GitHubRepository {
  full_name: string;
  name: string;
  owner: { login: string };
  html_url: string;
  default_branch: string;
  created_at: string;
  updated_at: string;
  pushed_at: string | null;
  fork: boolean;
  parent: GitHubRepository | null;
  source: GitHubRepository | null;
  homepage: string | null;
  description: string | null;
  topics?: string[];
  size: number;
  archived: boolean;
  disabled: boolean;
  visibility: string;
  stargazers_count: number;
  license: { spdx_id: string | null; name: string } | null;
}

export interface GitHubTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree' | 'commit';
  sha: string;
  size?: number;
  url: string;
}

export interface GitHubTree {
  sha: string;
  truncated: boolean;
  tree: GitHubTreeEntry[];
}

export interface GitHubFile {
  path: string;
  sha: string;
  size: number;
  text: string;
  htmlUrl: string;
}

export class GitHubNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubNotFoundError';
  }
}

export interface GetFileOptions {
  revision?: string | undefined;
  maxBytes?: number;
}

/**
 * Thin, read-only GitHub REST client.
 *
 * It performs no writes, no authenticated repository access and no request
 * that could execute anything. Request URLs are always rebuilt from validated
 * inputs; response-supplied URLs are re-checked against the outbound allowlist
 * before use.
 */
export class GitHubClient {
  private readonly http: HttpClient;
  private readonly apiRoot: string;
  private readonly rawRoot: string;

  constructor(http: HttpClient, apiRoot = API_ROOT, rawRoot = RAW_ROOT) {
    this.http = http;
    this.apiRoot = apiRoot;
    this.rawRoot = rawRoot;
  }

  private url(path: string, params: Record<string, string | number | undefined> = {}): URL {
    const url = new URL(`${this.apiRoot}${path}`);
    for (const key of Object.keys(params).sort()) {
      const value = params[key];
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  }

  async getRepository(ref: RepositoryRef): Promise<GitHubRepository> {
    const repository = await this.http.fetchJson<GitHubRepository>(this.url(`/repos/${ref.owner}/${ref.name}`));
    if (!repository?.full_name) throw new GitHubNotFoundError(`no repository metadata at ${ref.owner}/${ref.name}`);
    return repository;
  }

  async getCommitSha(ref: RepositoryRef, revision: string): Promise<string> {
    const payload = await this.http.fetchJson<{ sha?: string }>(
      this.url(`/repos/${ref.owner}/${ref.name}/commits/${encodeURIComponent(revision)}`),
    );
    if (!payload?.sha || !/^[0-9a-f]{40}$/.test(payload.sha)) {
      throw new GitHubNotFoundError(`could not resolve revision ${revision} for ${ref.owner}/${ref.name}`);
    }
    return payload.sha;
  }

  async getTree(ref: RepositoryRef, commitSha: string): Promise<GitHubTree> {
    const tree = await this.http.fetchJson<GitHubTree>(
      this.url(`/repos/${ref.owner}/${ref.name}/git/trees/${commitSha}`, { recursive: '1' }),
    );
    if (!tree || !Array.isArray(tree.tree)) throw new GitHubNotFoundError(`no tree for ${ref.owner}/${ref.name}@${commitSha}`);
    if (tree.tree.length > LIMITS.tree.maxEntries) {
      tree.tree = tree.tree.slice(0, LIMITS.tree.maxEntries);
      tree.truncated = true;
    }
    return tree;
  }

  /**
   * Reads one text file. Oversized files, directories and missing files return
   * `null` instead of throwing, so that one unreadable document never fails an
   * entire analysis.
   */
  async getTextFile(ref: RepositoryRef, path: string, options: GetFileOptions = {}): Promise<GitHubFile | null> {
    const maxBytes = options.maxBytes ?? LIMITS.document.maxBytes;
    const encoded = path.split('/').map(encodeURIComponent).join('/');
    const url = this.url(`/repos/${ref.owner}/${ref.name}/contents/${encoded}`, {
      ref: options.revision,
    });
    let payload: { type?: string; size?: number; sha?: string; content?: string; encoding?: string; download_url?: string; html_url?: string };
    try {
      payload = await this.http.fetchJson(url);
    } catch (error) {
      if (error instanceof Error && /\b404\b/.test(error.message)) return null;
      throw error;
    }
    if (payload?.type !== 'file') return null;
    if (typeof payload.size === 'number' && payload.size > maxBytes) return null;
    if (!payload.sha) return null;

    const raw = new URL(
      `${this.rawRoot}/${ref.owner}/${ref.name}/${options.revision ?? 'HEAD'}/${encoded}`,
    );
    assertPublicHttpsUrl(raw, this.http.allowlist);
    let text: string;
    try {
      text = await this.http.fetchText(raw, maxBytes);
    } catch (error) {
      if (error instanceof Error && /\b404\b/.test(error.message)) {
        return {
          path,
          sha: payload.sha,
          size: typeof payload.size === 'number' ? payload.size : 0,
          text: '',
          htmlUrl: payload.html_url ?? '',
        };
      }
      throw error;
    }
    return {
      path,
      sha: payload.sha,
      size: typeof payload.size === 'number' ? payload.size : 0,
      text,
      htmlUrl: payload.html_url ?? '',
    };
  }
}
