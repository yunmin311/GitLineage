import { mountSitePresentation } from './lib/site-presentation.mjs';
import {dismissGitLog} from './lib/git-log.mjs';
import {connectionFallback} from './lib/connection-fallback.mjs';
import {classifyRelationships} from './lib/classification.mjs';
import {spatialLayout, spatialExpansion, spatialRoute, ORIGIN} from './lib/spatial.mjs';
import {buildView as projectCanonicalView} from '../view-model.ts';
import {captureMotion, transitionScene, transitionCamera, stopMotion, revealInstrument, revealPanel} from './lib/motion.mjs';
import { mountRepositoryExplorer } from './lib/repository-explorer.mjs';
import { mountDeepPreview } from './lib/deep-preview.mjs';
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
  RUNNING_PHASES,
  ANALYSIS_PHASE_TEXT,
  ANALYSIS_FSM_TEXT,
} from './lib/analysis.mjs';
import { evidenceSourceUrl, SIMILARITY_DISCLAIMER } from './lib/evidence-links.mjs';
import { nodePrimitive, nodePrimitiveRadius, depthTier, depthClass, depthOffset, depthShadowClass } from './lib/primitives.mjs';
import { RefitTrigger, shouldRefit } from './lib/camera.mjs';
import {
  PHASES, SETTLED_PHASE, arcSegment, tracerPoint, phaseLabel, phaseTransition, isSettled,
  phaseIndex as tracerPhaseIndex,
} from './lib/phases.mjs';
import { buildComposition } from './lib/aggregate.mjs';
import { Regime, regimeFor, partitionPeers, isHomogeneousFan } from './lib/regime.mjs';
import {
  WORLD, ZONES, subjectPosition, initialViewBox, viewBoxFor,
} from './lib/compose.mjs';
import { DRAWABLE_CAPACITY } from './lib/regime.mjs';

import { initialPanels, transitionPanels, visiblePanels, protectionPan } from './lib/panels.mjs';

import { phoneViewport, relationGroups, installTouchCamera } from './lib/mobile.mjs';
let panels = initialPanels(window.innerWidth);
const mobile = { view: 'graph', previous: 'graph', graph: null, drawerGraph: null, resetGesture: () => {} };
const isPhone = () => phoneViewport(window.innerWidth, window.innerHeight) && window.matchMedia('(pointer: coarse)').matches;


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

let workspace = null;
let loadController = null;
function cancelLoad() {
  state.loadToken += 1;
  loadController?.abort();
  loadController = null;
  if (state.pollTimer) clearTimeout(state.pollTimer);
}
function observationSignal() {
  return AbortSignal.any([loadController.signal, AbortSignal.timeout(20000)]);
}
const state = {
  repository: null,
  view: null,
  viewRepository: null,
  graph: null,
  meta: null,
  selectedEdgeId: '',
  selectedNodeId: '',
  layers: provenanceLayers(),
  perspective: 'origins',
  focusId: '',
  explorationBack: [],
  positions: new Map(),
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
  const params = new URLSearchParams(query);
  params.set('perspective', state.perspective);
  params.set('neighborhoods', JSON.stringify([...aggregatePages]));
  if (isPhone()) params.set('mobile', mobile.view);
  const next = `${repositoryPath(state.repository)}${params.size ? '?' + params : ''}`;
  if (window.location.pathname + window.location.search === next) return;
  if (replace) window.history.replaceState(window.history.state || {}, '', next);
  else window.history.pushState({}, '', next);
}

