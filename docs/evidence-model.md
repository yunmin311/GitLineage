# Evidence model

Three object kinds, kept separate and never merged:

```
Entity       a node
Relationship a typed edge between two entities
Evidence     the reviewable observation that supports an edge
```

Evidence is data, not prose. It is stored in `graph.json`, consumed by the
validator, and must survive any future exporter or renderer.

## Entity

```json
{
  "id": "repo:github:octocat/hello-world",
  "type": "Repository",
  "display": { "name": "hello-world", "fullName": "octocat/hello-world", "url": "https://github.com/octocat/hello-world" },
  "attributes": { "default_branch": "main", "created_at": "2011-01-26T19:01:12Z", "is_fork": false },
  "sourceUrl": "https://github.com/octocat/hello-world"
}
```

Types: `Repository`, `Package`, `Commit`, `Release`, `SourceArtifact`,
`ExternalProject`. V1 materialises `Repository` and `Package`; the others exist
in the contract because later phases need them, and emitting a type before it
has an extractor would be dishonest.

Identifiers are content-derived and stable:

| Kind | Identifier | Notes |
| --- | --- | --- |
| Repository | `repo:github:<owner>/<name>` | lowercased, so casing never splits an entity |
| Package | `pkg:<ecosystem>:<name>` | npm/PyPI separators `-`, `_`, `.` are normalised |
| Commit | `commit:<sha>` | |
| SourceArtifact | `artifact:github:<owner>/<name>:<blob>` | blobs are content addressed, so one artifact per content |
| ExternalProject | `project:<slug>` | reserved |

## Relationship

```json
{
  "id": "rel_9f2c1d0b4a7e5c31",
  "type": "contains_exact_content_from",
  "source": "repo:github:owner/fork",
  "target": "repo:github:owner/upstream",
  "directed": true,
  "status": "VERIFIED",
  "evidenceIds": ["ev_1a2b3c4d5e6f7a8b"],
  "attributes": { "matched_blob_count": 19, "evidence_truncated": false }
}
```

Direction is a property of the relationship type, not of the collector. A
collector that proposes `similar_to` as directed, or `shares_history_with` as
directed, is rejected with `direction_mismatch`.

`attributes` carry facts that belong to the relationship rather than to a single
evidence record: aggregate counts, truncation flags, the submodule path, the
pinned commit. They are merged from every observation of that relationship.

## Evidence

```json
{
  "id": "ev_1a2b3c4d5e6f7a8b",
  "type": "git_blob_identity",
  "status": "VERIFIED",
  "collector": "git-blob-analyzer",
  "extractor": "git-blob-identity@1",
  "repository": "repo:github:owner/fork",
  "sourceUrl": "https://github.com/owner/fork/blob/<commit>/src/parser.ts",
  "locator": { "path": "src/parser.ts", "lineStart": 41, "lineEnd": 42, "field": "<blob sha>" },
  "observedText": "identical git blob 0a1b2c3d",
  "data": {
    "source_blob": "0a1b2c3d",
    "target_blob": "0a1b2c3d",
    "source_path": "src/parser.ts",
    "target_path": "lib/parser.ts",
    "source_commit": "<commit>",
    "target_commit": "<commit>"
  },
  "observedAt": "2026-09-30T04:14:22.440Z"
}
```

Every evidence type declares required data keys (`EVIDENCE_REQUIRED_DATA_KEYS`).
An observation missing one of them is dropped with `evidence_data_incomplete`,
because an evidence record a reviewer cannot check is not evidence.

## Status

| Status | Meaning | Produced by |
| --- | --- | --- |
| `VERIFIED` | Machine-checkable fact read from Git or the platform, with no reliance on an author's claim | fork metadata, identical commit objects, identical blob ids, gitmodules entries with a tree-verified pin |
| `DECLARED` | A statement made by the repository or its author | manifests, lockfiles, README attribution, registry metadata |
| `DETECTED` | A deterministic algorithm found a pattern that does not establish provenance | token fingerprints |

