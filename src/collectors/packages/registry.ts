import type { HttpClient } from '../../platform/http.ts';
import { resolveRepositoryRef, type RepositoryRef } from '../../platform/url.ts';
import { LIMITS } from '../../platform/limits.ts';
import type { Ecosystem } from './manifests.ts';

export const COLLECTOR_REGISTRY = 'package-registry';
export const EXTRACTOR_REGISTRY = 'package-registry-metadata@1';

export interface PackageTarget {
  ecosystem: Ecosystem;
  name: string;
}

/**
 * Optional adapter: resolves a package name to the source repository that the
 * package registry itself records.
 *
 * This is registry metadata, not a lineage claim, so the resulting edge is a
 * `references` relationship with `DECLARED` status, never an ancestry
 * relationship. Failure to resolve a package is a normal outcome.
 */
export class PackageRegistryResolver {
  private readonly http: HttpClient;
  private readonly memo = new Map<string, RepositoryRef | null>();
  private lookups = 0;

  constructor(http: HttpClient) {
    this.http = http;
  }

  get lookupCount(): number {
    return this.lookups;
  }

  async resolve(target: PackageTarget): Promise<RepositoryRef | null> {
    if (this.lookups >= LIMITS.registry.maxLookups) return null;
    const key = `${target.ecosystem}/${target.name}`;
    if (this.memo.has(key)) return this.memo.get(key) ?? null;
    this.lookups += 1;
    const resolved = await this.resolveUncached(target);
    this.memo.set(key, resolved);
    return resolved;
  }

  private async resolveUncached(target: PackageTarget): Promise<RepositoryRef | null> {
    try {
      if (target.ecosystem === 'npm') {
        const name = target.name;
        const url = new URL(`https://registry.npmjs.org/${name.split('/').map(encodeURIComponent).join('/')}/latest`);
        const payload = await this.http.fetchJson<{ repository?: { url?: string }; homepage?: string }>(url);
        return firstRepository(payload?.repository?.url, payload?.homepage);
      }
      if (target.ecosystem === 'pypi') {
        const url = new URL(`https://pypi.org/pypi/${encodeURIComponent(target.name)}/json`);
        const payload = await this.http.fetchJson<{ info?: { project_urls?: Record<string, string> | null; home_page?: string | null } }>(url);
        const urls = payload?.info?.project_urls ?? {};
        const ordered = ['Source', 'Source Code', 'Repository', 'Homepage', 'Code'];
        for (const key of ordered) {
          const value = urls[key];
          const resolved = value ? firstRepository(value) : null;
          if (resolved) return resolved;
        }
        return firstRepository(payload?.info?.home_page ?? undefined);
      }
    } catch {
      return null;
    }
    return null;
  }
}

function firstRepository(...candidates: readonly (string | undefined)[]): RepositoryRef | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    for (const line of candidate.split(/[\n\s]+/)) {
      const value = line.replace(/[),.;]+$/, '');
      if (!/github\.com|git@github/i.test(value)) continue;
      try {
        const ref = resolveRepositoryRef(value);
        if (ref) return ref;
      } catch {
        continue;
      }
    }
  }
  return null;
}