function readUrlState() {
  const urlState = readViewState(window.location.search);
  state.selectedEdgeId = urlState.edge;
  state.selectedNodeId = urlState.node;
  state.query = urlState.search;
  // Without an explicit layer choice, recorded ancestry and source identity
  // take priority. Dependencies and references require a deliberate switch.
  state.layers = urlState.layers ? parseLayerState(urlState.layers) : provenanceLayers();
  state.perspective = new URLSearchParams(window.location.search).get('perspective') || (urlState.layers ? 'custom' : 'origins');
  state.expandedBundles = new Set(urlState.bundles ? urlState.bundles.split(',') : []);
  aggregatePages.clear();
  try {
    const saved=JSON.parse(new URLSearchParams(window.location.search).get('neighborhoods')||'[]');
    if(Array.isArray(saved))for(const item of saved){
      if(Array.isArray(item)&&item.length===2&&typeof item[0]==='string'&&Number.isSafeInteger(item[1])&&item[1]>0&&item[1]<=100000)aggregatePages.set(item[0],item[1]);
    }
  } catch { /* Invalid URL state cannot interrupt graph loading. */ }
  if (urlState.depth) {
    const depth = Number(urlState.depth);
    if (Number.isFinite(depth)) state.depth = depth;
  }
  for (const button of document.querySelectorAll('[data-depth]')) {
    const active = Number(button.dataset.depth) === state.depth;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function navigate(repository, push = true) {
  state.repository = repository;
  state.selectedEdgeId = '';
  state.selectedNodeId = '';
  state.query = '';
  state.expandedBundles = new Set();
  aggregatePages.clear();
  state.activeGroup='';state.focusId='';state.explorationBack=[];state.positions.clear();state.perspective='origins';state.layers=provenanceLayers();
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
  setHidden($('rail-toggle'), true);
  panels = initialPanels(window.innerWidth);
  applyPanels();
  // The landing is left behind as soon as a repository route is resolved, so the
  // working frame is never stacked on top of the marketing page.
  setHidden($('landing'), true);

  /*
   * The Explorer is HIDDEN, not merely emptied.
   *
   * Clearing the canvas was never enough, and this is the measured reason. `state.view`
   * is only reassigned when a view arrives, so during a job it still holds the PREVIOUS
   * repository's model, and the rail's DOM still holds its rendered provenance, status
   * census and evidence. On the path Explorer A -> back -> submit B, A's rail text, A's
   * crumb, A's `51514bd` and A's `97 one-hop` were all still readable while B was in
   * `resolving`.
   *
   * Hiding the Explorer removes the only surfaces that could show it. The Analysis
   * surface has no rail, no canvas and no drawer, so there is nothing for stale data to
   * appear in.
   */
  setHidden($('explorer'), true);
  setHidden($('analysis'), false);
  /*
   * And the surface is populated before the first poll lands.
   *
   * Shown empty it flashes a blank frame, which was measurable: the first snapshot of a
   * real run had the section visible with no repository, no key and no segments in it,
   * because the job had been accepted but no status had come back yet. The state at that
   * moment is not "nothing" -- it is `queued`, so that is what is drawn, in words.
   */
  state.resolvedRevision = '';
  renderAnalysis('queued', '');
  // And the previous repository's identity leaves the chrome too, so nothing in the
  // shared appbar names the repository being replaced.
  for (const id of ['crumb-repo', 'crumb-ctx', 'crumb-rev', 'crumb-count']) {
    const node = $(id);
    if (node) node.textContent = '';
  }
  setHidden($('empty'), true);
  setHidden($('failure'), true);
  setHidden($('drawer'), true);
  setHidden($('drawer-scrim'), true);
  $('explorer-body').classList.remove('with-drawer');
  setHidden($('bundles'), true);
  $('canvas').replaceChildren();
  $('rail-scroll').replaceChildren();
  $('drawer-inner').replaceChildren();
  $('band').replaceChildren();
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
/* ------------------------------------------------------------ the Analysis surface */

/**
 * Renders the standalone Analysis surface from real job state.
 *
 * Frozen V3.3. The five-phase path is the production contract
 * (`RUNNING_PHASES`), and `queued`, `complete` and `failed` are job FSM states rendered as
 * words -- never as a sixth or seventh segment, which is how a five-phase contract turns
 * into a seven-phase one.
 *
 * Every value printed here comes from a field the server actually sent. A job that has not
 * resolved a revision yet says "not yet resolved" in mono, in the pending ink, and is
 * marked as pending -- it never shows a placeholder that reads like data. Nothing is
 * counted, timed or interpolated: no percentage, no collector sub-progress, no record
 * total.
 */
function renderAnalysis(status, jobId) {
  const root = $('analysis');
  if (!root) return;

  const repository = state.repository
    ? `${state.repository.owner}/${state.repository.name}`
    : '';
  $('an-repo').textContent = repository;

  const running = RUNNING_PHASES.indexOf(status);
  const phaseChanged = root.dataset.phase !== status;
  if (phaseChanged) {
    root.dataset.phase = status;
    const object = root.querySelector('.an-obj');
    if (object && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      object.getAnimations().forEach(animation => animation.cancel());
      object.animate([{ opacity: .45, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 260, easing: 'cubic-bezier(.2,.7,.2,1)' });
    }
  }
  const fsm = ANALYSIS_FSM_TEXT[status];
  const current = running >= 0 ? ANALYSIS_PHASE_TEXT[status] : null;

  // The ordinal gives position; the title alone names the current activity.
  $('an-pk').textContent = current
    ? `phase ${running + 1} of ${RUNNING_PHASES.length}`
    : (fsm?.key ?? status);
  $('an-ptitle').textContent = current ? current.t : (fsm?.title ?? status);
  $('an-psub').textContent = current ? current.s : (fsm?.sub ?? '');
  $('an-verb').textContent = current ? current.v : (fsm?.verb ?? '');

  // Job: what the server says about the job itself.
  const jobRows = [
    ['state', current ? 'running' : (fsm ? fsm.key.split(' \u00b7 ')[1] : status)],
    // A queued job is not phase zero. It has not entered the path.
    ['phase', current ? `${running + 1} / ${RUNNING_PHASES.length}` : (fsm ? 'not on the phase path' : 'unknown')],
    ['job', jobId || 'pending'],
    ['contract', 'RUNNING_PHASES'],
  ];
  const jobDl = $('an-job');
  jobDl.replaceChildren();
  for (const [k, v] of jobRows) jobDl.append(specRow(k, v));

  // Source: what is known about the repository. The revision is the honest part --
  // it is only ever printed once the server has resolved one.
  const revision = state.resolvedRevision || '';
  const srcDl = $('an-src');
  srcDl.replaceChildren();
  srcDl.append(specRow('repository', repository || 'unknown'));
  /*
   * Only two facts, and both are about the repository itself. A resolved depth was
   * tempting to print and was left out on purpose: there is no resolved depth until the
   * graph exists, and `state.depth` is the cap the client asked for, so a row reading
   * "depth 200" beside a resolved revision would read as a measured result rather than
   * as a request.
   */
  srcDl.append(specRow('revision', revision ? revision.slice(0, 12) : 'not yet resolved', !revision));

  // The path. Five segments, always five: a settled job marks all five done and parks the
  // tracer, rather than adding an endpoint.
  const n = RUNNING_PHASES.length;
  const labels = $('an-plabels');
  // Polls refresh source facts, but must not restart the visible phase entrance.
  if (!phaseChanged && labels.childElementCount === n) { state.phase = status; return; }
  /*
   * How much of the path is behind us.
   *
   * Three different answers, and conflating them was a real defect: this was originally
   * `current ? at < running : Boolean(fsm)`, which marks all five segments done for
   * `queued` as well as for the terminal states. A queued job has completed nothing, and
   * a full row of done segments says the opposite -- it is the visual form of the exact
   * claim this surface exists not to make. So a terminal state is done, a running phase
   * is done up to itself, and a queued job is done not at all.
   */
  const terminal = status === 'complete' || status === 'failed';
  const isDone = (at) => (current ? at < running : terminal);
  /*
   * `minmax(0, 1fr)`, not `1fr`.
   *
   * A bare `1fr` floors each track at its `min-content` width, which is as wide as the
   * longest unbreakable word in the phase name. At 390px that made every track wider than
   * its share of the row, so the five labels overflowed and overlapped each other instead
   * of fitting inside their own columns. Mobile uses shorter names within the same tracks.
   */
  labels.style.gridTemplateColumns = `repeat(${n}, minmax(0, 1fr))`;
  labels.replaceChildren();
  for (const phase of RUNNING_PHASES) {
    const at = RUNNING_PHASES.indexOf(phase);
    const done = isDone(at);
    const now = current ? at === running : false;
    labels.append(el('div', {
      class: ['an-plabel', done ? 'is-done' : '', now ? 'is-now' : ''].filter(Boolean).join(' '),
      'data-phase': phase,
      ...(now ? { 'aria-current': 'step' } : {}),
      // Mobile uses a short name; assistive technology retains the full phase name.
      'aria-label': `${at + 1} of ${RUNNING_PHASES.length}. ${ANALYSIS_PHASE_TEXT[phase].t}`,
    }, [
      el('span', { class: 'n', text: String(at + 1) }),
      el('span', { class: 't', text: ANALYSIS_PHASE_TEXT[phase].t }),
      el('span', { class: 't-short', 'aria-hidden': 'true', text: ['Resolve', 'Collect', 'Links', 'Check', 'Publish'][at] }),
    ]));
  }

  state.phase = status;
}

/** One compact spec row: a schema field name beside a machine value. */
function specRow(key, value, pending) {
  return el('div', { class: 'an-row' }, [
    el('span', { class: 'k', text: key }),
    el('span', { class: pending ? 'v is-pending' : 'v', text: value }),
  ]);
}

function renderPhases(status, jobId) {
  const tracer = $('tracer');
  const list = $('phases');
  const strip = $('strip');
  if (!tracer || !list) return;

  const index = tracerPhaseIndex(status);
  const settled = isSettled(status);
  const moving = phaseTransition(state.phase, status);

  // The standalone Analysis surface is the visible one; the strip is kept for the
  // in-shell tracer contract and is not rendered while a job runs.
  renderAnalysis(status, jobId);

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
    list.append(item);
  }

  /*
   * The job id, once, at the end of the strip.
   *
   * It used to be a column inside every phase cell, which printed the same eight
   * characters seven times and stole the width each phase's name needed. It is one
   * technical datum about the whole run, so it belongs to the run. The column it
   * replaced held a per-phase evidence count, which the analyser does not report --
   * there is no honest number to put there.
   */
  const job = $('strip-job');
  if (job) {
    job.textContent = jobId ? `job ${jobId.slice(0, 8)}` : '';
    setHidden(job, !jobId);
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
  // The Analysis surface is standalone, so it steps aside as the Explorer arrives.
  setHidden($('analysis'), true);
  setHidden($('explorer'), false);
  // Hidden is not the same as empty. A finished job left its repository, revision and
  // terminal wording sitting in the markup, and the next job's first frame inherited
  // them. Hidden pixels are not a leak, but stale text in the document is still stale
  // text in the document, so it is cleared here rather than merely covered.
  for (const id of ['an-repo', 'an-pk', 'an-ptitle', 'an-psub', 'an-verb', 'an-job', 'an-src']) {
    const node = $(id);
    if (node) node.replaceChildren();
  }
  for (const id of ['an-plabels']) {
    const node = $(id);
    if (node) node.replaceChildren();
  }
  state.resolvedRevision = '';
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
  cancelLoad();
  dismissGitLog();
  loadController = new AbortController();
  readUrlState();
  showWorking();
  state.phase = 'starting';

  // A newer load invalidates any poll still in flight from a previous one.
  const token = (state.loadToken += 1);
  const stale = () => token !== state.loadToken;

  const repo = state.repository;
  const fetchOptions = { headers: { accept: 'application/json' }, signal: observationSignal() };

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
async function fetchView(token, attempt = 0) {
  if (token !== state.loadToken || !state.repository) return;
  const repo = state.repository;
  let viewEnvelope;
  try {
    const response = await fetch(`/api/view/${repo.owner}/${repo.name}?depth=${state.depth}`, {
      headers: { accept: 'application/json' }, signal: observationSignal(),
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
    if ((error?.pending || error?.status === 202) && attempt < 8) {
      await sleep(error?.retryAfterMs ?? VIEW_RETRY_DELAY_MS);
      if (token === state.loadToken) await fetchView(token, attempt + 1);
      return;
    }
    hideWorking();
    showFailure(error);
    return;
  }
  if (token !== state.loadToken) return;
  applyView(viewEnvelope);
}

/**
 * Polls a job until it reaches a terminal phase, then loads the result.
 *
 * Backoff is bounded by `nextDelayMs`, and polling stops on any phase this client
 * does not recognise, so it cannot spin forever.
 */
async function pollJob(job, elapsed, stale, failures = 0) {
  if (stale()) return;
  const { jobId, statusUrl, retryAfterMs } = job;
  state.job = { jobId, statusUrl };

  let status;
  try {
    const response = await fetch(statusUrl, { headers: { accept: 'application/json' }, signal: observationSignal() });
    if (stale()) return;
    if (response.status === 404) {
      hideWorking();
      showFailure({ message: 'the analysis job is no longer known to the server', retryable: true });
      return;
    }
    status = parseJob(await response.json());
  } catch (error) {
    if (stale()) return;
    if (failures >= 2) {
      hideWorking();
      showFailure({ message: "The connection was interrupted. Your analysis may still be running; retry to reconnect.", retryable: true });
      return;
    }
    // Retry transient observation failures without restarting the server job.
    const wait = nextDelayMs(retryAfterMs, elapsed);
    await sleep(wait);
    if (!stale()) await pollJob(job, elapsed + wait, stale, failures + 1);
    return;
  }

  if (stale()) return;
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

  // The revision is recorded as soon as the job reports one, so the Analysis surface can
  // show a real commit instead of a placeholder -- and shows nothing until it has one.
  if (status.resolvedRevision) state.resolvedRevision = String(status.resolvedRevision);
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
  setHidden($('rail-toggle'), false);

  const view = viewEnvelope.data;
  const meta = viewEnvelope.meta || {};

  // Only the view endpoint is read. It is a projection of the same canonical
  // graph `/api/graph` returns — the server states that in `meta.derivedFrom` —
  // so a second request would duplicate work for a result the server already
  // holds. The canonical graph remains the source of truth; this file never
  // reconstructs or edits it.
  state.graph = null;

  state.view = view;
  state.viewRepository = { ...state.repository };
  state.meta = meta;
  state.cacheHit = meta.cacheHit === true;
  state.resolvedRevision = meta.resolvedRevision || view.revision.commit;
  state.phase = state.cacheHit ? 'cached' : view.partial.isPartial ? 'partial' : 'complete';

  setHidden($('strip'), true);
  renderChrome(view);

  setHidden($('empty'), true);
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
  /*
   * Presenting a view retires the Analysis surface.
   *
   * This is the counterpart of `showWorking()` hiding the Explorer, and it is not
   * redundant with `hideWorking()`, because `hideWorking()` is not the only way to arrive
   * here. A cached view resolves on the boot path -- the route is opened, the view is
   * fetched, and `renderChrome` runs without a job having been started -- and that path
   * never calls `hideWorking()`.
   *
   * Without this, `#analysis` and `#explorer` were both visible at once, and `#main` gave
   * its flex height to both: the Explorer got roughly 140px of a 800px viewport, the
   * camera was fitted to that, and the graph painted up through the transparent Analysis
   * ground. One missing `hidden` produced seven acceptance failures at once -- a clipped
   * band, an unopened Drawer, a mis-fitted camera, plates drawn over the band, and ink in
   * the rail and Drawer gutters.
   */
  setHidden($('analysis'), true);
  setHidden($('appbar-mid'), false);
  setHidden($('appbar-right'), false);
  setHidden($('project-source'), true);
  applyPanels();
  const repo = state.repository;
  $('crumb-repo').textContent = view.subject.owner && view.subject.name
    ? `${view.subject.owner}/${view.subject.name}`
    : `${repo.owner}/${repo.name}`;
  $('crumb-repo').title = $('crumb-repo').textContent;
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

// Local neighborhoods grow spatially. Limits describe explored space, never pages.
const memberPageSize = () => isPhone() ? 5 : 8;
const aggregatePages = new Map();
function provenanceLayers(){return {ancestry:true,'source-identity':true,dependency:true,attribution:true,similarity:false};}
function exploredIds(plate){
 if(!plate.expanded)return [];
 const limit=aggregatePages.get(plate.key)||memberPageSize();
 const taxonomy=classifyRelationships(state.view,plate);
 // Admission precedes visibility: folding a category never loads replacements.
 return taxonomy.ordered.slice(0,limit).filter(id=>!taxonomy.paths.get(id)?.some(n=>state.expandedBundles.has('closed:'+n.id)));
}
function revealRelationships(plate,ids){
 const taxonomy=classifyRelationships(state.view,plate);
 for(const id of ids)for(const ancestor of taxonomy.paths.get(id)||[])state.expandedBundles.delete('closed:'+ancestor.id);
}
function authoredPositions(view,edges,composition){
 const taxonomies=new Map(composition.plates.map(p=>[p.key,classifyRelationships(view,p)]));
 const classified=new Set();const categoryNodes=[],navigation=[];
 const groups=composition.plates.map(plate=>{
  const taxonomy=taxonomies.get(plate.key),shown=new Set(edges.filter(e=>plate.memberEdgeIds.includes(e.id)).map(e=>e.id));
  const peers=plate.memberEdgeIds.filter(id=>edges.some(e=>e.id===id)).map(id=>view.edges.find(e=>e.id===id)).filter(Boolean).map(e=>e.source===view.subject.id?e.target:e.source);
  if(!plate.expanded||!taxonomy.categories.length)return {key:plate.key,family:plate.family,peers};
  const closed=n=>state.expandedBundles.has('closed:'+n.id);
  for(const n of taxonomy.categories){
   if(taxonomy.categories.some(parent=>parent.id===n.parent&&closed(parent)))continue;
   categoryNodes.push(n);navigation.push({source:n.parent,target:n.id,presentation:'branch',kind:'observation'});
  }
  for(const id of shown){const edge=view.edges.find(e=>e.id===id);if(!edge)continue;
   const peer=edge.source===view.subject.id?edge.target:edge.source;
   if(classified.has(peer))continue;classified.add(peer);
   const parent=taxonomy.paths.get(id)?.at(-1);if(parent)navigation.push({source:parent.id,target:peer,presentation:'branch',kind:'observation'});
  }
  const localNodes=categoryNodes.filter(n=>taxonomy.categories.some(c=>c.id===n.id));
  const localLinks=navigation.filter(e=>e.source==='bundle:'+plate.key||taxonomy.categories.some(c=>c.id===e.source));
  const measured=spatialExpansion({anchors:new Map([['bundle:'+plate.key,{x:0,y:0,angle:isPhone()?Math.PI/2:0}]]),nodes:[...localNodes,...localLinks.filter(e=>!e.target.startsWith('category:')).map(e=>({id:e.target}))],edges:localLinks,compact:isPhone()});
  const cross=[...measured.values()].map(p=>isPhone()?p.x:p.y);
  return {key:plate.key,family:plate.family,peers:[],reserve:Math.max(256,Math.max(...cross)-Math.min(...cross)+(isPhone()?256:112))};
 });
 const base=spatialLayout({subjectId:view.subject.id,edges:edges.filter(e=>!classified.has(e.source)&&!classified.has(e.target)),groups,compact:isPhone(),previous:state.positions});
 if(categoryNodes.length){
  for(const [id]of base){const old=state.positions.get(id);if(old)base.set(id,{...old});}
  const overlaps=(a,b)=>Math.abs(a.x-b.x)<((a.width||216)+(b.width||216))/2+20&&Math.abs(a.y-b.y)<((a.height||52)+(b.height||52))/2+20;
  for(const [id,p]of base){if(state.positions.has(id)||id===view.subject.id||id.startsWith(BUNDLE_ID_PREFIX))continue;
   let candidate=p,attempt=0;const obstacles=[...[...base].filter(([key])=>key!==id).map(([,q])=>q),...state.positions.values()];
   while(obstacles.some(q=>overlaps(candidate,q))&&attempt<600){attempt++;candidate={...p,x:p.x+(isPhone()?(attempt%2)*248:Math.floor(attempt/12)*280),y:p.y+Math.ceil(attempt/2)*88};}base.set(id,candidate);
  }
 }
 const positions=spatialExpansion({anchors:base,nodes:[...categoryNodes,...[...classified].map(id=>({id}))],edges:navigation,previous:state.positions,compact:isPhone(),preserve:true});
 for(const plate of composition.plates){const taxonomy=taxonomies.get(plate.key);for(const n of taxonomy.categories){const p=positions.get(n.id);if(p)Object.assign(p,{aggregateKey:plate.key,parentId:n.parent});}}
 for(const link of navigation){const p=positions.get(link.target),parent=positions.get(link.source);if(p&&parent)Object.assign(p,{aggregateKey:parent.aggregateKey,parentId:link.source});}
 state.classifications=categoryNodes;state.classificationLinks=navigation.filter(e=>e.target.startsWith('category:'));

 state.positions=positions;state.placementOverflow=0;return positions;
}
const PERSPECTIVES=[['origins','Origins',['ancestry','source-identity']],['dependencies','Dependencies',['dependency']],['references','References',['attribution']]];
function setPerspective(value){
 const entry=PERSPECTIVES.find(p=>p[0]===value);if(!entry)return;
 const enabled=!entry[2].some(f=>state.layers[f]);for(const f of entry[2])state.layers[f]=enabled;
 state.perspective='custom';syncUrl();draw();renderDrawer();
}
function renderPerspective(){
 let host=$('graph-perspectives');if(!host){host=el('div',{id:'graph-perspectives',class:'graph-perspectives'});$('stage').append(host);}
 host.replaceChildren();const tabs=el('nav',{'aria-label':'Relationship layers',class:'graph-perspective-tabs'});
 for(const [id,label,families]of PERSPECTIVES){const count=state.view.edges.filter(e=>families.includes(e.family)).length;tabs.append(el('button',{type:'button','data-perspective':id,'aria-label':label+' · '+count,'aria-pressed':String(families.some(f=>state.layers[f])),text:label+' · '+count,onclick:()=>setPerspective(id)}));}
 host.append(tabs);
 const ancestry=state.view.edges.filter(e=>e.family==='ancestry').length;
 const description=ancestry?'Recorded relationships · layers share one exploration space.':'No recorded ancestry evidence · dependencies are separate claims.';
 host.append(el('p',{class:'graph-perspective-note',text:description}));
 const selected=state.selectedNodeId&&state.selectedNodeId!==state.view.subject.id;
 const bar=el('div',{class:'graph-exploration-actions'});
 if(state.explorationBack.length)bar.append(el('button',{type:'button',id:'graph-back',text:'← Back',onclick:()=>{const prev=state.explorationBack.pop();state.focusId=prev.focusId;state.layers=prev.layers;state.perspective=prev.perspective;state.selectedNodeId=prev.selectedNodeId;state.selectedEdgeId=prev.selectedEdgeId;state.positions=prev.positions;state.activeGroup=prev.activeGroup;state.expandedBundles=prev.expandedBundles;aggregatePages.clear();for(const [key,value]of prev.aggregatePages)aggregatePages.set(key,value);draw();renderDrawer();setCamera($('canvas'),prev.camera,prev.zoom);syncUrl();}}));
 if(selected)bar.append(el('button',{type:'button',id:'graph-explore-node',text:'Explore '+nameOf(state.selectedNodeId),onclick:()=>workspace?workspace.expand(state.selectedNodeId):void exploreNode(state.selectedNodeId)}));
 if(state.focusId)bar.append(el('span',{class:'graph-focus-label',text:'Focus: '+nameOf(state.focusId)}));
 if(bar.childElementCount)host.append(bar);
 if(isPhone()&&state.selectedNodeId&&state.positions.get(state.selectedNodeId)?.parentId){
  const labels=[];let id=state.positions.get(state.selectedNodeId).parentId;const seen=new Set();
  while(id&&!seen.has(id)){seen.add(id);const category=state.classifications?.find(n=>n.id===id);const plate=id.startsWith(BUNDLE_ID_PREFIX)?state.composition?.plates.find(p=>BUNDLE_ID_PREFIX+p.key===id):null;if(category)labels.unshift(category.label);else if(plate)labels.unshift(plate.label.replace(/ ×\d+$/, ''));id=state.positions.get(id)?.parentId;}
  host.append(el('p',{class:'graph-focus-path',text:labels.join(' → ')}));
 }

 if(state.perspective==='origins'){
  const relations=visibleCandidates(state.view);if(relations.length&&relations.length<=6){const key=el('div',{class:'graph-relation-key'});for(const edge of relations)key.append(el('button',{type:'button',text:edge.label,class:'st-'+edge.status,'aria-pressed':String(state.selectedEdgeId===edge.id),onclick:()=>selectEdge(edge.id)}));host.append(key);}
 }

 if(isPhone()&&(state.composition.plates.length||visibleCandidates(state.view).length)){
  const jump=el('div',{class:'graph-group-jumps','aria-label':'Navigate relationship neighborhoods'});
  for(const g of state.composition.plates)jump.append(el('button',{type:'button',text:g.label.replace(/ ×\d+$/,'')+' · '+g.count,'aria-pressed':String(g.expanded),onclick:()=>{if(!state.expandedBundles.has(g.key)){state.expandedBundles.add(g.key);draw();syncUrl();}focusGraphGroup(g.key);}}));
  const grouped=new Set(state.composition.plates.flatMap(g=>g.memberEdgeIds));
  const peers=new Set();for(const edge of visibleCandidates(state.view)){if(grouped.has(edge.id))continue;const id=edge.source===state.view.subject.id?edge.target:edge.source;if(peers.has(id))continue;peers.add(id);jump.append(el('button',{type:'button',text:edge.label+' · '+nameOf(id),onclick:()=>{state.activeGroup='';selectNode(id);switchMobile('graph');phoneFit(id);}}));}
  host.append(jump);
 }
 if(isPhone()&&((state.activeGroup&&state.expandedBundles.has(state.activeGroup))||(!state.composition.plates.length&&state.positions.size>2))){
  const peers=[...state.positions.keys()].filter(id=>id!==(state.focusId||state.view.subject.id)&&!id.startsWith('bundle:')&&(!state.activeGroup||state.positions.get(id).aggregateKey===state.activeGroup));
  const at=Math.max(0,peers.indexOf(state.selectedNodeId)),bar=el('div',{class:'graph-neighbor-step'});
  const show=i=>{state.selectedNodeId=peers[(i+peers.length)%peers.length];state.selectedEdgeId='';draw();renderDrawer();phoneFit(state.selectedNodeId);syncUrl();};
  bar.append(el('button',{type:'button',text:'‹','aria-label':'Previous nearby object',onclick:()=>show(at-1)}),el('span',{text:nameOf(peers[at])}),el('button',{type:'button',text:'›','aria-label':'Next nearby object',onclick:()=>show(at+1)}));host.append(bar);
 }

}
async function exploreNode(id){
 const token=state.loadToken,repo=state.repository;
 if(!state.graph){try{const response=await fetch(`/api/graph/${repo.owner}/${repo.name}?depth=${state.depth}`);const envelope=await response.json();if(token!==state.loadToken||!response.ok||!envelope.ok)return;state.graph=envelope.data;}catch{return;}}
 if(token!==state.loadToken)return;
 state.explorationBack.push({focusId:state.focusId,layers:{...state.layers},perspective:state.perspective,selectedNodeId:state.selectedNodeId,selectedEdgeId:state.selectedEdgeId,positions:new Map(state.positions),activeGroup:state.activeGroup,expandedBundles:new Set(state.expandedBundles),aggregatePages:new Map(aggregatePages),camera:$('canvas').getAttribute('viewBox'),zoom:state.zoom});
 const neighborhood=projectCanonicalView(state.graph,{subjectId:id});
 const nodes=new Map(state.view.nodes.map(n=>[n.id,n]));for(const n of neighborhood.nodes)if(!nodes.has(n.id))nodes.set(n.id,{...n,isSubject:false});
 const edges=new Map(state.view.edges.map(e=>[e.id,e]));for(const e of neighborhood.edges)if(!edges.has(e.id))edges.set(e.id,e);
 state.view={...state.view,nodes:[...nodes.values()],edges:[...edges.values()],evidenceByRelationship:{...state.view.evidenceByRelationship,...neighborhood.evidenceByRelationship}};
 state.selectedNodeId=id;draw();renderDrawer();syncUrl();
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
  return view.edges.filter(edge=>state.layers[edge.family]!==false);
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
/**
 * Says, from the region's own scroll position, whether there is more to read.
 *
 * Three classes, and only three facts are claimable: more above, more below, and how far
 * through the list the reader is. Everything is measured from `scrollTop` rather than
 * assumed from content length, because the rail and the Drawer change height constantly
 * -- a plate opens, the Drawer arrives, the viewport resizes -- and an affordance that
 * is stale is worse than none: it tells a reader the list ends when it does not.
 *
 * The continuation rule lives on the panel's *frame* rather than on the scroller, so it
 * is `is-more-below` on the parent. A pseudo-element on a scrolling box would travel
 * down the list with its content.
 */
function scrollAffordance(node, frame) {
  if (!node) return;
  // 2px of slack: fractional layout sizes make `scrollHeight - clientHeight` land on
  // values like 1.5, and a rule that flickers on for half a pixel is a defect.
  const slack = 2;
  const room = node.scrollHeight - node.clientHeight;
  const scrollable = room > slack;
  const above = scrollable && node.scrollTop > slack;
  const below = scrollable && node.scrollTop < room - slack;
  node.classList.toggle('gl-has-above', above);
  node.classList.toggle('gl-has-below', below);
  // How far through, as a whole percent. The cue is a count because a count is a fact.
  const through = scrollable ? Math.round(((node.scrollTop + node.clientHeight) / node.scrollHeight) * 100) : 100;
  if (frame) frame.classList.toggle('is-more-below', below);
  node.setAttribute('data-scroll-through', scrollable ? `${Math.min(99, Math.max(1, through))}%` : '100%');
}

/**
 * Keeps both panels' affordances true, cheaply.
 *
 * A scroll listener per region, coalesced into one animation frame, plus a
 * `ResizeObserver` on the scrolled box. The observer is what makes it correct rather
 * than merely working: the rail's content changes with the graph, the Drawer's with the
 * selection, and neither fires a scroll event when its own height changes. An earlier
 * version listened only to `scroll`, so opening a plate of ninety-seven rows left the
 * rule claiming there was nothing below.
 */
const scrollRegions = [];

function registerScrollRegion(node, frame) {
  if (!node) return;
  const entry = { node, frame };
  scrollRegions.push(entry);

  let queued = false;
  const sync = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scrollAffordance(entry.node, entry.frame);
    });
  };
  node.addEventListener('scroll', sync, { passive: true });

  if (typeof ResizeObserver === 'function') {
    const observer = new ResizeObserver(sync);
    observer.observe(node);
    // The content box, not the node: the node's own height is fixed by the grid, so
    // observing only it would never fire when the list inside it grew.
    for (const child of node.children) observer.observe(child);
  }
  scrollAffordance(node, frame);
  return entry;
}

function syncAllScrollAffordances() {
  for (const { node, frame } of scrollRegions) scrollAffordance(node, frame);
}

function renderRail(view) {
  const rail = $('rail-scroll');
  if (!rail) return;
  rail.replaceChildren();

  const block = (heading, body) => {
    const section = el('div', { class: 'lblk' });
    section.append(el('h6', { text: capitalise(heading) }));
    for (const child of body) section.append(child);
    rail.append(section);
  };

  // Provenance: what was analysed, and by what. Real revision, real analyzer.
  const provenance = el('div', { class: 'statline' });
  provenance.append(el('b', { text: view.subject?.label ?? '' }));
  const metadata=el('dl',{class:'rail-metadata'});
  for(const [label,value] of [
    ['Revision',`${view.revision.ref || view.revision.defaultBranch || 'HEAD'} @ ${view.revision.shortCommit}`],
    ['Analysed',formatTime(view.revision.analyzedAt)],
    ['Analyzer',`${view.analyzer.name} ${view.analyzer.version}`],
    ['Schema',view.schemaVersion],
  ]) metadata.append(el('dt',{text:label}),el('dd',{text:String(value)}));
  provenance.append(metadata);
  block('provenance', [provenance]);

  // Status: the real counts, with no interpretation added to them.
  const status = el('div', { class: 'statline' });
  const statusMarks = el('div', { class: 'rail-statuses' });
  for (const [key, style, label] of [['VERIFIED', 'v', 'Verified'], ['DECLARED', 'd', 'Declared'], ['DETECTED', 't', 'Detected']]) {
    const mark = el('span', { class: `st st-${style}` });
    mark.append(el('span', { class: 'sw', 'aria-hidden': 'true' }), el('span', { class: 'status-count', text: String(view.statusCounts[key]) }), el('span', { class: 'status-label', text: label }));
    statusMarks.append(mark);
  }
  status.append(statusMarks);
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
  // Drawer has its own shell overlay and does not own world coordinates.
  const present = new Set((view.edges || []).map((edge) => edge.family));
  const absent = ['ancestry', 'dependency', 'attribution', 'source-identity']
    .filter((family) => !present.has(family));
  const absentBlock = [];
  if (absent.length > 0) {
    const names = { ancestry: 'Ancestry', dependency: 'Dependencies', attribution: 'Attribution', 'source-identity': 'Source identity' };
    absentBlock.push(el('p', { class: 'rail-absence', text: absent.map((family) => names[family]).join(' · ') }));
    absentBlock.push(el('p', {
      class: 'rule-note',
      text: 'Not recorded in this snapshot. This does not rule out shared ancestry.',
    }));
  } else {
    absentBlock.push(el('p', {
      class: 'rule-note',
      text: 'The recorded graph contains relationships in every available family.',
    }));
  }
  block('not on the canvas', absentBlock);

  // The lineage key: line style per family, counted. Only families with a real count
  // appear, so it cannot advertise a style that is not drawn.
  const keyHost = el('div', { class: 'tkey' });
  block('relationships', [keyHost]);
  renderFamilyKey(keyHost);

  // Navigation and object controls stay primary; analysis receipts and reading
  // conventions are reference material, disclosed without removing their content.
  const reference = el('details',{class:'rail-reference'});
  reference.append(el('summary',{text:'Reading the graph'}));
  for(const section of [...rail.querySelectorAll(':scope > .lblk')]) {
   const heading=section.querySelector('h6')?.textContent?.toLowerCase();
   if(['reading names','not on the canvas','relationships'].includes(heading))reference.append(section);
   if(heading==='provenance') {
    const analysis=el('details',{class:'rail-reference'});
    analysis.append(el('summary',{text:'Analysis details'}),section);rail.append(analysis);
   }
  }
  if(reference.children.length>1)rail.append(reference);
  rail.hidden = false;
  // The rail's content just changed height, so its own scroll position is no longer
  // evidence of anything. Without this it keeps whatever fade it had while the content
  // beneath it is a different list.
  scrollAffordance(rail, $('rail'));
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
    ['directed', 'Directed'],
    ['symmetric', 'Mutual'],
    ['aggregate', 'Navigation group'],
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
      text: `${$('canvas').querySelectorAll('.node').length} objects · ${$('canvas').querySelectorAll('.edge-group,.group-navigation').length} shown relationships · ${$('canvas').querySelectorAll('.unified-edge').length} exploration links${plateNote}`,
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
  const provenance = candidates.every(e=>e.family==='ancestry'||e.family==='source-identity') && candidates.length<=DRAWABLE_CAPACITY;
  const familyCounts=new Map();for(const e of candidates)familyCounts.set(e.family,(familyCounts.get(e.family)||0)+1);
  const branchEdges=new Set(candidates.filter(e=>['dependency','attribution'].includes(e.family)&&familyCounts.get(e.family)>=4).map(e=>e.id));
  const composition = buildComposition(target, {
    edges: candidates,
    expandedAggregates: state.expandedBundles,
    directEdgeIds: provenance ? candidates.map(e=>e.id) : directEdgeIds.filter(id=>!branchEdges.has(id)),
    aggregateEdgeIds: provenance ? [] : [...new Set([...aggregateEdgeIds,...branchEdges])],
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
  const before = captureMotion(canvas);
  const focusedEdge = document.activeElement?.getAttribute('data-edge-id');
  const focusedNode = document.activeElement?.getAttribute('data-node-id');
  const focusedCategory=document.activeElement?.getAttribute('data-category-id');
  const focusedBundle=document.activeElement?.getAttribute('data-bundle-key');
  canvas.replaceChildren();
  if (!view) return;

  // The composition decides what is drawn individually and what collapses into a
  // plate. A 14-way fan-out reaches the canvas as one plate, not fourteen spokes.
  const initial=!state.hasFitted;
  const composition = currentComposition(view);
  state.composition = composition;
  const loose = new Set(composition.looseEdgeIds);
  // Phone navigation also exposes the composition's already-promoted real relationships.
  for (const id of composition.promotedEdgeIds) loose.add(id);
  if(!state.hasFitted&&composition.plates.length&&!new URLSearchParams(location.search).has('neighborhoods')){for(const plate of [...composition.plates].sort((a,b)=>b.count-a.count).slice(0,isPhone()?1:2)){state.expandedBundles.add(plate.key);plate.expanded=true;aggregatePages.set(plate.key,isPhone()?1:3);}}
  const expandedEdgeIds = new Set(composition.plates.flatMap(exploredIds));
  const selectedMember = state.selectedNodeId && state.selectedNodeId !== view.subject.id;
  const selectedEdges = new Set(selectedMember ? visibleCandidates(view).filter(e=>e.source===state.selectedNodeId||e.target===state.selectedNodeId).slice(0,memberPageSize()).map(e=>e.id) : []);
  // Selection retains evidence, but cannot reopen a deliberately folded branch.
  for(const edge of visibleCandidates(view)){
    if(edge.id!==state.selectedEdgeId&&!selectedEdges.has(edge.id))continue;
    const plate=composition.plates.find(p=>p.memberEdgeIds.includes(edge.id));
    if(plate?.expanded&&!classifyRelationships(view,plate).paths.get(edge.id)?.some(n=>state.expandedBundles.has('closed:'+n.id)))expandedEdgeIds.add(edge.id);
  }
  const edges = visibleCandidates(view).filter(edge=>{
    const plate=composition.plates.find(p=>p.memberEdgeIds.includes(edge.id));
    return plate?expandedEdgeIds.has(edge.id):loose.has(edge.id)||edge.id===state.selectedEdgeId||selectedEdges.has(edge.id);
  });
  // Allocate a two-dimensional neighborhood around the current focus. Existing
  // objects reserve their footprints before new peers and group controls arrive.
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
    setCamera(canvas, `${ORIGIN.x-viewport.width/2} ${ORIGIN.y-viewport.height/2} ${viewport.width} ${viewport.height}`, 1);
    state.refitMobile=isPhone();
    state.hasFitted = true;
    state.refitPending = false;
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
  const memberEdgeLayer = svgEl('g', {class:'member-edge-layer'});

  const mobilePath=new Set();let pathId=isPhone()&&state.activeGroup?state.selectedNodeId:null;
  while(pathId&&!mobilePath.has(pathId)){mobilePath.add(pathId);pathId=positions.get(pathId)?.parentId;}
  const selectedParent=positions.get(state.selectedNodeId)?.parentId;
  const mute=id=>mobilePath.size>0&&!mobilePath.has(id)&&positions.get(id)?.parentId!==selectedParent;
  const query = state.query ? state.query.toLowerCase() : '';
  const matchedNodes = new Set(searchNodes(view, query));
  const matchedEdges = new Set(searchEdges(view, query));
  const focusMode = query.length > 0 || Boolean(state.selectedNodeId);

  for (const edge of edges) {
    const aggregate=composition.plates.find(p=>p.memberEdgeIds.includes(edge.id));
    // A grouped relation is navigated through its display branch. Only a selected
    // canonical relation draws the direct object-to-object claim and its arrow.
    if(aggregate&&expandedEdgeIds.has(edge.id)){
      const peer=edge.source===view.subject.id?edge.target:edge.source;
      const memberPeers=edges.filter(e=>aggregate.memberEdgeIds.includes(e.id)).sort((a,b)=>{const pa=positions.get(a.source===view.subject.id?a.target:a.source),pb=positions.get(b.source===view.subject.id?b.target:b.source);return Math.abs(Math.cos(positions.get(BUNDLE_ID_PREFIX+aggregate.key)?.angle||0))>.7?pa.y-pb.y:(pa.x-pb.x||pa.y-pb.y);});
      const route=spatialRoute({source:positions.get(peer)?.aggregateKey===aggregate.key?(positions.get(peer)?.parentId||BUNDLE_ID_PREFIX+aggregate.key):BUNDLE_ID_PREFIX+aggregate.key,target:peer,presentation:positions.get(peer)?.aggregateKey===aggregate.key?'branch':undefined},positions,memberPeers.indexOf(edge),memberPeers.length);
      if(route){const nav=svgEl('g',{class:'group-navigation'+(mute(peer)?' is-neighborhood-muted':'')+(positions.get(peer)?.aggregateKey!==aggregate.key?' is-cross-reference':''), 'data-navigation-source':positions.get(peer)?.aggregateKey===aggregate.key?(positions.get(peer)?.parentId||BUNDLE_ID_PREFIX+aggregate.key):BUNDLE_ID_PREFIX+aggregate.key,'data-navigation-target':peer});nav.append(svgEl('path',{d:route.path,class:'group-navigation-line'}),svgEl('title',{},['Member of '+aggregate.label+'; select the object to read its actual relationship.']));memberEdgeLayer.append(nav);}
      else {const source=positions.get(peer)?.aggregateKey===aggregate.key?(positions.get(peer)?.parentId||BUNDLE_ID_PREFIX+aggregate.key):BUNDLE_ID_PREFIX+aggregate.key;memberEdgeLayer.append(connectionFallback({source,target:peer,label:'Member of '+aggregate.label+' · grouping only'},positions,()=>selectEdge(edge.id),{'data-navigation-source':source,'data-navigation-target':peer}));}
      if(state.selectedEdgeId!==edge.id)continue;
    }
    const { fanIndex, fanCount } = fanSlot(edge, edges);
    const geometry = edgeGeometry(edge, positions, fanIndex, fanCount);
    const route=spatialRoute(edge,positions,fanIndex,fanCount);
    if (!geometry) continue;
    if (!route) {
      (expandedEdgeIds.has(edge.id) ? memberEdgeLayer : edgeLayer).append(connectionFallback(edge,positions,()=>selectEdge(edge.id),{class:'edge-group route-obstructed','data-relationship-id':edge.id,'data-source':edge.source,'data-target':edge.target}));
      continue;
    }
    geometry.path=route.path;geometry.label={x:route.label.x,y:route.label.y-10};geometry.badge=geometry.label;

    const group = svgEl('g', {
      class: [
        'edge-group',
        `fam-${edge.family}`,
        `st-${edge.status}`,
        state.selectedEdgeId === edge.id ? 'is-selected' : '',
        query.length > 0 && !matchedEdges.has(edge.id) && !isEdgeTouching(edge, matchedNodes) ? 'is-dim' : '',
        matchedEdges.has(edge.id) ? 'is-match' : '',
      ].filter(Boolean).join(' '),
    });
    group.setAttribute('role','button');
    group.setAttribute('tabindex','0');
    group.setAttribute('aria-label',`${edge.source} ${edge.label} ${edge.target}`);
    group.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();selectEdge(edge.id);}});
    group.dataset.relationshipId = edge.id;
    group.dataset.source = edge.source; group.dataset.target = edge.target;

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
    const crowded = expandedEdgeIds.has(edge.id) || fanCount > LABEL_FAN_LIMIT || isCrowdedEdge(edge, degrees, LABEL_DEGREE_LIMIT);
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
    (expandedEdgeIds.has(edge.id) ? memberEdgeLayer : edgeLayer).append(group);
  }

  // Compact, independent grouping nodes. No nested members, rows or table frame.
  const subjectPosition = positions.get(view.subject.id);
  for(const plate of composition.plates){
    const at=positions.get(BUNDLE_ID_PREFIX+plate.key);if(!at||!plate.count)continue;
    const siblings=composition.plates.filter(p=>p.family===plate.family).sort((a,b)=>{const pa=positions.get(BUNDLE_ID_PREFIX+a.key),pb=positions.get(BUNDLE_ID_PREFIX+b.key);return Math.abs(Math.cos(at.angle||0))>.7?pa.y-pb.y:(pa.x-pb.x||pa.y-pb.y);});
    const navigationRoute=spatialRoute({source:view.subject.id,target:BUNDLE_ID_PREFIX+plate.key,presentation:'branch'},positions,siblings.indexOf(plate),siblings.length);
    if(navigationRoute)edgeLayer.append(svgEl('path',{d:navigationRoute.path,class:'group-navigation-line group-navigation-root','data-navigation-source':view.subject.id,'data-navigation-target':BUNDLE_ID_PREFIX+plate.key,'aria-label':plate.label+' · grouping, not a lineage claim'}));
    else edgeLayer.append(connectionFallback({source:view.subject.id,target:BUNDLE_ID_PREFIX+plate.key,label:plate.label+' · grouping only'},positions,()=>focusGraphGroup(plate.key),{'data-navigation-source':view.subject.id,'data-navigation-target':BUNDLE_ID_PREFIX+plate.key}));
    const left=at.x-at.width/2,top=at.y-at.height/2;
    const owns=plate.memberEdgeIds.includes(state.selectedEdgeId)||plate.memberEdgeIds.some(id=>{const e=view.edges.find(e=>e.id===id);return state.selectedNodeId&&(e?.source===state.selectedNodeId||e?.target===state.selectedNodeId);});
    const group=svgEl('g',{class:`bundle-card graph-group family-${plate.family} st-${plate.status}${plate.expanded?' is-expanded is-open':''}${owns?' is-selected':''}`,role:'button',tabindex:'0','aria-label':`${plate.label}, ${plate.count} ${plate.relationshipType.replace(/_/g,' ')} relationships, grouped`,'aria-expanded':String(plate.expanded)});
    group.dataset.bundleKey=plate.key;group.dataset.family=plate.family;
    group.append(svgEl('title',{},[`${plate.label} · ${plate.meta||plate.relationshipType} · grouping only`]),
      svgEl('rect',{x:left+(owns?5:4),y:top+(owns?5:4),width:at.width,height:at.height,rx:4,class:owns?'depth-shadow-selected':'depth-shadow-plate','aria-hidden':'true'}),
      svgEl('rect',{x:left,y:top,width:at.width,height:at.height,rx:4,class:'bundle-card-box depth-plate'}),
      svgEl('text',{x:left+12,y:top+25,class:'bundle-card-count'},[plate.label.replace(/ ×\d+$/, '')]),
      svgEl('text',{x:left+12,y:top+43,class:'plate-subtitle'},[`${plate.family==='dependency'?'DEPENDENCIES':plate.family==='attribution'?'REFERENCES':'ORIGINS'} · ${plate.count} members`])
    );
    const admitted=Math.min(plate.count,aggregatePages.get(plate.key)||memberPageSize());
    const action=(label,x,fn,cls)=>{const g=svgEl('g',{role:'button',tabindex:'0','aria-label':label,class:cls});g.append(svgEl('text',{x,y:top+69,class:'plate-row-expand'},[label]),svgEl('rect',{x:x-4,y:top+44,width:90,height:44,class:'plate-row-hit'}));const run=e=>{e.stopPropagation();fn();};g.addEventListener('click',run);g.addEventListener('mobile-tap',run);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();run(e);}});group.append(g);};
    if(plate.expanded){
      action('Focus',left+12,()=>focusGraphGroup(plate.key),'aggregate-focus');
      if(admitted<plate.count)action('Explore more',left+110,()=>{const next=Math.min(plate.count,admitted+memberPageSize());revealRelationships(plate,classifyRelationships(view,plate).ordered.slice(admitted,next));aggregatePages.set(plate.key,next);draw();syncUrl();},'aggregate-more');
    }else{group.append(svgEl('text',{x:left+12,y:top+69,class:'plate-row-more'},['Explore neighborhood']));}
    const activate=e=>{e.stopPropagation();if(e.target?.closest('.aggregate-more, .aggregate-search, .aggregate-focus'))return;toggleBundle(plate.key);};
    group.addEventListener('click',activate);group.addEventListener('keydown',e=>{if(e.target!==group)return;if(e.key==='Enter'||e.key===' '){e.preventDefault();activate(e);}});
    nodeLayer.append(group);
  }

  for(const link of state.classificationLinks||[]){
    const route=spatialRoute(link,positions);if(route){const nav=svgEl('g',{class:'group-navigation classification-navigation'+(mute(link.target)?' is-neighborhood-muted':''),'data-navigation-source':link.source,'data-navigation-target':link.target});nav.append(svgEl('path',{d:route.path,class:'group-navigation-line'}));memberEdgeLayer.append(nav);}else memberEdgeLayer.append(connectionFallback(link,positions,()=>{const category=state.classifications?.find(c=>c.id===link.target);if(category?.edgeIds[0])selectEdge(category.edgeIds[0]);},{'data-navigation-source':link.source,'data-navigation-target':link.target}));
  }
  for(const category of state.classifications||[]){
    const p=positions.get(category.id);if(!p)continue;
    const closed=state.expandedBundles.has('closed:'+category.id);
    const g=svgEl('g',{class:'classification-node category-level-'+category.level+(mute(category.id)?' is-neighborhood-muted':''),role:'button',tabindex:'0','aria-expanded':String(!closed),'aria-label':category.label+', '+category.edgeIds.length+' relationships. '+category.basis,'data-category-id':category.id,'data-parent-id':category.parent});
    g.append(svgEl('rect',{x:p.x-108,y:p.y-26,width:216,height:52,rx:category.level===1?13:3,class:'classification-box'}),svgEl('text',{x:p.x-94,y:p.y-4,class:'classification-label'},[(closed?'+ ':'− ')+category.label]),svgEl('text',{x:p.x-94,y:p.y+15,class:'classification-caption'},[category.edgeIds.length+' relationships · '+(category.level===1?'scope':'declaration sites')]),svgEl('title',{},[category.basis+' · display grouping only']));
    const activate=e=>{e.preventDefault();e.stopPropagation();if(closed){
      state.expandedBundles.delete('closed:'+category.id);
      const plate=composition.plates.find(p=>classifyRelationships(view,p).categories.some(n=>n.id===category.id));
      if(plate&&!category.children.length){const taxonomy=classifyRelationships(view,plate),first=taxonomy.ordered.findIndex(id=>category.edgeIds.includes(id));aggregatePages.set(plate.key,Math.min(plate.count,Math.max(first+1,aggregatePages.get(plate.key)||memberPageSize())));}
    }else state.expandedBundles.add('closed:'+category.id);syncUrl();draw();renderDrawer();};
    g.addEventListener('click',activate);g.addEventListener('mobile-tap',activate);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')activate(e);});nodeLayer.append(g);
  }
  nodeLayer.append(memberEdgeLayer);

  // Real entities require a canonical relation and an independent layout position.
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
        position.aggregateKey ? 'aggregate-member' : '',
        !node.isSubject&&mute(node.id)?'is-neighborhood-muted':'',
        `entity-${node.type.toLowerCase()}`,
        node.isSubject ? 'is-subject' : '',
        state.selectedNodeId === node.id ? 'is-selected' : '',
        query.length > 0 && !matchedNodes.has(node.id) ? 'is-dim' : '',
      ].filter(Boolean).join(' '),
    });
    group.dataset.nodeId = node.id;
    if(position.parentId)group.dataset.parentId=position.parentId;
    if(position.aggregateKey)group.dataset.aggregateKey=position.aggregateKey;
    group.setAttribute('tabindex', '0');
    group.setAttribute('role','button');group.setAttribute('aria-label',node.label);
    group.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectNode(node.id);}});

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
        node.label,
      ]),
    );
    if (!node.isSubject && !node.fact) {
      let parent=position.parentId,scope;
      while(parent){const category=state.classifications?.find(n=>n.id===parent);if(!category)break;if(category.level===1)scope=category.label;parent=category.parent;}
      group.append(svgEl('text',{x:position.x-NODE_W/2+10,y:position.y+15,class:'node-fact'},[node.type.toUpperCase()+(scope?' · '+scope.toUpperCase():'')]));
    }
    if (node.fact) {
      group.append(
        svgEl('text', {
          x: position.x + NODE_W / 2 - 10, y: position.y + 15, class: 'node-fact', 'text-anchor': 'end',
        }, [node.fact]),
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
  workspace?.paint(canvas, positions);
  state.contentBounds=contentBounds(positions);
  fitGraphText(canvas);
  transitionScene(canvas, before);
  if (focusedEdge) {
    Array.from(canvas.querySelectorAll('[data-edge-id]')).find(row => row.getAttribute('data-edge-id') === focusedEdge)?.focus({ preventScroll: true });
  }
  if (focusedNode) {
    Array.from(canvas.querySelectorAll('[data-node-id]')).find(node => node.getAttribute('data-node-id') === focusedNode)?.focus({ preventScroll: true });
  }
  if(focusedCategory)[...canvas.querySelectorAll('[data-category-id]')].find(n=>n.dataset.categoryId===focusedCategory)?.focus({preventScroll:true});
  if(focusedBundle)[...canvas.querySelectorAll('.bundle-card')].find(n=>n.dataset.bundleKey===focusedBundle)?.focus({preventScroll:true});
  renderPerspective();
  let empty=$('graph-provenance-empty');if(!empty){empty=el('div',{id:'graph-provenance-empty',class:'graph-provenance-empty'});$('stage').append(empty);}
  empty.replaceChildren();setHidden(empty,edges.length>0||composition.plates.length>0||canvas.querySelectorAll('.unified-node').length>0);
  if(edges.length===0&&composition.plates.length===0){empty.append(el('h2',{text:state.perspective==='origins'?'No recorded ancestry':'No recorded relationships in this layer'}),el('p',{text:state.perspective==='origins'?'This analysis has no verified fork or derivation record. Explore the fixed repository structure and Git history, or switch to a separate relationship layer.':'Choose another relationship layer, or return to the previous exploration focus.'}));}
  if(isPhone()&&state.refitMobile){if(edges.length>0&&positions.size<=3)fitGraphBoxes([...canvas.querySelectorAll('.node-box')]);else phoneFit();state.refitMobile=false;}
  renderBundles();
  renderLayersPop();
  renderRail(view);
  workspace?.decorate();
  renderBottomBand(view);
  if(initial&&!isPhone())fit();
  renderOverview();
  workspace?.settle();
  updateSearchCount();
  if(initial)syncUrl();
}

/** Fit real glyph advances after attachment, preserving complete values in titles. */
function fitGraphText(canvas) {
  for (const text of canvas.querySelectorAll('.bundle-card text, .node text')) {
    const full = text.textContent;
    const card = text.closest('.bundle-card, .node');
    const box = card.querySelector('.bundle-card-box, .node-box').getBBox();
    let room = box.width - 24;
    if (text.classList.contains('plate-subtitle') && card.classList.contains('is-expanded')) room = 164;
    if (text.classList.contains('group-batch')) room = 68;
    if (text.classList.contains('plate-row-expand')) room = 96;
    if (text.classList.contains('subject-tag')) continue;
    if (text.getComputedTextLength() <= room) continue;
    const chars = Array.from(full);
    let lo = 0, hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      text.textContent = chars.slice(0, mid).join('') + '…';
      if (text.getComputedTextLength() <= room) lo = mid; else hi = mid - 1;
    }
    text.textContent = chars.slice(0, lo).join('') + '…';
    // Put the title beside text, never inside it (SVG textContent would include it).
    if (!card.querySelector('title')) card.prepend(svgEl('title', {}, [full]));
    if (text.classList.contains('plate-subtitle')) card.prepend(svgEl('title', {}, [full]));
  }
}

