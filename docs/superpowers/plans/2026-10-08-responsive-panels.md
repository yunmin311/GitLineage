# P0.5 Responsive panels implementation plan

Goal: remove unintended panel occlusion while preserving the accepted V3.3 graph.
Architecture: one responsive panel reducer, existing shell overlays and existing camera writer;
measure actual selected target and uncovered stage before a bounded translation.
Tech: vanilla JavaScript/CSS, Node tests, Playwright against the production bundle.
Spec: user P0.5 attachment, docs/UI_CONTRACT.md, docs/MOTION_CONTRACT.md.
Global constraints: canonical graph/evidence and composition unchanged; no fit/scale on panel
transitions; preserve tools/; local commits only. Review focus: selection, scroll, focus,
world/viewport ownership, real hit testing, threshold transitions and repeated-open drift.

## Task 1 — Commit A
- [x] Reproduce exclusive-panel and selected-target visibility failures in Chromium.
- [x] Implement a pure panel transition reducer and actual occlusion geometry helper.
- [x] Integrate one shell owner, restore hidden evidence without rebuilding its scroll state,
  add explicit temporary-panel close/back, preserve graph focus and limit protective pan.
- [x] Replace obsolete all-CTM-translation equality / dual-panel assertions with policy-aware
  scale, stage and visibility assertions; retain P0 glyph, hover, camera, pan and HUD checks.
- [x] Run full regressions and responsive viewport interactions; record screenshots/geometry.
- [x] Update permanent contracts and report; commit web: coordinate responsive overlay panels.

## Task 2 — Commit B scope gate
- [x] Audit mobile navigation, real family/group indexing, evidence height/scroll, header menu,
  safe areas, browser back and multi-pointer gesture ownership before implementation.
- [x] If this requires a separate navigation/gesture subsystem beyond the bounded panel
  repair, use the user's explicit A-only stop condition; document unimplemented acceptance.
- [ ] Otherwise implement/test complete Graph/Relations/Evidence and pinch; never mix half B.

Progress: P0 baseline build + 71/71 UI checks passed on original 1ca934f7.
Pre-flight: Task 2 consumes Task 1's shell state; mobile navigation must preserve the same
selection/camera without rendering a second evidence source.

Scope decision: existing phone shell lacks navigation/history/menu and multi-pointer state.
Use the explicitly authorized Commit A-only stop; Commit B is not implemented.
Independent review found node-close and resize-hidden-panel focus gaps; reproduced failing
checks, repaired central focus ownership and preserved node focus through graph redraw.
Unit build tests mutate dist/web, so finish unit/build before browser regression runs.
