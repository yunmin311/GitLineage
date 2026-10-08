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

## Rail / Drawer
Rail defaults visible above 1500px and collapses below that breakpoint; disclosure
remains available at all widths. Drawer opens on selection, closes on explicit close /
Escape / genuine blank click. Both panels can coexist. Scroll within panel; panel opening
never changes stage bounds or triggers fit. At compact widths overlays may cover world
content; deliberate navigation is available through pan/zoom and closing Context.

## Camera / Zoom / Pan invariants
For no panel / Rail / Drawer / both: compare stage rect, viewBox, getScreenCTM(), node
screen rect, zoom and world focal point. All remain equal on panel toggles. Selection
never silently pans or fits. Explicit fit restores the authored opening camera.
Zoom and pan affect world only; HUD rect and computed font size remain equal.

## Keyboard / Accessibility
Input fields own their keystrokes. Escape closes search first, then selection. SVG rows
and plates support Enter / Space, expose role/name/state and suppress default page scroll.
Preserve visible focus and focus return after Drawer close. A pan never activates the
object under pointer-up. Pointer down is pending until displacement exceeds 5 CSS px;
then panning owns that gesture. Pointer cancel cleans up capture. Blank click may clear
selection only when this gesture has never crossed the drag threshold.

## Responsive Viewports
Test the four sizes above with short and long repository names. Small screens use
explicit shell layout changes, never CSS transforms to simulate responsive graph scale.
200% acceptance uses half-sized CSS viewport and a separate browser device scale probe;
deviceScaleFactor alone is not browser zoom. Preserve access to primary actions and HUD.

## Visual Regression / Interaction Acceptance
`npm run test:ui-contract` executes real Chromium against the built bundle. Saves JSON
geometry and screenshots under `artifacts/ui-contract/after`. Baseline reproduction:
`UI_EVIDENCE_PHASE=before npm run test:ui-contract`. Compare screenshots visually and
assert pixels/geometry/click outcomes. Do not bulk update snapshots. Existing Canvas,
Landing, Analysis, Preflight and stale A→B remain required regression checks. Changed
assertions must cite the obsolete invariant and the replacement; never delete failures.

## References and application
- [Carbon 2x Grid](https://www.carbondesignsystem.com/building-blocks/foundations/2x-grid/overview): consistent geometric foundation; reuse local tokens, without importing a new design.
- [Primer navigation](https://primer.style/product/ui-patterns/navigation/) and [Truncate](https://primer.style/product/components/truncate/): preserve context hierarchy and full identities behind constrained labels.
- [React Flow Viewport](https://reactflow.dev/api-reference/types/viewport) and [Panel](https://reactflow.dev/api-reference/components/panel): independent world camera and viewport overlays; no React Flow dependency needed.
- [Playwright assertions](https://playwright.dev/docs/test-assertions): wait for observable state; capture interaction and geometry, not declarations alone.
- [Stylelint custom property checks](https://stylelint.io/user-guide/rules/no-unknown-custom-properties): token definition/reference validation. Current dynamic world CSS properties require explicit registration; avoid unrelated lint rewrites.

Taste `redesign-existing-projects` is not installed in the supplied skill catalog/local
skills. No installation is needed for this correctness pass; V3.3 remains the design authority.
