/** Paired, inspectable endpoint badges when no collision-free line exists.
 * They describe a connection gap, never a replacement relationship or arrow. */
export function connectionFallback(edge, positions, select, attributes = {}) {
  const make = (tag, attrs, text) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, String(value));
    if (text !== undefined) element.textContent = text;
    return element;
  };
  const title = `Connection obstructed: ${edge.source} — ${edge.label || 'group membership'} — ${edge.target}. Select to inspect; no safe line is available.`;
  const group = make('g', {...attributes, 'data-route-fallback': 'true', role: 'button', tabindex: 0, 'aria-label': title});
  for (const id of new Set([edge.source, edge.target])) {
    const point = positions.get(id);
    if (!point) continue;
    const x = point.x - (point.width || 216) / 2 + 12, y = point.y - (point.height || 52) / 2 - 14;
    group.append(make('rect', {x: x - 10, y: y - 10, width: 20, height: 20, rx: 4, fill: 'var(--paper, #fff)', stroke: 'var(--muted, #777)'}),
      make('text', {x, y: y + 4, 'text-anchor': 'middle', fill: 'var(--ink, #222)', 'font-size': 12}, '!'));
  }
  group.append(make('title', {}, title));
  group.addEventListener('click', event => {event.stopPropagation(); select();});
  group.addEventListener('mobile-tap', event => {event.stopPropagation(); select();});
  group.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); event.stopPropagation(); select();}
  });
  return group;
}
