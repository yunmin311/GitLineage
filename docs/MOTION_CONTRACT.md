# Motion contract

This gate defines state and invariants; it adds no entrance or layout animation.

- Pointer: idle → pending on primary pointer down → panning after >5 CSS px displacement
  → idle on up/cancel. Crossing the threshold suppresses the ensuing click activation,
  even if the pointer returns to its origin. Pending up retains ordinary click behavior.
- Pan updates camera only. Selection, Rail, Drawer and HUD remain stable. Pointer cancel
  releases capture and does not activate or clear selection.
- Rail/Drawer visibility changes shell overlays only. No implicit fit, scale transition
  or camera reset. Fit/zoom require a user camera action.
- Hover changes a background layer only; glyphs and selected markers remain visible.
- Existing short surface transitions use existing duration/easing tokens. Reduced-motion
  preference removes transitions; acceptance tests exercise it alongside keyboard focus.

Acceptance mapping: ui-contract.ts measures threshold gestures, repeated zoom, HUD bounds,
panel invariants, Escape and pixels. Canvas retains scroll/focus and composition coverage.
