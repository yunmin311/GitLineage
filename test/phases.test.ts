/**
 * The analysis tracer.
 *
 * The tracer is the one place in the client that reports work in progress, so it is
 * held to four rules: it names only phases the analyser really reaches, it rests *on*
 * the segment for the current phase, its shape cannot be read as a clock, and it says
 * nothing it cannot show. These tests pin the phase vocabulary, the arc geometry --
 * which is what decides whether the tracer lands on a segment or between two of them --
 * and the absence of the decorative treatments the frozen design rejects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PHASES,
  SETTLED_PHASE,
  TRACER_SWEEP_DEG,
  TRACER_STEP_DEG,
  TRACER_ARC,
  TRACER_EASE_MS,
  phaseStartAngle,
  phaseEndAngle,
  arcSegment,
  tracerPoint,
  phaseIndex,
  phaseLabel,
  phaseTransition,
  isSettled,
} from '../src/web/client/lib/phases.mjs';
import { VISIBLE_PHASES, PHASE_TEXT } from '../src/web/client/lib/analysis.mjs';

const APP_CSS = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.css'), 'utf8');
const APP_SOURCE = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.js'), 'utf8');
const SHELL = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/index.html'), 'utf8');

/** Comments may discuss any treatment; only declarations may not use one. */
function code(of: string): string {
  return of.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** The rule block for a selector, with comments removed. */
function cssRule(selector: string): string {
  const pattern = new RegExp(
    `(^|[,}])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*(,[^{]*)?\\{([^}]*)\\}`,
    'm',
  );
  const match = pattern.exec(code(APP_CSS));
  assert.ok(match, `${selector} must have a rule in app.css`);
  return match[3] ?? '';
}

/** The body of a function, read from the shipped source rather than a stand-in. */
function functionBody(name: string): string {
  const start = APP_SOURCE.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist in app.js`);
  const open = APP_SOURCE.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < APP_SOURCE.length; i += 1) {
    if (APP_SOURCE[i] === '{') depth += 1;
    else if (APP_SOURCE[i] === '}') {
      depth -= 1;
      if (depth === 0) return APP_SOURCE.slice(open, i + 1);
    }
  }
  throw new Error(`could not read the body of ${name}`);
}

// ------------------------------------------------------------ phase vocabulary

test('the tracer names the phases the analyser reaches, plus the settled one', () => {
  assert.deepEqual([...PHASES], [...VISIBLE_PHASES, 'complete'], 'the tracer reads the canonical order');
  assert.equal(PHASES[PHASES.length - 1], SETTLED_PHASE, 'the tracer must have somewhere to rest');
  // A failed analysis is an outcome, not a point on a progress tracer.
  assert.equal(PHASES.includes('failed'), false, 'failure is reported in words, not as a segment');
  assert.equal(VISIBLE_PHASES.includes('complete'), false, 'the server does not report completion as a step');
});

test('every segment has a plain-language label and no phase is unlabelled', () => {
  for (const phase of PHASES) {
    assert.equal(typeof phaseLabel(phase), 'string', `${phase} is labelled`);
    assert.ok(phaseLabel(phase).length > 0, `${phase} has a label`);
  }
  assert.equal(phaseLabel('nonsense'), 'nonsense', 'an unknown phase is shown as itself, not invented');
  assert.equal(Object.keys(PHASE_TEXT).length > 0, true);
});

test('an unrecognised phase reads as the start, never as finished', () => {
  assert.equal(phaseIndex('nonsense'), 0);
  assert.equal(phaseIndex(undefined), 0);
  assert.equal(phaseIndex(''), 0);
  assert.equal(phaseIndex('queued'), 0);
  assert.equal(phaseIndex('complete'), PHASES.length - 1);
  // Reporting an analysis as finished because a name was not recognised would be
  // a lie about work nobody has shown to be done.
  assert.equal(isSettled('nonsense'), false);
  assert.equal(isSettled(undefined), false);
  assert.equal(isSettled('publishing'), false);
  assert.equal(isSettled('complete'), true);
});

// --------------------------------------------------------------- tracer motion

test('the tracer sweeps a fixed open arc with one segment per phase', () => {
  assert.equal(TRACER_SWEEP_DEG, 110, 'the sweep is open by construction, not a closed dial');
  assert.equal(TRACER_SWEEP_DEG < 360, true, 'the arc must not close into a ring');
  assert.equal(TRACER_STEP_DEG, TRACER_SWEEP_DEG / PHASES.length, 'one segment per phase, derived');

  const starts = PHASES.map((_, at) => phaseStartAngle(at));
  assert.equal(new Set(starts).size, starts.length, 'every phase has its own segment');
  for (let i = 1; i < starts.length; i += 1) {
    assert.ok(starts[i]! > starts[i - 1]!, 'the tracer only ever moves forward through the analysis');
  }
  // The arc's bulge belongs at the bottom, so the middle of the sweep is 90 degrees in
  // SVG space (y grows downward).
  assert.ok(Math.abs(90 - (starts[0]! + starts[starts.length - 1]! + TRACER_STEP_DEG) / 2) < 1e-9,
    'the sweep is centred on the bottom of the arc');

  // Indices outside the arc clamp to the ends rather than throwing mid-render.
  assert.equal(phaseStartAngle(-3), phaseStartAngle(0));
  assert.equal(phaseStartAngle(99), phaseStartAngle(PHASES.length - 1));
});

test('segments are adjacent arcs, so no phase owns a gap', () => {
  for (let at = 0; at < PHASES.length - 1; at += 1) {
    // Within a rounding step: the two are the same angle computed from different
    // expressions, and demanding bit equality would pin the arithmetic rather than
    // the geometry.
    assert.ok(Math.abs(phaseEndAngle(at) - phaseStartAngle(at + 1)) < 1e-9,
      `segment ${at} ends where segment ${at + 1} begins`);
  }
  const first = arcSegment(0);
  const last = arcSegment(PHASES.length - 1);
  assert.match(first, /^M [\d.]+ [\d.]+ A /, 'each segment is a real elliptical arc, not a polyline');
  assert.match(last, /^M [\d.]+ [\d.]+ A /);
  // The two ends differ: a closed dial would render these as the same point.
  const ends = PHASES.map((_, at) => {
    const d = arcSegment(at);
    const [, x, y] = /A [\d.]+ [\d.]+ 0 0 1 ([\d.]+) ([\d.]+)$/.exec(d) ?? [];
    return `${x},${y}`;
  });
  assert.notEqual(ends[0], ends[ends.length - 1], 'the arc is open: its ends are not joined');
  assert.equal(new Set(ends).size, ends.length, 'each segment ends on its own point');
});

test('the tracer rests on the segment it reports, not on a seam', () => {
  for (let at = 0; at < PHASES.length; at += 1) {
    const point = tracerPoint(at);
    const mid = (phaseStartAngle(at) + phaseEndAngle(at)) / 2;
    const rad = (mid * Math.PI) / 180;
    const expectedX = TRACER_ARC.cx + TRACER_ARC.r * Math.cos(rad);
    const expectedY = TRACER_ARC.cy + TRACER_ARC.r * Math.sin(rad);
    assert.ok(Math.abs(point.x - expectedX) < 1e-6, `phase ${at} x is the arc's own radius`);
    assert.ok(Math.abs(point.y - expectedY) < 1e-6, `phase ${at} y is the arc's own radius`);
    // The midpoint angle strictly inside the segment, which is the whole difference
    // between resting on a mark and resting on the boundary between two.
    assert.ok(mid > phaseStartAngle(at) && mid < phaseEndAngle(at), `phase ${at} is inside its own segment`);
  }
  // Consecutive tracers are distinct positions, so progress is visible as travel.
  const points = PHASES.map((_, at) => JSON.stringify(tracerPoint(at)));
  assert.equal(new Set(points).size, points.length);
});

