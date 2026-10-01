/**
 * GitLineage Explorer client.
 *
 * Contract compliance notes, because these are the rules that must not drift:
 *
 * 1. The canonical graph from `/api/graph/:owner/:repo` is the source of truth.
 *    Nothing here mutates it, and no view field is written back into it.
 * 2. Layout and labels come from `/api/view/:owner/:repo`, the presentation
 *    layer. The client never decides family, slot, or arrow semantics itself.
 * 3. **Arrow direction is read from `viewEdge.directed` and `viewEdge.arrow`,
 *    both derived from `relationship.directed` by the server.** The client has
 *    no code path that infers direction from the focused node. See
 *    `edgeGeometry()` and the `ARROW_RULE` assertion.
 * 4. Evidence rendered in the drawer is the real `Evidence` record, including
 *    locator, observed text and data. There is no summarisation step.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

const state = {
  repository: null,
  graph: null,
  view: null,
  selectedRelationshipId: null,
  selectedNodeId: null,
  depth: 200,
};

/** Bundle keys the user has expanded. Defaults to collapsed for density. */
const expandedBundleKeys = new Set();

// ------------------------------------------------------------------ helpers

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child);
  }
  return node;
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  return node;
}

function setHidden(node, hidden) {
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

// ------------------------------------------------------------------ routing

function parseLocation() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length !== 2) return null;
  const [owner, name] = segments;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return { owner, name };
}

function navigate(repository) {
  const next = `/${repository.owner}/${repository.name}`;
  if (window.location.pathname !== next) window.history.pushState({}, '', next);
  void load(repository);
}

// ------------------------------------------------------------------- render

const SLOT_POSITIONS = {
  subject: { x: 0, y: 0 },
  upstream: { x: 0, y: -1 },
  downstream: { x: 0, y: 1 },
  'shared-near': { x: 1, y: 0 },
  'attribution-far': { x: 1, y: -0.55 },
  dependency: { x: 0.72, y: 0.95 },
  similarity: { x: -1, y: 0 },
};

const NODE_W = 168;
const NODE_H = 52;
const COL_GAP = 330;
const ROW_GAP = 190;

function layout(view, shownEdges) {
  const edges = shownEdges || view.edges.filter((edge) => edge.visibility === 'primary');
  const bySlot = new Map();
  for (const node of view.nodes) {
    const slot = node.slot || 'shared-near';
    if (!bySlot.has(slot)) bySlot.set(slot, []);
    bySlot.get(slot).push(node);
  }
  const positions = new Map();
  const originX = 470;
  const originY = 300;

  positions.set(view.subject.id, { x: originX, y: originY });

  // Nodes with no visible edge are not drawn, so drop them from the layout.
  const connected = new Set([view.subject.id]);
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  for (const [slot, nodes] of bySlot) {
    if (slot === 'subject') continue;
    const base = SLOT_POSITIONS[slot] || SLOT_POSITIONS['shared-near'];
    const members = nodes.filter((node) => connected.has(node.id));
    if (members.length === 0) continue;
    if (base.y === 0) {
      members.forEach((node, index) => {
        const offset = (index - (members.length - 1) / 2) * 74;
        positions.set(node.id, { x: originX + base.x * COL_GAP + offset * (base.x < 0 ? -1 : 1) * 0.9, y: originY });
      });
    } else if (base.x === 0) {
      members.forEach((node, index) => {
        const offset = (index - (members.length - 1) / 2) * (NODE_H + 26);
        positions.set(node.id, { x: originX, y: originY + base.y * ROW_GAP + offset });
      });
    } else {
      members.forEach((node, index) => {
        const offset = (index - (members.length - 1) / 2) * (NODE_H + 22);
        positions.set(node.id, { x: originX + base.x * COL_GAP, y: originY + base.y * ROW_GAP + offset });
      });
    }
  }
  return positions;
}

