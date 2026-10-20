# Motion contract

This gate defines state and invariants; it adds no entrance or layout animation.

- Pointer: idle → pending on primary pointer down → panning after >5 CSS px displacement
  → idle on up/cancel. Crossing the threshold suppresses the ensuing click activation,
  even if the pointer returns to its origin. Pending up retains ordinary click behavior.
- Pan updates camera only. Selection, Rail, Drawer and HUD remain stable. Pointer cancel
  releases capture and does not activate or clear selection.
- Rail/Drawer transitions are reducer actions: selection, Context disclosure and viewport
  resize. Below 1600, Context temporarily hides evidence without losing selection or scroll.
  Closing Context restores evidence. Wide screens permit both overlays.
- Panel transitions preserve stage and zoom. Protect an occluded selected target with only
  the minimal bounded camera pan through the existing writer; no implicit fit or reset.
  Closing/reopening must not accumulate camera movement. Hover never triggers protection.
- Native vertical touch scroll belongs to panel content and cannot pan or deselect the
  graph. Canvas single-pointer drag retains selection and overlays on release. Phone multi-pointer ownership is specified below; sheet drag is not used.
- Hover changes a background layer only; glyphs and selected markers remain visible.
- Existing short surface transitions use existing duration/easing tokens. Reduced-motion
  preference removes transitions; acceptance tests exercise it alongside keyboard focus.

Acceptance mapping: ui-contract.ts measures threshold gestures, repeated zoom, HUD bounds,
panel invariants, Escape and pixels. responsive-acceptance.ts measures seven viewport
policies, whole-target occlusion/hit tests, repeated transitions, native touch scroll/pan,
scroll retention and live breakpoint reconciliation. panels.test.ts verifies pure policy
and idempotent protection. Canvas retains scroll/focus and composition coverage.
Reduced-motion remains executable in ui-contract.ts and unification-acceptance.ts.


## Commit B phone pointer ownership
Only the SVG canvas owns phone pan/pinch. One pointer starts pending; >5px motion
becomes pan, two pointers become pinch. The inverse CTM world point beneath the initial
midpoint follows the moving midpoint; zoom is clamped through the existing camera
writer. Finger-count changes rebase the remaining pointer from the current camera.
Pan, pinch and cancellation suppress synthetic click activation. A fresh pending tap
routes once to the real painted hit owner. Document capture suppresses the following
touch compatibility click even if newly opened Evidence retargets it. A fresh pointer
outside the canvas restores ordinary reading interactions. Cancel/view-switch/resize releases captures
and clears pointer state. Native Relations/Evidence scrolling cannot move the graph.

Three views preserve their DOM, camera and selection without entrance animation or
implicit Fit. Returning to Graph restores navigation focus; Evidence focuses its pinned
Back control. Same-repository history restores camera/scroll without analysis requests;
returning from Landing restores the Explorer shell. Reduced-motion has no new motion
to suppress. mobile-acceptance.ts checks pinch midpoint geometry, pinch-to-one-finger,
three-pointer cancellation, subsequent tap, native list/evidence scroll and history.

## Graph and repository exploration refinement (2026-10-12)
User-authorized refinement adds 260ms geometry transitions for real member expansion,
directory changes and camera controls; panel feedback is 160ms; instrument and disclosure transitions are 220ms. Unchanged
analysis polls retain their current phase without restarting entrances. Existing semantic
status, direction and confidence markers are unchanged. Pointer-down and wheel cancel
pending camera motion at its current geometry, then transfer ownership to native input.
Reduced motion writes the final geometry immediately. View switching restores saved
camera rather than fitting implicitly. unification-acceptance.ts checks intermediate,
settled and interrupted camera geometry and the reduced-motion branch.

## UI/Motion closeout (2026-10-20)
- One entrance owner per surface; nested text/card entrances must not multiply opacity
  or displacement. Commit selection updates reading content without replaying each block.
- Spatial expansion retains the last painted node position and opacity when interrupted,
  then resolves to the latest DOM state in 260ms. Unchanged scenes schedule no animation.
- Panel contents use 160ms feedback; instrument/disclosure changes use 220ms. Waiting
  markers communicate pending work; they never imply measured progress or trigger requests.
- Hover displacement applies only to fine pointers with hover. Reduced motion skips
  spatial/entrance transitions and keeps loading, status, focus and evidence readable.
- motion-continuity-acceptance.ts records painted expansion frames, interruption geometry,
  rapid reversal, focus, reduced motion and History camera restoration at four widths.