function isEdgeTouching(edge, nodeIds) {
  return nodeIds.has(edge.source) || nodeIds.has(edge.target);
}

/** Expands or collapses a bundle, recording the state in the URL. */
function toggleBundle(key) {
  if (state.expandedBundles.has(key)) state.expandedBundles.delete(key);
  else state.expandedBundles.add(key);
  syncUrl();
  // The camera must not move. Expansion is a local change: it adds independent nodes
  // across reserved member shelves, while the pan, zoom, viewport centre and
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
  const nodes = searchNodes(state.view, state.query).length+(workspace?.search(state.query).length||0);
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
  else { setHidden($('mobile-search-results'),true); clearSearch(); }
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

// ------------------------------------------------------------ mobile views
function mobileSnapshot() {
  return { url: location.pathname + location.search, camera: $('canvas').getAttribute('viewBox'),
    zoom: state.zoom, relationsScroll: $('mobile-relation-list').scrollTop,
    evidenceScroll: $('drawer-inner').scrollTop, previous: mobile.previous };
}
function switchMobile(view, push = true, previous = null) {
  if (!isPhone() || !['graph','relations','evidence'].includes(view)) return;
  mobile.resetGesture();
  const old = previous || mobileSnapshot();
  const nextParams = new URLSearchParams(location.search);
  if (mobile.view !== 'evidence' && view === 'evidence') mobile.previous = mobile.view;
  if (push) history.replaceState({ mobileSnapshot: old, previous: old.previous }, '', old.url);
  mobile.view = view;
  const params = nextParams; params.set('mobile', view);
  const url = location.pathname + '?' + params;
  if (push) history.pushState({ previous: mobile.previous }, '', url);
  applyMobile();
  if (view === 'evidence') $('mobile-evidence-back').focus({ preventScroll: true });
  else document.querySelector(`#mobile-nav [data-mobile-view="${view}"]`).focus({ preventScroll: true });
}
function applyMobile() {
  const focused = document.activeElement;
  document.body.classList.add('mobile-explorer');
  if (!['graph','relations','evidence'].includes(mobile.view)) mobile.view = 'graph';
  const body = $('explorer-body'); body.dataset.mobileView = mobile.view;
  body.classList.remove('rail-open','with-drawer'); body.classList.add('rail-closed');
  setHidden($('rail'),true); setHidden($('drawer-scrim'),true);
  // Visibility (rather than display:none) retains stage geometry and its CTM.
  $('stage').style.visibility = mobile.view === 'graph' ? '' : 'hidden';
  $('stage').inert = mobile.view !== 'graph';
  setHidden($('mobile-nav'),false);
  setHidden($('mobile-relations'),mobile.view !== 'relations');
  setHidden($('mobile-evidence-heading'),mobile.view !== 'evidence');
  const selected = Boolean(state.selectedEdgeId || state.selectedNodeId);
  setHidden($('drawer'),mobile.view !== 'evidence' || !selected);
  setHidden($('mobile-evidence-empty'),mobile.view !== 'evidence' || selected);
  for (const button of document.querySelectorAll('#mobile-nav [data-mobile-view]')) button.setAttribute('aria-current',button.dataset.mobileView === mobile.view ? 'page' : 'false');
  if (mobile.graph !== state.view) renderMobileRelations();
  if (focused && focused !== document.body && (!focused.getClientRects().length || getComputedStyle(focused).visibility === 'hidden' || focused.closest('[inert]'))) {
    document.querySelector(`#mobile-nav [data-mobile-view="${mobile.view}"]`).focus({preventScroll:true});
  }
}
function renderMobileRelations() {
  mobile.graph = state.view;
  const list = $('mobile-relation-list'); list.replaceChildren();
  $('mobile-relation-query').value = '';
  $('mobile-relations-count').textContent = `${state.view.edges.length} relationships`;
  for (const family of relationGroups(state.view)) {
    const familyDetails = el('details', { class:'mobile-family', 'data-family':family.family });
    familyDetails.append(el('summary', { text: `${family.family} · ${family.groups.length} groups · ${family.count} relationships` }));
    for (const group of family.groups) {
      const details = el('details', { class:'mobile-group' });
      details.append(el('summary', { text: `${group.label} · ${group.edges.length} relationships · ${group.evidenceCount} evidence records` }));
      for (const edge of group.edges) {
        const source = nameOf(edge.source), target = nameOf(edge.target);
        const row = el('div', { class:'mobile-relation', 'data-relation-id':edge.id });
        row.dataset.search = `${source} ${target} ${edge.relationshipType} ${edge.status} ${group.label}`.toLowerCase();
        row.append(el('button',{ class:'mobile-relation-evidence', text: `${source} ${edge.directed ? '→' : '⇄'} ${target}`, onclick: () => {
          if (state.selectedEdgeId === edge.id) switchMobile('evidence'); else selectEdge(edge.id);
        }}),el('p',{class:'mono',text:`${edge.relationshipType} · ${edge.status} · ${edge.evidenceCount} evidence records`}),
        el('button',{class:'mobile-locate',text:'View in Graph',onclick:()=>locateMobile(edge.id,'edge')}));
        details.append(row);
      }
      familyDetails.append(details);
    }
    list.append(familyDetails);
  }
  list.scrollTop = 0;
  workspace?.decorate();
}
function filterMobileRelations() {
  const query = $('mobile-relation-query').value.trim().toLowerCase();
  for (const row of $('mobile-relation-list').querySelectorAll('.mobile-relation')) setHidden(row, query && !row.dataset.search.includes(query));
  for (const details of $('mobile-relation-list').querySelectorAll('details')) {
    const match = [...details.querySelectorAll('.mobile-relation')].some(row=>!row.hidden);
    setHidden(details,!match);
    if (query && match) details.open = true;
  }
}
function phoneFit(targetId) {
 const canvas=$('canvas'),rootId=state.view?.subject.id;
 const id=targetId||rootId;
 const target=state.positions.get(id||rootId)||ORIGIN;
 const parentId=target.parentId||(target.aggregateKey?BUNDLE_ID_PREFIX+target.aggregateKey:null);
 const parent=parentId?state.positions.get(parentId):null;
 const root=state.positions.get(rootId)||target;
 const box=p=>({getBBox:()=>({x:p.x-108,y:p.y-(p.height||52)/2,width:216,height:p.height||52})});
 const connection=targetId&&parent?[...canvas.querySelectorAll('.group-navigation')].find(n=>n.dataset.navigationTarget===id&&n.dataset.navigationSource===parentId)?.querySelector('path'):null;
 // Short touch landscapes locate the readable entity; its parent path stays in
 // the navigation. A long obstacle-avoiding connector must not shrink it away.
 if(targetId&&canvas.clientHeight<400){fitGraphBoxes([box(target)]);return;}
 fitGraphBoxes([box(target),...(parent?[box(parent)]:[]),...(connection?[connection]:[]),...(!targetId&&id!==rootId?[box(root)]:[])]);
}
function renderOverview(){
 let host=$('graph-overview');if(!host){
  host=el('div',{id:'graph-overview',class:'graph-overview','aria-label':'Graph overview'});
  const toggle=el('button',{id:'overview-toggle',class:'vp-btn',text:'Map','aria-label':'Graph overview','aria-expanded':'false','aria-controls':'overview-map',popovertarget:'overview-map'});
  const panel=el('div',{id:'overview-map'});panel.addEventListener('toggle',e=>toggle.setAttribute('aria-expanded',String(e.newState==='open')));
  host.append(toggle,panel);
 }
 const phone=isPhone(),panel=host.querySelector('#overview-map'),toggle=host.querySelector('#overview-toggle');
 (phone?$('viewport-hud'):$('stage')).append(host);setHidden(toggle,!phone);
 if(phone)panel.setAttribute('popover','auto');else panel.removeAttribute('popover');
 panel.replaceChildren();const points=[...state.positions.entries()];if(points.length<2){setHidden(host,true);return;}setHidden(host,false);
 const minX=Math.min(...points.map(([,p])=>p.x))-120,minY=Math.min(...points.map(([,p])=>p.y))-60,maxX=Math.max(...points.map(([,p])=>p.x))+120,maxY=Math.max(...points.map(([,p])=>p.y))+60;
 const map=svgEl('svg',{viewBox:`${minX} ${minY} ${maxX-minX} ${maxY-minY}`,role:'button',tabindex:0,'aria-label':'Graph overview: click a neighborhood; Enter returns to the repository'});
 for(const n of $('canvas').querySelectorAll('.group-navigation-line,.unified-line,.edge-line'))map.append(svgEl('path',{d:n.getAttribute('d'),fill:'none',stroke:'var(--rule-2)','stroke-width':5}));
 for(const [id,p]of points)map.append(svgEl('rect',{x:p.x-70,y:p.y-20,width:140,height:40,rx:5,fill:id===state.view.subject.id?'var(--brand)':'var(--brand-edge)'}));
 const focus=id=>{if(panel.matches(':popover-open'))panel.hidePopover();return id.startsWith('category:')?phoneFit(id):id.startsWith(BUNDLE_ID_PREFIX)?focusGraphGroup(id.slice(BUNDLE_ID_PREFIX.length)):workspace?.has(id)?workspace.focus(id):(selectNode(id),phoneFit(id));};
 map.onclick=e=>{const at=new DOMPoint(e.clientX,e.clientY).matrixTransform(map.getScreenCTM().inverse());const nearest=points.reduce((a,b)=>Math.hypot(b[1].x-at.x,b[1].y-at.y)<Math.hypot(a[1].x-at.x,a[1].y-at.y)?b:a);focus(nearest[0]);};
 map.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();focus(state.view.subject.id);}};
 panel.append(el('span',{text:'Overview · '+points.length+' objects'}),map);
}
function locateMobile(id,kind) {
  const relationIds = kind === 'edge' ? [id] : state.view.edges.filter(e=>e.source===id || e.target===id).map(e=>e.id);
  for(const edge of state.view.edges)if(relationIds.includes(edge.id)&&state.layers[edge.family]===false){state.layers[edge.family]=true;state.perspective='custom';}
  const branch = currentComposition(state.view).plates.find(p=>relationIds.some(edgeId=>p.memberEdgeIds.includes(edgeId)));
  if (branch) {
    revealRelationships(branch,relationIds);
    state.expandedBundles.add(branch.key);
    // The selected relationship is explicitly rendered; locating it must not
    // admit every earlier member of a large neighborhood.
    aggregatePages.set(branch.key,Math.min(branch.count,aggregatePages.get(branch.key)||memberPageSize()));
  }
  if (kind === 'edge') {
    const edge = state.view.edges.find(e=>e.id===id);
    state.selectedEdgeId=id;state.selectedNodeId='';
    if (edge) state.layers[edge.family]=true;
  } else { state.selectedNodeId=id;state.selectedEdgeId=''; }
  syncUrl(); draw(); renderDrawer(); switchMobile('graph');
  const canvas=$('canvas');
  let target = kind === 'node' ? [...canvas.querySelectorAll('.node')].find(e=>e.dataset.nodeId===id)?.querySelector('.node-box') : selectedTarget();
  let grouped = false;
  if (!target) {
    const ids = kind === 'edge' ? [id] : state.view.edges.filter(e=>e.source===id || e.target===id).map(e=>e.id);
    const plate=state.composition.plates.find(p=>ids.some(edgeId=>p.memberEdgeIds.includes(edgeId)));
    target=[...canvas.querySelectorAll('[data-bundle-key]')].find(e=>e.dataset.bundleKey===plate?.key)?.querySelector('.bundle-card-box');
    grouped = Boolean(target);
  }
  for (const previous of canvas.querySelectorAll('[data-mobile-located]')) previous.removeAttribute('data-mobile-located');
  if (target) {
    target.setAttribute('data-mobile-located',id);
    if (grouped) { const note=$('band').querySelector('.band-note'); if (note) { note.textContent = `${kind === 'node' ? nameOf(id) : nameOf(state.view.edges.find(e=>e.id===id)?.target)} · grouped here; read Evidence for this member`; note.title=note.textContent; } }
    if (branch) { state.activeGroup=branch.key; renderPerspective(); const edge=state.view.edges.find(e=>e.id===id);phoneFit(kind==='node'?id:edge?.target); (target.closest('[tabindex]') || $('zoom-fit')).focus({preventScroll:true}); return; }
    const r=target.getBoundingClientRect(), c=canvas.getScreenCTM();
    const point=new DOMPoint(r.x+r.width/2,r.y+r.height/2).matrixTransform(c.inverse());
    // Explicit location fits the actual target above the HUD, including short landscape.
    const hudHeight = $('viewport-hud').getBoundingClientRect().height;
    const availableHeight = Math.max(44,canvas.clientHeight-hudHeight-24);
    const zoom = Math.max(.25,Math.min(state.zoom,state.zoom*(canvas.clientWidth-24)/r.width,state.zoom*availableHeight/r.height));
    const w=canvas.clientWidth/zoom,h=canvas.clientHeight/zoom;
    setCamera(canvas,`${point.x-w/2} ${point.y-(canvas.clientHeight-hudHeight)/2/zoom} ${w} ${h}`,zoom);
    (target.closest('[tabindex]') || $('zoom-fit')).focus({preventScroll:true});
  }
}
function renderMobileSearch() {
  const box=$('mobile-search-results');box.replaceChildren();
  setHidden(box,!isPhone() || !state.query);
  if (!isPhone() || !state.query) return;
  for (const id of [...searchNodes(state.view,state.query),...(workspace?.search(state.query)||[])]) {
    box.append(el('button',{text:nameOf(id),onclick:()=>{ toggleSearch(false);workspace?.has(id)?workspace.focus(id):locateMobile(id,'node'); }}));
  }
  if (!box.childElementCount) box.append(el('p',{text:'No matching nodes. Browse Relations for relationship search.'}));
}