/**
 * Computes an edge's path, arrowhead and label anchor.
 *
 * `edge.arrow` arrives from the server, derived from `relationship.directed`.
 * The only branch on arrow is 'end' vs 'end-weak', i.e. stroke weight. There is
 * deliberately no logic here that inspects which node is selected.
 *
 * `fanIndex`/`fanCount` handle the case that real data produces constantly:
 * two repositories can be joined by several different relationships at once
 * (for example a fork that also shares history and identical content). Those
 * edges would otherwise be drawn on top of each other and their labels would
 * overprint, so they are bowed apart and their labels staggered.
 */
function edgeGeometry(edge, positions, fanIndex = 0, fanCount = 1) {
  const a = positions.get(edge.source);
  const b = positions.get(edge.target);
  if (!a || !b) return null;

  const start = anchor(a, b);
  const end = anchor(b, a);

  // Bow offset: 0 for a single edge, symmetric spread for parallel edges.
  const spread = fanCount > 1 ? (fanIndex - (fanCount - 1) / 2) * 34 : 0;

  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  // Perpendicular unit vector, so the bow is always visually parallel.
  const px = (-dy / length) * spread;
  const py = (dx / length) * spread;

  const midX = (start.x + end.x) / 2 + px;
  const midY = (start.y + end.y) / 2 + py;

  const path = `M ${start.x} ${start.y} Q ${midX} ${midY} ${end.x} ${end.y}`;

  // Parallel edges share their endpoints, so a label anchored at the midpoint
  // would overprint its neighbours. Each edge in the group is labelled at its
  // own position along the curve, which separates them both along and across it.
  const t = fanCount > 1 ? 0.26 + (fanIndex * 0.48) / Math.max(fanCount - 1, 1) : 0.5;
  const inv = 1 - t;
  const labelPoint = {
    x: inv * inv * start.x + 2 * inv * t * midX + t * t * end.x,
    y: inv * inv * start.y + 2 * inv * t * midY + t * t * end.y,
  };

  if (edge.arrow === 'none') {
    // Symmetric: a plain curve. No arrowhead is created anywhere on it.
    return { start, end, mid: labelPoint, path, arrowAt: null, spread };
  }
  // Directional: the arrowhead sits at the canonical target, set by the server.
  return { start, end, mid: labelPoint, path, arrowAt: end, spread };
}

/** Groups edges by endpoint pair so parallel edges can be bowed apart. */
function fanIndexOf(edge, edges) {
  const key = [edge.source, edge.target].sort().join('|');
  const parallel = edges.filter((item) => [item.source, item.target].sort().join('|') === key);
  return { fanIndex: parallel.indexOf(edge), fanCount: parallel.length };
}

function anchor(node, toward) {
  const dx = toward.x - node.x;
  const dy = toward.y - node.y;
  const halfW = NODE_W / 2 + 6;
  const halfH = NODE_H / 2 + 6;
  if (dx === 0 && dy === 0) return { x: node.x, y: node.y };
  const scaleX = dx === 0 ? Infinity : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Infinity : halfH / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: node.x + dx * scale, y: node.y + dy * scale };
}

function statusClass(status) {
  return `status-${status}`;
}

function familyClass(family) {
  return `family-${family}`;
}

// ----------------------------------------------------------------- drawing

