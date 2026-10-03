/**
 * GitLineage Explorer application.
 *
 * Contract notes, because these are the rules that must not drift:
 *
 * 1. The canonical graph from `/api/graph/:owner/:repo` is the source of truth.
 *    Nothing here mutates it and no view field is written back into it.
 * 2. Layout, labels, slots, visibility and counts come from
 *    `/api/view/:owner/:repo`. This file does not decide family, slot or arrow
 *    semantics.
 * 3. **Arrow direction is read from `edge.directed` / `edge.arrow`, both derived
 *    from `relationship.directed` by the server.** There is no code path here
 *    that infers direction from the focused node. `edgeGeometry()` receives the
 *    arrow and places it; it never decides it.
 * 4. Evidence in the drawer is the real record, with locator, observed text and
 *    data. Nothing is summarised.
 */

import {
  parseRepositoryPath,
  resolveRepositoryInput,
  repositoryPath,
  readViewState,
  writeViewState,
  parseLayerState,
  serializeLayerState,
} from './lib/url-state.mjs';
import {
  layoutGraph,
  edgeGeometry,
  fanSlot,
  nodeDegrees,
  isCrowdedEdge,
  fitViewBox,
  zoomViewBox,
  contentBounds,
  nodeAnchor,
  NODE_W,
  NODE_H,
  COL_GAP,
} from './lib/geometry.mjs';
import {
  allLayersOn,
  searchNodes,
  searchEdges,
  edgesForNode,
  layerCount,
  visibleEdges,
  orphanBundles,
} from './lib/search.mjs';
import {
  parseStart,
  parseJob,
  shouldPoll,
  nextDelayMs,
  phaseIndex,
  refusalText,
  VISIBLE_PHASES,
  PHASE_TEXT,
} from './lib/analysis.mjs';
import { evidenceSourceUrl, SIMILARITY_DISCLAIMER } from './lib/evidence-links.mjs';
import { nodePrimitive, nodePrimitiveRadius } from './lib/primitives.mjs';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ZOOM_STEP = 1.25;
/**
 * Above this many parallel relationships, a label is hidden until hover or
 * selection. Dense fans put their labels within a few pixels of each other, and
 * drawn on top of one another they become an unreadable smear. Nothing is lost:
 * the Evidence Drawer always names the relationship type.
 */
const LABEL_FAN_LIMIT = 2;
/** The same rule for node degree: a hub's labels all land near the hub. */
const LABEL_DEGREE_LIMIT = 4;

const state = {
  repository: null,
  view: null,
  graph: null,
  meta: null,
  selectedEdgeId: '',
  selectedNodeId: '',
  layers: allLayersOn(),
  expandedBundles: new Set(),
  query: '',
  depth: 200,
  phase: 'idle',
  cacheHit: false,
  resolvedRevision: '',
  zoom: 1,
  hasFitted: false,
  /** True when the canvas is showing standalone bundle cards. */
  standaloneBundles: false,
  /** Job being observed, when an analysis is in flight. */
  job: null,
  pollTimer: null,
  /** Guards against a stale poll resolving after a newer request started. */
  loadToken: 0,
};

// -------------------------------------------------------------- dom helpers

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) if (child) node.append(child);
  return node;
}

/** SVG element with attributes and optional text children. */
function svgEl(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === undefined || child === null || child === '') continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function setHidden(node, hidden) {
  if (!node) return;
  if (hidden) node.setAttribute('hidden', '');
  else node.removeAttribute('hidden');
}

// -------------------------------------------------------------- url / state

function syncUrl(replace = true) {
  if (!state.repository) return;
  const query = writeViewState({
    edge: state.selectedEdgeId,
    node: state.selectedNodeId,
    layers: serializeLayerState(state.layers),
    search: state.query,
    bundles: [...state.expandedBundles].join(','),
    depth: String(state.depth),
  });
  const next = `${repositoryPath(state.repository)}${query}`;
  if (window.location.pathname + window.location.search === next) return;
  if (replace) window.history.replaceState({}, '', next);
  else window.history.pushState({}, '', next);
}

function readUrlState() {
  const urlState = readViewState(window.location.search);
  state.selectedEdgeId = urlState.edge;
  state.selectedNodeId = urlState.node;
  state.query = urlState.search;
  // An absent `layers` parameter means every layer is on. Parsing the empty
  // string would mean the opposite, so the default is only replaced when the
  // parameter is actually present.
  state.layers = urlState.layers ? parseLayerState(urlState.layers) : allLayersOn();
  state.expandedBundles = new Set(urlState.bundles ? urlState.bundles.split(',') : []);
  if (urlState.depth) {
    const depth = Number(urlState.depth);
    if (Number.isFinite(depth)) state.depth = depth;
  }
}

function navigate(repository, push = true) {
  state.repository = repository;
  state.selectedEdgeId = '';
  state.selectedNodeId = '';
  state.query = '';
  state.expandedBundles = new Set();
  const next = repositoryPath(repository);
  if (push) window.history.pushState({}, '', next);
  void load();
}

// ------------------------------------------------------------------ loading

/**
 * Switches to the explorer shell and shows the working state.
 *
 * The old implementation advanced a label on a timer, which made a fake
 * progress claim. Progress is now rendered from the job the server reports, and
 * this only prepares the frame.
 */
function showWorking() {
  // The landing is left behind as soon as a repository route is resolved, so the
  // working frame is never stacked on top of the marketing page.
  setHidden($('landing'), true);
  setHidden($('explorer'), false);
  setHidden($('empty'), true);
  setHidden($('failure'), true);
  setHidden($('drawer'), true);
  setHidden($('drawer-scrim'), true);
  $('explorer-body').classList.remove('with-drawer');
  setHidden($('legend'), true);
  setHidden($('bundles'), true);
  $('canvas').replaceChildren();
  setChrome('analysing');
}

/**
 * Renders the real job phases.
 *
 * Every step shown is one the server has reported reaching. There is no
 * percentage and no interpolation: between two stages there is nothing honest to
 * show, so nothing is shown.
 */
function renderPhases(status, jobId) {
  const list = $('phases');
  list.replaceChildren();
  const current = phaseIndex(status);
  for (const phase of VISIBLE_PHASES) {
    const reached = VISIBLE_PHASES.indexOf(phase) <= current;
    const item = el('li', {
      class: `phase${phase === status ? ' is-current' : ''}${reached ? ' is-done' : ''}`,
    });
    item.append(el('span', { class: 'phase-dot', 'aria-hidden': 'true' }));
    item.append(el('span', { class: 'phase-text', text: PHASE_TEXT[phase] }));
    list.append(item);
  }
  $('progress-label').textContent = PHASE_TEXT[status] ?? '';
  $('progress-job').textContent = jobId ? `job ${jobId.slice(0, 8)}` : '';
  setHidden($('progress'), false);
}