// ------------------------------------------------------------------ drawer

function selectEdge(id) {
  if (isPhone() && state.selectedEdgeId === id) { switchMobile('evidence'); return; }
  const previous = isPhone() ? mobileSnapshot() : null;
  state.selectedEdgeId = state.selectedEdgeId === id ? '' : id;
  state.selectedNodeId = '';
  syncUrl();
  draw();
  renderDrawer();
  if(isPhone())switchMobile('evidence',true,previous);
}

function selectNode(id) {
  if (isPhone() && state.selectedNodeId === id) { switchMobile('evidence'); return; }
  const previous = isPhone() ? mobileSnapshot() : null;
  state.selectedNodeId = state.selectedNodeId === id ? '' : id;
  if (state.selectedNodeId) state.selectedEdgeId = '';
  syncUrl();
  draw();
  renderDrawer();
  if(isPhone()&&state.selectedNodeId)phoneFit(state.selectedNodeId);
}

function clearSelection() {
  state.selectedEdgeId = '';
  state.selectedNodeId = '';
  syncUrl();
  draw();
  renderDrawer();
}

function closeDrawer() {
  if (isPhone()) { switchMobile(mobile.previous); return; }
  const edge = state.selectedEdgeId, nodeId = state.selectedNodeId;
  clearSelection();
  const node = Array.from($('canvas').querySelectorAll('[data-node-id]')).find(node => node.getAttribute('data-node-id') === nodeId);
  const row = Array.from($('canvas').querySelectorAll('[data-edge-id]')).find(row => row.getAttribute('data-edge-id') === edge);
  (node || row || $('zoom-fit')).focus({ preventScroll: true });
}