function drawGraph(view) {
  const canvas = document.getElementById('canvas');
  canvas.replaceChildren();
  if (!view || view.edges.length === 0) return;

  // Bundled edges are collapsed by default; the header reports the count.
  const visibleEdges = view.edges.filter((edge) => edge.visibility === 'primary');
  const shown = expandedBundleKeys.size > 0
    ? view.edges.filter((edge) => edge.visibility === 'primary' || expandedBundleKeys.has(edge.bundleKey))
    : visibleEdges;

  const positions = layout(view, shown);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const position of positions.values()) {
    minX = Math.min(minX, position.x - NODE_W);
    maxX = Math.max(maxX, position.x + NODE_W);
    minY = Math.min(minY, position.y - NODE_H);
    maxY = Math.max(maxY, position.y + NODE_H);
  }
  const padding = 90;
  canvas.setAttribute('viewBox', `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`);

  const defs = svgEl('defs');
  for (const [id, className] of [
    ['arrow-verified', 'status-VERIFIED'],
    ['arrow-declared', 'status-DECLARED'],
    ['arrow-detected', 'status-DETECTED'],
  ]) {
    const marker = svgEl('marker', {
      id,
      viewBox: '0 0 10 10',
      refX: '9',
      refY: '5',
      markerWidth: '6',
      markerHeight: '6',
      orient: 'auto-start-reverse',
    });
    const shape = svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: className });
    shape.setAttribute('fill', 'currentColor');
    marker.setAttribute('style', `color: var(--${id.replace('arrow-', '')})`);
    marker.append(shape);
    defs.append(marker);
  }
  canvas.append(defs);

  const edgeLayer = svgEl('g', { class: 'edges' });
  const nodeLayer = svgEl('g', { class: 'nodes' });

  for (const edge of shown) {
    const { fanIndex, fanCount } = fanIndexOf(edge, shown);
    const geometry = edgeGeometry(edge, positions, fanIndex, fanCount);
    if (!geometry) continue;
    const group = svgEl('g', { class: `edge-group ${statusClass(edge.status)} ${familyClass(edge.family)}` });
    group.dataset.relationshipId = edge.id;
    if (state.selectedRelationshipId === edge.id) group.classList.add('is-selected');

    const line = svgEl('path', {
      d: geometry.path,
      class: `edge-line ${familyClass(edge.family)} ${statusClass(edge.status)}`,
      'marker-end': geometry.arrowAt ? `url(#arrow-${edge.status.toLowerCase()})` : null,
    });
    group.append(line);

    const hit = svgEl('path', { d: geometry.path, class: 'edge-hit' });
    hit.addEventListener('click', () => selectRelationship(edge.id));
    group.append(hit);

    // Label anchor: clear of the curve it belongs to. The bow already displaced the
    // curve sideways, so the offset is measured from the bowed position.
    const side = geometry.spread >= 0 ? 1 : -1;
    const clearance = Math.abs(geometry.spread) / 2 + 16;
    const labelX = geometry.mid.x + side * clearance;
    const labelY = geometry.mid.y - 6;
    const label = svgEl('text', { x: labelX, y: labelY, class: 'edge-label' });
    label.textContent = edge.label;
    group.append(label);

    if (edge.badge) {
      const badge = svgEl('text', { x: labelX, y: labelY + 14, class: 'edge-badge' });
      badge.textContent = edge.badge;
      group.append(badge);
    }
    edgeLayer.append(group);
  }

  for (const node of view.nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const group = svgEl('g', { class: `node ${node.isSubject ? 'is-subject' : ''} ${state.selectedNodeId === node.id ? 'is-selected' : ''}` });
    group.dataset.nodeId = node.id;

    const classes = ['node-box'];
    if (node.isSubject) classes.push('subject');
    if (node.isPackage) classes.push('package');

    const box = svgEl('rect', {
      x: position.x - NODE_W / 2,
      y: position.y - NODE_H / 2,
      width: NODE_W,
      height: NODE_H,
      rx: node.isPackage ? 3 : 6,
      class: classes.join(' '),
    });
    group.append(box);

    const label = svgEl('text', { x: position.x - NODE_W / 2 + 10, y: position.y - 4, class: 'node-label' });
    label.textContent = truncate(node.label, 22);
    group.append(label);

    if (node.fact) {
      const fact = svgEl('text', { x: position.x + NODE_W / 2 - 10, y: position.y + 14, class: 'node-fact', 'text-anchor': 'end' });
      fact.textContent = truncate(node.fact, 22);
      group.append(fact);
    }
    if (node.isSubject) {
      const tag = svgEl('text', { x: position.x - NODE_W / 2 + 10, y: position.y + 14, class: 'subject-tag' });
      tag.textContent = 'SUBJECT';
      group.append(tag);
    }

    const hit = svgEl('rect', {
      x: position.x - NODE_W / 2,
      y: position.y - NODE_H / 2,
      width: NODE_W,
      height: NODE_H,
      class: 'node-hit',
    });
    hit.addEventListener('click', () => selectNode(node.id));
    group.append(hit);

    nodeLayer.append(group);
  }

  canvas.append(edgeLayer, nodeLayer);
  renderBundles(view);
  renderLegend(view);
}

