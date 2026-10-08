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
  graph. Canvas single-pointer drag retains selection and overlays on release. This gate
  does not implement phone multi-pointer/pinch or sheet-drag feedback.
- Hover changes a background layer only; glyphs and selected markers remain visible.
- Existing short surface transitions use existing duration/easing tokens. Reduced-motion
  preference removes transitions; acceptance tests exercise it alongside keyboard focus.

Acceptance mapping: ui-contract.ts measures threshold gestures, repeated zoom, HUD bounds,
panel invariants, Escape and pixels. responsive-acceptance.ts measures seven viewport
policies, whole-target occlusion/hit tests, repeated transitions, native touch scroll/pan,
scroll retention and live breakpoint reconciliation. panels.test.ts verifies pure policy
and idempotent protection. Canvas retains scroll/focus and composition coverage.
Reduced-motion remains executable in ui-contract.ts; no new animation is added.
