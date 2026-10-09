import { declarationForm, manifestPathOf, declaringPath } from './aggregate.mjs';

/** Height matters for a phone rotated to landscape; desktop/tablet policy stays intact. */
export function phoneViewport(width, height) {
  return width < 768 || (width <= 900 && height <= 500);
}

/** Total partition of the production edges. Paths describe declaring sites, never semantics. */
export function relationGroups(view) {
  const families = new Map();
  for (const edge of view.edges) {
    const cards = view.evidenceByRelationship[edge.id] || [];
    const card = cards[0];
    const form = declarationForm(card);
    const path = manifestPathOf(card) || declaringPath(card);
    const label = form === 'unknown' ? 'Other relationships · structure not classified'
      : `${form} · ${path || 'declaring site not supplied'}`;
    if (!families.has(edge.family)) families.set(edge.family, new Map());
    const groups = families.get(edge.family);
    if (!groups.has(label)) groups.set(label, { label, edges: [], evidenceCount: 0 });
    const group = groups.get(label);
    group.edges.push(edge);
    group.evidenceCount += edge.evidenceCount;
  }
  return [...families].map(([family, groups]) => ({ family, groups: [...groups.values()],
    count: [...groups.values()].reduce((n, g) => n + g.edges.length, 0) }));
}

/** Canvas-only pointer owner. The anchored world point follows the moving pinch midpoint. */
export function installTouchCamera(canvas, { active, read, write }) {
  const points = new Map();
  let baseline = null, suppressed = false;
  const pair = () => [...points.values()].slice(0, 2);
  const centre = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  function rebase() {
    if (!points.size) { baseline = null; canvas.classList.remove('is-panning'); return; }
    const ctm = canvas.getScreenCTM(), camera = read();
    if (points.size >= 2) {
      const [a, b] = pair(), mid = centre(a, b);
      const world = new DOMPoint(mid.x, mid.y).matrixTransform(ctm.inverse());
      baseline = { type: 'pinch', distance: Math.max(1, Math.hypot(a.x-b.x, a.y-b.y)), world, camera };
      suppressed = true;
    } else baseline = { type: 'pending', point: pair()[0], ctm, camera };
  }
  canvas.addEventListener('pointerdown', event => {
    if (!active() || event.pointerType !== 'touch') return;
    if (!points.size) suppressed = false;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    // Capture at canvas even when a glyph owns the tap. Explicit click routing below
    // preserves taps; redraws cannot detach the captured node mid-gesture.
    canvas.setPointerCapture(event.pointerId);
    rebase();
  });
  canvas.addEventListener('pointermove', event => {
    if (!points.has(event.pointerId) || !baseline) return;
    points.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const rect = canvas.getBoundingClientRect();
    if (baseline.type === 'pinch') {
      const [a,b] = pair(), mid = centre(a,b);
      const zoom = Math.max(.25, Math.min(4, baseline.camera.zoom * Math.hypot(a.x-b.x,a.y-b.y)/baseline.distance));
      const width = rect.width / zoom, height = rect.height / zoom;
      write(`${baseline.world.x-(mid.x-rect.left)/zoom} ${baseline.world.y-(mid.y-rect.top)/zoom} ${width} ${height}`, zoom);
    } else {
      const p = pair()[0], dx = p.x-baseline.point.x, dy = p.y-baseline.point.y;
      if (baseline.type === 'pending' && Math.hypot(dx,dy)<=5) return;
      baseline.type = 'pan'; suppressed = true; canvas.classList.add('is-panning');
      const [x,y,w,h] = baseline.camera.viewBox.split(/\s+/).map(Number);
      write(`${x-dx/baseline.ctm.a} ${y-dy/baseline.ctm.d} ${w} ${h}`,baseline.camera.zoom);
    }
  });
  const end = event => {
    if (!points.has(event.pointerId)) return;
    if (event.type !== 'pointerup') suppressed = true;
    const tap = points.size === 1 && baseline?.type === 'pending' && !suppressed && event.type === 'pointerup';
    points.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    rebase();
    if (tap) {
      // Native capture retargets click to SVG: dispatch once to the painted hit owner.
      suppressed = true;
      const target = document.elementFromPoint(event.clientX,event.clientY);
      if (target && canvas.contains(target)) {
        target.dispatchEvent(new CustomEvent('mobile-tap', { bubbles: true }));
      }
    }
  };
  canvas.addEventListener('pointerup',end);
  canvas.addEventListener('pointercancel',end);
  canvas.addEventListener('lostpointercapture',end);
  // A handled tap can replace Graph with Evidence before its compatibility click.
  // Suppress that click at document capture, even if Chromium retargets it to a new card.
  document.addEventListener('pointerdown',event=>{
    if (!canvas.contains(event.target)) suppressed = false;
  },true);
  document.addEventListener('click',event=>{
    const touchClick = event.pointerType === 'touch' || event.sourceCapabilities?.firesTouchEvents;
    if (active() && suppressed && (touchClick || canvas.contains(event.target))) {
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
  return () => { const captured = [...points.keys()]; points.clear(); for (const id of captured) if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id); baseline=null;suppressed=true;canvas.classList.remove('is-panning'); };
}