function hideWorking() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  state.job = null;
  setHidden($('progress'), true);
}

/**
 * Phase label in the app bar.
 *
 * `cached` is stated explicitly whenever the artifact came from the cache, so
 * "reload gives the same result" is visible rather than implied.
 */
function setChrome(label) {
  const chip = $('cache-state');
  if (!chip) return;
  if (state.phase === 'cached') {
    chip.textContent = `cached ${formatDuration(state.meta?.elapsedMs ?? 0)}`;
    chip.className = 'mono cache-chip is-cached';
  } else {
    chip.textContent = label;
    chip.className = 'mono cache-chip';
  }
}

// -------------------------------------------------------------- data loading

/**
 * Loads a repository, starting or joining an analysis job if one is needed.
 *
 * The request that asks for analysis returns as soon as the job is registered,
 * so this never blocks on the analysis itself. It observes the job by polling,
 * and a second browser opening the same URL joins the same job because the server
 * deduplicates on the analysis target rather than on the request.
 */
async function load() {
  if (!state.repository) return;
  readUrlState();
  showWorking();
  state.phase = 'starting';

  // A newer load invalidates any poll still in flight from a previous one.
  const token = (state.loadToken += 1);
  const stale = () => token !== state.loadToken;

  const repo = state.repository;
  const fetchOptions = { headers: { accept: 'application/json' } };

  // Step 1: ask for the analysis. Cheap when it is already cached.
  let start;
  try {
    const response = await fetch(`/api/analysis/${repo.owner}/${repo.name}`, {
      method: 'POST',
      ...fetchOptions,
    });
    start = parseStart(await response.json(), response.headers);
  } catch (error) {
    if (stale()) return;
    hideWorking();
    showFailure({ message: error instanceof Error ? error.message : String(error) });
    return;
  }
  if (stale()) return;

  if (start.kind === 'invalid') {
    hideWorking();
    showFailure({ message: start.message });
    return;
  }
  if (start.kind === 'refused') {
    hideWorking();
    showFailure({ status: 429, message: refusalText(start), retryable: true });
    return;
  }

  // Step 2: a completed artifact needs no waiting at all.
  if (start.kind === 'complete') {
    await fetchView(token);
    return;
  }

  // Step 3: show the phase the server just reported. An accepted job is
  // `queued`, and rendering that immediately is what makes a fast analysis
  // legible rather than a flash of an empty canvas. The server's own state is
  // used, never a guess: it is `queued` unless it said otherwise.
  renderPhases(start.status, start.jobId);
  state.job = { jobId: start.jobId, statusUrl: start.statusUrl };

  // Step 4: observe the job. Polling is the whole transport; no stream is held.
  await pollJob(start, 0, stale);
}

const VIEW_RETRY_DELAY_MS = 1500;

/** Fetches the completed view-model for the current repository. */
async function fetchView(token) {
  if (token !== state.loadToken || !state.repository) return;
  const repo = state.repository;
  let viewEnvelope;
  try {
    const response = await fetch(`/api/view/${repo.owner}/${repo.name}?depth=${state.depth}`, {
      headers: { accept: 'application/json' },
    });
    viewEnvelope = await response.json();
    if (!response.ok || !viewEnvelope.ok) {
      const pending = viewEnvelope?.error?.code === 'analysis_pending';
      throw Object.assign(new Error(viewEnvelope?.error?.message || 'analysis failed'), {
        status: response.status,
        detail: viewEnvelope?.error?.detail,
        pending,
        retryAfterMs: viewEnvelope?.meta?.retryAfterMs,
      });
    }
  } catch (error) {
    if (token !== state.loadToken) return;
    // The job said complete but the artifact is not readable yet: a short
    // retry, not a failure.
    if (error?.pending || error?.status === 202) {
      await sleep(error?.retryAfterMs ?? VIEW_RETRY_DELAY_MS);
      if (token === state.loadToken) await fetchView(token);
      return;
    }
    hideWorking();
    showFailure(error);
    return;
  }
  applyView(viewEnvelope);
}

/**
 * Polls a job until it reaches a terminal phase, then loads the result.
 *
 * Backoff is bounded by `nextDelayMs`, and polling stops on any phase this client
 * does not recognise, so it cannot spin forever.
 */
async function pollJob(job, elapsed, stale) {
  if (stale()) return;
  const { jobId, statusUrl, retryAfterMs } = job;
  state.job = { jobId, statusUrl };

  let status;
  try {
    const response = await fetch(statusUrl, { headers: { accept: 'application/json' } });
    if (response.status === 404) {
      hideWorking();
      showFailure({ message: 'the analysis job is no longer known to the server', retryable: true });
      return;
    }
    status = parseJob(await response.json());
  } catch (error) {
    if (stale()) return;
    // A transient poll failure is retried rather than surfaced.
    const wait = nextDelayMs(retryAfterMs, elapsed);
    await sleep(wait);
    if (!stale()) await pollJob(job, elapsed + wait, stale);
    return;
  }

  // An unrecognised shape stops the loop: better a clear error than an endless poll.
  if (!status) {
    hideWorking();
    showFailure({ message: 'the server reported an analysis state this page does not understand', retryable: true });
    return;
  }

  if (status.status === 'complete') {
    hideWorking();
    await fetchView(state.loadToken);
    return;
  }
  if (status.status === 'failed') {
    hideWorking();
    showFailure({
      message: status.error?.message ?? 'the analysis failed',
      code: status.error?.code,
      retryable: true,
    });
    return;
  }

  renderPhases(status.status, jobId);
  const wait = nextDelayMs(retryAfterMs, elapsed);
  await sleep(wait);
  if (!stale()) await pollJob(job, elapsed + wait, stale);
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.max(0, ms));
    timer.unref?.();
  });
}

