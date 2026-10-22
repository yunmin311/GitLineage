# Discovery V3 — bounded representative source comparison

Discovery V3 connects the existing candidate search, verified tree listing, source
collector and comparison worker. It does not reopen the V3.3 / Relationship Map
design stage. Similarity remains an observation: `verification: pending`,
`lineageClaim: none`. Canonical Graph, Presentation View and Discovery Candidate
remain separate. Existing Graph, candidate and preview export schemas are unchanged.

## Use in the current application

In an explicitly enabled public exploration or authorized preview, open the existing
Discovery tools, search a public repository, choose one or two admitted candidates,
and request the bounded source listing. No search or source work starts merely by
opening the tools. Production-default-disabled behavior is retained.

The existing file checkboxes are populated with up to three recommendations per
repository. Each path explains its directory/module, supported language, size and
metadata-only selection reason. **Use recommendations** restores that optional plan;
check or uncheck files to override it (existing maximum eight per repository).
Compare starts actual pinned blob reads and the existing worker, not a mock result.

**Compared source & coverage** reports selected, read, included, filtered and pending
paths; unselected eligible paths; unsupported files; uncovered listed modules and
unlisted directories. File pair details distinguish identical blobs, partial token
similarity observations, no obvious similarity under the declared rule, and
unavailable. Unread or filtered content never becomes a negative observation.
Download **review + pinned evidence** for the additive review receipt together with
the unchanged legacy export. The original export download remains available.
**Adjust files & compare again** returns to the same checkboxes and preserves choices.
Cumulative budgets, cooldowns and final identity checks still apply.

## Selection and evidence contract

`representative-source-selection@1` is deterministic on a fixed listing and budget.
It uses no extra requests. Repository slots are allocated round-robin; path-level
configuration/test/example/declaration noise and tiny files have lower priority,
then new modules, new supported languages, smaller bytes and codepoint path order.
A module is the first directory, or the first two components for deeper paths;
root files form `(root)`. This is a reproducible directory proxy, not semantic module
inference. Duplicate listed blob IDs are suppressed within each repository; manual
overrides are allowed. Generated markers and parser/low-information failures can
only be known after a verified read. Unsupported languages are explicitly unmeasured;
the existing JS/TS parser boundary is not silently expanded.

Read allocation leaves room for each repository's final ID request and respects
remaining attempt, reserved-response-byte, source-byte and per-repository file caps.
No deeper search or tree enumeration is added. Existing ceilings remain: 24 shared
HTTP attempts, 2 search attempts, 3 listed trees per repository, at most 2 selected
candidates, 8 files/repository, 128 KiB/file (the listing's 24,000-byte blob ceiling is
stricter), 2 MiB source reservations, 32 KiB/response, 1 MiB reserved HTTP bytes,
30 seconds cumulative active work and concurrency 2. Hard CPU budgeting remains
unsupported; worker heap/stack and cancellation limits remain enforced. Public and
Private Beta ownership, address/global quotas and rate limits are unchanged.

Repeated comparisons reuse only previously digest-checked UTF-8 content bound to
repository ID, revision, path, blob and size. Session caches expire with the existing
session and cannot add files beyond cumulative reservations. Failed reads are not
cached or refunded. Each comparison rechecks final repository identity; failure
withholds comparison evidence even if bytes were cached. Sealed exports deep-copy
mutable resolver and provider receipt state so later failures cannot alter earlier
evidence. A regression reproduces and prevents that aliasing defect.

`discovery-review-receipt@1` is additive and regenerated from a validated preview
export. It binds the export digest and its own digest, recomputes the recommendation
from the original listing-stage budget, and records each selected Cartesian pair.
The denominator includes unavailable pairs. Exact equality is Git-blob equality;
otherwise five shared distinct strict or identifier-normalized five-token shingles
produce a *partial similarity observation*. Common syntax/templates can satisfy it.
This heuristic is not a probability, copying detector or verified provenance.
Source-byte coverage divides included read bytes by **listed eligible bytes**, not
all repository bytes. Aggregate scores retain the existing distinct-shingle-set
union definition and remain null for partial collections; they are not file-score
averages. The original export supplies requests, SHA/path/blob/digests, bytes,
fragments and combined stage costs for independent review.

## Fixed benchmark and measured results

Run `npm run benchmark:discovery`. The corpus is versioned in
`test/discovery/v3-corpus.ts`, labels and quality gates were frozen in the delivery
plan before the first run. Nine authored cases cover single/multiple modules,
monorepo, unrelated same-layout code, different-layout partial code, duplicates,
generated/comment/config/oversized/unsupported files, missing blobs, truncated
listing and exhausted budgets. All four strategies start fresh under identical
hard file/byte/HTTP/time/concurrency ceilings and use real verified Git objects,
provider, ledger and comparison worker. Transport is deterministic official-route
fixture HTTP, **not live network latency**. Manual is an explicit label-informed
oracle reference, not a measurement of typical users.

The initial selector failed the pair-completion gate by choosing a comment-only tiny
file. That failed run is retained under `artifacts/discovery-v3/benchmark-initial/`.
After a failing unit check, tiny-file priority was lowered ahead of directory
novelty. The same corpus and caps were rerun. Invalid-source rate now explicitly
includes both collector-filtered and parser/token-unavailable read files, excluding
unread failures (reported separately). This metric clarification does not erase the
original failed run.

Six complete cases, macro means (three fault cases are reported separately):

