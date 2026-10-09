# Commit B: Mobile Explorer

Authorized brief: phone Graph / Relations / Evidence on the existing production ViewGraph,
without changing canonical data, collectors, server architecture or desktop composition.
Baseline: 85b18b84. Preserve untracked tools/ and Commit A.

## Architecture
- A phone shell (<768px, or <=900px and <=500px landscape) owns three persistent views.
  Stage stays mounted with unchanged dimensions across switches; Evidence reuses the real
  Drawer renderer. Hidden views preserve DOM, scroll, selection and camera.
- URL history retains repository route and existing edge/node parameters, plus a mobile
  view parameter. Same-repository Back restores UI without fetching/reanalysis.
- Relations indexes every view edge under its canonical family and evidence declaration
  form/site. Unknown structure is explicitly named; no path-derived semantic categories.
  No member caps; group/relationship/evidence counts are separate.
- Pointer ownership: canvas pending -> pan (>5px) or two-pointer pinch; midpoint anchors
  an inverse CTM world point. Multi-pointer completion suppresses click and rebases the
  remaining pointer. Native vertical scrolling remains owned by reading/list containers.
- Phone opening/Fit centres the existing subject, at zoom 1 for readable graph targets.
  Explicit search and list location navigate authored nodes/plates without re-layout.
- Existing tokens/fonts/palette, safe-area padding and 44px controls. No new motion.

## Implementation / acceptance order
1. Record failing mobile browser navigation checks + screenshot/actual stage geometry.
2. Add persistent shell/list, navigation/history, reuse Evidence and coordinate camera.
3. Add pan/pinch state handling, native ownership and search/list location.
4. Mobile browser checks on three real cache graphs and four phone sizes, scroll/focus,
   touch coordinates, focal point, member reachability, selection/back, screenshot evidence.
5. Diagnose any obsolete legacy phone assertions before replacing them; keep all desktop
   invariants and suite counts. Run typecheck/unit/build before browser regressions.
6. Independent review, fix issues, report browser/device limitations and exact results.
7. Commit web: add mobile explorer navigation; no push/deployment.

## Completion evidence
Mobile 133/133; Canvas 113/113; UI 75/75; Responsive 71/71; Landing 40/40 (one external-network timeout retained, unchanged retry passed); Analysis 16 states/0 violations; Preflight 45/45; Stale pass; Unit 441 pass/3 skip; build/typecheck pass. Independent final review found no remaining confirmed defect. See docs/P05_MOBILE_REPORT.md for exact device limits and artifacts. Local commit authorized; no push/deploy.

Final focus checks cover hidden desktop/phone controls and source-link focus during mode rebuilds. Depth history acceptance waits for the target view response and visible reading UI; the intermediate loading-state race is retained in the evidence log.