/** Renders a completed view-model. */
function applyView(viewEnvelope) {

  const view = viewEnvelope.data;
  const meta = viewEnvelope.meta || {};

  // Only the view endpoint is read. It is a projection of the same canonical
  // graph `/api/graph` returns — the server states that in `meta.derivedFrom` —
  // so a second request would duplicate work for a result the server already
  // holds. The canonical graph remains the source of truth; this file never
  // reconstructs or edits it.
  state.graph = null;

  state.view = view;
  state.meta = meta;
  state.cacheHit = meta.cacheHit === true;
  state.resolvedRevision = meta.resolvedRevision || view.revision.commit;
  state.phase = state.cacheHit ? 'cached' : view.partial.isPartial ? 'partial' : 'complete';

  setHidden($('progress'), true);
  renderChrome(view);
  renderStatusLine(view);

  if (view.empty.isEmpty) {
    setHidden($('empty'), false);
    $('empty-body').textContent = view.empty.reason;
    $('canvas').replaceChildren();
    setHidden($('bundles'), true);
    setHidden($('legend'), true);
    state.phase = 'empty';
    setChrome('no lineage');
    return;
  }

  // The phase chip is the last thing set, so it can never report a stale label.
  setChrome(state.phase === 'partial' ? 'partial' : 'analyzed');
  draw();
  // A shared link arrives with the selection already in the URL, so the drawer is
  // restored from state rather than waiting for a click.
  renderDrawer();
}

function showFailure(error) {
  state.phase = 'failed';
  setHidden($('failure'), false);
  const status = error?.status;
  const code = error?.code;
  $('failure-head').textContent =
    status === 400
      ? 'That does not look like a GitHub repository.'
      : code === 'analysis_rate_limited'
        ? 'Too many analyses from this address.'
        : code === 'analysis_overloaded'
          ? 'The analysis queue is full.'
          : code === 'upstream_rate_limited'
            ? 'GitHub is rate limiting this server.'
            : code === 'upstream_forbidden'
              ? 'This server may not read that repository.'
              : code === 'analysis_timeout' || code === 'interrupted_by_restart'
                ? 'The analysis did not finish.'
                : 'Could not analyse this repository.';
  $('failure-body').textContent =
    error?.detail || error?.message || 'The analyzer returned no result. Try again shortly.';
  // A retryable failure offers a retry rather than a dead end. An upstream rate
  // limit clears by itself, so retrying is reasonable; a refusal will not clear
  // without changing the deployment, so offering a retry would be a dead end.
  const retryable =
    error?.retryable === true || (error?.code === 'upstream_rate_limited' ? true : error?.retryable);
  setHidden($('retry-analysis'), error?.code === 'upstream_forbidden' || retryable !== true);
  $('canvas').replaceChildren();
  setHidden($('bundles'), true);
  setHidden($('legend'), true);
  setChrome('failed');
  renderStatusLine(null);
}

// ------------------------------------------------------------------ chrome

function renderChrome(view) {
  setHidden($('landing'), true);
  setHidden($('explorer'), false);
  setHidden($('appbar-mid'), false);
  setHidden($('appbar-right'), false);
  const repo = state.repository;
  $('crumb-repo').textContent = view.subject.owner && view.subject.name
    ? `${view.subject.owner}/${view.subject.name}`
    : `${repo.owner}/${repo.name}`;
  $('crumb-rev').textContent = state.resolvedRevision.slice(0, 7);
  $('crumb-count').textContent = view.bundledEdgeCount > 0
    ? `${view.primaryEdgeCount} drawn · ${view.bundledEdgeCount} bundled`
    : `${view.primaryEdgeCount} relationships`;
  const open = $('open-source');
  open.href = view.subject.url || `https://github.com/${repo.owner}/${repo.name}`;
  $('repo-input').value = `${repo.owner}/${repo.name}`;
}

function renderStatusLine(view) {
  const line = $('status-line');
  line.replaceChildren();
  if (!view) return;
  const parts = [
    `${view.revision.ref || view.revision.defaultBranch || 'HEAD'} @ ${view.revision.shortCommit}`,
    `analyzed ${formatTime(view.revision.analyzedAt)}`,
    `${view.analyzer.name} ${view.analyzer.version}`,
    `${view.primaryEdgeCount} shown / ${view.edgeCount} one-hop / ${view.edgeCount + view.hiddenRelationshipCount} relationships`,
    `(${view.statusCounts.VERIFIED} verified · ${view.statusCounts.DECLARED} declared · ${view.statusCounts.DETECTED} detected)`,
  ];
  parts.forEach((text, index) => {
    if (index > 0) line.append(el('span', { class: 'sep', text: '·' }));
    line.append(el('span', { text }));
  });
  if (state.cacheHit) {
    line.append(el('span', { class: 'sep', text: '·' }));
    line.append(el('span', { class: 'cache-hit', text: `cached · ${formatDuration(state.meta?.elapsedMs ?? 0)}` }));
  }
}

function formatTime(iso) {
  if (!iso) return '';
  return String(iso).replace('T', ' ').replace(/\..*$/, '').replace('Z', ' UTC');
}

