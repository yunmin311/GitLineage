import { createHash } from 'node:crypto';
import type { EntityId, EntityRef, EntityRefRepository, JsonValue } from './model.ts';
import { LIMITS } from '../platform/limits.ts';

const REPO_COMPONENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const SHA = /^[0-9a-f]{7,64}$/;

export class InvalidEntityRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidEntityRefError';
  }
}

function stableHash(input: string, length = 16): string {
  return createHash('sha256').update(input).digest('hex').slice(0, length);
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k] as JsonValue)}`).join(',')}}`;
}

export function digestOf(value: JsonValue, length = 16): string {
  return stableHash(canonicalJson(value), length);
}

export function normalizeRepositoryRef(ref: EntityRefRepository): EntityRefRepository {
  const owner = ref.owner.trim();
  const name = ref.name.trim();
  assertRepositoryComponent(owner, 'owner', LIMITS.repository.maxOwnerLength);
  assertRepositoryComponent(name, 'name', LIMITS.repository.maxNameLength);
  return { kind: 'repository', provider: 'github', owner: owner.toLowerCase(), name: name.toLowerCase() };
}

export function assertRepositoryComponent(value: string, label: string, maxLength: number): void {
  if (value.length === 0) throw new InvalidEntityRefError(`repository ${label} must not be empty`);
  if (value.length > maxLength) throw new InvalidEntityRefError(`repository ${label} exceeds ${maxLength} characters`);
  if (value.includes('..')) throw new InvalidEntityRefError(`repository ${label} must not contain ".."`);
  if (!REPO_COMPONENT.test(value)) {
    throw new InvalidEntityRefError(`repository ${label} contains unsupported characters: ${value}`);
  }
}

export function repositoryFullName(ref: EntityRefRepository): string {
  return `${ref.owner}/${ref.name}`;
}

export function repositoryUrl(ref: EntityRefRepository): string {
  return `https://github.com/${repositoryFullName(ref)}`;
}

/** PyPI and npm both treat `.`, `_` and `-` as equivalent separators in names. */
function normalizePackageName(ecosystem: string, name: string): string {
  const lower = name.trim().toLowerCase();
  return ecosystem === 'pypi' || ecosystem === 'npm' ? lower.replace(/[-_.]+/g, '-') : lower;
}

export function refToId(ref: EntityRef): EntityId {
  switch (ref.kind) {
    case 'repository': {
      const repo = normalizeRepositoryRef(ref);
      return `repo:${repo.provider}:${repositoryFullName(repo)}`;
    }
    case 'package': {
      const ecosystem = ref.ecosystem.trim().toLowerCase();
      const name = normalizePackageName(ecosystem, ref.name);
      if (name.length === 0) throw new InvalidEntityRefError('package name must not be empty');
      return `pkg:${ecosystem}:${name}`;
    }
    case 'commit': {
      const sha = ref.sha.trim().toLowerCase();
      if (!SHA.test(sha)) throw new InvalidEntityRefError(`invalid commit sha: ${ref.sha}`);
      return `commit:${sha}`;
    }
    case 'release': {
      const repo = normalizeRepositoryRef(ref.repository);
      return `release:${repo.provider}:${repositoryFullName(repo)}@${ref.tag}`;
    }
    case 'source_artifact': {
      const repo = normalizeRepositoryRef(ref.repository);
      const blob = ref.blob.trim().toLowerCase();
      if (!SHA.test(blob)) throw new InvalidEntityRefError(`invalid blob id: ${ref.blob}`);
      return `artifact:${repo.provider}:${repositoryFullName(repo)}:${blob}`;
    }
    case 'external_project': {
      const slug = ref.slug.trim().toLowerCase();
      if (slug.length === 0) throw new InvalidEntityRefError('external project slug must not be empty');
      return `project:${slug}`;
    }
    default: {
      const exhaustive: never = ref;
      throw new InvalidEntityRefError(`unsupported entity ref: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function refToEntityType(ref: EntityRef): 'Repository' | 'Package' | 'Commit' | 'Release' | 'SourceArtifact' | 'ExternalProject' {
  switch (ref.kind) {
    case 'repository':
      return 'Repository';
    case 'package':
      return 'Package';
    case 'commit':
      return 'Commit';
    case 'release':
      return 'Release';
    case 'source_artifact':
      return 'SourceArtifact';
    case 'external_project':
      return 'ExternalProject';
    default: {
      const exhaustive: never = ref;
      throw new InvalidEntityRefError(`unsupported entity ref: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function refToDisplayName(ref: EntityRef): { name: string; fullName?: string } {
  switch (ref.kind) {
    case 'repository': {
      const repo = normalizeRepositoryRef(ref);
      return { name: repo.name, fullName: repositoryFullName(repo) };
    }
    case 'package':
      return { name: ref.name, fullName: `${ref.ecosystem}:${ref.name}` };
    case 'commit':
      return { name: ref.sha.slice(0, 12) };
    case 'release':
      return { name: ref.tag, fullName: `${repositoryFullName(normalizeRepositoryRef(ref.repository))}@${ref.tag}` };
    case 'source_artifact':
      return { name: ref.path, fullName: ref.blob.slice(0, 12) };
    case 'external_project':
      return { name: ref.slug };
    default: {
      const exhaustive: never = ref;
      throw new InvalidEntityRefError(`unsupported entity ref: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export function relationshipKey(type: string, source: EntityId, target: EntityId, directed: boolean): string {
  return directed ? `${type}|${source}|${target}` : [type, source, target].sort().join('|');
}

export function relationshipId(type: string, source: EntityId, target: EntityId, directed: boolean): string {
  return `rel_${stableHash(relationshipKey(type, source, target, directed))}`;
}

export function evidenceId(parts: {
  type: string;
  status: string;
  collector: string;
  extractor: string;
  repository?: string;
  sourceUrl?: string;
  locator?: JsonValue;
  observedText?: string;
  data: Record<string, JsonValue>;
}): string {
  return `ev_${stableHash(
    canonicalJson({
      type: parts.type,
      status: parts.status,
      collector: parts.collector,
      extractor: parts.extractor,
      repository: parts.repository ?? null,
      sourceUrl: parts.sourceUrl ?? null,
      locator: parts.locator ?? null,
      observedText: parts.observedText ?? null,
      data: parts.data,
    }),
  )}`;
}
