# M2 post-release integration — 2026-10-10

Before integration, M2 was `02299f88b3122840cf7bcef80da4684f2407b4be`; production/main was `1c31c1ccbb4657c8c0773e29faeb0b87203f8e4d`. This integration uses a normal main-to-M2 merge, preserving both histories. No rebase, force push, product feature or deployment is included.

The only conflict was `test/web/fixture-server.ts`, in its import and options declaration. The resolved helper retains the `ServeOptions` type, `previewHandler` option and forwarding of `serveOptions`, alongside the common pinned snapshots, isolated temporary cache and scheduler drain. Its final bytes match pre-merge M2. All eight Graph fixture bytes, shared fixture loader, Explorer product code and production preview-disabled test are unchanged from M2. The main-side SHA-256 fixture test is retained.

Both ARM64 Node 24 PR workflows are retained. They use separate `m2-pr-*` and `p0-p05-ui-*` concurrency groups. The stable UI workflow now takes the Discovery-present branch and requires the actual named production-disabled runtime test to pass. Its exact guard was executed locally successfully. Neither PR workflow deploys or invokes real GitHub experiments.

## Local acceptance

WSL Ubuntu-24.04, Linux Node v24.21.0. Typecheck, Unit (571 pass, 3 existing skips, zero failures), Build, offline Discovery (118/118), Phase 0 benchmark tests and benchmark, Phase 1A/1B/1C/1D offline entry points and production-disabled test all passed.

Chromium: Canvas 113/113, Landing 40/40, Analysis, Preflight 45/45, Stale A→B, UI Contract 75/75, Responsive 71/71, Mobile 133/133, Deep Search and discovered candidate layer passed. The Deep Search suite runs 390, 430, 1280 and 1920px, including source selection, comparison, provenance export validation, filtered-only files, partial/no-results/cancellation/rate-limit cases. It verifies graph viewBox, actual SVG CTM, selection, URL, returned focus and canonical-cache digest preservation. Production build file hashes recorded before browser suites match after all suites.

Logs: `artifacts/m2-integration/`; browser evidence: `artifacts/deep-search/validation.json` and screenshots in that directory. No new real GitHub experiment was performed. These are fixed Mock browser tests with real deterministic comparison code, not new public-repository scores. WebKit and physical devices were not validated in this integration.

## Production and release boundary

Read-only production verification confirms `1c31c1ccbb4657c8c0773e29faeb0b87203f8e4d`, active service. No SSH write, deployment, main push, PR merge, Cache/Jobs cleanup or tools modification occurred. PR #1 remains the Draft review vehicle.

Public M2 release still requires reviewed production authentication/authorization, shared-user quota and abuse controls, production operational acceptance and release approval; local capability-gated preview is not a public access-control system. WebKit/physical-device coverage remains incomplete. Unknown comparisons remain pending/none, deterministic similarity is not a lineage verdict, and incomplete search/file coverage must remain explicit. This integration does not implement those future capabilities.

Remote acceptance must use both applicable ARM64 PR workflow runs at the final integration SHA; their URLs and results are recorded in the final delivery and ignored local evidence, rather than treating the earlier RC SHA as current acceptance.