function formatDuration(ms) {
  if (!ms && ms !== 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ------------------------------------------------------------------ drawing

function currentEdges() {
  return visibleEdges(state.view, { layers: state.layers, expandedBundles: state.expandedBundles });
}

/** Pseudo-id for a bundle representative card. Never an entity id. */
const BUNDLE_ID_PREFIX = 'bundle:';

/**
 * Positions for bundle representative cards.
 *
 * Deliberately a layout-only concept: these are cards standing in for grouped
 * relationships, not entities. They are fanned to the right of the subject and
 * are only ever created when nothing else would be drawn.
 */
function bundleAnchorPositions(bundles, positions) {
  const subject = positions.get(state.view.subject.id);
  const originX = subject ? subject.x + COL_GAP * 0.62 : 700;
  const originY = subject ? subject.y : 300;
  return bundles.map((bundle, index) => [
    `${BUNDLE_ID_PREFIX}${bundle.key}`,
    {
      x: originX,
      y: originY + (index - (bundles.length - 1) / 2) * 118,
    },
  ]);
}

function draw() {
  const view = state.view;
  const canvas = $('canvas');
  canvas.replaceChildren();
  if (!view) return;

  const edges = currentEdges();
  const positions = layoutGraph(view, edges);
  // Degree decides label thinning. Parallel-edge count does not: a hub with 20
  // distinct peers has 20 fans of one, and their mid-line labels still collide.
  const degrees = nodeDegrees(edges);

  // Bundles with nothing drawn of their own. `expressjs/express` lands here: 48
  // real relationships, all bundled, so the canvas would otherwise show a lone
  // subject and read exactly like a repository with no lineage.
  const orphans = orphanBundles(view, { layers: state.layers, expandedBundles: state.expandedBundles });
  const standaloneBundles = orphans.length > 0 && edges.length === 0;
  state.standaloneBundles = standaloneBundles;
  if (standaloneBundles) {
    for (const [id, position] of bundleAnchorPositions(orphans, positions)) {
      positions.set(id, position);
    }
  }

  const bounds = contentBounds(positions);
  const viewport = { width: canvas.clientWidth || 1200, height: canvas.clientHeight || 700 };
  if (!state.hasFitted) {
    const fitted = fitViewBox(bounds, viewport);
    canvas.setAttribute('viewBox', fitted.viewBox);
    state.zoom = fitted.zoom;
    state.hasFitted = true;
  }

  const defs = svgEl('defs');
  for (const [id, status, colour] of [
    ['arw-verified', 'VERIFIED', 'var(--verified)'],
    ['arw-declared', 'DECLARED', 'var(--declared)'],
    ['arw-detected', 'DETECTED', 'var(--detected)'],
  ]) {
    const marker = svgEl('marker', {
      id, viewBox: '0 0 10 10', refX: '9', refY: '5',
      markerWidth: '6.5', markerHeight: '6.5', orient: 'auto-start-reverse',
    });
    marker.append(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: colour }));
    defs.append(marker);
  }
  canvas.append(defs);

  const edgeLayer = svgEl('g', { class: 'edge-layer' });
  const nodeLayer = svgEl('g', { class: 'node-layer' });

  const query = state.query ? state.query.toLowerCase() : '';
  const matchedNodes = new Set(searchNodes(view, query));
  const matchedEdges = new Set(searchEdges(view, query));
  const focusMode = query.length > 0 || Boolean(state.selectedNodeId);

  for (const edge of edges) {
    const { fanIndex, fanCount } = fanSlot(edge, edges);
    const geometry = edgeGeometry(edge, positions, fanIndex, fanCount);
    if (!geometry) continue;

    const group = svgEl('g', {
      class: [
        'edge-group',
        `fam-${edge.family}`,
        `st-${edge.status}`,
        state.selectedEdgeId === edge.id ? 'is-selected' : '',
        focusMode && !matchedEdges.has(edge.id) && !isEdgeTouching(edge, matchedNodes) ? 'is-dim' : '',
        matchedEdges.has(edge.id) ? 'is-match' : '',
      ].filter(Boolean).join(' '),
    });
    group.dataset.relationshipId = edge.id;

    group.append(
      svgEl('path', {
        d: geometry.path,
        class: `edge-line fam-${edge.family} st-${edge.status}`,
        // Marker comes from the contract. Never from focus.
        'marker-end': geometry.arrowAt ? `url(#arw-${edge.status.toLowerCase()})` : null,
      }),
    );
    const hit = svgEl('path', { d: geometry.path, class: 'edge-hit' });
    hit.addEventListener('click', (event) => {
      event.stopPropagation();
      selectEdge(edge.id);
    });
    group.append(hit);

    // A crowded edge keeps its label in the DOM but marks the group, so CSS reveals
    // it on hover or selection. Redrawing on hover would rebuild the canvas under
    // the pointer and re-fire the event.
    const crowded = fanCount > LABEL_FAN_LIMIT || isCrowdedEdge(edge, degrees, LABEL_DEGREE_LIMIT);
    if (crowded) group.classList.add('is-dense');
    group.append(
      svgEl('text', { x: geometry.label.x, y: geometry.label.y, class: 'edge-label' }, [edge.label]),
    );
    if (edge.badge) {
      group.append(svgEl('text', { x: geometry.badge.x, y: geometry.badge.y, class: 'edge-badge' }, [edge.badge]));
    }
    if (state.selectedEdgeId === edge.id) {
      group.append(
        svgEl('text', { x: geometry.label.x, y: geometry.label.y + 11, class: 'edge-ontology' }, [
          edge.relationshipType,
        ]),
      );
    }
    edgeLayer.append(group);
  }

  // Bundle representative cards: drawn only when nothing else would be drawn, so
  // a graph with many hidden relationships never looks like an empty one. The
  // connector carries no arrowhead, because a bundle is not a relationship with a
  // direction: it is a count of several.
  if (standaloneBundles) {
    const subject = positions.get(view.subject.id);
    for (const bundle of orphans) {
      const id = `${BUNDLE_ID_PREFIX}${bundle.key}`;
      const position = positions.get(id);
      if (!position || !subject) continue;

      const from = nodeAnchor(subject, position);
      const to = nodeAnchor(position, subject);
      const midX = (from.x + to.x) / 2;
      edgeLayer.append(
        svgEl('path', {
          d: `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`,
          class: 'bundle-link',
        }),
      );

      const group = svgEl('g', {
        class: `bundle-card st-${bundle.status}${state.expandedBundles.has(bundle.key) ? ' is-open' : ''}`,
        role: 'button',
        tabindex: '0',
        'aria-label': `${bundle.count} ${bundle.relationshipType.replace(/_/g, ' ')} relationships, grouped`,
      });
      group.dataset.bundleKey = bundle.key;
      group.append(
        svgEl('rect', {
          x: position.x - 92,
          y: position.y - 30,
          width: 184,
          height: 60,
          rx: 4,
          class: 'bundle-card-box',
        }),
      );
      group.append(
        svgEl('text', { x: position.x - 80, y: position.y - 6, class: 'bundle-card-count' }, [
          `×${bundle.count}`,
        ]),
      );
      group.append(
        svgEl('text', { x: position.x - 80, y: position.y + 15, class: 'bundle-card-label' }, [
          truncate(bundle.relationshipType.replace(/_/g, ' '), 24),
        ]),
      );
      const activate = (event) => {
        event.stopPropagation();
        toggleBundle(bundle.key);
      };
      group.addEventListener('click', activate);
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') activate(event);
      });
      nodeLayer.append(group);
    }
  }

  for (const node of view.nodes) {
    const position = positions.get(node.id);
    if (!position) continue;
    const group = svgEl('g', {
      class: [
        'node',
        node.isSubject ? 'is-subject' : '',
        state.selectedNodeId === node.id ? 'is-selected' : '',
        focusMode && !matchedNodes.has(node.id) ? 'is-dim' : '',
      ].filter(Boolean).join(' '),
    });
    group.dataset.nodeId = node.id;

    // Identity comes from the canonical `entity.type` on the view node, never
    // from `isPackage`. `nodePrimitive` covers the whole canonical union, so a
    // type the design has no primitive for yet still gets its own marker instead
    // of being drawn as a repository.
    const primitive = nodePrimitive(node.type);

    group.append(
      svgEl('rect', {
        x: position.x - NODE_W / 2,
        y: position.y - NODE_H / 2,
        width: NODE_W,
        height: NODE_H,
        rx: nodePrimitiveRadius(node.type),
        class: [
          'node-box',
          node.isSubject ? 'is-subject' : '',
          primitive,
        ].filter(Boolean).join(' '),
      }),
    );
    group.append(
      svgEl('text', { x: position.x - NODE_W / 2 + 10, y: position.y - 3, class: 'node-label' }, [
        truncate(node.label, 22),
      ]),
    );
    if (node.fact) {
      group.append(
        svgEl('text', {
          x: position.x + NODE_W / 2 - 10, y: position.y + 15, class: 'node-fact', 'text-anchor': 'end',
        }, [truncate(node.fact, 22)]),
      );
    }
    if (node.isSubject) {
      // The tag sits above the box: inside it, it collides with the fact line on
      // a node whose fact is long.
      group.append(
        svgEl('text', {
          x: position.x - NODE_W / 2,
          y: position.y - NODE_H / 2 - 7,
          class: 'subject-tag',
        }, ['SUBJECT']),
      );
    }
    const hit = svgEl('rect', {
      x: position.x - NODE_W / 2, y: position.y - NODE_H / 2, width: NODE_W, height: NODE_H, class: 'node-hit',
    });
    hit.addEventListener('click', (event) => {
      event.stopPropagation();
      selectNode(node.id);
    });
    group.append(hit);
    nodeLayer.append(group);
  }

  canvas.append(edgeLayer, nodeLayer);
  renderLegend();
  renderBundles();
  renderLayersPop();
  updateSearchCount();
}

