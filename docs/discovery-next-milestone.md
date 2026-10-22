# Next Milestone proposal: representative source selection

Status: Superseded by the implemented [Discovery V3](discovery-v3.md) on 2026-10-22.
The proposal below records the frozen prior scope. V3 expands it to a complete
manual-review and repeated multi-file comparison flow without raising budgets.
It does not reopen visual design. No automatic V3.1/V3.2 follow-up is scheduled.

## Existing implementation checked

`src/discovery/query.ts` already builds bounded name, description, topic and explicit
keyword plans. `search.ts` preserves numeric repository identity, per-query coverage,
rejected identities and admission budgets. The enabled preview uses at most three
unique search candidates and compares one or two explicitly selected candidates.
`experiments/discovery-v2/source-selection.ts` verifies nonrecursive Git tree objects,
visits at most three trees, prioritizes source directories and exposes exclusions and
unlisted directories. `source-collection.ts` binds explicit file choices to immutable
repository/revision/tree/blob/digest identities before comparison. Selection exports
already bind search, listing, selected files and combined resource consumption.

The remaining useful gap is representativeness: selectable files are a bounded
listing, and manual or first-listed choices need not cover distinct source modules.
Existing evidence validation is already substantial; another provenance label alone
would add less value than improving what the comparison actually samples.

## One bounded slice

Recommend a deterministic, diverse subset of **already listed and selectable** JS/TS
application source files. Prefer distinct source directories/modules and avoid spending
all eight file slots on one directory when alternatives exist. Keep explicit user
selection and show why each suggested path was chosen, the unselected eligible paths,
and the directories that were never listed. A recommendation is a sampling plan,
not a claim that the repository was scanned or that any lineage was verified.

Keep existing HTTP endpoints and request shapes. Suggestions populate the existing
file-selection flow. Any additional downloadable selection metadata requires an
explicit version and compatibility tests for existing receipts. Do not introduce a
new discovery source, deeper enumeration, background crawl or automatic comparison.

## Acceptance

- Freeze a labeled offline corpus before implementation: flat libraries, multi-module
  applications and monorepos, plus generated/vendor-only, truncated tree, symlink,
  duplicate content, renamed repository and exhausted-budget controls. Keep revisions,
  tree/blob identities and corpus digests reproducible.
- Compare against the current first-listed selection on the same listings and budget.
  With at least two eligible source directories and two available slots, select from
  at least two directories. A multi-module fixture must reach its labeled relevant
  module when that module is in the verified listing and the slot budget permits it.
  Report improvements and unchanged/worse cases; do not substitute a similarity score
  for retrieval quality or claim coverage outside the fixed corpus.
- Same inputs produce the same ordered suggestions and reasons. Manual overrides,
  one-to-eight-path validation, selection binding and export digest checks still pass.
- Preserve the current preview ceilings: shared 24 attempts, 1 MiB reserved response
  bytes, 30 seconds active work, three visited trees per repository, two compared
  candidates and eight selected paths per repository. No extra requests solely to
  generate suggestions; retain all lower file/path and security limits.
- Cancellation, unavailable directories, filtered files and exhausted budgets produce
  explicit partial/unavailable coverage, without fabricated candidates or fallback
  claims. Rejected/symlink/generated paths never become selectable suggestions.
- Every result remains `verification: pending`, `lineageClaim: none`. Canonical Graph,
  Presentation View and Discovery Candidate stay separate. Similarity never creates
  a canonical edge, changes status, asserts authorship or infers direction.
- Run existing Discovery isolation, quotas, SSRF, worker cancellation, receipt,
  production-default-disabled and browser file-selection tests, plus the fixed-corpus
  comparison. Existing API consumers and old receipt readers remain supported.

Out of scope: new UI language, Timeline, cross-forge/cross-repository product features,
new ontology, verification promotion, production enablement and budget increases.
