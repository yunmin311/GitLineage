# UI engineering contract

Scope: engineering correctness of the accepted V3.3 presentation. Preserve its palette,
fonts, primitives, evidence semantics and composition. A screenshot count alone is
never an interaction acceptance result.

## Layout / Grid / Spacing
Reuse `--s1`…`--s8` and existing component sizes; do not invent a parallel spacing system.
Flex children containing user text need `min-width: 0`. Shell owns appbar and panels;
world geometry never reflows in response to panel visibility. No horizontal document
scroll at 1920×1080, 1280×800, 768×800 or the 640×400 CSS viewport corresponding to
1280×800 at 200% browser zoom.

## Typography / Baseline / Component Alignment
Appbar groups centre their explicit line boxes on the same vertical axis. Repository
identity retains its title token. Revision and cache are nonshrinking adjacent context.
Actions own a nonshrinking allocation; long identity truncates first. Compact appbar
may have two explicit rows, each centre aligned. Measure bounding rectangles, computed
line height and centre spread (<=1px within a row), not only `align-items` declarations.

## Long Text / Overflow / Truncation
HTML identities use ellipsis and a full-value title. SVG text fits its actual allocated
world width with `getComputedTextLength()` after attachment; character counts are not
width guarantees. Reserve independent label and locator columns. Native SVG titles or
Drawer preserve full values. Fit after fonts settle. No glyph may extend beyond its
card or overlap its locator; test wide glyphs and long manifest paths.

## SVG Hit Testing / Hover / Selection
Visual hover backgrounds paint before glyphs. Hit rectangles remain transparent and
paint after content to own pointer targeting. Priority: disabled > selected > hover >
rest; hover does not erase selection. Actionable rows have a keyboard name and Enter /
Space activation. A real row click opens that row's relationship evidence. Record
before/hover screenshots and count painted dark glyph pixels in the label bounds.

## Shell / World / HUD ownership
World: nodes, relations, ties and world annotations. Its SVG viewBox is the camera.
HUD: legend, hints and zoom controls; an untransformed layer fixed to stage pixels.
Shell: appbar, Rail and Drawer. Side panels overlay the stage and do not own grid columns.
The HUD has a dedicated bottom lane above panels, with inert regions passing through
pointer input. Its legend and controls cannot overlap each other.

## Responsive Panel Policy
One reducer owns visible Rail/Drawer state (`lib/panels.mjs`); event handlers must not
mutually call panel open/close handlers. Selection and camera remain Explorer state.

| CSS viewport width | Initial Context | Selected evidence | Opening Context while selected |
| --- | --- | --- | --- |
| >=1600 | open | Drawer may coexist with Rail | both allowed |
| 1024–1599 | closed | closes Rail and opens Drawer | hides Drawer; keeps selection and evidence DOM |
| 768–1023 | closed | single temporary Drawer | single temporary Rail |

Closing Context restores retained evidence and its exact scroll offset. Closing evidence
clears selection and returns focus to its rendered node/row target (Fit fallback when absent). Temporary Context supports Escape,
Back/Close and its disclosure toggle. Panels scroll independently; transitions must not
rebuild retained evidence. The <768 legacy shell is not Mobile Explorer acceptance:
Graph/Relations/Evidence navigation and pinch require the separate Commit B gate.

## Viewport Visibility Contract
Panels overlay the unchanged stage, above the graph and below the dedicated HUD lane.
Measure the uncovered rectangle from actual stage, visible panel and HUD bounds. Protect
an existing selected node box, relation row as a whole:
its intersection area with either panel must be zero and its real hit targets reachable.
Unexpanded aggregate members have no rendered row to protect. Direct edges protect their
visual labels, whose pointer events are disabled; the actual path hit area is separate
and not covered by this responsive acceptance suite. Label protection must not move nodes
within the graph or alter canonical semantics.

## Camera / Zoom / Pan invariants
Compare actual stage rect, getScreenCTM(), node screen dimensions, zoom, viewBox and world
focal point. Stage and screen scale remain equal across panel transitions. A newly
occluded selection may cause only the smallest deterministic camera translation needed
to reach the free rectangle, with an 8px margin, through the existing camera writer.
CTM translation and focal point may therefore change; unconditional equality was the
obsolete P0 invariant. Already-visible targets must not move. Repeated open/close cycles
must not accumulate movement. Closing panels does not undo the protection pan or fit.
Oversized targets cannot be made to fit through translation alone: keep user zoom and
camera bounds, never silently shrink or fit. Explicit fit restores the authored camera.
Zoom and pan affect world only; HUD rect and computed font size remain equal.