// Native disclosures keep their focus and scroll; only newly revealed content moves.
$('drawer-inner').addEventListener('toggle',event=>{
 const details=event.target;
 if(details instanceof HTMLDetailsElement&&details.open)for(const child of details.children)if(child.tagName!=='SUMMARY')revealInstrument(child);
},true);

function renderDrawer() {
  const drawer = $('drawer');
  const inner = $('drawer-inner');
  const key = state.selectedEdgeId + '|' + state.selectedNodeId + '|' + (isPhone() ? 'phone' : 'desktop') + '|' + state.view?.revision.commit;
  if (isPhone() && mobile.drawerGraph === state.view && inner.dataset.selectionKey === key) { applyPanels(); return; }
  // A breakpoint rebuild changes presentation, not the reader's selected record.
  // Retain only disclosures from the same repository/revision/selection.
  const readingKey = [state.view?.subject.id, state.view?.revision.commit, state.selectedEdgeId, state.selectedNodeId].join('|');
  const openedFields = inner.dataset.readingKey === readingKey
    ? new Set([...inner.querySelectorAll('.evidence-fields[open]')].map(n => n.dataset.evidenceId)) : new Set();
  mobile.drawerGraph = state.view;
  inner.dataset.selectionKey = key;
  inner.dataset.readingKey = readingKey;
  inner.replaceChildren();

  const view = state.view;
  if (!view) return;
  // A stale or hand-edited selection resolves to nothing. The URL is corrected
  // instead of leaving an empty drawer open.
  if (state.selectedEdgeId && !view.edges.some((edge) => edge.id === state.selectedEdgeId) && !workspace?.has(state.selectedEdgeId)) {
    state.selectedEdgeId = '';
  }
  if (state.selectedNodeId && !view.nodes.some((node) => node.id === state.selectedNodeId) && !workspace?.has(state.selectedNodeId)) {
    state.selectedNodeId = '';
  }

  const open = Boolean(state.selectedEdgeId || state.selectedNodeId);
  panels = transitionPanels(panels, { type: 'selection', selected: open });
  applyPanels();
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
    text: '×',
    onclick: closeDrawer,
  });
  const block = el('div');

  const displayEvidence = workspace?.inspector(state.selectedEdgeId || state.selectedNodeId);
  if (displayEvidence) block.append(displayEvidence);
  else if (state.selectedEdgeId) {
    const edge = view.edges.find((item) => item.id === state.selectedEdgeId);
    if (edge) block.append(renderEdgeDrawer(edge));
  } else {
    block.append(renderNodeDrawer());
    const actions=workspace?.repositoryActions(state.selectedNodeId);if(actions){const overview=block.querySelector(".entity-overview");if(overview)overview.after(actions);else block.append(actions);}
  }

  const toolbar = el('div', { class: 'drawer-toolbar' });
  toolbar.append(el('span', { text: 'Inspector' }), close);
  inner.append(toolbar, block);
  for (const fields of inner.querySelectorAll('.evidence-fields')) fields.open = openedFields.has(fields.dataset.evidenceId);
  revealInstrument(block);

  /*
   * Two things about a freshly-filled scroller.
   *
   * The position resets, because the Drawer shows one relationship's evidence at a time
   * and the reader is meant to start at its title; carrying the previous one's scroll
   * offset over would drop them into the middle of an unrelated list.
   *
   * Then the affordance is measured rather than assumed. `pebrel` opens a Drawer of
   * ninety-seven rows here, which scrolls; `nachocebey/is` opens one of four, which does
   * not. A rule that appeared on both would be a lie on the second.
   */
  inner.scrollTop = 0;
  inner.classList.remove('gl-has-above', 'gl-has-below');
  scrollAffordance(inner, drawer);
  protectSelectedTarget();
}

