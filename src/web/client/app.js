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
import { nodePrimitive, nodePrimitiveRadius, depthTier, depthClass, depthOffset, depthShadowClass } from './lib/primitives.mjs';
import { RefitTrigger, shouldRefit } from './lib/camera.mjs';
import {
  PHASES, SETTLED_PHASE, arcSegment, tracerPoint, phaseLabel, phaseTransition, isSettled,
  phaseIndex as tracerPhaseIndex,
} from './lib/phases.mjs';
import { buildComposition, plateRows, plateHiddenRows, PLATE_MEMBER_ROWS } from './lib/aggregate.mjs';
import { Regime, regimeFor, partitionPeers, isHomogeneousFan } from './lib/regime.mjs';
import {
  WORLD, ZONES, subjectPosition, dataZonePositions, loosePositions, initialViewBox, viewBoxFor,
  frameTransform,
} from './lib/compose.mjs';
import { DRAWABLE_CAPACITY } from './lib/regime.mjs';

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
  /**
   * Set when the scene is replaced rather than rearranged: a different
   * repository, or the same one at a different depth. Only then may the camera
   * refit. Local changes (aggregate expansion, selection, Drawer) never set it,
   * so the camera survives them untouched.
   */
  refitPending: false,
  /** True when the canvas is showing standalone bundle cards. */
  standaloneBundles: false,
  /** Peers the authored field could not hold, so the count is never silently lost. */
  placementOverflow: 0,
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
  // A different repository is a different dataset, so the camera refits. This
  // previously inherited the previous repository's framing.
  state.refitPending = true;
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
  setHidden($('bundles'), true);
  $('canvas').replaceChildren();
  setChrome('analysing');
}

/*
 * The tracer: seven segments on an open arc, and one dot.
 *
 * Every mark is placed from `arcSegment()` and the dot from `tracerPoint()`, both of
 * which read the same angle table. That shared geometry is the whole point: a mark
 * anywhere the dot never reaches would be telling the reader about work the analyser
 * did not do, and a dot that rested on a seam between two segments would be
 * reporting a phase that does not exist.
 */
function renderTracer(tracer, index) {
  const host = tracer.querySelector('.tracer-arc');
  if (!host) return;
  if (host.childElementCount !== PHASES.length) {
    host.replaceChildren(...PHASES.map((_, at) => svgEl('path', {
      class: 'tracer-seg',
      'data-at': String(at),
      d: arcSegment(at),
    })));
  }
  for (const seg of host.children) {
    const at = Number(seg.dataset.at);
    seg.classList.toggle('is-done', at < index);
    seg.classList.toggle('is-current', at === index);
  }
  const dot = tracer.querySelector('.tracer-dot');
  if (dot) {
    const at = tracerPoint(index);
    dot.setAttribute('cx', String(at.x));
    dot.setAttribute('cy', String(at.y));
  }
}

/**
 * The analysis tracer and the phase strip.
 *
 * The tracer eases to the phase the analyser has actually reported and stops there.
 * There is no percentage anywhere: the server reports a phase only once it has reached
 * it, and between two phases there is nothing honest to interpolate. A re-render at
 * the same phase does not restart the animation, because the client polls repeatedly
 * while an analysis runs and a twitching dot would read as instability.
 *
 * Under `prefers-reduced-motion` the tracer arrives immediately. It still shows the
 * phase, so the information never depends on the animation.
 */
function renderPhases(status, jobId) {
  const tracer = $('tracer');
  const list = $('phases');
  const strip = $('strip');
  if (!tracer || !list) return;

  const index = tracerPhaseIndex(status);
  const settled = isSettled(status);
  const moving = phaseTransition(state.phase, status);

  list.replaceChildren();
  for (const phase of PHASES) {
    const at = PHASES.indexOf(phase);
    const item = el('div', {
      class: [
        'phase',
        phase === status ? 'is-current' : '',
        at < index || settled ? 'is-done' : '',
        phase === SETTLED_PHASE && settled ? 'is-settled' : '',
      ].filter(Boolean).join(' '),
      'data-phase': phase,
    });
    item.append(el('i', { class: 'pm', 'aria-hidden': 'true' }));
    // The ordinal is mono because it is a number in a technical list, and it is the
    // part that survives the narrowest breakpoint when the names are dropped.
    item.append(el('span', { class: 'phase-n', text: String(at + 1).padStart(2, '0') }));
    item.append(el('span', { class: 'phase-name', text: phaseLabel(phase) }));
    if (jobId) item.append(el('span', { class: 'phase-ev', text: jobId.slice(0, 8) }));
    list.append(item);
  }

  renderTracer(tracer, index);

  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // One transition per phase change, never per render.
  tracer.dataset.phase = String(index);
  tracer.dataset.settled = settled ? 'true' : 'false';
  tracer.dataset.moving = moving && !reduced ? 'true' : 'false';
  tracer.setAttribute('role', 'img');
  tracer.setAttribute('aria-label', `${phaseLabel(status)}, ${index + 1} of ${PHASES.length}`);

  if (strip) strip.hidden = false;
  setHidden($('stages'), false);

  state.phase = status;
}

/**
 * Test-only stepper for the analysis tracer.
 *
 * The tracer is driven by whatever phase the server last reported, so verifying its
 * motion in a browser means driving it through the real phase sequence rather than
 * waiting for an analysis to happen to be slow at the right moment. This is only
 * reachable when the page is opened with `?tracer-test`, and it calls the same
 * `renderPhases` the polling loop does, so what is measured is the shipped code path
 * and not a stand-in for it.
 */
function installTracerTestStepper() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (params.get('tracer-test') !== '1') return;
  window.__setPhaseForTest = (phase) => {
    state.phase = state.phase ?? 'queued';
    renderPhases(phase, 'tracer-test');
  };
}