function isEdgeTouching(edge, nodeIds) {
  return nodeIds.has(edge.source) || nodeIds.has(edge.target);
}

/** Expands or collapses a bundle, recording the state in the URL. */
function toggleBundle(key) {
  if (state.expandedBundles.has(key)) state.expandedBundles.delete(key);
  else state.expandedBundles.add(key);
  syncUrl();
  state.hasFitted = false;
  draw();
}

function truncate(text, max) {
  return String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text);
}

/**
 * Line style per family, in one place so the legend, the popover, the drawer and
 * the canvas cannot disagree. Style is presentation only; it never implies a
 * direction — that comes from the relationship.
 */
const FAMILY_STYLE = {
  ancestry: ['solid', '2px'],
  dependency: ['solid', '1.5px'],
  attribution: ['dashed', '1.5px'],
  'source-identity': ['solid', '2px'],
  similarity: ['dotted', '1px'],
};

function renderLegend() {
  const legend = $('legend');
  const view = state.view;
  legend.replaceChildren();
  const labels = {
    ancestry: 'ancestry',
    dependency: 'dependency',
    attribution: 'attribution',
    'source-identity': 'identical',
    similarity: 'similar',
  };
  let shown = 0;
  for (const [family, [style, width]] of Object.entries(FAMILY_STYLE)) {
    const count = view.familyCounts[family] || 0;
    if (!count) continue;
    shown += 1;
    const swatch = el('span', { class: 'layer-swatch' });
    swatch.style.borderTopStyle = style;
    swatch.style.borderTopWidth = width;
    legend.append(el('span', { class: 'legend-item' }, [swatch, `${labels[family]} ${count}`]));
  }
  if (shown === 0) {
    setHidden(legend, true);
    return;
  }
  legend.append(el('span', { class: 'legend-item legend-note', text: 'no arrow = symmetric' }));
  setHidden(legend, false);
}

// -------------------------------------------------------------------- layers

function renderLayersPop() {
  const list = $('layers-list');
  const counts = layerCount(state.view, state.layers);

  // Rows are built once and then updated in place. Replacing them would destroy
  // the button the user just pressed mid-click, which also breaks the
  // outside-click dismissal because the detached node has no ancestors left.
  if (list.childElementCount !== Object.keys(FAMILY_STYLE).length) {
    list.replaceChildren();
    for (const family of Object.keys(FAMILY_STYLE)) {
      const [style, width] = FAMILY_STYLE[family];
      const row = el('button', { class: 'layer-row', type: 'button' });
      row.dataset.family = family;
      const swatch = el('span', { class: 'layer-swatch' });
      swatch.style.borderTopStyle = style;
      swatch.style.borderTopWidth = width;
      row.append(swatch, el('span', { class: 'layer-name', text: family.replace('-', ' ') }), el('span', { class: 'layer-count mono' }));
      list.append(row);
    }
  }

  for (const row of list.children) {
    const family = row.dataset.family;
    if (!family) continue;
    const on = state.layers[family] !== false;
    row.classList.toggle('is-off', !on);
    row.setAttribute('aria-pressed', String(on));
    const count = row.querySelector('.layer-count');
    if (count) count.textContent = String(counts[family] || 0);
  }

  $('layers-note').textContent =
    `${state.view.primaryEdgeCount} of ${state.view.edgeCount} one-hop relationships are drawn. ` +
    `${state.view.bundledEdgeCount} are collapsed into bundles below the canvas and stay openable. ` +
    `Turning a layer off hides edges only; it never changes a relationship type, status or direction.`;
}

function toggleLayers(force) {
  const pop = $('layers-pop');
  const show = force === undefined ? pop.hasAttribute('hidden') : force;
  setHidden(pop, !show);
  $('layers-btn').classList.toggle('on', show);
  $('layers-btn').setAttribute('aria-expanded', String(show));
}

// ------------------------------------------------------------------- bundles

function renderBundles() {
  const box = $('bundles');
  const view = state.view;
  box.replaceChildren();
  if (!view.bundles || view.bundles.length === 0) {
    setHidden(box, true);
    return;
  }
  box.append(
    el('p', {
      class: 'bundles-head mono',
      text: `BUNDLED (${view.bundledEdgeCount} of ${view.edgeCount} one-hop relationships)`,
    }),
  );
  if (state.standaloneBundles) {
    box.append(
      el('p', {
        class: 'bundles-note',
        text: 'These groups are also drawn on the canvas. Click one to expand the real relationships.',
      }),
    );
  }
  for (const bundle of view.bundles) {
    const open = state.expandedBundles.has(bundle.key);
    const row = el('button', { class: `bundle-row ${open ? 'is-open' : ''} st-${bundle.status}`, type: 'button' });
    row.dataset.bundleKey = bundle.key;
    row.append(
      el('span', { class: 'bundle-count mono', text: `×${bundle.count}` }),
      el('span', { class: 'bundle-label', text: bundle.relationshipType.replace(/_/g, ' ') }),
      el('span', { class: 'bundle-status mono', text: bundle.status }),
    );
    row.addEventListener('click', () => toggleBundle(bundle.key));
    box.append(row);
  }
  setHidden(box, false);
}

