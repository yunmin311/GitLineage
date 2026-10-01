# Integration validation

Validation target: are the discovered relationships correct and checkable on
real public repositories, including the cases where the correct answer is *no
relationship*?

Run with `npm run test:live`. Live tests read the public GitHub API and perform
bounded git fetches, so they are excluded from `npm test`. Expectations are
recorded in `fixtures/integration/real-repositories.json`.

Recorded run: 2026-10-01, Node 24.21, git 2.43, WSL2. The core analyzer run
above was re-confirmed at Web Phase 2 (`npm run test:live`, 7 pass); the client
runs recorded below were added by that phase.

## Result summary

| Case | Repository | Assertions | Result |
| --- | --- | --- | --- |
| unmodified-fork | `nachocebey/is` | `forked_from` VERIFIED, `shares_history_with` VERIFIED and symmetric, `shares_exact_content_with` VERIFIED and symmetric, no mirrored duplicate edge, no `derived_from`, no `similar_to` | pass |
| submodule-host | `grpc/grpc` | at least 10 `uses_submodule` VERIFIED, each with a pinned commit, no `similar_to` | pass |
| declared-fork-in-readme | `vitest-dev/vitest` | `forked_from` DECLARED to `vitest-dev/istanbuljs`, no `similar_to` | pass |
| unrelated-repositories | `octocat/Spoon-Knife` | no `forked_from`, `derived_from`, `shares_history_with`, `similar_to`, `declared_inspiration`; no evidence mentioning `octocat/hello-world` | pass |
| reproducibility | `nachocebey/is` | two runs of an unchanged revision produce an identical graph apart from timestamps | pass |
| namespace isolation | any | `private` namespace refused, no storage created | pass |

Every analysed graph also passes `validateGraph` and the JSON Schema.

## What the runs produced

### `nachocebey/is` (fork of `sindresorhus/is`)

| Relationship | Status | Target | Evidence |
| --- | --- | --- | --- |
| `forked_from` | `VERIFIED` | `sindresorhus/is` | GitHub fork metadata |
| `shares_history_with` | `VERIFIED` | `sindresorhus/is` | 200 shared commit objects |
| `shares_exact_content_with` | `VERIFIED` | `sindresorhus/is` | 19 identical blob ids (`matched_blob_count: 19`), `directed: false` |
| `depends_on` | `DECLARED` | 8 npm packages | `package.json` |
| `references` | `DECLARED` | 10 repositories | `readme.md` links |

20 entities, 39 evidence records, no diagnostics.

The informative negative result: **no `derived_from`**. The fork's sampled
history is identical to its upstream's, so containment carries no direction.
The analyser reports shared history and exact content and refuses to guess a
direction. An `evolved_into` or `derived_from` here would be a fabricated claim.

Both shared-state edges are symmetric and appear exactly once per pair. The
live suite asserts this: `directed: false` for `shares_history_with` and
`shares_exact_content_with`, no mirrored duplicate edge, and endpoint order
identical regardless of which repository was the subject.

### `grpc/grpc`

| Relationship | Status | Count |
| --- | --- | --- |
| `uses_submodule` | `VERIFIED` | 20 |
| `references` | `DECLARED` | 16 |
| `depends_on` | `DECLARED` | 6 |
| `shares_exact_content_with` | `VERIFIED` | 2 |

43 entities, 45 evidence records, 30 diagnostics.

Every submodule edge carries its tree-verified pinned commit, for example
`third_party/protobuf` at `35cd01f9fe9afbeea38cc7b979a3b6bfcde82c03`. Two
exact-content matches were found against lineage candidates.

The 12 `attribution_phrase_without_repository_url` diagnostics are the precision
rule working as intended: the documents say "derived from", "based on" and
similar things about specifications, protocols and people's work without naming
a GitHub repository, so no relationship is created.

`candidate_limit_applied`: 36 candidates were discovered and 8 were analysed.
Truncation is reported, not hidden.

### `vitest-dev/vitest`