V1 has no `INFERRED`. There is no generic catch-all status, because a catch-all
is where clues turn into facts. If inference is ever added it must be a separate
status that cannot be rendered like a verified relationship.

## Two independent guards

A collector cannot simply claim a status. Two tables must both admit it.

**Guard 1 — evidence type to relationship type.** Which evidence may support
which relationship:

| Evidence type | May support |
| --- | --- |
| `git_shared_commits` | `shares_history_with` |
| `git_history_containment` | `derived_from`, `evolved_into` |
| `git_blob_identity` | `contains_exact_content_from` |
| `token_fingerprint` | `similar_to` |
| `package_manifest`, `package_lockfile` | `depends_on` |
| `git_submodule_entry` | `uses_submodule` |
| `document_attribution` | `declared_inspiration`, `derived_from`, `forked_from`, `shares_history_with`, `uses_submodule` |
| `document_reference` | `references` |
| `package_registry_metadata` | `references` |
| `github_fork_metadata`, `github_repository_identity` | `forked_from` |

**Guard 2 — status to relationship type.** Which status a relationship may have,
and independently which status an evidence type may carry:

| Relationship | Allowed statuses | Allowed evidence statuses |
| --- | --- | --- |
| `forked_from` | `VERIFIED`, `DECLARED` | `github_fork_metadata: VERIFIED`, `document_attribution: DECLARED` |
| `derived_from` | `VERIFIED`, `DECLARED` | `git_history_containment: VERIFIED`, `document_attribution: DECLARED` |
| `shares_history_with` | `VERIFIED`, `DECLARED` | `git_shared_commits: VERIFIED`, `document_attribution: DECLARED` |
| `depends_on` | `DECLARED` only | `DECLARED` only |
| `uses_submodule` | `VERIFIED`, `DECLARED` | `VERIFIED`, `DECLARED` |
| `declared_inspiration` | `DECLARED` only | `DECLARED` only |
| `references` | `DECLARED`, `DETECTED` | `DECLARED` only |
| `contains_exact_content_from` | `VERIFIED` only | `VERIFIED` only |
| `similar_to` | `DETECTED` only | `DETECTED` only |
| `evolved_into` | `VERIFIED` only | `VERIFIED` only |

Consequences, all covered by regression tests:

- a README link cannot become `declared_inspiration`;
- a package dependency cannot become `derived_from`, and can never be `VERIFIED`;
- a similarity score cannot become `derived_from` or `copied_from`, and
  `copied_from` does not exist in the ontology at all;
- a document declaration can never be `VERIFIED`;
- a relationship can never be stronger than its own evidence.

## Status collapse

When several evidence records support one relationship, the relationship takes
the strongest status that is admissible for that relationship type. Weaker
records are still kept, so the edge stays fully reviewable. If no evidence
status is admissible, the relationship is dropped with
`no_admissible_evidence_status` rather than being downgraded into something it is
not.

## Diagnostics

Every dropped or degraded fact is recorded with a stable code, so "why is this
edge missing?" always has an answer:

`evidence_type_not_allowed`, `evidence_status_not_valid_for_type`,
`evidence_status_not_allowed`, `evidence_data_incomplete`, `direction_mismatch`,
`self_relationship`, `no_admissible_evidence_status`, `invalid_entity_ref`,
`relationship_without_evidence`, `graph_relationship_cap_applied`,
`containment_not_asserted`, `attribution_phrase_without_repository_url`,
`submodule_unsupported_remote`, `tree_truncated`, `candidate_limit_applied`,
`candidate_unavailable`, `dependency_limit_applied`, `manifest_parse_failed`,
`manifest_too_large`, `root_history_unavailable`,
`candidate_history_unavailable`, `exact_content_detected`,
`git_analysis_unavailable`.