| Strategy | Relevant module recall | Relevant source-byte recall | Invalid selected files | Selected-pair completion | HTTP attempts | HTTP bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| V2 first eligible file | 54.17% | 46.10% | 0% | 100% | 104 | 21,310 |
| V3 representative | 91.67% | 77.03% | 0% | 100% | 116 | 25,711 |
| First-N, same count as V3 | 75.00% | 75.31% | 2.78% | 94.44% | 116 | 25,569 |
| Manual label oracle | 91.67% | 77.03% | 0% | 100% | 116 | 25,711 |

Equal ceilings do not mean equal expenditure. V3 uses 12 more HTTP attempts than
first-one across these six cases. The same-count ablation spends exactly the same
116 attempts; its different byte cost is disclosed. On the recorded WSL2 x86_64
Node 24 run, complete-case cumulative wall time was 1.69/1.72/1.68/1.66 seconds for
V2/V3/First-N/manual; these single-run observations include worker startup and are
not statistically supported speed claims. Raw per-case process CPU, response and
source bytes, selected/read paths, Git identities, receipt digests and corpus digest
are retained in `artifacts/discovery-v3/benchmark/results.json` and 36 case receipts.
CI reruns timings rather than comparing noisy latency thresholds.

Counterexamples and scope limits are part of the result:

- Multi-module: V3 reads `alpha/a.js`, `beta/encode.ts`, `beta/route.js` (both repos),
  covers both modules, but only 56.6% of labeled bytes. First-N covers only `alpha`
  yet reads 62.3% of labeled bytes. Diversity can trade byte coverage for modules.
- Monorepo: the three-tree cap exposes `packages/codec/main.ts` only;
  `packages/parser` remains unlisted. All strategies cover only 50% of relevant
  modules and 49.1% of labeled bytes. Recommendations cannot recover unseen files.
- Different-layout partial: baseline misses the labeled shared fragment; V3 and
  First-N find it. Multi-module labeled-pair recall is 60%, not 100%.
- Independently authored same-layout code: V3 observes two partial pairs out of four
  despite zero labeled shared implementations. Baseline observes none out of one.
  More comparisons also expose more common-syntax matches; the existing normalized
  engine does not establish origin or precision. Users must inspect fragments.
- Missing blob: V3 preserves two valid pairs out of four and one pending path;
  aggregate score is null. Truncated target trees are withheld entirely.
- Eight-file manual exhaustion stops at 24 attempts, retains read receipts, and
  withholds all pair results when no budget remains for final identity verification.
  It does not spend extra requests to make completion look better.

These are authored task-coverage results, not GitHub-wide relevance/precision or
causal information-gain estimates. Broader independent repository quality remains
unmeasured. The fixed gate establishes bounded sampling and usable comparison,
not universal discovery success.

## Live GitHub observation (separate from the benchmark)

An anonymous live smoke searched `sindresorhus/p-limit`, revision
`a8a6fbec4e0e866d6d779b10889bb4f5567e70eb`. Its first admitted candidate was
`1inch/limit-order-protocol`, revision `50bd1300315606a3d32e9021898374c9d0dc2335`.
It actually read `index.js`, `benchmark.js`, `scripts/benchmarker.js` against
`.solcover.js`, `hardhat.config.js`: six completed pairs, 21 attempts, 108,407 HTTP
bytes, 19,853 reserved source bytes and about 13.4 seconds active work. Exact raw
requests and scopes are in `artifacts/discovery-v3/live/`.

This is a working real-network pipeline **and a quality counterexample**: the
candidate was irrelevant, its Solidity application code was unsupported/unlisted,
and three normalized partial observations did not prove shared implementation.
No real-network strategy superiority is claimed. The source-selector cannot repair
candidate relevance or language support. `node experiments/discovery-v3/live-evaluation.ts`
is an opt-in live smoke, excluded from offline CI quality gates; current search
results and costs can differ.

## Engineering acceptance and limits

`npm run test:discovery-v3` exercises deterministic choice, budgets, multi-file real
worker results, missing source, revised scope/cache costs, final identity conflicts,
immutable prior receipts and validation tamper rejection. Existing tests cover
source SHA/path/SSRF, cancellation, byte/file/quota limits and import isolation.
`npm run test:discovery-v3-browser` uses the built production bundle at
1920/1280/430/390, plus enabled anonymous app flow at 1280/390: recommendations,
overrides, downloads, repeat comparison, keyboard return, Reduced Motion, viewport
geometry and canonical cache preservation. Browser fixtures supply actual hashed
source objects to the real provider/worker; no mocked comparison result is accepted.

M2 ARM64 PR CI runs the quality benchmark and new browser suite alongside all old
checks. Main's existing push workflow runs unit/build/live/image validation; full
M2 browser/quality acceptance still requires workflow dispatch on a future merged
main. This PR is not authorization to merge, deploy or change protections.

Local execution logs, original failures, screenshots, geometry, live observation,
benchmark receipts and exact bundle checksums are under `artifacts/discovery-v3/`.
Remote CI is a separate result, linked from the delivery report/PR. Existing three
opt-in live unit skips are disclosed; they are not new skipped acceptance checks.
Linux Playwright mobile emulation is not a physical device, real touch/pinch or
macOS/iOS Safari certification. Discovery V3 does not add new languages, deeper
listing, candidate retrieval quality, automatic provenance verification or a
production rollout. Those are remaining core capability boundaries, not another
visual or V3.x design milestone.
