# Relationship ontology

Ten relationship types. Each one states what it means, what may support it, how
strong it may be reported, whether it has a direction, and what it explicitly
does not mean. The tables are enforced in code
(`src/core/ontology.ts`, `src/core/policy.ts`), not only documented.

| Type | Direction | Statuses | Evidence |
| --- | --- | --- | --- |
| `forked_from` | directed | `VERIFIED`, `DECLARED` | `github_fork_metadata`, `document_attribution` |
| `derived_from` | directed | `VERIFIED`, `DECLARED` | `git_history_containment`, `document_attribution` |
| `shares_history_with` | undirected | `VERIFIED`, `DECLARED` | `git_shared_commits`, `document_attribution` |
| `depends_on` | directed | `DECLARED` | `package_manifest`, `package_lockfile` |
| `uses_submodule` | directed | `VERIFIED`, `DECLARED` | `git_submodule_entry`, `document_attribution` |
| `declared_inspiration` | directed | `DECLARED` | `document_attribution` |
| `references` | directed | `DECLARED`, `DETECTED` | `document_reference`, `document_attribution`, `package_registry_metadata` |
| `contains_exact_content_from` | directed | `VERIFIED` | `git_blob_identity` |
| `similar_to` | undirected | `DETECTED` | `token_fingerprint` |
| `evolved_into` | directed | `VERIFIED` | `git_history_containment`, `github_fork_metadata` |

`gitlineage ontology` prints this table as JSON from the code itself.

## `forked_from`

Explicit fork ancestry. `VERIFIED` only when the platform records
`fork.parent`, in which case the evidence names the parent full name, the parent
URL and the fork root. `DECLARED` when a document states it.

A missing `forked_from` proves nothing. A repository can be a historical fork
whose platform association was removed, and a platform fork record says nothing
about Git ancestry. Both situations are covered by the Git-level types.

## `derived_from`

Historical derivation with a direction. The strongest non-platform claim in V1,
and the hardest to earn. From Git, it requires **all** of:

1. at least one identical commit object, proving a common ancestor;
2. the analysed repository's entire sampled commit window is contained in the
   candidate's window;
3. the candidate carries additional commits, so the containment has direction;
4. neither window is truncated, otherwise containment cannot be proven;
5. the candidate repository is older than the analysed one.

Any missing condition leaves the pair at `shares_history_with` and records
`containment_not_asserted`. A practical consequence: an unmodified fork has
identical windows, so no direction can be proven and no `derived_from` is
emitted. Silence here is the correct answer, not a missing feature.

From a document, it stays `DECLARED`: "Port of X" is a claim by the author, not
a verified history.

`derived_from` does not mean `copied_from`, and never assigns responsibility.

## `shares_history_with`

At least one identical Git commit object. Symmetric, therefore undirected.
Commit identity is a content hash over the commit content, author, committer
and parents, so this is a cryptographic fact rather than a heuristic.

This is the type that finds relationships the platform does not record.

## `depends_on`

A package dependency declared by a manifest or lockfile, always `DECLARED`, never
`VERIFIED`. The analyzer reads files; it never installs anything, so it cannot
know what is actually built or run.

Only registry-style specs become dependencies. `file:`, `link:`, `workspace:`,
`git+https:` and relative specs are skipped, and a `git` spec is recorded inside
the evidence and used as a candidate source, not as a dependency edge.

Go module paths are repository paths. `require github.com/x/y v1.2.3` therefore
produces `depends_on` directly against a `Repository` entity, which is both
correct and more useful than a synthetic package node.

Dependency is not ancestry. Using a library does not make it an ancestor.

## `uses_submodule`

A submodule entry in `.gitmodules`, resolved against the tree's gitlink entry so
the pinned commit is authoritative rather than a branch name. Unsupported
remotes are reported (`submodule_unsupported_remote`) and skipped, never guessed.

## `declared_inspiration`

The author explicitly said the project was inspired by or based on another
project. `DECLARED` only, and only when a resolvable GitHub repository URL
appears in the same line or within a two-line forward window, with a blank line
ending the declaration. Phrases inside fenced or indented code are ignored, so
an example shell command is never read as a declaration.

Phrase mapping:

| Phrase | Relationship |
| --- | --- |
| `inspired by`, `based on`, `originally based on` | `declared_inspiration` |
| `derived from`, `adapted from`, `port of` | `derived_from` (`DECLARED`) |
| `fork of` | `forked_from` (`DECLARED`) |
| `thanks to` | `references` |

`thanks to` maps to `references` on purpose: an acknowledgement is a link, not a
claim of derivation. Treating it as inspiration would be exactly the kind of
over-reading the product exists to avoid.

## `references`

An explicit link. The weakest documented relationship, and the only one a bare
URL may produce. Capped at 40 per analysis so a README link list cannot bury the
lineage edges; the cap is reported rather than silently applied.

A repository URL that names a user or organisation rather than a repository is
not a relationship, and produces no entity.

## `contains_exact_content_from`

Identical Git blob ids. Byte-identical content, independent of file name,
directory and repository. `VERIFIED`, directed so that the evidence can name
`source_path` and `target_path`.

There is no threshold and no similarity score: content is either identical or
the relationship does not exist. Empty blobs are excluded from the index, and
the number of evidence records per relationship is capped with
`attributes.matched_blob_count` carrying the true total.

Identical content is a fact about content, not about copying direction or
authorship. V1 makes no claim about how the shared content came to be in both
repositories.

## `similar_to`

A deterministic algorithm found source similarity. Undirected, `DETECTED` only,
and it may never be rendered or read as provenance. V1 ships no detector; the
type, the evidence type and the policy exist so that a future clone detector
cannot accidentally become a provenance claim.

The product rule is a fixed part of the semantics, not decoration:

> Similarity does not establish provenance or direction of copying.

## `evolved_into`

Reserved for a later repository or release state in the same lineage. It is part
of the ontology and enforced by the policy, but V1 emits nothing for it, because
no extractor produces sufficient evidence yet.

## Not in the ontology

`copied_from`, `plagiarized_from`, `stolen_from`, `inferred`, `depends_on_repository`,
`contains_code_from`. The first three are accusations the analyzer has no standing
to make; the rest are redundant or ambiguous with existing types. Their absence is
enforced by the JSON Schema, which rejects them.
