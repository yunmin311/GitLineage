# Discovery V4: relevance and cautious source review

V4 adds two small review aids to the existing enabled Discovery flow. It does not
expand search, alter raw similarity measurements or infer ancestry. V3 was normally
merged at `01563bc7394a5d900c85f557b3e9867947fabc69`; its merged-main
[ARM64 run passed](https://github.com/yunmin311/GitLineage/actions/runs/39800678001).
The design stage stays closed.

## Use

In an already enabled public exploration or Private Beta instance, open Deep Search,
search a public repository, read each candidate's purpose evidence, and select up to
the existing two candidates. An insufficient candidate remains selectable. If none
has enough evidence, the interface explicitly says no sufficiently relevant candidate
was found **within this query and budget**. This is not a claim about all GitHub.

Continue through the existing source listing, automatic recommendation or manual file
selection, and Compare. Multi-module review now separates exact bytes, distinctive
strict-token overlap worth examining, and limited-information observations. Expand
file outcomes and pinned measurements, change the chosen files, compare again, and
download the review plus evidence. Nothing is automatically verified.

For authorized local use: run `npm run build`, then
`GITLINEAGE_DEEP_PREVIEW=1 npm run preview:deep` and open the ephemeral loopback URL
printed by that process. Normal production startup still leaves Discovery disabled;
this change does not deploy or enable production.

## Minimal rules and compatibility

- Reuse target bootstrap metadata and existing search item descriptions, topics and
  primary language; no extra HTTP request. Bound retained metadata and reject reflected
  credentials. Ignore repository self-tags and generic language/platform/package tags.
- At least two meaningful shared description terms or a non-generic shared topic
  supports review, unless known primary languages disagree. JS and TS are compatible.
  Language equality alone and repository-name equality never support a recommendation.
  Supported candidates precede insufficient ones; ties preserve existing order.
- Ranking applies **after existing bounded candidate admission**. It cannot recover a
  useful repository excluded by the existing candidate cap or never returned by the
  query. No candidate is hidden or automatically selected.
- Keep exact Git blob equality and V3 strict/identifier-normalized five-token shingle
  scores, ranges, denominators and unavailable states. Annotate completed strict
  measurements only: at least 12 shared distinct shingles and four non-common distinct
  identifier spellings support priority review, except configuration filenames.
  Common syntax, short fragments and normalization-only overlaps receive caution.
  This is a review heuristic, not a probability or semantic proof. Configuration
  overlap and heavily renamed real shared code can be under-prioritized; raw evidence
  and manual review remain available. Exact bytes take precedence in review receipts.
- New review receipts use `discovery-review-receipt@2`; the validator also strictly
  reconstructs sealed V3 `@1` receipts and rejects modified ones. Existing candidate,
  graph and pinned preview export formats remain unchanged. UI tolerates legacy
  receipts with no priority explanation.

## Fixed evaluation and actual limits

Public metadata is pinned in `test/discovery/fixtures/v4/public-corpus.json`, with
four pinned public source files, revision/blob/SHA-256 receipts and upstream licenses.
The 12 candidate observations form three purpose-labeled controlled pools: p-limit,
chalk and Vite. They include name collisions, different uses, same-use implementations,
related cross-language tooling and shared-ecosystem counterexamples. Labels describe
usefulness for comparison, not lineage. They are independent of algorithm output.
This is **not a random sample of live search**, and cannot establish broad precision
or recall. Acquisition is a separate explicit offline preparation command; CI replay
performs no network requests and never executes the acquired code.

The source evaluation includes the public p-limit/fork pair, unrelated chalk, same-use
fastq, authored short/import/configuration templates, controlled preserved/renamed
public fragments, and all relevant cross-path pairs from the non-fault V3 corpus.
Cross-path labels explicitly include shared authored `core` fragments, rather than
assuming different paths mean different implementations. Fault/budget coverage also
continues in the existing V3 benchmark and Discovery suites.

| Fixed-set observation | V3 | V4 |
| --- | --- | --- |
| Top-two useful fraction, stored input order | 50.0% | 66.7% |
| Top-two useful fraction, all 24 orders per pool (72 total) | 58.3% | 77.8% |
| Orders with worse useful top-two fraction | — | 0/72 |
| Labeled low-value pairs receiving priority | 25/42 | 1/42 |
| Labeled valuable pairs receiving priority | 30/30 | 30/30 |
| Raw measurement/summary differences, annotations excluded | baseline | 0/72 |
| Replay network attempts / response bytes | 0 / 0 | 0 / 0 |
| Source bytes supplied across the identical pairs | 69,669 | 69,669 |

Of the 30 positive source pairs, 13 have identical bytes and 17 share non-identical
implementations, including the controlled renaming example.

Four candidates receive support and none is labeled irrelevant in this small set.
Three relevant candidates still receive insufficient support: fastq (sparse purpose
terms), Rich (different primary language), and Rollup (vague description). They remain
available to users. One unrelated public source pair, p-limit/chalk, still receives
priority: distinctive-looking spellings can overlap incidentally. Do not describe the
result as eliminating false matches. V3 raw partial-observation counts are deliberately
unchanged; V4 improves interpretation and priority, not source provenance detection.

Annotations add 11,332 serialized measurement bytes across the 72 pairs;
metadata and review explanations also add bounded application-response text. No extra
GitHub response is fetched. Corpus acquisition used 26 explicit development requests
and 140,978 response bytes, separate from unchanged product budgets and offline replay.

A frozen copy of the actual V3 engine is test-only. Every pair executes the production
V4 worker and compares all raw measurements and aggregate fields against that baseline.
Both engines also receive identical snapshots in the same process with alternating
execution order for cost sampling. Timings are short CPU observations, not sustained
performance or a speedup claim. Machine-dependent timings and separately charged corpus
acquisition costs are in `docs/evidence/discovery-v4-benchmark.json`; full measurements,
per-case costs and receipts are emitted to `artifacts/discovery-v4/benchmark/results.json`.

An initial rule was rejected after generic promotional terms and ecosystem tags falsely
recommended Vitest as a bundler candidate. The rejected run is preserved locally. An
independent review also found generic topics, cross-path labeling and old-receipt issues;
all three gained concrete regression checks or corrected construction-based labels.

## Verification and boundaries

Run `npm run benchmark:discovery-v4`, the existing `benchmark:discovery`, all Discovery
and unit tests, typecheck and build. `test:discovery-v4-browser` exercises the production
bundle at 1920/1280/430/390 with keyboard selection of an insufficient candidate,
comparison explanations, a no-recommendation case, Reduced Motion, DOM geometry and
page errors. Screenshots and geometry live in `artifacts/discovery-v4/chromium/`.
The M2 ARM64 PR workflow now runs both new checks and retains all existing checks.
Existing Canvas/Landing/Analysis/Preflight/stale/UI contract/responsive/Discovery/public
exploration/Private Beta browser checks remain required for this change's local audit.
Three preexisting opt-in live unit skips are disclosed separately from executed tests.

All existing request/time/file/byte/concurrency/global budgets remain unchanged.
Canonical Graph, Presentation View and Discovery Candidate stay separate;
`verification: pending`, `lineageClaim: none`, revision identity, evidence receipts,
SSRF protections and worker termination remain enforced. No acquired repository code
is executed. No new dependency, service, crawler, embedding or model was added.

Still open: live query recall and pre-admission selection, sparse/ambiguous metadata,
more languages than JS/TS source comparison, highly transformed shared code and stronger
independent provenance evidence. V4 does not certify physical touch/pinch, Safari/WebKit
or sustained performance on the new flow. Prior design acceptance does not substitute
for device-level evidence. No additional UI milestone is proposed.
