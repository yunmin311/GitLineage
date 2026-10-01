# Relationship ontology

Ten relationship types. Each one states what it means, what may support it, how
strong it may be reported, whether it has a direction, and what it explicitly
does not mean. The tables are enforced in code
(`src/core/ontology.ts`, `src/core/policy.ts`), not only documented.

| Type | Direction | Statuses | Evidence |
| --- | --- | --- | --- |
| `forked_from` | directional | `VERIFIED`, `DECLARED` | `github_fork_metadata`, `document_attribution` |
| `derived_from` | directional | `VERIFIED`, `DECLARED` | `git_history_containment`, `document_attribution` |
| `shares_history_with` | symmetric | `VERIFIED`, `DECLARED` | `git_shared_commits`, `document_attribution` |
| `depends_on` | directional | `DECLARED` | `package_manifest`, `package_lockfile` |
| `uses_submodule` | directional | `VERIFIED`, `DECLARED` | `git_submodule_entry`, `document_attribution` |
| `declared_inspiration` | directional | `DECLARED` | `document_attribution` |
| `references` | directional | `DECLARED`, `DETECTED` | `document_reference`, `document_attribution`, `package_registry_metadata` |
| `shares_exact_content_with` | symmetric | `VERIFIED` | `git_blob_identity` |
| `similar_to` | symmetric | `DETECTED` | `token_fingerprint` |
| `evolved_into` | directional | `VERIFIED` | `git_history_containment`, `github_fork_metadata` |

`gitlineage ontology` prints this table as JSON from the code itself.

## Direction is part of the contract

Direction is declared by the ontology, not by a collector and not by whichever
endpoint happened to be observed first. Three consequences, all enforced:

1. **A renderer must read `directed` from the relationship, never infer it from
   the focused node.** `DIRECTIONAL_RELATIONSHIPS` and `SYMMETRIC_RELATIONSHIPS`
   are exported for exactly this purpose, and every relationship in `graph.json`
   carries the resolved boolean.
2. **A collector cannot mislabel direction.** The resolver reads direction from
   the ontology and overwrites whatever the observation claimed. An observation
   that contradicts the contract is rejected with `direction_mismatch` rather
   than silently corrected.
3. **Symmetric pairs are stored once.** `canonicalEndpoints` normalises the two
   endpoints into a stable order, so observing a pair from both sides merges
   into one edge instead of two mirrored ones. `validateGraph` rejects a graph
   that contains both orientations.

| Direction | Relationship types |
| --- | --- |
| Directional | `forked_from`, `derived_from`, `depends_on`, `uses_submodule`, `declared_inspiration`, `references`, `evolved_into` |
| Symmetric | `shares_history_with`, `shares_exact_content_with`, `similar_to` |

The rule behind the split: a relationship is directional only when the evidence
establishes an order. Shared history, identical content and similarity establish
membership, not origin, so all three are symmetric.

Direction in the eventual renderer must come from this contract, not from the
currently focused subject.

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

At least one identical Git commit object. Symmetric. Commit identity is a content
hash over the commit content, author, committer and parents, so this is a
cryptographic fact rather than a heuristic.

Symmetric because a shared ancestor establishes common history, not an order.
Which repository was created first is a separate question, answered by
`derived_from` only when containment and creation dates both support it.

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

## `shares_exact_content_with`

Identical Git blob ids. Byte-identical content, independent of file name,
directory and repository. `VERIFIED` and **symmetric**.

The symmetry is the whole point of the name. Identical content is a fact about
two sets of bytes. It does not establish that one repository contains something
*from* the other, because there is no evidence for which side came first, and
"contains content from" is a provenance claim that content identity cannot
support. The evidence therefore names its two sides `first_path` and
`second_path` rather than `source_path` and `target_path`; `first` only means
the repository under analysis, never an origin.

Renamed from `contains_exact_content_from` during the V1 direction audit. The old
name asserted a direction that the evidence did not support, and a renderer that
drew an arrow from it would have shown a provenance claim the analyzer never
made. The rename changes core semantics, not just a display label: the type,
the `directed` flag, the endpoint canonicalisation and the evidence field names
all changed together.

There is no threshold and no similarity score: content is either identical or
the relationship does not exist. Empty blobs are excluded from the index, and
the number of evidence records per relationship is capped with
`attributes.matched_blob_count` carrying the true total.

Identical content is a fact about content, not about copying direction or
authorship. V1 makes no claim about how the shared content came to be in both
repositories.

## `similar_to`

A deterministic algorithm found source similarity. Symmetric, `DETECTED` only,
and it may never be rendered or read as provenance. V1 ships no detector; the
type, the evidence type and the policy exist so that a future clone detector
cannot accidentally become a provenance claim.

The product rule is a fixed part of the semantics, not decoration:

> Similarity does not establish provenance or direction of copying.

## `evolved_into`

Reserved for a later repository or release state in the same lineage. It is part
of the ontology and enforced by the policy, but V1 emits nothing for it, because
no extractor produces sufficient evidence yet.

## Contract for the Web API and renderer

The upcoming Web layer must consume this contract rather than re-deriving it.

```ts
import {
  DIRECTIONAL_RELATIONSHIPS, // forked_from, derived_from, depends_on, uses_submodule,
  SYMMETRIC_RELATIONSHIPS,   // declared_inspiration, references, evolved_into
  relationshipSpec,
  isDirectional,
  isSymmetric,
  canonicalEndpoints,
} from './core/ontology.ts';
```

Rules for the API and the UI:

1. Serve `directed` on every relationship, or expose the ontology endpoint:
   `gitlineage ontology` emits a `directionContract` block with both lists. Either
   way the value originates here.
2. Never infer direction from the focused node, the selected entity, or the
   traversal order. Focusing the upstream of a fork must not reverse
   `forked_from`, and focusing either side of a symmetric edge changes nothing.
3. Render symmetric edges without a directional arrowhead. Do not orient them by
   endpoint order: canonical order is an identity detail, not meaning.
4. Symmetric pairs arrive as one edge. A client that sees two edges for the same
   pair, or a self-loop, has a bug.
5. Keep symmetric evidence keys origin-free (`first_*`/`second_*`). Relabelling
   them as "source" and "target" in the UI reintroduces exactly the claim the
   rename removed.

A Web API contract test should assert that every relationship's `directed` equals
`isDirectional(type)`, that no symmetric pair appears twice, and that the
directional/symmetric partition matches the tables above.

## Not in the ontology

`copied_from`, `plagiarized_from`, `stolen_from`, `inferred`, `depends_on_repository`,
`contains_code_from`, `contains_exact_content_from`. The first three are
accusations the analyzer has no standing to make; `contains_exact_content_from`
and `contains_code_from` asserted a direction their evidence did not support and
were replaced by symmetric types. Their absence is enforced by the JSON Schema,
which rejects them, and by a regression test that asserts the removed name is no
longer a valid relationship type.