| Relationship | Status | Count |
| --- | --- | --- |
| `depends_on` | `DECLARED` | 83 |
| `references` | `DECLARED` | 18 |
| `forked_from` | `DECLARED` | 1 |

103 entities, 175 evidence records, 50 diagnostics.

The interesting edge is the declared fork. GitHub metadata does not record
`vitest-dev/vitest` as a fork of anything, but `README.md` line 338 states:

```
- Coverage switched to the [`@vitest/istanbuljs`](https://github.com/vitest-dev/istanbuljs ...
```

The result is a `forked_from` relationship with status `DECLARED`, pointing at
the exact line and the observed text. It is never reported as `VERIFIED`,
because a README sentence is a statement by the author and nothing more. This is
the platform-versus-document split working in both directions: the earlier case
where the platform records a fork the documents never mention, and this case
where a document records a fork the platform does not.

`dependency_limit_applied`: 24 manifest files in a monorepo produce more
dependency facts than the 400-fact budget allows. The cap is reported.

### `octocat/Spoon-Knife`

No lineage relationship of any kind. GitHub records no fork relationship, and a
comparison of the sampled commit windows against `octocat/Hello-World` finds no
identical commit object, so no edge is produced. This is the negative validation
case: two repositories that a link-following tool would happily connect are left
alone.

## Coverage gaps found during validation

- **No public `declared_inspiration` case yet.** The rule requires a resolvable
  GitHub repository URL in the declaration window. Real READMEs frequently
  declare inspiration in a project hosted elsewhere: `ahmedkhaleel2004/gitdiagram`
  declares inspiration from Gitingest (`gitingest.com`) and credits an
  individual (`github.com/cyclotruc`, a user profile, not a repository). Both
  are correctly not converted into repository relationships. Supporting
  non-GitHub projects would use the existing `ExternalProject` entity type and
  is listed as a proposal.
- **Directional derivation is rare in the public set.** Unmodified forks produce
  no direction, and modified forks diverge, so `derived_from` needs either a
  fork with upstream commits ahead of its fork point inside the sampled window,
  or a larger depth. The rule is unit-tested against constructed histories.
- **Renamed repositories** answer with a redirect. The HTTP client follows up to
  three allowlisted hops so that a URL-first product keeps working; a repository
  that has moved to another forge is still reported as unsupported.

## Web Phase 2 client validation

Run with `npm run test:web`. Drives the real production bundle in headless
Chromium against the real server against real GitHub, and asserts 26 behaviours.

| Behaviour | Result |
| --- | --- |
| Landing renders before a repository is chosen, with four real samples | pass |
| A cold `/owner/repo` route reaches the explorer and draws nodes and edges | pass |
| The canonical graph endpoint is same-origin and reports schema 2.0.0 | pass |
| The second load is labelled `cached` | pass |
| A symmetric relationship renders with no arrowhead | pass |
| A directed relationship keeps its arrowhead | pass |
| Selecting a relationship opens the drawer with real evidence records | pass |
| The selection is written to the URL | pass |
| A shared link reproduces the same selection from cold | pass |
| Search reports a hit count and is reflected in the URL | pass |
| Clearing search restores a clean URL | pass |
| The layers popover lists all five families; layer state is in the URL | pass |
| Zoom-in changes the viewport; fit returns to the fitted frame | pass |
| The graph survives a 420px viewport, drawer as a sheet | pass |
| A repository with no lineage states that plainly instead of failing | pass |
| No link points at a hard-coded host | pass |
| The client logs no uncaught errors | pass |

Every check passed. Each of the eight defects these checks caught is listed in
`docs/web-slice.md`.

## Not validated in this run

- `similar_to`: no detector ships in V1, so there is nothing to validate.
- `evolved_into`: reserved, no extractor.
- Cross-forge candidates, private repositories, non-GitHub platforms.
- Keyboard-only and screen-reader navigation of the Explorer. Pointer, URL and
  `Esc` behaviour is covered; a full accessibility pass has not been done.
- Load behaviour under concurrency or a cold shared cache in production. A single
  cold analysis of `grpc/grpc` takes roughly 150 seconds, which is why the client
  scripts accept a warm cache directory.
