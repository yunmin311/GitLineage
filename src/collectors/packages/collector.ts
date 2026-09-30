import type { EntityRef, JsonValue, Observation } from '../../core/model.ts';
import { resolveRepositoryRef, type RepositoryRef } from '../../platform/url.ts';
import { LIMITS } from '../../platform/limits.ts';
import { dedupeFacts, parseManifestFile, type DependencyFact, type Ecosystem } from './manifests.ts';

export const COLLECTOR_PACKAGES = 'packages';
export const EXTRACTOR_MANIFEST = 'manifest-dependency@1';
export const EXTRACTOR_LOCKFILE = 'lockfile-dependency@1';

export interface ManifestFile {
  path: string;
  text: string;
}

export interface PackageCollectorResult {
  observations: Observation[];
  candidates: RepositoryRef[];
  diagnostics: { code: string; message: string; context?: Record<string, JsonValue> }[];
  facts: DependencyFact[];
}

/**
 * Go module paths are repository paths. A `require github.com/x/y v1.2.3`
 * statement is a declaration about a repository, not only about a package, so
 * the edge is emitted directly against the Repository entity.
 */
function goModuleToRepository(name: string): RepositoryRef | null {
  try {
    return resolveRepositoryRef(name);
  } catch {
    return null;
  }
}

function objectRefFor(fact: DependencyFact): EntityRef {
  if (fact.ecosystem === 'go') {
    const repository = goModuleToRepository(fact.name);
    if (repository) {
      return { kind: 'repository', provider: 'github', owner: repository.owner, name: repository.name };
    }
  }
  return { kind: 'package', ecosystem: fact.ecosystem, name: fact.name };
}

export function collectPackageDependencies(input: {
  root: RepositoryRef;
  commit: string;
  manifests: readonly ManifestFile[];
  factLimit?: number;
}): PackageCollectorResult {
  const observations: Observation[] = [];
  const candidates: RepositoryRef[] = [];
  const diagnostics: PackageCollectorResult['diagnostics'] = [];
  const facts: DependencyFact[] = [];
  const rootRef: RepositoryRef = input.root;
  const limit = input.factLimit ?? LIMITS.manifest.maxDependencies;

  for (const manifest of input.manifests) {
    if (Buffer.byteLength(manifest.text, 'utf8') > LIMITS.manifest.maxBytes) {
      diagnostics.push({
        code: 'manifest_too_large',
        message: `manifest ${manifest.path} exceeds ${LIMITS.manifest.maxBytes} bytes and was skipped`,
        context: { path: manifest.path },
      });
      continue;
    }
    const parsed = parseManifestFile(manifest.path, manifest.text);
    if (!parsed) continue;
    for (const error of parsed.errors) {
      diagnostics.push({ code: 'manifest_parse_failed', message: error, context: { path: manifest.path } });
    }
    facts.push(...parsed.facts);
  }

  const deduped = dedupeFacts(facts).slice(0, limit);
  if (deduped.length < facts.length) {
    diagnostics.push({
      code: 'dependency_limit_applied',
      message: `dependency facts were truncated to ${deduped.length} entries`,
      context: { dropped: facts.length - deduped.length },
    });
  }

  const manifestUrl = (path: string): string =>
    `https://github.com/${rootRef.owner}/${rootRef.name}/blob/${input.commit}/${path
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;

  for (const fact of deduped) {
    const object = objectRefFor(fact);
    if (fact.sourceUrlHint) {
      const hinted = safeResolve(fact.sourceUrlHint);
      if (hinted) candidates.push(hinted);
    }

    if (fact.source === 'lockfile') {
      observations.push({
        collector: COLLECTOR_PACKAGES,
        extractor: EXTRACTOR_LOCKFILE,
        subject: { kind: 'repository', provider: 'github', owner: rootRef.owner, name: rootRef.name },
        object,
        relationship: 'depends_on',
        directed: true,
        evidence: {
          type: 'package_lockfile',
          status: 'DECLARED',
          repository: { kind: 'repository', provider: 'github', owner: rootRef.owner, name: rootRef.name },
          sourceUrl: manifestUrl(fact.manifestPath),
          locator: { path: fact.manifestPath, field: fact.name },
          observedText: `${fact.name}@${fact.resolvedVersion ?? fact.range}`,
          data: {
            ecosystem: fact.ecosystem,
            package_name: fact.name,
            resolved_version: fact.resolvedVersion ?? fact.range,
            manifest_path: fact.manifestPath,
            scope: fact.scope,
            ...(fact.integrity ? { integrity: fact.integrity } : {}),
          },
        },
      });
      continue;
    }

    observations.push({
      collector: COLLECTOR_PACKAGES,
      extractor: EXTRACTOR_MANIFEST,
      subject: { kind: 'repository', provider: 'github', owner: rootRef.owner, name: rootRef.name },
      object,
      relationship: 'depends_on',
      directed: true,
      evidence: {
        type: 'package_manifest',
        status: 'DECLARED',
        repository: { kind: 'repository', provider: 'github', owner: rootRef.owner, name: rootRef.name },
        sourceUrl: manifestUrl(fact.manifestPath),
        locator: { path: fact.manifestPath, field: fact.name, spec: fact.ecosystem },
        observedText: `"${fact.name}": "${fact.range}"`,
        data: {
          ecosystem: fact.ecosystem,
          package_name: fact.name,
          range: fact.range,
          manifest_path: fact.manifestPath,
          scope: fact.scope,
          ...(fact.sourceUrlHint ? { spec_source_url: fact.sourceUrlHint } : {}),
        },
      },
    });
  }

  return { observations, candidates, diagnostics, facts: deduped };
}

function safeResolve(text: string): RepositoryRef | null {
  try {
    return resolveRepositoryRef(text);
  } catch {
    return null;
  }
}
