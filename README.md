# GitLineage

Evidence-backed repository lineage and software provenance explorer.

GitLineage answers one question with a machine-checkable answer:

> Where did this repository come from, what is it structurally connected to,
> and what evidence supports each claim?

It is not a plagiarism detector, not a code clone detector, and not a
dependency graph viewer. It converts scattered public provenance signals into
one canonical, auditable **Repository Lineage Graph**.

```
GitHub Repository
      ↓
  Collectors            (raw observations only)
      ↓
  Relationship Resolver (policy gate: evidence strength cannot be upgraded)
      ↓
  Canonical Lineage Graph (graph.json)
```

## Principles

| Principle | How it is enforced in this repository |
| --- | --- |
| No AI dependency | The analyzer contains no model provider, no inference call, and no network dependency other than deterministic HTTP and `git`. |
| Evidence before inference | A relationship without an evidence record cannot exist: `validateGraph` rejects it, and the JSON schema requires `minItems: 1` on `evidenceIds`. |
| Similarity is not provenance | `similar_to` can only be `DETECTED` and only from `token_fingerprint` evidence. A detector cannot emit `derived_from`; the resolver drops the proposal with a diagnostic. |
| Never execute repository code | The only spawned process is `git`, from a fixed subcommand allowlist, with a scrubbed environment, no shell, and no lifecycle hooks. No package manager is ever run. |
| Repository as untrusted data | Every file, tree entry, document, manifest and gitmodules entry passes a size cap, a path check and a parser guard. |
| Explicit relationship semantics | Each relationship type declares the evidence types and statuses it may ever carry. See `docs/relationship-ontology.md`. |
| Evidence is first-class data | Evidence records live in `graph.json` with locator, observed text, source URL, collector and extractor. |
| Repository-level graph first | Entities are repositories and packages by default; source artifacts only appear when a relationship needs them. |
| High precision before high recall | Weak signals are capped and reported instead of being expanded. Missing a weak edge is preferred over inventing a provenance claim. |

## Quick start

Requires Node.js >= 22.18 (developed and verified on Node 24) and `git`.

```bash
npm install
npm run check          # typecheck + unit, contract and regression tests

# Analyse a repository and write the machine-readable artifacts
node src/cli/main.ts analyze sindresorhus/is --out artifacts/is

# Inspect any relationship together with its evidence
node src/cli/main.ts inspect artifacts/is/graph.json forked_from

# Validate an artifact against the contract
node src/cli/main.ts validate artifacts/is/graph.json

# Print the enforced ontology
node src/cli/main.ts ontology

# Live integration validation against real public repositories
npm run test:live
```

`analyze` accepts `owner/name`, `github.com/owner/name`, a full URL, a
`tree`/`blob` URL, or an `ssh`/`git+https` remote. Anything that is not a
GitHub repository is rejected before a request is made.

Useful flags: `--ref <branch|tag|sha>`, `--depth <n>`, `--max-candidates <n>`,
`--no-git`, `--no-blobs`, `--no-registry`, `--blobs all`, `--json`.

## What V1 detects

| Relationship | Status | Primary evidence |
| --- | --- | --- |
| `forked_from` | `VERIFIED` from platform metadata, `DECLARED` from a README | `github_fork_metadata`, `document_attribution` |
| `derived_from` | `VERIFIED` only, and only with history containment plus temporal ordering | `git_history_containment` |
| `shares_history_with` | `VERIFIED` from identical Git commit objects | `git_shared_commits` |
| `uses_submodule` | `VERIFIED` with the pinned commit from the tree gitlink | `git_submodule_entry` |
| `contains_exact_content_from` | `VERIFIED` from identical Git blob ids | `git_blob_identity` |
| `depends_on` | `DECLARED` only, never an ancestry claim | `package_manifest`, `package_lockfile` |
| `declared_inspiration` | `DECLARED` only | `document_attribution` |
| `references` | `DECLARED` | `document_reference`, `package_registry_metadata` |
| `similar_to` | `DETECTED` only, undirected. Reserved: no detector ships in V1 | `token_fingerprint` |
| `evolved_into` | Reserved: part of the ontology, not emitted in V1 | — |

Ecosystems parsed in V1: npm (`package.json`, `package-lock.json`), Python
(`pyproject.toml`, `requirements*.txt`), Rust (`Cargo.toml`), Go (`go.mod`).
Package registries consulted for source repositories: npm, PyPI.

## Documentation

| Document | Contents |
| --- | --- |
| `docs/architecture.md` | Data flow, module boundaries, collector/resolver contract, caching, cost model. |
| `docs/evidence-model.md` | `Entity`, `Relationship`, `Evidence`, the status policy and the two admission guards. |
| `docs/relationship-ontology.md` | Every relationship type with its evidence, statuses, direction and non-goals. |
| `docs/security.md` | Threat model, SSRF defence, resource limits, "never execute" enforcement, cache namespace isolation. |
| `docs/project-state.md` | Confirmed decisions, open proposals, deprecated options. |
| `docs/integration-validation.md` | What was validated against real repositories, including negative cases. |
| `schemas/lineage-graph.schema.json` | Normative JSON Schema for `graph.json`. |

## Repository layout

```
src/
  core/         canonical model, ontology, policy gate, resolver, validator
  platform/     url/ssrf, http client, namespaced cache, bounded git, limits
  collectors/   github, git, submodules, packages, documents
  pipeline/     orchestration and artifact writing
  cli/          analyze / validate / inspect / ontology
test/           unit, contract, regression, schema, offline pipeline
test/live/      live integration suite (network, opt-in)
fixtures/       recorded expectations for real repositories
schemas/        JSON Schema for the artifact
docs/           project documentation
```

## Current status

Phase 1 (provenance core) is implemented end to end: URL in, validated
`graph.json` out, with every relationship backed by reviewable evidence. The
interactive explorer is not built yet; it should consume `graph.json` without
changing the contract. See `docs/project-state.md`.