// ------------------------------------------------------------------ search

function updateSearchCount() {
  if (!state.query) {
    $('search-count').textContent = '';
    return;
  }
  const nodes = searchNodes(state.view, state.query).length;
  const edges = searchEdges(state.view, state.query).length;
  $('search-count').textContent = `${nodes} node${nodes === 1 ? '' : 's'} · ${edges} relationship${edges === 1 ? '' : 's'}`;
}

function toggleSearch(force) {
  const bar = $('searchbar');
  const show = force === undefined ? bar.hasAttribute('hidden') : force;
  setHidden(bar, !show);
  $('search-btn').classList.toggle('on', show);
  $('search-btn').setAttribute('aria-expanded', String(show));
  if (show) $('search-input').focus();
  else clearSearch();
}

/** Closing search with a query active clears it, so dimming never survives. */
function clearSearch() {
  if (!state.query) {
    $('search-input').value = '';
    return;
  }
  state.query = '';
  $('search-input').value = '';
  syncUrl();
  draw();
}

// ------------------------------------------------------------------ drawer

function selectEdge(id) {
  state.selectedEdgeId = state.selectedEdgeId === id ? '' : id;
  state.selectedNodeId = '';
  syncUrl();
  draw();
  renderDrawer();
}

function selectNode(id) {
  state.selectedNodeId = state.selectedNodeId === id ? '' : id;
  if (state.selectedNodeId) state.selectedEdgeId = '';
  syncUrl();
  draw();
  renderDrawer();
}

function clearSelection() {
  state.selectedEdgeId = '';
  state.selectedNodeId = '';
  syncUrl();
  draw();
  renderDrawer();
}

function closeDrawer() {
  clearSelection();
}

function renderDrawer() {
  const drawer = $('drawer');
  const inner = $('drawer-inner');
  const body = $('explorer-body');
  const scrim = $('drawer-scrim');
  inner.replaceChildren();

  const view = state.view;
  // A stale or hand-edited selection resolves to nothing. The URL is corrected
  // instead of leaving an empty drawer open.
  if (state.selectedEdgeId && !view.edges.some((edge) => edge.id === state.selectedEdgeId)) {
    state.selectedEdgeId = '';
  }
  if (state.selectedNodeId && !view.nodes.some((node) => node.id === state.selectedNodeId)) {
    state.selectedNodeId = '';
  }

  const open = Boolean(state.selectedEdgeId || state.selectedNodeId);
  setHidden(drawer, !open);
  setHidden(scrim, !open);
  body.classList.toggle('with-drawer', open);
  if (!open) {
    // Only rewrite the URL if it actually named something that is gone.
    if (window.location.search) syncUrl();
    return;
  }

  const close = el('button', {
    class: 'drawer-close',
    type: 'button',
    title: 'Close (Esc)',
    'aria-label': 'Close evidence drawer',
    text: 'Esc',
    onclick: closeDrawer,
  });
  const block = el('div');

  if (state.selectedEdgeId) {
    const edge = view.edges.find((item) => item.id === state.selectedEdgeId);
    if (edge) block.append(renderEdgeDrawer(edge));
  } else {
    block.append(renderNodeDrawer());
  }

  inner.append(close, block);
}

function nameOf(id) {
  const node = state.view.nodes.find((item) => item.id === id);
  return node ? node.label : id;
}

function renderEdgeDrawer(edge) {
  const view = state.view;
  const wrap = el('div');

  wrap.append(el('p', { class: 'd-eyebrow', text: 'RELATIONSHIP' }));
  wrap.append(el('p', { class: 'd-head', text: capitalise(edge.label) }));
  wrap.append(
    el('p', { class: 'd-sub' }, [
      el('span', { class: 'mono', text: `ontology ${edge.relationshipType}` }),
      document.createTextNode(' · '),
      el('span', { class: 'mono', text: edge.directed ? 'directional' : 'symmetric · no arrowhead' }),
    ]),
  );

  const pair = el('p', { class: 'd-pair' });
  pair.append(
    el('span', { text: nameOf(edge.source) }),
    el('span', { class: 'd-arrow', text: edge.directed ? '→' : '⇄' }),
    el('span', { text: nameOf(edge.target) }),
  );
  wrap.append(pair);

  const pill = el('span', { class: `d-pill st-${edge.status}` });
  const sw = el('span', { class: 'pill-sw' });
  const [style, width] = FAMILY_STYLE[edge.family] ?? FAMILY_STYLE.ancestry;
  sw.style.borderTopStyle = style;
  sw.style.borderTopWidth = width;
  pill.append(sw, edge.status);
  wrap.append(pill);

  // Conditions
  const conditions = el('div', { class: 'd-block' });
  conditions.append(el('p', { class: 'd-block-head', text: 'OBSERVED AT' }));
  const kv = el('dl', { class: 'd-kv' });
  const row = (k, v) => {
    kv.append(el('dt', { text: k }), el('dd', { text: String(v) }));
  };
  row('Revision', `${view.revision.ref || view.revision.defaultBranch || 'HEAD'} @ ${view.revision.shortCommit}`);
  row('Analyzed', formatTime(view.revision.analyzedAt));
  row('Source', state.cacheHit ? `cached (${formatDuration(state.meta?.elapsedMs ?? 0)})` : 'fresh analysis');
  row('Analyzer', `${view.analyzer.name} ${view.analyzer.version}`);
  row('Evidence', `${edge.evidenceCount} record${edge.evidenceCount === 1 ? '' : 's'}`);
  conditions.append(kv);
  wrap.append(conditions);

  // Evidence records
  const records = view.evidenceByRelationship[edge.id] || [];
  const evidenceBlock = el('div', { class: 'd-block' });
  evidenceBlock.append(el('p', { class: 'd-block-head', text: `EVIDENCE (${records.length})` }));
  if (records.length === 0) {
    evidenceBlock.append(el('p', { class: 'mono', text: 'No evidence records inlined.' }));
  }
  for (const record of records) evidenceBlock.append(renderEvidenceCard(record, edge));
  if (edge.evidenceTruncated) {
    evidenceBlock.append(
      el('p', { class: 'mono', text: `showing ${records.length} of ${edge.evidenceCount} evidence records` }),
    );
  }
  wrap.append(evidenceBlock);

  // Why, anchored to the raw record
  const why = el('div', { class: 'd-block' });
  why.append(el('p', { class: 'd-block-head', text: 'WHY THIS IS ' + edge.status }));
  const whyText = verificationSentence(edge, records);
  const whyBox = el('p', { class: `d-why st-${edge.status}` });
  whyBox.textContent = whyText;
  why.append(whyBox);
  wrap.append(why);

  const actions = el('div', { class: 'd-actions' });
  const copy = el('button', { class: 'd-action', text: 'Copy link' });
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      copy.textContent = 'Copied';
    } catch {
      copy.textContent = 'Copy failed';
    }
  });
  const graphLink = el('a', {
    class: 'd-action',
    text: 'graph.json',
    href: `/api/graph/${state.repository.owner}/${state.repository.name}?depth=${state.depth}`,
  });
  graphLink.target = '_blank';
  graphLink.rel = 'noreferrer noopener';
  actions.append(copy, graphLink);
  wrap.append(actions);

  return wrap;
}