test('a re-render at the same phase produces no transition', () => {
  // The client polls repeatedly; restarting the animation on every poll would make the
  // tracer twitch, which reads as instability rather than as progress.
  assert.equal(phaseTransition('collecting', 'collecting'), null);
  assert.equal(phaseTransition('complete', 'complete'), null);
  assert.equal(phaseTransition(undefined, undefined), null);

  const move = phaseTransition('queued', 'resolving');
  assert.ok(move, 'a real phase change must transition');
  assert.equal(move.ms, TRACER_EASE_MS);
  assert.equal(move.from, phaseIndex('queued'));
  assert.equal(move.to, phaseIndex('resolving'));
});

// -------------------------------------------------------------------- geometry

test('the renderer places every segment and the tracer from the arc\'s own geometry', () => {
  const body = functionBody('renderTracer');
  assert.match(body, /host\.childElementCount !== PHASES\.length/, 'one segment per phase, rebuilt only if needed');
  assert.match(body, /arcSegment\(at\)/, 'a segment is drawn from the shared geometry');
  assert.match(body, /tracerPoint\(index\)/, 'the tracer rests on the shared geometry');
  assert.match(body, /classList\.toggle\('is-done'/, 'passed segments are marked');

  // renderPhases drives it, so the arc cannot quietly go stale.
  assert.match(functionBody('renderPhases'), /renderTracer\(tracer, index\)/);
  assert.match(SHELL, /class="tracer-arc"/, 'the shell carries the segment host');
  assert.match(SHELL, /class="tracer-dot"/, 'and the tracer itself');
});

test('the phases sit on one row beside the arc, not stacked over the canvas', () => {
  const strip = cssRule('.strip');
  assert.match(strip, /display:\s*flex/, 'the instrument is a row');
  assert.match(strip, /min-height:\s*var\(--strip-h\)/, 'and its height is one token');
  const phases = cssRule('.phases');
  assert.match(phases, /display:\s*flex/, 'the phases are a row');
  assert.match(phases, /flex:\s*1/, 'which shares the strip rather than floating above it');
  // A list would put the seven phases in a column, which is what pushed them over the
  // canvas before.
  assert.equal(/display:\s*list-item/.test(code(APP_CSS)), false, 'the phases are not list items');
});

test('the shell carries no dial: no face, no arm, no hub', () => {
  // Comments are stripped first: the shell's own commentary explains why the clock was
  // retired, and a test that failed on its own explanation would be a bad test.
  const markup = SHELL.replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(/dial/i.test(markup), false, 'the clock is gone from the shell');
  assert.equal(/dial-/.test(code(APP_CSS)), false, 'and from the stylesheet');
  assert.equal(/installDialTestStepper/.test(APP_SOURCE), false, 'and so is the dial test hook');
  assert.match(APP_SOURCE, /tracer-test/, 'the tracer keeps a test hook under its own name');
});

test('the tracer uses no gradient, blur, glow or looping animation', () => {
  const declared = code(APP_CSS);
  assert.equal(/(^|[;{\s])(repeating-)?(linear|radial|conic)-gradient\(/.test(declared), false,
    'no gradient may be declared in the client stylesheet');
  assert.equal(/filter:\s*blur/.test(declared), false, 'no blur');
  // The only animation is the tracer's single arrival pulse, which is declared once and
  // applied by a class rather than by a keyframe on a moving part.
  const animations = declared.match(/@keyframes\s+([\w-]+)/g) ?? [];
  assert.deepEqual(animations, ['@keyframes tracer-arrive'], 'the only keyframe is the tracer arriving');
  assert.equal(/animation:\s*[^;]*infinite/.test(declared), false, 'nothing loops');
  assert.match(cssRule('.tracer-dot'), /fill:\s*var\(--accent\)/, 'the tracer is the one accent mark');
  assert.match(code(APP_CSS), /@media \(prefers-reduced-motion: reduce\)/,
    'reduced motion is honoured, so the tracer arrives at once');
  assert.match(code(APP_CSS.replace(/\s+/g, ' ')),
    /\.tracer-dot\.is-moving \{ animation: none;/,
    'the phase must stay readable without motion');
});

test('the tracer says phases, never percentages', () => {
  const body = functionBody('renderPhases');
  assert.equal(/%/.test(body.replace(/\s+/g, ' ')), false,
    'the renderer must not compute or print a percentage');
  // There is no progress bar left to hang one on.
  assert.equal(/loading-fill|loading-bar/.test(APP_CSS), false, 'the old spinner bar is gone');
  assert.equal(/class="loading/.test(SHELL), false, 'and it is gone from the shell');
});