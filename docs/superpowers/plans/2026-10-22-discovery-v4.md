# Discovery V4 bounded implementation

Scope authorized by the user: improve relevance and review interpretation, preserve budgets and raw evidence. Base: main 01563bc7394a5d900c85f557b3e9867947fabc69 after normally merging PR #8 (all three ARM64 checks passed).

1. Freeze independent relevance and source counterexample labels; reproduce V3 ranking and observations.
2. Retain bounded metadata already returned by search; apply a small deterministic relevance rule, with explicit abstention and manual access to all admitted candidates. No new requests or schema changes to canonical/candidate exports.
3. Add conservative review-priority explanations to existing comparison reasons; retain exact matches, raw scores and fragments. Test shared implementation, common syntax, short snippets and identifier renames.
4. Compare V3/V4 on identical fixed inputs, including pinned public samples; report counterexamples, costs and limitations.
5. Integrate explanations into existing Discovery UI, verify desktop/phone, keyboard and state retention. Run required local regressions sequentially after build.
6. Review diff, commit, push V4 branch, create PR, wait for ARM64 checks. Do not merge V4 or deploy.

Acceptance: better first-two relevance on the fixed corpus; fewer promoted low-value observations; retain all labeled valuable observations in raw evidence and report any priority loss. Reject rules without stable benefit. Labels are task relevance, never lineage truth or statistical probabilities.
