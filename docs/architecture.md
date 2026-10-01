# Architecture

## Data flow

```
GitHub REST API + bounded git fetch + registries
                    ↓
              collectors            src/collectors/**
              (raw observations only: no graph, no layout, no UI)
                    ↓
        Observation[] + EntityDraft[]
                    ↓
              policy gate           src/core/policy.ts
        (evidence type x status x relationship admissibility)
                    ↓
              resolver              src/core/resolver.ts
        (merge evidence, materialise entities, order output)
                    ↓
         Canonical Lineage Graph   src/core/model.ts
                    ↓
        validateGraph + JSON Schema  src/core/validate.ts, schemas/
                    ↓
        graph.json + analysis-metadata.json
                    ↓
              renderer (future)
```

Data discovery and product presentation stay separated. A new collector, a new
forge or a new ecosystem parser must not require any change outside
`src/collectors/**` and, at most, the ontology tables in `src/core/ontology.ts`.

## Module boundaries

| Module | Responsibility | Must not |
| --- | --- | --- |
| `core/model.ts` | The three object kinds and their serialized shape. | Contain logic. |
| `core/ontology.ts` | Relationship specs, evidence specs, status strength. | Import collectors. |
| `core/policy.ts` | Admission gate and status collapse. | Know about HTTP or git. |
| `core/resolver.ts` | Merge, materialise, order, cap. | Fetch anything. |
| `core/validate.ts` | Contract validation of a produced or hand-written graph. | Repair a graph. |
| `platform/*` | SSRF-guarded input resolution, bounded HTTP, namespaced cache, bounded git. | Emit relationships. |
| `collectors/*` | Observe one signal, emit `Observation[]`. | Merge evidence, choose a status, touch the graph. |
| `pipeline/analyze.ts` | Order of operations, candidate budget, artifact writing. | Interpret evidence strength. |

A collector proposes; the resolver disposes. Every rejection is written to
`graph.diagnostics` with a stable code, so a missing relationship is always
explainable.

## Collector interface

Collectors are plain functions returning:

```ts
interface Observation {
  collector: string;          // which collector
  extractor: string;          // rule + version, e.g. explicit-attribution@1
  subject: EntityRef;
  object: EntityRef;
  relationship: RelationshipType;  // proposal, validated by the policy gate
  directed: boolean;
  evidence: EvidenceDraft;          // the observation itself
  relationshipAttributes?: Record<string, JsonValue>;  // aggregates
}
```

Collectors emit one observation per piece of evidence. Several observations
that describe the same relationship are merged by the resolver into a single
edge with several evidence records, which is why adding a second signal to a
relationship increases explainability instead of adding visual noise.

## Repository access strategy

Access is layered so that expensive work is never on the default path.

| Layer | Cost | Used for |
| --- | --- | --- |
| A. Remote metadata | 1-2 API calls | repository identity, fork metadata, file tree, manifests, documents |
| B. Bounded git | shallow fetch, blob-filtered | shared commit windows, `.gitmodules` parsing via `git config` |
| C. Extended analysis | none in V1 | clone detection, similarity |

Blob identity is obtained from the GitHub tree API rather than from a clone, so
`shares_exact_content_with` costs one API call per candidate.

Every git fetch is bounded: `--depth`, `--no-tags`, `--filter=blob:none`,
`--no-recurse-submodules`, a 120 s timeout, a 256 MiB post-fetch size check that
deletes the repository and fails loudly rather than filling a disk, and an
argument allowlist that forbids `--upload-pack`, `--exec`, `--global`,
`--system` and any `-c` override.

## Candidate expansion

Candidates come only from deterministic signals, never from a global search:

1. GitHub fork parent and fork source.
2. `.gitmodules` remotes.
3. Repository URLs inside attribution documents.
4. Manifest dependencies that name a git remote.
5. Package registry source repositories.
6. Go module paths, which are repository paths.

Candidates are capped (`LIMITS.candidates.maxRepositories`, 12 by default) and
processed in codepoint order, so a large graph degrades predictably instead of
randomly. Blob comparison runs only against candidates that already have a
lineage relationship (`forked_from`, `derived_from`, `shares_history_with`,
`uses_submodule`); `--blobs all` widens this.

## Cost and caching

| Artefact | Purpose |
| --- | --- |
| `<cache>/public/http/<hash>.json` + `.bin` | Conditional-request cache: ETag and `Last-Modified` revalidation, so an unchanged repository costs one conditional request per endpoint. |
| `<cache>/public/git/<owner>/<name>.git` | Bare repositories holding only a bounded slice of history. |
| `graph.json` | The canonical graph. |
| `analysis-metadata.json` | Revision, timestamps, analyzer version, enabled extractors and adapters, applied limits, counts by relationship type and status, diagnostic counts. |

The cache key for a graph artifact is repository identity plus resolved revision
plus graph schema version. When the default branch head moves, a new artifact is
produced. A private namespace is physically separate (`<cache>/<namespace>/...`)
and V1 refuses it outright rather than risking a private artifact in public
storage.

## Determinism

Given the same repository revision, two runs produce byte-identical graphs apart
from observation timestamps. This is enforced by:

- codepoint ordering everywhere (never `localeCompare`, which is locale dependent);
- content-derived entity, relationship and evidence ids (`rel_<sha256-16>`, `ev_<sha256-16>`);
- sorted output arrays;
- no clock, locale or random input inside the graph.

The live suite asserts this property.
