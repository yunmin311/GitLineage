/** Shell state only: selection and camera stay owned by the Explorer. */
export function panelMode(width) {
  return width >= 1600 ? 'wide' : width >= 1024 ? 'compact' : width >= 768 ? 'tablet' : 'legacy-mobile';
}
export function initialPanels(width) {
  return { mode: panelMode(width), rail: width >= 1600, evidence: false };
}
export function transitionPanels(current, action) {
  const next = { ...current };
  if (action.type === 'resize') {
    next.mode = panelMode(action.width);
    if (next.mode !== 'wide' && next.evidence) next.rail = false;
  } else if (action.type === 'selection') {
    next.evidence = action.selected;
    if (next.evidence && next.mode !== 'wide') next.rail = false;
  } else if (action.type === 'context') {
    next.rail = action.open;
  }
  return next;
}
export function visiblePanels(state) {
  return { rail: state.rail, drawer: state.evidence && (state.mode === 'wide' || !state.rail) };
}
/** Smallest CSS-pixel translation that puts the entire target in the free rectangle.
 * Never change scale to make an oversized target fit. */
export function protectionPan(target, free, margin = 8) {
  const left = free.left + margin, right = free.right - margin;
  const top = free.top + margin, bottom = free.bottom - margin;
  if (target.width > right-left || target.height > bottom-top) return null;
  const dx = target.left < left ? left-target.left : target.right > right ? right-target.right : 0;
  const dy = target.top < top ? top-target.top : target.bottom > bottom ? bottom-target.bottom : 0;
  return { dx, dy };
}
