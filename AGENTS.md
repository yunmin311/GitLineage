# GitLineage agent workflow

# >>> AI Runtime Contract (managed) >>>
# Execution: All WSL-capable Agent shell/tool/test/dev-server execution -> WSL2 Ubuntu-24.04 Linux, including /mnt/c and /mnt/e workspaces. Windows-native GUI/OS management only -> PowerShell. Docker -> Desktop WSL Integration.
# Forbidden in WSL: /mnt/e/APP/node.js, /mnt/e/npm-global, /mnt/e/APP/Tools/uv/bin
# Env diagnosis: max 1x per task; dynamic facts via `agent-env`
# Source: C:\Users\lqy\.ai-runtime\RUNTIME.md
# <<< AI Runtime Contract (managed) <<<

## UI engineering gate
Read docs/UI_CONTRACT.md and docs/MOTION_CONTRACT.md before UI changes. Accepted V3.3
visual language and graph semantics are authoritative. Inspect existing styles/tokens,
tests and dirty work before editing; preserve unrelated files. Reproduce the fault with
real browser pixels and geometry before fixing it. Add a failing interaction check, fix
the root cause, rerun the check, and then the required regression suites.

For panel/camera changes, measure actual stage bounds, SVG CTM, world focal point and
screen-space node bounds. viewBox equality alone is insufficient. For hover changes,
verify painted glyphs and real hit targets. For drag changes, test selection and both
panels after pointer-up and test an ordinary blank click separately.

Run build, typecheck, unit, Canvas, Landing, Analysis, Preflight, stale A→B and
`npm run test:ui-contract` and `npm run test:responsive`. Explorer, Rail, Drawer, camera
or breakpoint changes must also measure uncovered stage, selected-target/panel intersection,
real hit targets, focus/scroll restoration and native touch ownership. Use the >=1600 dual /
1024–1599 exclusive / 768–1023 temporary policy; do not claim the <768 Mobile Explorer
or physical-device/pinch acceptance until Commit B supplies executable checks. Record screenshots and geometry with the result. Explain an
obsolete assertion before replacing it; never mask defects with baseline updates.
Keep reviewable commits by stage. Report failures and unverified cases explicitly.
Unit build tests rewrite dist/web: finish unit/build before browser suites; never race
a rebuild against a running browser acceptance test.
No push or deployment without explicit user authorization. Preserve existing production.