## Touch Interaction Contract
For this desktop/tablet gate, panel scroll containers own vertical native touch scroll
(`touch-action: pan-y`, contained overscroll); canvas owns its existing pointer pan.
Real Chromium touch input must prove that evidence scroll leaves camera and selection
unchanged, hidden evidence restores its scroll, and canvas pan retains evidence and
selection after pointer-up. Do not claim physical-device or multi-pointer coverage from
these checks. Pinch, phone navigation, safe areas and soft-keyboard acceptance remain
Commit B work. No new mobile transitions are introduced by Commit A.

## Keyboard / Accessibility
Input fields own their keystrokes. Escape closes Layers/search first, then temporary
Context, then selection. Wide Context uses its explicit Close button. SVG rows
and plates support Enter / Space, expose role/name/state and suppress default page scroll.
Preserve visible focus and focus return after Drawer close. A pan never activates the
object under pointer-up. Pointer down is pending until displacement exceeds 5 CSS px;
then panning owns that gesture. Pointer cancel cleans up capture. Blank click may clear
selection only when this gesture has never crossed the drag threshold.

## Responsive Viewports
UI Contract tests the four sizes above with short and long repository names. Responsive
acceptance additionally tests 1920×1080, 1600×900, 1280×800, 1024×768, 768×1024,
820×1180 and 844×390 (tablet-width landscape). Small screens use
explicit shell layout changes, never CSS transforms to simulate responsive graph scale.
200% acceptance includes a compact CSS viewport/device scale probe and a separate full
Chromium run that selects 200% in browser settings. Verify innerWidth=640, innerHeight=400,
devicePixelRatio=2 and visualViewport.scale=1 at a 1280×800 browser viewport;
deviceScaleFactor alone is not browser zoom. Preserve access to primary actions and HUD.

## Visual Regression / Interaction Acceptance
`npm run test:ui-contract` executes real Chromium against the built bundle. Saves JSON
geometry and screenshots under `artifacts/ui-contract/after`. For baseline reproduction,
build the baseline revision first and select a fresh `UI_EVIDENCE_PHASE` directory;
the phase flag labels evidence and does not select a revision. Preserve original captures.
`npm run test:responsive` saves selected-target, free-area, intersection, hit-testing,
CTM and repeated-transition evidence under `artifacts/responsive/after`. It also dispatches
actual Chromium touch events for independent evidence scrolling and canvas panning.
`test/panels.test.ts` covers threshold/state transitions and minimal/idempotent pan.
Compare screenshots visually and
assert pixels/geometry/click outcomes. Do not bulk update snapshots. Existing Canvas,
Landing, Analysis, Preflight and stale A→B remain required regression checks. Changed
assertions must cite the obsolete invariant and the replacement; never delete failures.

## References and application
- [Carbon 2x Grid](https://www.carbondesignsystem.com/building-blocks/foundations/2x-grid/overview): consistent geometric foundation; reuse local tokens, without importing a new design.
- [Primer navigation](https://primer.style/product/ui-patterns/navigation/) and [Truncate](https://primer.style/product/components/truncate/): preserve context hierarchy and full identities behind constrained labels.
- [React Flow Viewport](https://reactflow.dev/api-reference/types/viewport) and [Panel](https://reactflow.dev/api-reference/components/panel): independent world camera and viewport overlays; no React Flow dependency needed.
- [Playwright assertions](https://playwright.dev/docs/test-assertions): wait for observable state; capture interaction and geometry, not declarations alone.
- [Stylelint custom property checks](https://stylelint.io/user-guide/rules/no-unknown-custom-properties): token definition/reference validation. The lightweight `test/ui-tokens.test.ts` checks all stylesheet references against definitions without adding dependencies. Retired world-overlay properties are removed; avoid unrelated lint rewrites.

Taste `redesign-existing-projects` is not installed in the supplied skill catalog/local
skills. No installation is needed for this correctness pass; V3.3 remains the design authority.