function nameOf(id) {
  const node = state.view.nodes.find((item) => item.id === id);
  return node ? node.label : workspace?.name(id) || id;
}

function renderEdgeDrawer(edge) {
  const view = state.view;
  const wrap = el('div', { class: 'relationship-inspector' });

  wrap.append(el('p', { class: 'd-eyebrow', text: 'RELATIONSHIP' }));
  wrap.append(el('p', { class: 'd-head', text: capitalise(edge.label) }));
  wrap.append(el('p', { class: 'd-sub', text: edge.directed ? 'Directed relationship' : 'Mutual relationship · no direction implied' }));

  const pair = el('div', { class: `d-pair${edge.directed ? ' is-directed' : ''}` });
  for (const [role, id] of [[edge.directed ? 'From' : 'Object', edge.source], [edge.directed ? 'To' : 'Related object', edge.target]]) {
    pair.append(el('div', { class: 'd-endpoint', 'data-endpoint': id }, [
      el('span', { class: 'd-endpoint-role', text: role }),
      el('span', { class: 'd-endpoint-name', text: nameOf(id) }),
    ]));
  }
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
  const provenance = el('details', { class: 'workspace-technical relationship-provenance' });
  provenance.append(el('summary', { text: 'Recorded provenance' }));
  const kv = el('dl', { class: 'd-kv' });
  const row = (k, v) => {
    kv.append(el('dt', { text: k }), el('dd', { text: String(v) }));
  };
  row('Relation', edge.relationshipType);
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
  // Interpret the record first; raw evidence still precedes technical provenance.
  const why = el('div', { class: 'd-block' });
  why.append(el('p', { class: 'd-block-head', text: 'WHAT THIS RECORD SHOWS' }));
  const whyText = verificationSentence(edge, records);
  const whyBox = el('p', { class: `d-why st-${edge.status}` });
  whyBox.textContent = whyText;
  why.append(whyBox);
  wrap.append(why);
  wrap.append(evidenceBlock);
  wrap.append(provenance);

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
  const card = el('div', { class: `d-card st-${record.status}` });

  const pill = el('span', { class: `d-pill st-${record.status}`, text: record.status });
  card.append(
    el('div', { class: 'd-card-head' }, [
      el('span', { class: 'd-card-type', text: capitalise(record.type.replaceAll('_', ' ')) }),
      pill,
    ]),
  );
  if (record.locator) card.append(el('p', { class: 'd-card-loc', text: record.locator }));
  if (record.observedText) card.append(el('blockquote', { class: 'd-quote', text: record.observedText }));

  const data = el('dl', { class: 'd-data' });
  for (const [key, value] of Object.entries(record.data || {})) {
    if (value === null || value === undefined || key === 'relationship_semantics') continue;
    const rendered = Array.isArray(value)
      ? value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ')
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
    data.append(el('dt', { text: key }), el('dd', { text: rendered }));
  }
  // The citation is primary; retain the complete record behind a native disclosure.
  const fields = el('details', { class: 'workspace-technical evidence-fields', 'data-evidence-id': record.id });
  fields.append(el('summary', { text: `Recorded fields · ${data.children.length / 2}` }), data);

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
  if (data.children.length) card.append(fields);
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

/**
 * A node's relationships, grouped by the file that declares them.
 *
 * `Kuddev/pebrel`'s subject has ninety-seven one-hop dependencies, and listing them as
 * ninety-seven rows in a flat list is not an answer: it is the count restated. What the
 * evidence actually says is that they are declared by a handful of manifests -- a dozen
 * `Cargo.toml` and `package.json` files, of which the workspace root declares about half
 * -- and that structure is the answer.
 *
 * The group key is `evidenceByRelationship[edgeId][0].data.manifest_path`, which is the
 * manifest the analyser's own evidence record names. So the grouping is evidence-backed
 * rather than invented, and it needs nothing the analyser does not already emit: this is
 * presentation, computed from the payload in the view model.
 *
 * The first record is the primary one. Where several manifests declare the same
 * relationship -- a workspace crate and the binary that wraps it both depend on `serde` --
 * the relationship is filed under the record the analyser put first, which is the
 * declaring manifest rather than the incidental one. There are twenty-three such
 * relationships in `pebrel`; filing them by first record keeps every relationship in
 * exactly one group, which is what makes the counts a partition rather than a tally.
 *
 * Where a relationship has no manifest -- an ancestry claim from git history, say -- it
 * is grouped by its own relationship type rather than dropped, because an unattributed
 * relationship is still a relationship.
 *
 * Ordering is fixed and total: groups by descending member count, then by path, so the
 * same repository always produces the same list in the same order. Within a group the
 * order is the view model's edge order, which is the analyser's own deterministic order.
 */
function groupRelationshipsByManifest(view, edgeIds) {
  const evidence = view.evidenceByRelationship || {};
  const groups = new Map();
  for (const id of edgeIds) {
    const edge = view.edges.find((item) => item.id === id);
    if (!edge) continue;
    const record = (evidence[id] || [])[0];
    // The evidence record's own shape, not a guess at it: `data` is the extractor's
    // structured payload and `manifest_path` is one of its documented fields, but the
    // record may also be a flat one. Both are read, and neither is assumed.
    const payload = record && record.data ? (record.data.data || record.data) : null;
    const manifest = payload ? payload.manifest_path : null;
    const key = manifest || edge.relationshipType;
    const group = groups.get(key) || { key, manifest: Boolean(manifest), members: [] };
    group.members.push(edge);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) =>
    b.members.length - a.members.length || String(a.key).localeCompare(String(b.key)));
}