function hideWorking() {
  if (state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }
  state.job = null;
  setHidden($('strip'), true);
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

  setHidden($('strip'), true);
  renderChrome(view);

  if (view.empty.isEmpty) {
    setHidden($('empty'), false);
    $('empty-body').textContent = view.empty.reason;
    $('canvas').replaceChildren();
    setHidden($('bundles'), true);
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
  setChrome('failed');
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
  /*
   * The app bar states the size of the graph, not the composition's internal split.
   *
   * It used to read `0 drawn · 14 bundled`, which is true of the view model's
   * primary/bundled bookkeeping and useless to a reader: the canvas plainly shows
   * eight named relationships, so "0 drawn" read as "nothing is here". The honest
   * summary is the frozen design's own — how many relationships, how many verified.
   */
  $('crumb-count').textContent =
    `${view.edgeCount} one-hop · ${view.statusCounts.VERIFIED} verified`;
  const open = $('open-source');
  open.href = view.subject.url || `https://github.com/${repo.owner}/${repo.name}`;
  $('repo-input').value = `${repo.owner}/${repo.name}`;
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
const PLATE_W = 184;
/**
 * An expanded plate is wider because each row carries a label and the file that
 * declares it. At the collapsed width the two overprinted each other and neither
 * could be read, which a DOM measurement cannot see because both elements exist.
 */
const PLATE_W_EXPANDED = 344;
const PLATE_HEADER = 34;
/** The line under a plate's title that names where the claim was written down. */
const PLATE_SUBTITLE = 22;
const PLATE_ROW = 26;

/**
 * Room for a row's evidence mark and its direction arrow, before the label starts.
 *
 * Measured, not guessed: the mark is 7 wide at a 12 inset and the arrow ends 4 past
 * its own origin, so a 16-unit allowance put the label's first glyph underneath the
 * arrow. Every row in the plate overprinted its own name, and the damage is
 * invisible to a DOM check because both elements are present and correctly placed.
 */
const ROW_MARK_W = 26;

/**
 * Plate height.
 *
 * A shut plate is its header plus the open affordance. An open one adds a row per
 * listed member, plus a line when it is holding some back. A plate that knows which
 * file declares it carries that as a subtitle, which costs a line and is the only
 * place the reader is told that the grouping is about *where* the claim was written
 * rather than what it claims.
 *
 * Every caller derives the height from this one function, so the reserved space and
 * the drawn box cannot disagree -- which is what previously let a plate's rows sit
 * outside its own border.
 */
function plateHeader(plate) {
  return PLATE_HEADER + (plate.meta ? PLATE_SUBTITLE : 0);
}

function plateHeight(rowCount, hiddenRows = 0, hasSubtitle = false) {
  const header = PLATE_HEADER + (hasSubtitle ? PLATE_SUBTITLE : 0);
  const rows = rowCount + (hiddenRows > 0 ? 1 : 0);
  return header + (rows > 0 ? rows * PLATE_ROW : 14) + 12;
}

/**
 * Puts the world's HTML layer through the camera's own transform.
 *
 * The bottom band is authored in world units, exactly as the canvas geometry is. It is
 * put through the identical mapping the SVG's `viewBox` performs, so it lands on the
 * world coordinate it annotates at every zoom and every pan. Deriving both from one
 * function is what keeps the authored composition intact everywhere instead of only at
 * the viewport it happened to be designed at.
 *
 * It takes the live `viewBox`, not just the viewport, because with a fixed world the
 * camera is the window: panning moves the overlays too, and reading only the viewport
 * would leave the band behind at the world's origin the first time a reader dragged.
 */
function applyFrameTransform(viewport, viewBox) {
  const stage = $('stage');
  if (!stage) return;
  const t = frameTransform(viewport, viewBox);
  stage.style.setProperty('--frame-scale', String(t.scale));
  stage.style.setProperty('--frame-x', `${t.x}px`);
  stage.style.setProperty('--frame-y', `${t.y}px`);
  stage.style.setProperty('--world-w', `${WORLD.width}px`);
  stage.style.setProperty('--world-h', `${WORLD.height}px`);
}

/**
 * Plates stand in the data zone to the right of the subject.
 *
 * They are stacked downward from the subject's own line so the tie from subject to
 * plate stays short and readable instead of fanning into long diagonals. The
 * stack is measured rather than pitched on a fixed interval, so an expanded plate
 * grows into the space below it and never overlaps its neighbour.
 */
/**
 * Places everything on the authored frame.
 *
 * The subject is fixed. Plates stack down the right-hand data zone from its
 * authored top, so every subject-to-plate tie is short and near-horizontal
 * instead of fanning into long diagonals. Loose relationships are placed on a
 * downward-opening arc around the subject, so a small graph reads as a
 * constellation rather than as mechanical columns, and nothing lands in the empty
 * upper field.
 */
function authoredPositions(view, edges, composition) {
  const positions = new Map();
  const subject = subjectPosition();
  positions.set(view.subject.id, subject);

  // Plates first: their heights decide where the loose arc has room to sit.
  const plateEntries = composition.plates.map((plate) => {
    const rows = plateRows(plate);
    return { height: plateHeight(rows.length, plateHiddenRows(plate), !!plate.meta) };
  });
  const plateSlots = dataZonePositions(plateEntries);
  composition.plates.forEach((plate, index) => {
    const slot = plateSlots[index];
    positions.set(`${BUNDLE_ID_PREFIX}${plate.key}`, {
      x: slot.x,
      y: slot.y + slot.height / 2,
      height: slot.height,
    });
  });

  // Loose relationships: the endpoints of the relationships actually drawn, in the
  // regime's ranked order, so slot position never decides visual importance.
  const nodeIds = [];
  for (const edge of edges) {
    for (const id of [edge.source, edge.target]) {
      if (id !== view.subject.id && !nodeIds.includes(id)) nodeIds.push(id);
    }
  }
  const slots = nodeIds.map((id) => (view.nodes.find((n) => n.id === id) || {}).slot || 'dependency');
  // Plates are handed to the placement as obstacles, so a loose node can never
  // land on top of one. Measured overlap was 1 before this was passed.
  // The plate's real drawn extent, not a worst case. Reserving the expanded width
  // for every plate blocked the right-hand column of the field and silently halved
  // how many peers the scene could show.
  const obstacles = composition.plates.map((plate, index) => {
    const rows = plateRows(plate);
    const slot = plateSlots[index];
    const left = slot.x - PLATE_W / 2;
    const width = rows.length > 0 ? PLATE_W_EXPANDED : PLATE_W;
    return {
      x: left + width / 2,
      y: slot.y + slot.height / 2,
      hw: width / 2,
      hh: slot.height / 2,
    };
  });
  const placement = loosePositions(nodeIds.length, slots, [subject], obstacles);
  // The regime sizes the direct set to what the field holds, so this is expected to
  // be zero. It is still tracked rather than assumed, because a mismatch would mean
  // relationships are missing from the scene, and that must be visible in review.
  state.placementOverflow = placement.overflowed;
  nodeIds.forEach((id, index) => {
    const at = placement.positions[index];
    if (at) positions.set(id, at);
  });

  return positions;
}

/**
 * Relationships the reader has chosen to see: every one-hop relationship, minus
 * whatever a switched-off layer hides.
 *
 * Every one-hop relationship is offered onward, not just the ones the view-model
 * marked `primary`. That split was the old mechanism for controlling density; the
 * composition now makes that decision itself, and filtering to `primary` first
 * would hand it an empty canvas for exactly the repositories that most need
 * aggregating.
 */
function visibleCandidates(view) {
  return view.edges.filter((edge) => state.layers[edge.family] !== false);
}

/*
 * L : the context rail.
 *
 * Contextual and reference information, not topology, so it is flat: no depth
 * tier, no shadow, no offset. Everything is read from the view model, so a block
 * can only show what the analysis actually established. Where the frozen design
 * has a block and the data has no honest equivalent, the block is omitted rather
 * than filled with an invented number.
 */
function renderRail(view) {
  const rail = $('rail');
  if (!rail) return;
  rail.replaceChildren();

  const block = (heading, body) => {
    const section = el('div', { class: 'lblk' });
    section.append(el('h6', { text: heading }));
    for (const child of body) section.append(child);
    rail.append(section);
  };

  // Provenance: what was analysed, and by what. Real revision, real analyzer.
  const provenance = el('div', { class: 'statline' });
  provenance.append(el('b', { text: view.subject?.label ?? '' }));
  provenance.append(el('span', {
    class: 'k',
    text: `${view.revision.ref || view.revision.defaultBranch || 'HEAD'} @ ${view.revision.shortCommit}`,
  }));
  provenance.append(el('span', {
    class: 'k',
    text: `analysed ${formatTime(view.revision.analyzedAt)} \u00b7 ${view.analyzer.name} ${view.analyzer.version} \u00b7 schema ${view.schemaVersion}`,
  }));
  block('provenance', [provenance]);

  // Status: the real counts, with no interpretation added to them.
  const status = el('div', { class: 'statline' });
  status.append(el('span', {
    class: 'k',
    text: `${view.statusCounts.VERIFIED} verified \u00b7 ${view.statusCounts.DECLARED} declared \u00b7 ${view.statusCounts.DETECTED} detected`,
  }));
  status.append(el('span', {
    class: 'k',
    text: `${view.edgeCount} one-hop of ${view.edgeCount + view.hiddenRelationshipCount} relationships`,
  }));
  block('status', [status]);

  // Census: a count per family. Lightweight and flat -- reference information
  // about the shape of the graph, not a second diagram competing with the canvas.
  const families = Object.entries(view.familyCounts || {}).filter(([, count]) => count > 0);
  if (families.length > 0) {
    const census = el('div', { class: 'census' });
    for (const [family, count] of families) {
      const cell = el('div', { class: 'cc' });
      cell.append(el('span', { class: 'k', text: family.replace('-', ' ') }));
      cell.append(el('span', { class: 'v', text: String(count) }));
      census.append(cell);
    }
    block('relationship census', [census]);
  }

  // Entity key: only the canonical types this graph actually contains, so the key
  // cannot advertise a primitive that is not on screen.
  const typeCounts = new Map();
  for (const node of view.nodes) typeCounts.set(node.type, (typeCounts.get(node.type) || 0) + 1);
  if (typeCounts.size > 0) {
    const key = el('div', { class: 'tkey' });
    for (const [type, count] of [...typeCounts].sort()) {
      const row = el('div', { class: 'tk-row' });
      const glyph = el('span', { class: 'gl' });
      glyph.append(el('i', { class: nodePrimitive(type) }));
      row.append(glyph);
      row.append(el('span', { text: type }));
      row.append(el('span', { class: 'k', text: `\u00d7${count}` }));
      key.append(row);
    }
    block('entities', [key]);
  }

  // The naming rule, stated only when a label really was shortened. The client
  // truncates to fit the plate and nothing else, so this describes what happened
  // rather than announcing a policy.
  const shortened = view.nodes.filter((node) => node.label && node.label.length > 22);
  if (shortened.length > 0) {
    block('reading names', [
      el('p', {
        class: 'rule-note',
        text: `${shortened.length} name${shortened.length === 1 ? '' : 's'} shortened to fit the plate; the full name is in the tooltip and the drawer.`,
      }),
    ]);
  }

  // The lineage families this graph has none of, and why. That is the honest negative
  // for the data zone: an empty column beside a real composition reads as something
  // unfinished rather than as a considered edge. It states a fact about the data and
  // never a gap in the analysis.
  //
  // This used to be a reserved right-hand gutter in the world, which meant the Drawer
  // and this column were claiming the same space. It is a rail block now, because the
  // Drawer is a real column and two things must not own one.
  const present = new Set((view.edges || []).map((edge) => edge.family));
  const absent = ['lineage', 'dependency', 'attribution', 'source-identity']
    .filter((family) => !present.has(family));
  const absentBlock = [];
  if (absent.length > 0) {
    const chips = el('div', { class: 'g-empty' });
    for (const family of absent) chips.append(el('span', { class: 'g-chip', text: family.replace('-', ' ') }));
    absentBlock.push(chips);
    absentBlock.push(el('p', {
      class: 'rule-note',
      text: 'This repository declares none of these. That is a fact about the data, not a gap in the analysis.',
    }));
  } else {
    absentBlock.push(el('p', {
      class: 'rule-note',
      text: 'Every lineage family this ontology knows about is present in the graph.',
    }));
  }
  block('not on the canvas', absentBlock);

  // The lineage key: line style per family, counted. Only families with a real count
  // appear, so it cannot advertise a style that is not drawn.
  const keyHost = el('div', { class: 'tkey' });
  block('relationships', [keyHost]);
  renderFamilyKey(keyHost);

  rail.hidden = false;
}


/*
 * The bottom band.
 *
 * It carries the edge-treatment key, which a reader genuinely needs in order to
 * interpret the canvas. It deliberately does not carry camera coordinates: pan,
 * zoom, centre and world focal are test instrumentation, and printing them to fill
 * a reserved area would be decoration dressed as a readout.
 */
function renderBottomBand(view) {
  const band = $('band');
  if (!band) return;
  band.replaceChildren();

  const key = el('div', { class: 'key' });
  for (const [kind, text] of [
    ['directed', 'arrow at the target'],
    ['symmetric', 'no arrow, the claim is mutual'],
    ['aggregate', 'a count, not one relationship'],
  ]) {
    const item = el('div', { class: 'ki' });
    item.append(el('span', { class: `ki-mark ki-${kind}`, 'aria-hidden': 'true' }));
    item.append(el('span', { text }));
    key.append(item);
  }
  band.append(key);

  // How this scene is composed, in words, derived from the composition itself so
  // it cannot claim a centrality the analysis did not establish.
  //
  // The counts, and only the counts. The regime's name used to lead this note, and it
  // read "dense composition" on `nachocebey/is` -- a graph the eye reads as sparse --
  // because the regime counts fan-out pressure rather than visible mass. A label that
  // contradicts what is on screen is worse than no label, and the two numbers beside
  // it already say everything the regime was standing in for.
  const composition = state.composition;
  if (composition && composition.regime) {
    const grouped = composition.plates.reduce((sum, plate) => sum + plate.count, 0);
    const plateNote = composition.plates.length > 0
      ? ` · ${composition.plates.length} plate${composition.plates.length === 1 ? '' : 's'} grouping ${grouped}`
      : '';
    band.append(el('span', {
      class: 'band-note',
      text: `${composition.direct.length} shown directly${plateNote}`,
    }));
  }

  band.hidden = false;
}

/**
 * The peers a composition would have to place, with the evidence behind each.
 *
 * Pressure is counted per peer rather than per relationship: several relationships
 * to one peer is one thing to draw, and treating it as several is precisely the
 * fan-out the plates exist to absorb.
 */
function peersOf(view, edges) {
  const byPeer = new Map();
  for (const edge of edges) {
    const peerId = edge.source === view.subject.id ? edge.target : edge.source;
    if (peerId === view.subject.id) continue;
    const peer = byPeer.get(peerId) || { id: peerId, relationshipCount: 0, verified: 0 };
    peer.relationshipCount += 1;
    if (edge.status === 'VERIFIED') peer.verified += 1;
    byPeer.get(peerId) === undefined && byPeer.set(peerId, peer);
    if (!byPeer.has(peerId)) byPeer.set(peerId, peer);
  }
  return [...byPeer.values()];
}

/**
 * Which relationships earn direct spatial presence, and which are represented.
 *
 * Ranking is by verified evidence then relationship count then id, so it never
 * depends on array order. That is what stops an arbitrary slot from acquiring
 * visual centrality, which was the defect in the two-column arrangement.
 */
function promotedEdges(view, edges) {
  const peers = peersOf(view, edges);
  const regime = regimeFor(peers.length);
  const { direct } = partitionPeers(peers, regime);

  const directIds = new Set(direct.map((peer) => peer.id));
  const promoted = [];
  for (const edge of edges) {
    const peerId = edge.source === view.subject.id ? edge.target : edge.source;
    if (directIds.has(peerId)) promoted.push(edge.id);
  }
  /*
   * Promotion is capped at what the field can hold. Without the cap, a regime that
   * said "six direct" could promote every relationship of a fan the peers belonged
   * to, leaving the remainder too small to aggregate and turning the plate back into
   * spokes. The cap is the field's capacity, so a fan always has enough left over to
   * become a plate.
   */
  const capped = promoted.slice(0, DRAWABLE_CAPACITY);

  // A homogeneous fan is aggregated in full: no peer earns a place on the canvas,
  // so the composition names the group rather than choosing between equals.
  const aggregateEdgeIds = isHomogeneousFan(peers)
    ? edges.map((edge) => edge.id)
    : [];

  return { regime, peers, direct, directEdgeIds: capped, aggregateEdgeIds };
}

/**
 * The composition for the current view. One source of truth for canvas and
 * status line.
 *
 * The visible-object budget is the authored field's real capacity, and the regime
 * decides how much of the topology may be exposed directly within it. Whatever
 * does not fit becomes a plate rather than an overflow report, so every
 * relationship is accounted for and none is dropped.
 */
function currentComposition(view) {
  const target = view || state.view;
  if (!target) return null;
  const candidates = visibleCandidates(target);
  const { regime, peers, direct, directEdgeIds, aggregateEdgeIds } = promotedEdges(target, candidates);
  const composition = buildComposition(target, {
    edges: candidates,
    expandedAggregates: state.expandedBundles,
    directEdgeIds,
    aggregateEdgeIds,
    budget: DRAWABLE_CAPACITY,
  });
  composition.regime = regime;
  composition.peers = peers;
  composition.direct = direct;
  return composition;
}

function draw() {
  const view = state.view;
  const canvas = $('canvas');
  canvas.replaceChildren();
  if (!view) return;

  // The composition decides what is drawn individually and what collapses into a
  // plate. A 14-way fan-out reaches the canvas as one plate, not fourteen spokes.
  const composition = currentComposition(view);
  state.composition = composition;
  const loose = new Set(composition.looseEdgeIds);
  const edges = visibleCandidates(view).filter((edge) => loose.has(edge.id));
  // Authored composition, not a content fit. The subject sits where the design
  // puts it, the data mass stacks down the right zone, and loose relationships
  // are placed on an arc around the anchor rather than in a slot grid.
  const positions = authoredPositions(view, edges, composition);
  // Degree decides label thinning. Parallel-edge count does not: a hub with 20
  // distinct peers has 20 fans of one, and their mid-line labels still collide.
  const degrees = nodeDegrees(edges);

state.standaloneBundles = composition.looseEdgeIds.length === 0 && composition.plates.length > 0;

  // How this scene is composed, for the bottom band. Derived from the composition that
  // was actually authored, so the band cannot claim a centrality the layout did not
  // establish -- and it is measured rather than reserved: the world is fixed, so
  // nothing has to be kept in reserve for a later fit.
  state.contentBounds = contentBounds(positions);
  const viewport = { width: canvas.clientWidth || 1200, height: canvas.clientHeight || 700 };
  // First paint always opens the window on the world's own coordinates. After that,
  // only a dataset change may move the camera: the refit gate is a single condition
  // so "expanding an aggregate recentres the scene" cannot come back unnoticed.
if (!state.hasFitted || shouldRefit(state.refitPending ? RefitTrigger.Dataset : RefitTrigger.Local)) {
    // The world is fixed and the window moves over it -- never the other way round.
    // Fitting the frame to the viewport meant the world itself changed size with the
    // window, so the same layout was a different composition at every width and no
    // two viewports were comparable.
    //
    // It goes through `setCamera` like every other camera write, so the clamp and the
    // world's HTML layer are remapped here too rather than only on interaction.
    setCamera(canvas, initialViewBox(viewport).viewBox, 1);
    state.hasFitted = true;
    state.refitPending = false;
  }
  // The band's world coordinates have to be mapped by the same window the canvas is
  // showing, so this runs after the viewBox above is settled. See `applyFrameTransform`.
  applyFrameTransform(viewport, canvas.getAttribute('viewBox'));

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

  /*
   * Aggregate plates.
   *
   * A plate stands in for several relationships. Its connector carries no
   * arrowhead, because a plate is not a relationship and has no direction: it is a
   * count of several. Expanding one reveals evidence-supported rows *inside* the
   * plate, so a fan-out never turns back into subject spokes.
   */
  const subjectPosition = positions.get(view.subject.id);
  for (const plate of composition.plates) {
    const position = positions.get(`${BUNDLE_ID_PREFIX}${plate.key}`);
    if (!position || !subjectPosition) continue;

    // A plate with no members is not a plate. This happened when a forced aggregate
    // lost its members and the plate drew as an empty box while its relationships
    // reappeared as loose edges.
    if (plate.count < 1) continue;

    /*
     * Rows list the plate's members, one relationship each.
     *
     * A group plate -- one whose evidence named it -- is open by default, so the
     * default paint carries the real claims into the data zone rather than a bare
     * count. A neutral plate stays shut until the reader opens it. Either way the
     * list is capped and the plate states what it is holding back.
     */
    const rows = plateRows(plate);
    const hiddenRows = plateHiddenRows(plate);
    const shownRows = rows;
    const header = plateHeader(plate);
    const height = plateHeight(shownRows.length, hiddenRows, !!plate.meta);
    // Widening grows to the right of the subject's tie, so the connection stays
    // anchored and the plate does not jump when it opens.
    const width = rows.length > 0 ? PLATE_W_EXPANDED : PLATE_W;
    // The left edge is fixed and the plate widens rightward, away from the subject.
    // Anchoring the left edge to the tie point keeps subject -> plate short and
    // stops an opening plate from growing back over the subject it belongs to.
    const left = position.x - PLATE_W / 2;
    const top = position.y - height / 2;

    const from = nodeAnchor(subjectPosition, position);
    // The tie arrives on the plate's left edge, which is where the plate always is.
    const to = { x: left, y: position.y };
    const midX = from.x + (to.x - from.x) * 0.55;
    edgeLayer.append(
      svgEl('path', {
        d: `M ${from.x} ${from.y} C ${midX} ${from.y} ${midX} ${to.y} ${to.x} ${to.y}`,
        class: 'bundle-link',
      }),
    );

    // Selection raises the plate that owns the selection, never a row inside it.
    /*
     * Explicit ownership: a plate owns the selection when the selected relationship
     * is one of its members, or one of the rows it is showing. The earlier
     * `selectedEdgeId.startsWith(bundle.key)` test worked only because a plate's key
     * happened to be a prefix of its members' bundle keys -- an accident of naming.
     */
    const rowMembers = shownRows.flatMap((row) => row.memberEdgeIds);
    const ownsSelection =
      plate.memberEdgeIds.includes(state.selectedEdgeId) ||
      rowMembers.includes(state.selectedEdgeId);
    // Selection raises the plate that owns it, never a row inside it.
    const plateTier = depthTier({ isSelected: ownsSelection });
    /*
     * `is-open` means "this plate is showing its rows", which is not the same as
     * "this plate is showing every row". A plate capped at six says so and offers the
     * rest; it is still open, and drawing it as a shut card would contradict the rows
     * directly beneath its own header.
     */
    const isOpen = shownRows.length > 0;
    const group = svgEl('g', {
      class: `bundle-card st-${plate.status}${isOpen ? ' is-open' : ''}${ownsSelection ? ' is-selected' : ''}`,
      role: 'button',
      tabindex: '0',
      'aria-label': `${plate.count} ${plate.relationshipType.replace(/_/g, ' ')} relationships, grouped`,
      'aria-expanded': plate.expanded ? 'true' : 'false',
    });
    group.dataset.bundleKey = plate.key;

    if (depthOffset(plateTier) > 0) {
      const d = depthOffset(plateTier);
      group.append(
        svgEl('rect', {
          x: left + d, y: top + d, width, height, rx: 4,
          class: depthShadowClass(plateTier), 'aria-hidden': 'true',
        }),
      );
    }
    group.append(
      svgEl('rect', {
        x: left, y: top, width, height, rx: 4,
        class: ['bundle-card-box', depthClass(plateTier)].filter(Boolean).join(' '),
      }),
    );
    group.append(
      svgEl('text', { x: left + 12, y: top + 22, class: 'bundle-card-count' }, [plate.label]),
    );
    /*
     * Where the claim was written down.
     *
     * A plate grouped by declaration form is making a claim about *evidence*, not
     * about the relationship, and that is the one claim on this canvas a reader
     * cannot infer from the shape. Naming the declaring file makes the grouping
     * checkable at a glance, and it is the reason the group is allowed to exist.
     *
     * Only ever a place, never a category: "declared in" says where a claim was
     * written, which is what the evidence supports. It never says what the claim
     * means, so a reference cannot be read here as a dependency.
     */
    if (plate.meta) {
      group.append(
        svgEl('text', { x: left + 12, y: top + 40, class: 'plate-subtitle' }, [
          truncate(`declared in: ${plate.meta}`, 54),
        ]),
      );
    }

    // Rows are content of the plate. They stay flat: no depth, no shadow, and a
    // selected row is marked by its own solid ink rule rather than by rising.
    // Mono at 11px advances about 6.6px, at 10px about 6.0px. Measuring the meta
    // first lets the label take exactly the room that is left, instead of both
    // being truncated independently and overprinting in the middle.
    const META_CHARS = 21;
    const metaWidth = rows.some((r) => r.meta) ? META_CHARS * 6.0 + 14 : 0;
    // The status mark, its direction arrow and their gap are measured rather than
    // assumed, so a label can never start underneath them.
    const MARK_W = ROW_MARK_W;
    const labelRoom = Math.max(8, Math.floor((width - 24 - metaWidth - MARK_W) / 6.6));

    shownRows.forEach((row, index) => {
      const rowY = top + header + index * PLATE_ROW;
      const rowSelected = row.memberEdgeIds.includes(state.selectedEdgeId);
      /*
       * One `<g>` per row, so the row's own accessible name lives on the row rather
       * than inside a `<text>`. A `<title>` nested in `<text>` becomes part of that
       * element's text content, which put the full name and the full locator into the
       * rendered string.
       */
      const item = svgEl('g', { class: 'plate-row', 'aria-hidden': 'true' });
      item.append(svgEl('title', {}, [`${row.label}${row.meta ? ` \u00b7 ${row.meta}` : ''}`]));
      if (rowSelected) {
        item.append(
          svgEl('rect', {
            x: left + 6, y: rowY + 4, width: width - 12, height: PLATE_ROW - 6,
            class: 'plate-row-marker', 'aria-hidden': 'true',
          }),
        );
      }
      /*
       * The member's own evidence strength.
       *
       * A row that inherits its plate's status cannot be trusted on its own: a plate
       * groups by relation, and one `references` fan can hold both a VERIFIED claim
       * and a DECLARED one. The mark is read from the relationship, and the direction
       * beside it is canonical, so a symmetric relationship shows no arrowhead.
       */
      const markX = left + 12;
      item.append(
        svgEl('rect', {
          x: markX, y: rowY + 9, width: 7, height: 7,
          class: `plate-row-status st-${row.status || plate.status}`, 'aria-hidden': 'true',
        }),
      );
      if (row.directed) {
        item.append(
          svgEl('path', {
            d: `M ${markX + 14} ${rowY + 9.5} l 4 2.5 l -4 2.5`,
            class: 'plate-row-dir', 'aria-hidden': 'true',
          }),
        );
      }
      const labelX = markX + MARK_W;
      const label = svgEl('text', { x: labelX, y: rowY + 18, class: 'plate-row-label' }, [truncate(row.label, labelRoom)]);
      item.append(label);
      /*
       * A row is selectable.
       *
       * It had no hit target, so clicking one did nothing: the frozen design's
       * selected row cannot exist if a row cannot be selected. The row stays flat --
       * the marker beside it shows selection and the plate above rises, so the row
       * itself never gains depth.
       */
      const rowHit = svgEl('rect', {
        x: left, y: rowY + 2, width, height: PLATE_ROW - 4,
        class: 'plate-row-hit', 'aria-hidden': 'true',
      });
      rowHit.addEventListener('click', (event) => {
        event.stopPropagation();
        const first = row.memberEdgeIds[0];
        if (!first) return;
        selectEdge(first);
      });
      item.append(rowHit);
      if (row.meta) {
        item.append(
          svgEl('text', { x: left + width - 12, y: rowY + 18, class: 'plate-row-meta', 'text-anchor': 'end' }, [
            truncate(compactLocator(row.meta), META_CHARS),
          ]),
        );
      }
      group.append(item);
    });

    /*
     * What the plate is holding back, said out loud.
     *
     * A bounded list with a silent remainder is how relationships go missing: the
     * plate claimed a count, showed fewer rows, and never said so. This states the
     * remainder and offers the one action that reveals it, so the count and what is
     * on screen can always be reconciled.
     */
    if (hiddenRows > 0) {
      const moreY = top + header + shownRows.length * PLATE_ROW;
      group.append(
        svgEl('text', { x: left + 12, y: moreY + 18, class: 'plate-row-more' }, [
          `${hiddenRows} more row${hiddenRows === 1 ? '' : 's'} in this plate`,
        ]),
      );
      group.append(
        svgEl('text', { x: left + width - 12, y: moreY + 18, class: 'plate-row-expand', 'text-anchor': 'end' }, [
          'expand',
        ]),
      );
      const moreHit = svgEl('rect', {
        x: left, y: moreY + 2, width, height: PLATE_ROW - 4,
        class: 'plate-row-hit', 'aria-hidden': 'true',
      });
      moreHit.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleBundle(plate.key);
      });
      group.append(moreHit);
    }

    const activate = (event) => {
      event.stopPropagation();
      // A click on a row selects that row; only the plate's own surface toggles.
      if (event.target && event.target.classList.contains('plate-row-hit')) return;
      toggleBundle(plate.key);
    };    group.addEventListener('click', activate);
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') activate(event);
    });
    nodeLayer.append(group);
  }

  // Only nodes that take part in what is drawn are drawn. An entity reachable only
  // through a plate is listed as a row inside that plate, so it cannot appear as a
  // disconnected island with no relationship attached.
  const drawnNodeIds = new Set([view.subject.id]);
  for (const edge of edges) {
    drawnNodeIds.add(edge.source);
    drawnNodeIds.add(edge.target);
  }

  for (const node of view.nodes) {
    if (!drawnNodeIds.has(node.id)) continue;
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
    // Depth says how far this object participates in the topology. The subject
    // outranks a selected node, so selection never reads as a change of anchor.
    const tier = depthTier({ isSubject: node.isSubject, isSelected: state.selectedNodeId === node.id });
    const depth = depthClass(tier);
    const offset = depthOffset(tier);
    const radius = nodePrimitiveRadius(node.type);

    // The hard offset is a real shape, not a box-shadow: box-shadow computes on
    // an SVG rect but paints nothing, so a CSS-only ladder would be invisible.
    if (offset > 0) {
      group.append(
        svgEl('rect', {
          x: position.x - NODE_W / 2 + offset,
          y: position.y - NODE_H / 2 + offset,
          width: NODE_W,
          height: NODE_H,
          rx: radius,
          class: depthShadowClass(tier),
          'aria-hidden': 'true',
        }),
      );
    }

    group.append(
      svgEl('rect', {
        x: position.x - NODE_W / 2,
        y: position.y - NODE_H / 2,
        width: NODE_W,
        height: NODE_H,
        rx: radius,
        class: [
          'node-box',
          node.isSubject ? 'is-subject' : '',
          primitive,
          depth,
        ].filter(Boolean).join(' '),
      }),
    );
    // A repository name is its identity. It is truncated only as far as the plate
    // allows, and the full value is always reachable as a tooltip rather than
    // being shortened further to make room.
    group.append(
      svgEl('title', {}, [node.label]),
      svgEl('text', { x: position.x - NODE_W / 2 + 10, y: position.y - 3, class: 'node-label' }, [
        truncate(node.label, Math.floor((NODE_W - 20) / 7.2)),
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
  renderBundles();
  renderLayersPop();
  renderRail(view);
  renderBottomBand(view);
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
  // The camera must not move. Expansion is a local change: it reflows rows
  // inside its own plate and nothing else, so the pan, zoom, viewport centre and
  // world focal the reader already has stay exactly as they were. Refitting here
  // used to reset `hasFitted`, which re-ran `fitViewBox` and silently recentred
  // the whole scene on every expand and collapse.
  draw();
}

function truncate(text, max) {
  return String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text);
}

/**
 * An evidence locator in the room a plate row actually has.
 *
 * Two shortenings, both of which throw away something the row does not need:
 *
 *   - `docs/plugins.md:20` becomes `plugins.md:20`. Truncated to sixteen characters
 *     the original reads `docs/plugins.md…`, which throws away the line number -- the
 *     only part that identifies the claim, and the part a reader needs in order to
 *     check it. The directory goes before the line does.
 *   - `.gitmodules -> submodule.boringssl.path` becomes `submodule.boringssl.path`.
 *     Every row of a submodule plate carried the same prefix and the same truncated
 *     tail, so sixteen rows of one plate all read `.gitmodules -> submod...` and none
 *     of them said which submodule it was.
 *
 * Display only. The full locator stays on the row's tooltip and in the Drawer, so
 * nothing is lost; this is about what fits, not about what exists.
 */
function compactLocator(locator) {
  const text = String(locator || '');
  const arrow = text.indexOf('→');
  if (arrow >= 0) return text.slice(arrow + 1).trim();
  const cut = text.lastIndexOf(':');
  if (cut <= 0) return text;
  const path = text.slice(0, cut);
  const line = text.slice(cut + 1);
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? `${path.slice(slash + 1)}:${line}` : text;
}

/**
 * Line style per family, in one place so the rail key, the popover, the drawer and
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

const FAMILY_LABEL = {
  ancestry: 'ancestry',
  dependency: 'dependency',
  attribution: 'attribution',
  'source-identity': 'identical',
  similarity: 'similar',
};

/**
 * The lineage key: one row per family this graph actually contains.
 *
 * It used to float across the canvas as a legend, which meant it sat on top of the
 * composition at every width and had to be hidden whenever anything else claimed the
 * space. The rail owns it now. Only families with a nonzero count appear, so the key
 * cannot advertise a line style that is not on the canvas.
 */
function renderFamilyKey(host) {
  if (!host) return;
  const view = state.view;
  host.replaceChildren();
  let shown = 0;
  for (const [family, [style, width]] of Object.entries(FAMILY_STYLE)) {
    const count = (view.familyCounts && view.familyCounts[family]) || 0;
    if (!count) continue;
    shown += 1;
    const row = el('div', { class: 'key-row' });
    const swatch = el('span', { class: 'layer-swatch' });
    swatch.style.borderTopStyle = style;
    swatch.style.borderTopWidth = width;
    row.append(swatch);
    row.append(el('span', { text: FAMILY_LABEL[family] }));
    row.append(el('span', { class: 'k r-mono', text: String(count) }));
    host.append(row);
  }
  if (shown === 0) {
    setHidden(host, true);
    return;
  }
  setHidden(host, false);
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

  /*
   * Provenance metadata.
   *
   * Built here but appended *after* the evidence: it is context for the record, not
   * a substitute for it. The extractor name is kept out entirely -- it is an
   * implementation detail of the analysis pipeline and the frozen design subordinates
   * exactly this kind of thing below the evidence.
   */
  const provenance = el('div', { class: 'd-block' });
  provenance.append(el('p', { class: 'd-block-head is-provenance', text: 'PROVENANCE' }));
  const kv = el('dl', { class: 'd-kv' });
  const row = (k, v) => {
    kv.append(el('dt', { text: k }), el('dd', { text: String(v) }));
  };
  row('Revision', `${view.revision.ref || view.revision.defaultBranch || 'HEAD'} @ ${view.revision.shortCommit}`);
  row('Analyzed', formatTime(view.revision.analyzedAt));
  row('Source', state.cacheHit ? `cached (${formatDuration(state.meta?.elapsedMs ?? 0)})` : 'fresh analysis');
  row('Evidence', `${edge.evidenceCount} record${edge.evidenceCount === 1 ? '' : 's'}`);
  provenance.append(kv);

  // Evidence records
  const records = view.evidenceByRelationship[edge.id] || [];
  const evidenceBlock = el('div', { class: 'd-block' });
  evidenceBlock.append(el('p', { class: 'd-block-head is-evidence', text: `EVIDENCE (${records.length})` }));
  if (records.length === 0) {
    evidenceBlock.append(el('p', { class: 'mono', text: 'No evidence records inlined.' }));
  }
  for (const record of records) evidenceBlock.append(renderEvidenceCard(record, edge));
  if (edge.evidenceTruncated) {
    evidenceBlock.append(
      el('p', { class: 'mono', text: `showing ${records.length} of ${edge.evidenceCount} evidence records` }),
    );
  }
  // Evidence first, then provenance: the record is what the reader came for.
  wrap.append(evidenceBlock);
  wrap.append(provenance);

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
    /*
     * The line anchor becomes part of the link rather than a bare token beside it.
     *
     * It read as `anchor #L21` under a locator that already said `docs/plugins.md:21`,
     * which is leaked debug output: a label nobody defined, restating a fact shown
     * directly above it. As part of the link text it is an affordance instead, and
     * the fragment is only offered when the source really is a line-addressable blob.
     */
    const fragment = anchorOf(record.locator);
    if (/\/blob\//.test(source) && record.locator && /:\d/.test(record.locator) && fragment) {
      link.href = `${source}${fragment}`;
      link.textContent = `View ${fragment} on GitHub \u2197`;
      card.replaceChild(link, link);
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

/**
 * The single place a camera change is written.
 *
 * Every path that moves the window -- wheel, buttons, drag, fit -- goes through here,
 * for two reasons that only hold if there is one path.
 *
 * First, the window is clamped inside the world. The world is fixed at 1920 x 1720, so
 * a raw pan could drag it to empty space and leave the reader looking at nothing; the
 * clamp is structural rather than a check somebody has to remember. Second, the world's
 * HTML layer is remapped here too. It used to be remapped only inside `draw()`, which
 * meant a drag left the band behind at the world's origin while the canvas moved --
 * an overlay annotating a coordinate the canvas was no longer showing.
 */
function setCamera(canvas, viewBox, zoom) {
  const viewport = { width: canvas.clientWidth || 1200, height: canvas.clientHeight || 700 };
  const parts = String(viewBox || '').split(/\s+/).map(Number);
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  const centre = { x: x + width / 2, y: y + height / 2 };
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const window = viewBoxFor(viewport, centre, z);
  canvas.setAttribute('viewBox', window.viewBox);
  state.zoom = window.zoom;
  applyFrameTransform(viewport, window.viewBox);
  return window;
}

/**
 * The rail disclosure.
 *
 * Above the breakpoint the rail is a permanent column and this button does not exist.
 * Below it the rail collapses, because there is no longer room for prose and a census
 * beside a 1920-wide world. Opening it adds a column to the shell -- it does not
 * rescale the world, so nothing on the canvas moves and no relationship changes
 * position. That is the whole difference between a disclosure and an overlay here.
 */
function toggleRail(force) {
  const body = $('explorer-body');
  const button = $('rail-toggle');
  if (!body) return;
  const open = force === undefined ? !body.classList.contains('rail-open') : force === true;
  body.classList.toggle('rail-open', open);
  if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
  // The stage's pixel width changed, so the canvas element is a different size. The
  // camera does not follow it: the window stays where the reader left it, in world
  // coordinates, and the world does not move.
  if (state.view) draw();
}

function setupViewport() {
  const canvas = $('canvas');

  // Node hover styling is pure CSS (`.node:hover`), deliberately not a redraw:
  // rebuilding the canvas under the pointer would re-fire hover and loop.

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const focus = clientToGraph(canvas, event.clientX - rect.left, event.clientY - rect.top);
    const next = zoomViewBox(canvas.getAttribute('viewBox'), factor, focus, state.zoom);
    setCamera(canvas, next.viewBox, next.zoom);
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
    // The window follows the pointer's world delta, then the same clamp applies: a
    // drag to the edge stops at the world's edge instead of leaving it.
    setCamera(canvas, `${vx - dx} ${vy - dy} ${vw} ${vh}`, vw > 0 ? canvas.clientWidth / vw : state.zoom);
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
  setCamera(canvas, next.viewBox, next.zoom);
}

/**
 * Reopens the window on the authored world, not on the content.
 *
 * This used to fit the content bounds, which meant "fit" was a second composition
 * rather than a way of looking at the first one -- and two of them disagreed at every
 * window size. It now returns the window to the world's own coordinates.
 */
function fit() {
  if (!state.view) return;
  const canvas = $('canvas');
  const viewport = { width: canvas.clientWidth || 1200, height: canvas.clientHeight || 700 };
  setCamera(canvas, initialViewBox(viewport).viewBox, 1);
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
      // A different depth is a different dataset: the content bounds are not
      // comparable with what is on screen, so the camera refits deliberately.
      state.refitPending = true;
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
  $('rail-toggle').addEventListener('click', () => toggleRail());

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
      // Navigating to another repository is a dataset change.
      state.refitPending = true;
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

installTracerTestStepper();
boot();