/**
 * Bundled secondary relationships.
 *
 * These are collapsed for density, not deleted. Each row carries the real
 * count and expands on click to draw its members, which keeps every edge
 * reachable without widening the default view.
 */
function renderBundles(view) {
  document.getElementById('bundles')?.remove();
  if (!view.bundles || view.bundles.length === 0) return;
  const stage = document.getElementById('stage');
  const box = el('div', { class: 'bundles', id: 'bundles' });
  box.append(el('p', { class: 'bundles-head mono', text: `BUNDLED (${view.bundledEdgeCount} of ${view.edgeCount} one-hop relationships)` }));
  for (const bundle of view.bundles) {
    const open = expandedBundleKeys.has(bundle.key);
    const row = el('button', { class: `bundle-row ${open ? 'is-open' : ''} ${statusClass(bundle.status)}` });
    row.append(el('span', { class: 'bundle-count mono', text: `×${bundle.count}` }));
    row.append(el('span', { class: 'bundle-label', text: bundle.relationshipType.replace(/_/g, ' ') }));
    row.append(el('span', { class: 'mono bundle-status', text: bundle.status }));
    row.addEventListener('click', () => {
      if (expandedBundleKeys.has(bundle.key)) expandedBundleKeys.delete(bundle.key);
      else expandedBundleKeys.add(bundle.key);
      redraw();
    });
    box.append(row);
  }
  stage.append(box);
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderLegend(view) {
  document.querySelector('.legend')?.remove();
  const stage = document.getElementById('stage');
  const legend = el('div', { class: 'legend' });
  const families = [
    ['ancestry', 'solid 2px', 'ancestry'],
    ['dependency', 'solid 1.5px', 'dependency'],
    ['attribution', 'dashed 1.5px', 'attribution'],
    ['source-identity', 'solid 2px', 'identical'],
    ['similarity', 'dotted 1px', 'similar'],
  ];
  for (const [family, stroke, label] of families) {
    if (!view.familyCounts[family]) continue;
    const swatch = el('span', { class: 'legend-swatch' });
    swatch.style.borderTopStyle = stroke.includes('dashed') ? 'dashed' : stroke.includes('dotted') ? 'dotted' : 'solid';
    swatch.style.borderTopWidth = stroke.split(' ')[0];
    legend.append(el('span', { class: 'legend-item' }, [swatch, `${label} ${view.familyCounts[family]}`]));
  }
  if (view.directionContract.symmetric.includes('shares_exact_content_with')) {
    legend.append(el('span', { class: 'legend-item legend-note', text: 'no arrow = symmetric' }));
  }
  stage.append(legend);
}

// ------------------------------------------------------------------ drawer

function selectRelationship(relationshipId) {
  state.selectedRelationshipId = state.selectedRelationshipId === relationshipId ? null : relationshipId;
  updateUrl();
  redraw();
  renderDrawer();
}

function selectNode(nodeId) {
  state.selectedNodeId = state.selectedNodeId === nodeId ? null : nodeId;
  updateUrl();
  redraw();
  renderDrawer();
}

function redraw() {
  drawGraph(state.view);
}

function clearSelection() {
  state.selectedRelationshipId = null;
  state.selectedNodeId = null;
  updateUrl();
  redraw();
  renderDrawer();
}

function updateUrl() {
  const params = new URLSearchParams();
  if (state.selectedRelationshipId) params.set('edge', state.selectedRelationshipId);
  if (state.selectedNodeId) params.set('node', state.selectedNodeId);
  if (state.depth !== 200) params.set('depth', String(state.depth));
  const query = params.toString();
  const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  window.history.replaceState({}, '', next);
}

function renderDrawer() {
  const drawer = document.getElementById('drawer');
  const inner = document.getElementById('drawer-inner');
  const body = document.querySelector('.explorer-body');
  inner.replaceChildren();

  if (!state.selectedRelationshipId) {
    setHidden(drawer, true);
    body.classList.remove('with-drawer');
    return;
  }
  setHidden(drawer, false);
  body.classList.add('with-drawer');

  const view = state.view;
  const edge = view.edges.find((item) => item.id === state.selectedRelationshipId);
  if (!edge) return;

  const nameOf = (id) => {
    const node = view.nodes.find((item) => item.id === id);
    return node ? node.label : id;
  };

  const wrap = el('div', { class: 'd-drawer' });
  wrap.append(el('button', { class: 'd-close', text: 'Esc', onclick: clearSelection }));

  // Section 1: the claim
  const s1 = el('div', { class: 'd-section' });
  s1.append(el('p', { class: 'd-head', text: capitalise(edge.label) }));
  const pill = el('span', { class: `d-pill ${statusClass(edge.status)}` });
  const sw = el('span', { class: 'd-pill-sw' });
  sw.style.borderTopStyle = edge.family === 'attribution' ? 'dashed' : edge.family === 'similarity' ? 'dotted' : 'solid';
  pill.append(sw, edge.status);
  s1.append(el('p', { class: 'd-anchor-ok', text: `${nameOf(edge.source)} → ${nameOf(edge.target)}` }));
  s1.append(pill);
  s1.append(el('dl', { class: 'd-kv' }, [
    el('dt', { text: 'direction' }),
    el('dd', { text: edge.directed ? 'directional' : 'symmetric (no arrow)' }),
    el('dt', { text: 'role' }),
    el('dd', { text: edge.subjectRole }),
  ]));
  wrap.append(s1);

  // Section 2: conditions
  const s2 = el('div', { class: 'd-section' });
  s2.append(el('dl', { class: 'd-kv' }, [
    el('dt', { text: 'resolved at' }),
    el('dd', { text: `${view.revision.ref || view.revision.defaultBranch || 'HEAD'} @ ${view.revision.shortCommit}` }),
    el('dt', { text: 'analyzed' }),
    el('dd', { text: view.revision.analyzedAt }),
    el('dt', { text: 'analyzer' }),
    el('dd', { text: `${view.analyzer.name} ${view.analyzer.version}` }),
  ]));
  wrap.append(s2);

  // Section 3: the actual Evidence records
  const evidence = view.evidenceByRelationship[edge.id] || [];
  const s3 = el('div', { class: 'd-section' });
  s3.append(el('p', { class: 'd-evidence-count', text: `EVIDENCE (${evidence.length})` }));
  if (evidence.length === 0) {
    s3.append(el('p', { class: 'mono', text: 'No evidence cards inlined for this relationship.' }));
  }
  for (const record of evidence) {
    s3.append(evidenceCard(record));
  }
  if (edge.evidenceTruncated) {
    s3.append(el('p', { class: 'mono', text: `showing ${evidence.length} of ${edge.evidenceCount} evidence records` }));
  }
  wrap.append(s3);

  // Section 4: the verification anchor
  const s4 = el('div', { class: 'd-section' });
  s4.append(el('p', { class: 'd-verification', text: verificationSentence(edge, evidence) }));
  wrap.append(s4);

  inner.append(wrap);
}

function evidenceCard(record) {
  const card = el('div', { class: 'd-card' });
  const head = el('div', { class: 'd-card-head' }, [
    el('span', { class: 'd-card-type', text: record.type.toUpperCase() }),
    el('span', { class: `d-pill ${statusClass(record.status)}`, text: record.status }),
  ]);
  card.append(head);
  if (record.locator) card.append(el('p', { class: 'd-card-loc', text: record.locator }));
  if (record.observedText) card.append(el('blockquote', { class: 'd-quote', text: record.observedText }));

  const dataList = el('dl', { class: 'd-data' });
  for (const [key, value] of Object.entries(record.data)) {
    if (value === null || value === undefined) continue;
    if (key === 'relationship_semantics') continue;
    const rendered = Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' && item.length > 12 ? `${item.slice(0, 12)}…` : String(item))).join(', ')
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
    dataList.append(el('dt', { text: key }), el('dd', { text: truncate(rendered, 120) }));
  }
  card.append(dataList);

  if (record.sourceUrl) {
    const link = el('a', { class: 'd-src', href: record.sourceUrl, target: '_blank', rel: 'noreferrer noopener' });
    link.textContent = 'View on GitHub ↗';
    card.append(link);
    if (record.locator && /:\d/.test(record.locator)) {
      card.append(el('p', { class: 'mono', text: record.locator }));
    }
  }
  return card;
}

function verificationSentence(edge, evidence) {
  const first = evidence[0];
  if (!first) return 'This relationship has no inlined evidence to cite.';
  if (edge.relationshipType === 'shares_exact_content_with') {
    return `Both repositories contain git blob ${first.data.first_blob ?? '—'}. Identical content establishes neither origin nor direction.`;
  }
  if (edge.relationshipType === 'shares_history_with') {
    return `Both repositories contain commit ${(first.data.shared_commit_samples ?? [])[0] ?? '—'}. A shared ancestor establishes common history, not an order.`;
  }
  if (edge.relationshipType === 'similar_to') {
    return 'Similarity does not establish provenance or direction of copying.';
  }
  if (edge.relationshipType === 'depends_on') {
    return `Declared in ${first.locator ?? first.data.manifest_path ?? 'a manifest'}. A dependency is not an ancestor.`;
  }
  if (first.sourceUrl) {
    return `Reviewable at ${first.sourceUrl}`;
  }
  return `Recorded by ${first.collector}/${first.extractor}.`;
}

function capitalise(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// -------------------------------------------------------------- status line

function renderStatusLine(view) {
  const line = document.getElementById('status-line');
  line.replaceChildren();
  const parts = [
    `${view.revision.ref || view.revision.defaultBranch || 'HEAD'} @ ${view.revision.shortCommit}`,
    `analyzed ${view.revision.analyzedAt}`,
    `${view.analyzer.name} ${view.analyzer.version}`,
    `${view.primaryEdgeCount} shown / ${view.edgeCount} one-hop / ${view.edgeCount + view.hiddenRelationshipCount} relationships`,
    `(${view.statusCounts.VERIFIED} verified · ${view.statusCounts.DECLARED} declared · ${view.statusCounts.DETECTED} detected)`,
  ];
  parts.forEach((text, index) => {
    if (index > 0) line.append(el('span', { class: 'sep', text: '·' }));
    line.append(el('span', { text }));
  });
}

// ------------------------------------------------------------------ loading

const PHASES = [
  'Resolving repository',
  'Reading repository metadata and fork records',
  'Reading manifests and documents',
  'Comparing bounded git history',
  'Drawing the lineage map',
];

let phaseTimer = null;

function showLoading() {
  setHidden(document.getElementById('loading'), false);
  setHidden(document.getElementById('empty'), true);
  setHidden(document.getElementById('error'), true);
  document.getElementById('canvas').replaceChildren();
  let index = 0;
  const label = document.getElementById('loading-label');
  label.textContent = PHASES[0];
  if (phaseTimer) clearInterval(phaseTimer);
  phaseTimer = setInterval(() => {
    index = Math.min(index + 1, PHASES.length - 1);
    label.textContent = PHASES[index];
  }, 1400);
  setState('loading');
}

function hideLoading() {
  if (phaseTimer) clearInterval(phaseTimer);
  setHidden(document.getElementById('loading'), true);
}

function setState(text) {
  document.getElementById('state').textContent = text;
}

async function load(repository) {
  state.repository = repository;
  state.selectedRelationshipId = null;
  state.selectedNodeId = null;

  document.getElementById('crumb-repo').textContent = `${repository.owner}/${repository.name}`;
  document.getElementById('landing').setAttribute('hidden', '');
  setHidden(document.getElementById('explorer'), false);
  document.getElementById('repo-input').value = `${repository.owner}/${repository.name}`;

  const source = document.getElementById('open-source');
  source.href = `https://github.com/${repository.owner}/${repository.name}`;
  setHidden(source, false);

  showLoading();

  try {
    const response = await fetch(`/api/view/${repository.owner}/${repository.name}?depth=${state.depth}`);
    const envelope = await response.json();
    if (!response.ok || !envelope.ok) {
      throw Object.assign(new Error(envelope?.error?.message || 'analysis failed'), {
        detail: envelope?.error?.detail,
      });
    }
    const view = envelope.data;

    const graphResponse = await fetch(`/api/graph/${repository.owner}/${repository.name}?depth=${state.depth}`);
    const graphEnvelope = await graphResponse.json();
    if (graphResponse.ok && graphEnvelope.ok) state.graph = graphEnvelope.data;

    state.view = view;
    hideLoading();
    renderStatusLine(view);
    applyQueryState();

    if (view.empty.isEmpty) {
      setHidden(document.getElementById('empty'), false);
      document.getElementById('empty-body').textContent = view.empty.reason;
      setState('no lineage');
      document.getElementById('canvas').replaceChildren();
      renderDrawer();
      return;
    }

    drawGraph(view);
    renderDrawer();
    setState(view.partial.isPartial ? 'partial result' : 'ready');
  } catch (error) {
    hideLoading();
    setHidden(document.getElementById('error'), false);
    document.getElementById('error-head').textContent =
      error?.status === 404 ? 'Repository not found on GitHub.' : 'Could not analyse this repository.';
    document.getElementById('error-body').textContent = error?.detail || error?.message || 'Unknown error.';
    document.getElementById('canvas').replaceChildren();
    setState('error');
  }
}

function applyQueryState() {
  const params = new URLSearchParams(window.location.search);
  state.selectedRelationshipId = params.get('edge');
  state.selectedNodeId = params.get('node');
  if (state.selectedRelationshipId || state.selectedNodeId) {
    // Focusing a node never changes edge direction: redraw reads the same
    // `directed` flags and only changes the dimming.
    redraw();
    renderDrawer();
  }
}

// --------------------------------------------------------------------- boot

function boot() {
  document.getElementById('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = document.getElementById('repo-input').value.trim();
    const cleaned = value
      .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
      .replace(/^github\.com\//i, '')
      .replace(/\.git$/i, '')
      .replace(/\/+$/, '');
    const segments = cleaned.split('/').filter(Boolean);
    if (segments.length < 2) {
      setState('enter owner/repo');
      return;
    }
    navigate({ owner: segments[0], name: segments[1] });
  });

  for (const button of document.querySelectorAll('.seg-btn')) {
    button.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.seg-btn')) other.classList.remove('is-active');
      button.classList.add('is-active');
      state.depth = Number(button.dataset.depth);
      if (state.repository) void load(state.repository);
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') clearSelection();
  });

  window.addEventListener('popstate', () => {
    const repository = parseLocation();
    if (repository) void load(repository);
    else showLanding();
  });

  const repository = parseLocation();
  if (repository) void load(repository);
  else showLanding();
}

function showLanding() {
  setHidden(document.getElementById('explorer'), true);
  document.getElementById('landing').removeAttribute('hidden');
  setHidden(document.getElementById('open-source'), true);
  setState('idle');
}

boot();