function renderNodeDrawer() {
  const view = state.view;
  const node = view.nodes.find((item) => item.id === state.selectedNodeId);
  const wrap = el('div');
  if (!node) return wrap;

  wrap.append(el('p', { class: 'd-eyebrow', text: node.isSubject ? 'ANALYSED REPOSITORY' : node.type.toUpperCase() }));
  wrap.append(el('p', { class: 'd-head', text: node.label }));
  const technical=el('details',{class:'workspace-technical'});technical.append(el('summary',{text:'Technical identity'}),el('p',{class:'mono',text:node.id}),el('p',{class:'d-sub',text:node.isSubject?'Analysed repository':'Related '+node.type.toLowerCase()}));
  const hierarchy=el('div',{class:'d-hierarchy'});hierarchy.append(el('p',{class:'d-block-head',text:'Exploration path'}));
  const path=el('ol');path.append(el('li',{text:view.subject.label}));
  const plate=state.composition?.plates.find(p=>p.memberEdgeIds.some(id=>{const e=view.edges.find(e=>e.id===id);return e&&(e.source===node.id||e.target===node.id);}));
  if(plate&&!node.isSubject){
   path.append(el('li',{text:plate.label.replace(/ ×\d+$/, '')}));
   const edgeId=plate.memberEdgeIds.find(id=>{const e=view.edges.find(e=>e.id===id);return e&&(e.source===node.id||e.target===node.id);});
   const categories=classifyRelationships(view,plate).paths.get(edgeId)||[];
   for(const n of categories)path.append(el('li',{class:n.level===1?'hierarchy-scope':'hierarchy-sites',text:n.label+' · '+n.basis}));
   path.append(el('li',{text:node.label}));
   const cards=view.evidenceByRelationship[edgeId]||[];
   const sites=[...new Set(cards.filter(c=>c.type==='package_manifest').map(c=>(c.data?.data||c.data)?.manifest_path).filter(Boolean))];
   hierarchy.append(path);if(sites.length)hierarchy.append(el('p',{class:'d-sub',text:'Recorded declaring sites: '+sites.join(' · ')}));wrap.append(hierarchy);
  }


  const overview = el('div', { class: 'entity-overview' });
  overview.append(el('p',{class:'entity-description',text:node.fact || node.type}));
  const relationships = edgesForNode(view,node.id).map(id=>view.edges.find(e=>e.id===id)).filter(Boolean);
  const metrics=el('div',{class:'entity-metrics'});
  const metricDescriptions={
   origins:'Direct relationships to this object: recorded ancestry or identical source content. Identical content does not prove derivation.',
   dependencies:'Direct dependency relationships to this object.',
   references:'Direct reference relationships to this object.',
  };
  for(const [id,label,families] of PERSPECTIVES) {
   const count=relationships.filter(e=>families.includes(e.family)).length;
   const item=el('div',{title:metricDescriptions[id]});item.append(el('strong',{text:String(count)}),el('span',{text:label}));metrics.append(item);
  }
  overview.append(metrics);
  if(node.isSubject&&!relationships.some(e=>e.family==='ancestry'))overview.append(el('p',{class:'entity-absence',text:'No recorded ancestry evidence. Dependencies describe use, not origin.'}));
  wrap.append(overview);

  /*
   * Relationships, by declaring manifest.
   *
   * Grouped, counted and sticky, because a flat list of ninety-seven is the count
   * again. Each group is one real file, named in mono because a path is technical data,
   * with its member count -- and the sticky heading means the reader always knows which
   * file they are reading while the members scroll under it.
   */
  const related = edgesForNode(view, node.id);
  const groups = groupRelationshipsByManifest(view, related);
  const relBlock = el('div', { class: 'd-block' });
  relBlock.append(el('p', {
    class: 'd-block-head',
    text: `Relationships · ${related.length}`,
  }));
  if (groups.length === 0) {
    relBlock.append(el('p', { class: 'node-detail', text: 'No one-hop relationship in this view.' }));
  }
  if(groups.length) relBlock.append(el('p',{class:'d-basis',text:groups.length+' '+(groups.length===1?'navigation group':'navigation groups')+' · open a relationship to read its evidence.'}));
  for (const group of groups) {
    const section = el('details', { class: 'd-group' });
    section.open = groups.length === 1 || group === groups[0];
    section.append(el('summary', { class: 'd-group-head' }, [
      el('span', { class: group.manifest ? 'mono d-group-name' : 'd-group-name', text: group.manifest ? group.key : ({references:'References', depends_on:'Dependencies', forked_from:'Fork source', derived_from:'Derived from', shares_history_with:'Shared Git history', shares_exact_content_with:'Identical content'})[group.key] || group.key.replaceAll('_', ' ') }),
      el('span', { class: 'd-group-count r-mono', text: String(group.members.length) }),
    ]));
    const appendRow=(host,edge)=>{const other=edge.source===node.id?edge.target:edge.source;const row=el('button',{class:'bundle-row'});row.append(el('span',{class:'relationship-object',text:nameOf(other)}),el('span',{class:'relationship-kind',text:edge.label}));row.addEventListener('click',()=>{state.selectedNodeId='';selectEdge(edge.id);});host.append(row);};
    const taxonomy=classifyRelationships(view,{key:group.key,family:group.members[0]?.family,count:group.members.length,memberEdgeIds:group.members.map(e=>e.id)});
    if(taxonomy.categories.length){
      const appendCategory=(host,n)=>{const details=el('details',{class:'d-classification category-level-'+n.level});details.append(el('summary',{text:n.label+' · '+n.edgeIds.length}),el('p',{class:'d-basis',text:n.basis}));
       if(n.children.length)for(const child of n.children)appendCategory(details,child);else for(const id of n.edgeIds){const e=group.members.find(e=>e.id===id);if(e)appendRow(details,e);}host.append(details);};
      for(const n of taxonomy.roots)appendCategory(section,n);
    }else for(const edge of group.members)appendRow(section,edge);

    relBlock.append(section);
  }
  wrap.append(relBlock);

  if (node.url) {
    const link = el('a', { class: 'd-action', href: node.url, target: '_blank', rel: 'noreferrer noopener', text: 'Open repository ↗' });
    const actions = el('div', { class: 'd-actions' });
    actions.append(link);
    wrap.append(actions);
  }
  wrap.append(technical);
  return wrap;
}

function capitalise(text) {
  return String(text).charAt(0).toUpperCase() + String(text).slice(1);
}

// --------------------------------------------------------- pan / zoom / fit

let panState = null;
let cameraViewport = null;

/**
 * The single place a camera change is written.
 *
 * Every path that moves the window -- wheel, buttons, drag, fit -- goes through here,
 * The explored world is unbounded. Shell overlays and
 * viewport HUD never participate in this transform.
 */
function setCamera(canvas, viewBox, zoom) {
  const viewport = { width: canvas.clientWidth || 1200, height: canvas.clientHeight || 700 };
  const parts = String(viewBox || '').split(/\s+/).map(Number);
  if (parts.length < 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x, y, width, height] = parts;
  const centre = { x: x + width / 2, y: y + height / 2 };
  const z = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const window = {viewBox:`${centre.x-width/2} ${centre.y-height/2} ${width} ${height}`,zoom:z};
  canvas.setAttribute('viewBox', window.viewBox);
  cameraViewport = viewport;
  state.zoom = window.zoom;

  return window;
}

/** The only writer of Rail/Drawer visibility. Hiding evidence retains its DOM/scroll. */
function applyPanels() {
  const mobileFocus = document.activeElement?.closest('#mobile-nav, #mobile-relations, #mobile-evidence-heading, #mobile-evidence-empty');
  if (isPhone() && state.view) { applyMobile(); return; }
  document.body.classList.remove('mobile-explorer');
  for (const id of ['mobile-nav','mobile-relations','mobile-evidence-heading','mobile-evidence-empty']) setHidden($(id),true);
  $('stage').style.visibility = '';
  $('stage').inert = false;
  const visible = visiblePanels(panels);
  const body = $('explorer-body');
  const hiddenFocus = mobileFocus || (!visible.rail && $('rail').contains(document.activeElement))
    || (!visible.drawer && $('drawer').contains(document.activeElement));
  const enteringRail = visible.rail && $('rail').hidden;
  const enteringDrawer = visible.drawer && $('drawer').hidden;
  setHidden($('rail'), !visible.rail);
  setHidden($('drawer'), !visible.drawer);
  if (enteringRail) revealPanel($('rail-scroll'), 'left');
  if (enteringDrawer) revealPanel($('drawer-inner'), 'right');
  setHidden($('drawer-scrim'), true);
  body.classList.toggle('rail-open', visible.rail);
  body.classList.toggle('rail-closed', !visible.rail);
  body.classList.toggle('with-drawer', visible.drawer);
  body.dataset.panelMode = panels.mode;
  // Instruments use uncovered screen space; the SVG world keeps its bounds.
  const stageRect = $('stage').getBoundingClientRect();
  body.style.setProperty('--instrument-left', visible.rail ? `${$('rail').getBoundingClientRect().right-stageRect.left}px` : '0px');
  body.style.setProperty('--instrument-right', visible.drawer ? `${stageRect.right-$('drawer').getBoundingClientRect().left}px` : '0px');
  $('rail-toggle').setAttribute('aria-expanded', String(visible.rail));
  if (hiddenFocus) $('rail-toggle').focus({ preventScroll: true });
  syncAllScrollAffordances();
}
function selectedTarget() {
  const canvas = $('canvas');
  if (state.selectedNodeId) {
    return Array.from(canvas.querySelectorAll('.node')).find(e => e.dataset.nodeId === state.selectedNodeId)?.querySelector('.node-box');
  }
  const row = Array.from(canvas.querySelectorAll('.plate-row')).find(e => e.dataset.edgeId === state.selectedEdgeId);
  if (row) return row;
  // Protect the visual relationship label; direct path hit coverage is a separate check.
  const edge = Array.from(canvas.querySelectorAll('.edge-group')).find(e => e.dataset.relationshipId === state.selectedEdgeId);
  return edge?.querySelector('.edge-label');
}
function protectSelectedTarget() {
  if (isPhone() || panels.mode === 'legacy-mobile' || !state.view) return;
  const target = selectedTarget();
  if (!target) return; // Unexpanded aggregate members have no current visible row.
  const stage = $('stage').getBoundingClientRect();
  const hud = document.querySelector('.viewport-hud').getBoundingClientRect();
  const visible = visiblePanels(panels);
  const free = { left: visible.rail ? $('rail').getBoundingClientRect().right : stage.left,
    right: visible.drawer ? $('drawer').getBoundingClientRect().left : stage.right,
    top: Math.max(stage.top,($('graph-perspectives')?.getBoundingClientRect().bottom||stage.top)+8), bottom: hud.top };
  const pan = protectionPan(target.getBoundingClientRect(), free);
  if (!pan || (Math.abs(pan.dx)<0.01 && Math.abs(pan.dy)<0.01)) return;
  const canvas = $('canvas'), c = canvas.getScreenCTM();
  const [x, y, w, h] = canvas.getAttribute('viewBox').split(/\s+/).map(Number);
  setCamera(canvas, `${x-pan.dx/c.a} ${y-pan.dy/c.d} ${w} ${h}`, state.zoom);
}
function toggleRail(force) {
  panels = transitionPanels(panels, { type: 'context', open: force === undefined ? !panels.rail : force === true });
  applyPanels();
  protectSelectedTarget();
}

function setupViewport() {
  const canvas = $('canvas');

  mobile.resetGesture = installTouchCamera(canvas, { active: isPhone,
    read: () => ({ viewBox: canvas.getAttribute('viewBox'), zoom: state.zoom }),
    write: (box, zoom) => setCamera(canvas, box, zoom) });
  canvas.addEventListener('mobile-tap', event => {
    const edge = event.target.closest('[data-edge-id], [data-relationship-id], [data-display-edge]');
    const node = event.target.closest('[data-node-id]');
    const plate = event.target.closest('[data-bundle-key]');
    if (edge) selectEdge(edge.dataset.edgeId || edge.dataset.relationshipId || edge.dataset.displayEdge);
    else if (node) selectNode(node.dataset.nodeId);
    else if (plate) toggleBundle(plate.dataset.bundleKey);
    else if (event.target === canvas) clearSelection();
  });
  // Node hover styling is pure CSS (`.node:hover`), deliberately not a redraw:
  // rebuilding the canvas under the pointer would re-fire hover and loop.

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    stopMotion(canvas);
    const rect = canvas.getBoundingClientRect();
    if (event.deltaY === 0) return;
    const factor = Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * 0.002);
    const focus = clientToGraph(canvas, event.clientX - rect.left, event.clientY - rect.top);
    const next = zoomViewBox(canvas.getAttribute('viewBox'), factor, focus, state.zoom);
    setCamera(canvas, next.viewBox, next.zoom);
  }, { passive: false });

  let suppressClick = false;
  const DRAG_THRESHOLD = 5;
  canvas.addEventListener('pointerdown', event => {
    stopMotion(canvas);
    if (isPhone() && event.pointerType === 'touch') return;
    if (event.button !== 0 || !event.isPrimary) return;
    suppressClick = false;
    panState = { pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      viewBox: canvas.getAttribute('viewBox'), zoom: state.zoom, ctm: canvas.getScreenCTM(), dragging: false };
  });
  canvas.addEventListener('pointermove', event => {
    if (!panState || event.pointerId !== panState.pointerId) return;
    const sx = event.clientX - panState.x, sy = event.clientY - panState.y;
    if (!panState.dragging && Math.hypot(sx, sy) <= DRAG_THRESHOLD) return;
    if (!panState.dragging) {
      panState.dragging = true;
      suppressClick = true;
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add('is-panning');
    }
    const [vx, vy, vw, vh] = String(panState.viewBox).split(/\s+/).map(Number);
    const c = panState.ctm;
    setCamera(canvas, `${vx - sx / c.a} ${vy - sy / c.d} ${vw} ${vh}`, panState.zoom);
  });
  const endPointer = event => {
    if (!panState || event.pointerId !== panState.pointerId) return;
    if (event.type === 'pointercancel') suppressClick = true;
    panState = null;
    canvas.classList.remove('is-panning');
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('lostpointercapture', endPointer);
  // Capture phase blocks node/row activation as well as blank deselection after a drag.
  canvas.addEventListener('click', event => {
    if (suppressClick) { event.preventDefault(); event.stopImmediatePropagation(); suppressClick = false; return; }
    if (event.target === canvas) clearSelection();
  }, true);

  $('zoom-in').addEventListener('click', () => zoomBy(ZOOM_STEP));
  $('zoom-out').addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
  $('zoom-fit').addEventListener('click', () => fit());
  window.addEventListener('resize', () => {
    const canvasBefore = $('canvas'), oldBox = String(canvasBefore.getAttribute('viewBox')).split(/\s+/).map(Number);
    const oldScale = cameraViewport ? Math.min(cameraViewport.width/oldBox[2],cameraViewport.height/oldBox[3]) : state.zoom;
    mobile.resetGesture();
    panels = transitionPanels(panels, { type: 'resize', width: window.innerWidth });
    applyPanels();
    if (state.view) {
      const canvas = $('canvas');
      const width=canvas.clientWidth/oldScale,height=canvas.clientHeight/oldScale;
      setCamera(canvas, `${oldBox[0]+oldBox[2]/2-width/2} ${oldBox[1]+oldBox[3]/2-height/2} ${width} ${height}`,oldScale);
      draw();
      const readingOffset = $('drawer-inner').scrollTop;
      const readingFocus = $('drawer-inner').contains(document.activeElement);
      renderDrawer();
      $('drawer-inner').scrollTop = readingOffset;
      // A mode change rebuilds evidence cards; retain a visible reading exit.
      if (readingFocus && document.activeElement === document.body) {
        (isPhone() ? $('mobile-evidence-back') : $('rail-toggle')).focus({preventScroll:true});
      }
      protectSelectedTarget();
    }
    // A resize changes how much of each list fits, which changes whether there is more
    // to read. The observers catch content changes; this catches the viewport's.
    syncAllScrollAffordances();
  });
}