function renderEvidenceCard(record, edge) {
  const owner = state.repository.owner;
  const name = state.repository.name;
  const card = el('div', { class: 'd-card' });

  const pill = el('span', { class: `d-pill st-${record.status}`, text: record.status });
  card.append(
    el('div', { class: 'd-card-head' }, [
      el('span', { class: 'd-card-type', text: record.type.toUpperCase() }),
      pill,
    ]),
  );
  if (record.locator) card.append(el('p', { class: 'd-card-loc', text: record.locator }));
  if (record.observedText) card.append(el('blockquote', { class: 'd-quote', text: record.observedText }));

  const data = el('dl', { class: 'd-data' });
  for (const [key, value] of Object.entries(record.data || {})) {
    if (value === null || value === undefined || key === 'relationship_semantics') continue;
    const rendered = Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' && item.length > 14 ? `${item.slice(0, 12)}…` : String(item))).join(', ')
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
    data.append(el('dt', { text: key }), el('dd', { text: truncate(rendered, 140) }));
  }
  card.append(data);

  // GitHub is secondary: the drawer is the primary destination, this is the
  // explicit "open the original" affordance.
  const source = evidenceSourceUrl(record, owner, name);
  if (source) {
    const link = el('a', { class: 'd-src', href: source, target: '_blank', rel: 'noreferrer noopener' });
    link.textContent = 'View source on GitHub ↗';
    card.append(link);
    if (/\/blob\//.test(source) && record.locator && /:\d/.test(record.locator)) {
      card.append(el('p', { class: 'mono', text: `anchor ${anchorOf(record.locator)}` }));
    }
  }
  void edge;
  return card;
}

function anchorOf(locator) {
  const match = /:(\d+)(?:-(\d+))?$/.exec(locator);
  if (!match) return '';
  return match[2] ? `#L${match[1]}-L${match[2]}` : `#L${match[1]}`;
}

function verificationSentence(edge, records) {
  const first = records[0];
  if (edge.relationshipType === 'similar_to') return SIMILARITY_DISCLAIMER;
  if (!first) return 'This relationship has no inlined evidence to cite.';
  const d = first.data || {};
  if (edge.relationshipType === 'shares_exact_content_with') {
    return `Both repositories contain git blob ${d.first_blob || '—'}. Identical content establishes neither origin nor direction, which is why this edge carries no arrowhead.`;
  }
  if (edge.relationshipType === 'shares_history_with') {
    const sample = (d.shared_commit_samples || [])[0] || '—';
    const count = d.shared_commit_count !== undefined ? ` ${d.shared_commit_count} commits are shared.` : '';
    return `Both histories contain commit ${sample}.${count} A shared ancestor cannot establish which repository is the ancestor of the other, which is why this edge carries no arrowhead.`;
  }
  if (edge.relationshipType === 'depends_on') {
    return `Declared in ${first.locator || d.manifest_path || 'a manifest'}. A dependency is a composition statement, not lineage.`;
  }
  if (edge.relationshipType === 'uses_submodule') {
    return `Pinned at ${d.pinned_commit || '—'} in ${d.path || '.gitmodules'}. The submodule URL points at this exact repository; the pin is read from the tree's gitlink entry.`;
  }
  if (first.sourceUrl) return `Reviewable at ${first.sourceUrl}`;
  return `Recorded by ${first.collector}/${first.extractor}.`;
}

function renderNodeDrawer() {
  const view = state.view;
  const node = view.nodes.find((item) => item.id === state.selectedNodeId);
  const wrap = el('div');
  if (!node) return wrap;

  wrap.append(el('p', { class: 'd-eyebrow', text: 'ENTITY' }));
  wrap.append(el('p', { class: 'd-head', text: node.label }));
  wrap.append(el('p', { class: 'd-sub' }, [el('span', { class: 'mono', text: node.id })]));

  const facts = el('div', { class: 'd-block' });
  facts.append(el('p', { class: 'd-block-head', text: 'FACTS' }));
  const kv = el('dl', { class: 'd-kv' });
  kv.append(el('dt', { text: 'type' }), el('dd', { text: node.type }));
  if (node.fact) kv.append(el('dt', { text: 'detail' }), el('dd', { text: node.fact }));
  kv.append(el('dt', { text: 'subject' }), el('dd', { text: node.isSubject ? 'yes (analysed repository)' : 'no' }));
  facts.append(kv);
  wrap.append(facts);

  const related = edgesForNode(view, node.id);
  const relBlock = el('div', { class: 'd-block' });
  relBlock.append(el('p', { class: 'd-block-head', text: `RELATIONSHIPS (${related.length})` }));
  if (related.length === 0) {
    relBlock.append(el('p', { class: 'node-detail', text: 'No one-hop relationship in this view.' }));
  }
  for (const id of related) {
    const edge = view.edges.find((item) => item.id === id);
    if (!edge) continue;
    const other = edge.source === node.id ? edge.target : edge.source;
    const row = el('button', { class: 'bundle-row', text: `${edge.label} · ${nameOf(other)}` });
    row.addEventListener('click', () => {
      state.selectedNodeId = '';
      selectEdge(edge.id);
    });
    relBlock.append(row);
  }
  wrap.append(relBlock);

  if (node.url) {
    const link = el('a', { class: 'd-action', href: node.url, target: '_blank', rel: 'noreferrer noopener', text: 'Open repository ↗' });
    const actions = el('div', { class: 'd-actions' });
    actions.append(link);
    wrap.append(actions);
  }
  return wrap;
}

