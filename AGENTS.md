# GitLineage agent workflow

## Runtime
All shell/build/test/server/browser execution uses WSL2 Ubuntu-24.04, including mounted
Windows workspaces. Windows-native GUI/OS management alone may use PowerShell.
Never use /mnt/e/APP/node.js, /mnt/e/npm-global or /mnt/e/APP/Tools/uv/bin from WSL.
Environment diagnosis at most once per task via agent-env.

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
`npm run test:ui-contract`. Record screenshots and geometry with the result. Explain an
obsolete assertion before replacing it; never mask defects with baseline updates.
Keep reviewable commits by stage. Report failures and unverified cases explicitly.
No push or deployment without explicit user authorization. Preserve existing production.