function clientToGraph(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const point = new DOMPoint(rect.left + clientX, rect.top + clientY).matrixTransform(canvas.getScreenCTM().inverse());
  return { x: point.x, y: point.y };
}

function zoomBy(factor) {
  const canvas = $('canvas');
  const next = zoomViewBox(canvas.getAttribute('viewBox'), factor, null, state.zoom);
  transitionCamera(canvas, next.viewBox, box=>setCamera(canvas,box,canvas.clientWidth / Number(box.split(/\s+/)[2])));
}

/** Explicit local focus uses the existing camera writer; expansion never fits. */
function fitGraphBoxes(nodes){
 const canvas=$('canvas'), boxes=nodes.filter(Boolean).map(n=>n.getBBox());if(!boxes.length)return;
 const padding=isPhone()?12:40;
 const x=Math.min(...boxes.map(b=>b.x))-24,y=Math.min(...boxes.map(b=>b.y))-padding;
 const right=Math.max(...boxes.map(b=>b.x+b.width))+24,bottom=Math.max(...boxes.map(b=>b.y+b.height))+padding;
 const viewport={width:canvas.clientWidth,height:canvas.clientHeight};
 const rail=!isPhone()&&visiblePanels(panels).rail?320:0,drawer=!isPhone()&&visiblePanels(panels).drawer?400:0;
 const hud=$('viewport-hud').getBoundingClientRect().height;
 const toolbar=$('graph-perspectives')?.offsetHeight||110;
 const availableHeight=Math.max(44,viewport.height-hud-toolbar-32);
 const scale=Math.max(1/1.2,(right-x)/Math.max(240,viewport.width-rail-drawer-48),(bottom-y)/availableHeight);
 const w=viewport.width*scale,h=viewport.height*scale;
 transitionCamera(canvas,`${x-(w-(right-x))/2-(rail-drawer)*scale/2} ${y-(h-(bottom-y))/2+(hud-toolbar)/2*scale} ${w} ${h}`,box=>setCamera(canvas,box,canvas.clientWidth/Number(box.split(/\s+/)[2])));
}
function focusGraphGroup(key){
 const canvas=$('canvas');const members=[...canvas.querySelectorAll('.aggregate-member')].filter(n=>n.dataset.aggregateKey===key);
 const group=[...canvas.querySelectorAll('.bundle-card')].find(n=>n.dataset.bundleKey===key);
 if(isPhone()){
  // Keep actual node text and touch targets at reading size. Navigation follows
  // the chosen neighborhood while the canvas can still pan to its other peers.
  const center=state.positions.get(BUNDLE_ID_PREFIX+key);
  const first=members.find(n=>n.dataset.nodeId===state.selectedNodeId)||members.toSorted((a,b)=>{const pa=state.positions.get(a.dataset.nodeId),pb=state.positions.get(b.dataset.nodeId);return Math.hypot(pa.x-center.x,pa.y-center.y)-Math.hypot(pb.x-center.x,pb.y-center.y);})[0];
  state.activeGroup=key;if(first){state.selectedNodeId=first.dataset.nodeId;state.selectedEdgeId='';draw();renderDrawer();syncUrl();}phoneFit(first?.dataset.nodeId);return;
 }

 fitGraphBoxes([canvas.querySelector('.node-box.is-subject'),group?.querySelector('.bundle-card-box'),...members.map(n=>n.querySelector('.node-box')),...[...canvas.querySelectorAll('.classification-node')].filter(n=>state.positions.get(n.dataset.categoryId)?.aggregateKey===key).map(n=>n.querySelector('.classification-box'))]);
}

function fit() {
  if (!state.view) return;
  const canvas = $('canvas');
  if(isPhone() && canvas.clientHeight<400){phoneFit();return;}
  if(isPhone()){phoneFit();return;}
  fitGraphBoxes([...canvas.querySelectorAll('.bundle-card-box, .node-box, .classification-box')]);
}

// --------------------------------------------------------------------- boot

function showLanding() {
  cancelLoad();
  dismissGitLog();
  hideWorking();
  state.phase = 'idle';
  setHidden($('failure'), true);
  setHidden($('rail-toggle'), true);
  setHidden($('landing'), false);
  setHidden($('explorer'), true);
  setHidden($('appbar-mid'), true);
  setHidden($('appbar-right'), true);
  setHidden($('project-source'), false);
  setHidden($('site-foot'), false);
  setHidden($('searchbar'), true);
  toggleLayers(false);
}

function boot() {
  document.addEventListener('click', event => {
    const link = event.target.closest('a.brand, .samples a');
    if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    const repository = parseRepositoryPath(new URL(link.href).pathname);
    if (repository) navigate(repository);
    else { history.pushState(null, '', '/'); showLanding(); }
  });
  mobile.view = new URLSearchParams(location.search).get('mobile') || 'graph';
  setupViewport();
  for (const button of document.querySelectorAll('#mobile-nav [data-mobile-view]')) button.addEventListener('click', () => switchMobile(button.dataset.mobileView));
  $('mobile-evidence-back').addEventListener('click', () => switchMobile(mobile.previous));
  $('mobile-evidence-close').addEventListener('click', () => switchMobile(mobile.previous));
  $('mobile-browse-relations').addEventListener('click', () => switchMobile('relations'));
  $('mobile-relation-query').addEventListener('input', filterMobileRelations);

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
      for (const other of document.querySelectorAll('.seg-btn')) {
        other.classList.toggle('is-active', other === button);
        other.setAttribute('aria-pressed', String(other === button));
      }
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
  $('rail-close').addEventListener('click', () => toggleRail(false));

  /*
   * Both scrollable panels, registered once.
   *
   * The Drawer's observer watches its children as well as itself, because the Drawer is
   * replaced wholesale on every selection -- a new `<div>` with new rows -- and an
   * observer bound to the old nodes would keep reporting a height that no longer exists.
   */
  registerScrollRegion($('rail-scroll'), $('rail'));
  registerScrollRegion($('drawer-inner'), $('drawer'));
  // The landing is a scroller too. It is the one region that is sometimes the whole
  // page, so its rule is on `#main` -- and registering it here means the rule appears and
  // withdraws on exactly the same evidence as the rail's and the Drawer's.
  registerScrollRegion($('landing'), $('main'));
  registerScrollRegion($('analysis'), $('main'));

  $('search-input').addEventListener('input', (event) => {
    state.query = event.target.value;
    syncUrl();
    draw();
    renderMobileSearch();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (!$('layers-pop').hasAttribute('hidden')) toggleLayers(false);
      else if (!$('searchbar').hasAttribute('hidden')) toggleSearch(false);
      else if (isPhone() && mobile.view !== 'graph') switchMobile(mobile.view === 'evidence' ? mobile.previous : 'graph');
      else if (panels.rail && panels.mode !== 'wide') toggleRail(false);
      else if (state.selectedEdgeId || state.selectedNodeId) closeDrawer();
    }
    /*
     * Single-key shortcuts yield to whatever the reader is typing into.
     *
     * `/` was guarded only against the search field itself, so typing a repository
     * path into the landing's own input opened the graph search on the `/` and sent the
     * rest of the name there: `octocat/Spoon-Knife` became `octocat` in the field and
     * `Spoon-Knife` in a search bar that has no graph to search yet. The landing's
     * primary control could not be filled by keyboard at all, and nothing caught it
     * because no check typed into it.
     *
     * `f` is guarded for the same reason and was worse: it called `fit()` mid-typing,
     * which is silent, so a repository name containing an `f` lost a character and
     * nothing said so.
     */
    const target = event.target;
    const typing = target instanceof HTMLElement
      && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (event.key === '/' && !typing && document.activeElement !== $('search-input')) {
      event.preventDefault();
      toggleSearch(true);
    }
    if (event.key === 'f' && !typing && !event.metaKey && !event.ctrlKey) fit();
  });

  // One delegated handler for both popovers, so the rows keep working after a
  // re-render and the dismissal test uses the composed path rather than
  // `closest`, which cannot see through a detached node.
  $('layers-list').addEventListener('click', (event) => {
    const row = event.target.closest('.layer-row');
    if (!row || !row.dataset.family) return;
    const family = row.dataset.family;
    state.layers[family] = state.layers[family] === false;
    state.perspective='custom';
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
    if (repository && state.view && state.phase !== 'starting' && $('analysis').hidden && repository.owner.toLowerCase() === state.viewRepository?.owner.toLowerCase() && repository.name.toLowerCase() === state.viewRepository?.name.toLowerCase()) {
      state.repository = repository;
      const old = state.selectedEdgeId + state.selectedNodeId;
      const oldDepth = state.depth;
      state.depth = 200;
      readUrlState();
      mobile.view = new URLSearchParams(location.search).get('mobile') || 'graph';
      mobile.previous = history.state?.previous || 'graph';
      if (state.depth !== oldDepth) { state.refitPending = true; void load(); return; }
      setHidden($('landing'), true);
      setHidden($('explorer'), false);
      setHidden($('rail-toggle'), false);
      renderChrome(state.view);
      draw();
      if (old !== state.selectedEdgeId + state.selectedNodeId) renderDrawer();
      applyPanels();
      const snapshot = history.state?.mobileSnapshot;
      if (snapshot) {
        setCamera($('canvas'), snapshot.camera, snapshot.zoom);
        $('mobile-relation-list').scrollTop = snapshot.relationsScroll;
        $('drawer-inner').scrollTop = snapshot.evidenceScroll;
      }
    } else if (repository) {
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
mountSitePresentation();

void mountDeepPreview(() => state.repository).then(deep => { if(deep?.capabilities.scope==='anonymous') workspace=mountRepositoryExplorer(() => state.repository, deep, {
 root:()=>state.view?.nodes.find(n=>n.id===state.view.subject.id),nodes:()=>state.view?.nodes||[],revision:()=>state.view?.revision.commit,selected:()=>state.selectedNodeId||state.selectedEdgeId,camera:()=>({box:$('canvas').getAttribute('viewBox'),zoom:state.zoom}),
 positions:()=>[...state.positions],restorePositions:(saved,compact)=>{if(compact===isPhone()&&Array.isArray(saved))state.positions=new Map(saved.filter(item=>Array.isArray(item)&&item.length===2&&typeof item[0]==='string'&&Number.isFinite(item[1]?.x)&&Number.isFinite(item[1]?.y)));},
 select:(id,edge=false,restoring=false)=>{if(restoring&&state.view?.edges.some(e=>e.id===id))edge=true;if(!restoring&&isPhone()&&id&&(edge?state.selectedEdgeId:state.selectedNodeId)===id&&mobile.view==='graph'){switchMobile('evidence');return;}state.selectedNodeId=edge?'':id||'';state.selectedEdgeId=edge?id:'';draw();renderDrawer();syncUrl();},
 draw,drawer:()=>{const previousPanels={...panels};$('drawer-inner').dataset.selectionKey='';renderDrawer();panels=previousPanels;applyPanels();},restore:c=>c&&setCamera($('canvas'),c.box,c.zoom),
 focus:(id,parentId)=>{if(isPhone())switchMobile('graph');const nodes=[...$('canvas').querySelectorAll('.node')],n=nodes.find(n=>n.dataset.nodeId===id),parent=nodes.find(n=>n.dataset.nodeId===parentId);if(n){const boxes=[n.querySelector('.node-box')];if(parent){const b=parent.querySelector('.node-box'),a=boxes[0].getBBox(),p=b.getBBox(),span=Math.max(a.x+a.width,p.x+p.width)-Math.min(a.x,p.x)+48;if(!isPhone()||span/Math.max(240,$('canvas').clientWidth-48)<=52/44)boxes.push(b);}fitGraphBoxes(boxes);}},
 dependencyEnabled:()=>state.layers.dependency,dependencies:enabled=>{state.layers.dependency=enabled;state.perspective='custom';syncUrl();},origins:()=>fit(),
 grow:id=>exploreNode(id),navigation:()=>isPhone()?switchMobile('relations'):toggleRail(true),
 }); if(workspace){draw();renderDrawer();} });