function capitalise(text) {
  return String(text).charAt(0).toUpperCase() + String(text).slice(1);
}

// --------------------------------------------------------- pan / zoom / fit

let panState = null;

function setupViewport() {
  const canvas = $('canvas');

  // Node hover styling is pure CSS (`.node:hover`), deliberately not a redraw:
  // rebuilding the canvas under the pointer would re-fire hover and loop.

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const focus = clientToGraph(canvas, event.clientX - rect.left, event.clientY - rect.top);
    const current = canvas.getAttribute('viewBox');
    const next = zoomViewBox(current, factor, focus, state.zoom);
    canvas.setAttribute('viewBox', next.viewBox);
    state.zoom = next.zoom;
  }, { passive: false });

  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    panState = { x: event.clientX, y: event.clientY, viewBox: canvas.getAttribute('viewBox') };
    canvas.classList.add('is-panning');
  });
  window.addEventListener('mousemove', (event) => {
    if (!panState) return;
    const rect = canvas.getBoundingClientRect();
    const parts = String(panState.viewBox).split(/\s+/).map(Number);
    const [vx, vy, vw, vh] = parts;
    const dx = ((event.clientX - panState.x) / rect.width) * vw;
    const dy = ((event.clientY - panState.y) / rect.height) * vh;
    canvas.setAttribute('viewBox', `${vx - dx} ${vy - dy} ${vw} ${vh}`);
  });
  window.addEventListener('mouseup', () => {
    panState = null;
    canvas.classList.remove('is-panning');
  });

  canvas.addEventListener('click', (event) => {
    if (event.target === canvas) clearSelection();
  });

  $('zoom-in').addEventListener('click', () => zoomBy(ZOOM_STEP));
  $('zoom-out').addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
  $('zoom-fit').addEventListener('click', () => fit());
  window.addEventListener('resize', () => {
    if (state.view) draw();
  });
}

function clientToGraph(canvas, clientX, clientY) {
  const viewBox = canvas.getAttribute('viewBox').split(/\s+/).map(Number);
  const [vx, vy, vw, vh] = viewBox;
  const rect = canvas.getBoundingClientRect();
  return { x: vx + (clientX / rect.width) * vw, y: vy + (clientY / rect.height) * vh };
}

function zoomBy(factor) {
  const canvas = $('canvas');
  const next = zoomViewBox(canvas.getAttribute('viewBox'), factor, null, state.zoom);
  canvas.setAttribute('viewBox', next.viewBox);
  state.zoom = next.zoom;
}

function fit() {
  if (!state.view) return;
  const canvas = $('canvas');
  const positions = layoutGraph(state.view, currentEdges());
  const bounds = contentBounds(positions);
  const fitted = fitViewBox(bounds, { width: canvas.clientWidth || 1200, height: canvas.clientHeight || 700 });
  canvas.setAttribute('viewBox', fitted.viewBox);
  state.zoom = fitted.zoom;
}

// --------------------------------------------------------------------- boot

function showLanding() {
  setHidden($('landing'), false);
  setHidden($('explorer'), true);
  setHidden($('appbar-mid'), true);
  setHidden($('appbar-right'), true);
  setHidden($('site-foot'), false);
  setHidden($('searchbar'), true);
  toggleLayers(false);
}

function boot() {
  setupViewport();

  $('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const repository = resolveRepositoryInput($('repo-input').value);
    if (!repository) {
      $('repo-input').focus();
      $('repo-input').style.outline = '2px solid var(--alert)';
      setTimeout(() => {
        $('repo-input').style.outline = '';
      }, 1400);
      return;
    }
    navigate(repository);
  });

  for (const button of document.querySelectorAll('.seg-btn')) {
    button.addEventListener('click', () => {
      for (const other of document.querySelectorAll('.seg-btn')) other.classList.remove('is-active');
      button.classList.add('is-active');
      state.depth = Number(button.dataset.depth);
      state.hasFitted = false;
      if (state.repository) void load();
    });
  }

  // A retryable failure re-requests analysis from scratch. The previous job is
  // abandoned; the load token makes its poll inert.
  $('retry-analysis').addEventListener('click', () => {
    setHidden($('failure'), true);
    void load();
  });

  $('layers-btn').addEventListener('click', () => toggleLayers());
  $('search-btn').addEventListener('click', () => toggleSearch());
  $('search-close').addEventListener('click', () => toggleSearch(false));
  $('drawer-scrim').addEventListener('click', () => closeDrawer());

  $('search-input').addEventListener('input', (event) => {
    state.query = event.target.value;
    syncUrl();
    draw();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!$('layers-pop').hasAttribute('hidden')) toggleLayers(false);
      else if (!$('searchbar').hasAttribute('hidden')) toggleSearch(false);
      else clearSelection();
    }
    if (event.key === '/' && document.activeElement !== $('search-input')) {
      event.preventDefault();
      toggleSearch(true);
    }
    if (event.key === 'f' && !event.metaKey && !event.ctrlKey) fit();
  });

  // One delegated handler for both popovers, so the rows keep working after a
  // re-render and the dismissal test uses the composed path rather than
  // `closest`, which cannot see through a detached node.
  $('layers-list').addEventListener('click', (event) => {
    const row = event.target.closest('.layer-row');
    if (!row || !row.dataset.family) return;
    const family = row.dataset.family;
    state.layers[family] = state.layers[family] === false;
    syncUrl();
    draw();
  });

  document.addEventListener('click', (event) => {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    const inside = (selector) => path.some((node) => node instanceof Element && node.matches?.(selector));
    if (!inside('.layers-pop') && !inside('#layers-btn')) toggleLayers(false);
  });

  window.addEventListener('popstate', () => {
    const repository = parseRepositoryPath(window.location.pathname);
    if (repository) {
      state.repository = repository;
      state.hasFitted = false;
      void load();
    } else {
      showLanding();
    }
  });

  // Cold load of /owner/repo must work: the path is parsed before anything else.
  const repository = parseRepositoryPath(window.location.pathname);
  if (repository) {
    state.repository = repository;
    void load();
  } else {
    showLanding();
  }
}

boot();