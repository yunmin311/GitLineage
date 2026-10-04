/**
 * The analysis dial.
 *
 * The dial is the one place in the client that reports work in progress, so it is
 * held to three rules: it names only phases the analyser really reaches, it moves
 * to a notch and stops, and it says nothing it cannot show. These tests pin the
 * phase vocabulary, the arm's geometry -- which is what decides whether the arm
 * rests *on* a notch or swings past it -- and the absence of the decorative
 * treatments the frozen design rejects.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  PHASES,
  SETTLED_PHASE,
  DIAL_SWEEP_DEG,
  ARM_EASE_MS,
  phaseAngle,
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

test('the dial names the phases the analyser reaches, plus the settled one', () => {
  assert.deepEqual([...PHASES], [...VISIBLE_PHASES, 'complete'], 'the dial reads the canonical order');
  assert.equal(PHASES[PHASES.length - 1], SETTLED_PHASE, 'the arm must have somewhere to rest');
  // A failed analysis is an outcome, not a point on a progress dial.
  assert.equal(PHASES.includes('failed'), false, 'failure is reported in words, not as a notch');
  assert.equal(VISIBLE_PHASES.includes('complete'), false, 'the server does not report completion as a step');
});

test('every notch has a plain-language label and no phase is unlabelled', () => {
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

// ------------------------------------------------------------------ arm motion

test('the arm sweeps a fixed arc with one notch per phase', () => {
  assert.equal(DIAL_SWEEP_DEG, 150, 'the sweep is a half turn, not a gauge');
  assert.equal(phaseAngle(0), -DIAL_SWEEP_DEG / 2, 'the first phase starts the sweep');
  assert.equal(phaseAngle(PHASES.length - 1), DIAL_SWEEP_DEG / 2, 'the settled phase ends it');

  const angles = PHASES.map((_, at) => phaseAngle(at));
  assert.equal(new Set(angles).size, angles.length, 'every phase has its own notch');
  for (let i = 1; i < angles.length; i += 1) {
    assert.ok(angles[i]! > angles[i - 1]!, 'the arm only ever moves forward through the analysis');
  }
  // Indices outside the dial clamp to the ends rather than throwing mid-render.
  assert.equal(phaseAngle(-3), -DIAL_SWEEP_DEG / 2);
  assert.equal(phaseAngle(99), DIAL_SWEEP_DEG / 2);
});

test('a re-render at the same phase produces no transition', () => {
  // The client polls repeatedly; restarting the easing on every poll would make
  // the arm twitch, which reads as instability rather than as progress.
  assert.equal(phaseTransition('collecting', 'collecting'), null);
  assert.equal(phaseTransition('complete', 'complete'), null);
  assert.equal(phaseTransition(undefined, undefined), null);

  const move = phaseTransition('queued', 'resolving');
  assert.ok(move, 'a real phase change must transition');
  assert.equal(move.ms, ARM_EASE_MS);
  assert.equal(move.from, phaseIndex('queued'));
  assert.equal(move.to, phaseIndex('resolving'));
});

// -------------------------------------------------------------------- geometry

test('the arm pivots on the hub, so it lands on a notch instead of swinging past it', () => {
  const arm = cssRule('.dial-arm');
  // `transform-origin: 50% 100%` is the arm's own lower edge. Anchoring the arm
  // with `top: 50%` puts that edge 29.5px above the dial's centre, so the origin
  // falls on the arm's middle and the arm swings through the centre like a clock
  // hand -- seen in Chromium resting at the lower right of the ring, its tip past
  // the notch it was meant to stop on. Anchoring it with `bottom: 50%` is what
  // makes the origin the hub, and the tip then lands on the notch every time.
  assert.match(arm, /bottom:\s*50%/, 'the arm hangs from the hub');
  assert.equal(/\btop:\s*50%/.test(arm), false, 'the arm must not be anchored by its top');
  assert.match(arm, /transform-origin:\s*50% 100%/, 'the pivot is the arm\'s lower edge');
  // The arm reaches exactly as far as the notch ring, so its tip meets a dot.
  assert.match(arm, /height:\s*var\(--notch-r\)/, 'the arm stops where the notches sit');
  assert.match(cssRule('.dial'), /--notch-r:\s*calc\(var\(--dial-size\)/, 'the ring radius is one value');

  const notches = cssRule('.dial-notch');
  assert.match(notches, /rotate\(var\(--notch-a\)\)\s*translateY\(/,
    'a notch orbits the centre at the arm\'s own angle');
  assert.match(notches, /translateY\(calc\(-1 \* var\(--notch-r\)\)\)/, 'and at the arm\'s own reach');
  // The dot is centred on the dial's centre before it is pushed out, so the
  // rotation turns about the pivot rather than about the dot itself.
  assert.match(notches, /margin:\s*-3px 0 0 -3px/);
});

test('the renderer builds one notch per phase from the arm\'s own angles', () => {
  const body = functionBody('renderNotches');
  assert.match(body, /host\.childElementCount !== PHASES\.length/, 'one dot per phase, rebuilt only if needed');
  assert.match(body, /phaseAngle\(at\)/, 'a notch and the arm that stops on it share one angle');
  assert.match(body, /is-done|classList\.toggle/, 'passed notches are marked');

  // renderPhases drives it, so the notches cannot quietly go stale.
  assert.match(functionBody('renderPhases'), /renderNotches\(dial, index\)/);
  assert.match(SHELL, /class="dial-notches"/, 'the shell carries the notch host');
  assert.match(SHELL, /class="dial-face"/, 'the ring the notches sit on');
  assert.match(SHELL, /class="dial-arm"/, 'the arm');
  assert.match(SHELL, /class="dial-hub"/, 'the pivot the arm turns about');
});

// ----------------------------------------------------------- decorative guards

test('the dial uses no gradient, blur, glow or looping animation', () => {
  const declared = code(APP_CSS);
  assert.equal(/(^|[;{\s])(repeating-)?(linear|radial|conic)-gradient\(/.test(declared), false,
    'no gradient may be declared in the client stylesheet');
  assert.equal(/filter:\s*blur/.test(declared), false, 'no blur');
  assert.equal(/@keyframes/.test(declared), false, 'nothing in the client loops');
  assert.equal(/animation:\s*[^;]+;/.test(declared), false, 'no looping or fake-progress animation');

  // The only easing on the dial is the arm's, and it stops when the phase does.
  assert.match(cssRule(".dial[data-moving='true'] .dial-arm"), /transition:\s*transform 420ms/);
  assert.match(code(APP_CSS), /@media \(prefers-reduced-motion: reduce\)/,
    'reduced motion is honoured, so the arm arrives at once');
  // Under reduced motion the arm still moves to the notch; only the travel is cut.
  assert.match(code(APP_CSS.replace(/\s+/g, ' ')),
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.dial\[data-moving='true'\] \.dial-arm \{ transition: none;/,
    'the phase must stay readable without motion');
});

test('the dial says phases, never percentages', () => {
  const body = functionBody('renderPhases');
  assert.equal(/%/.test(body.replace(/\s+/g, ' ')), false,
    'the renderer must not compute or print a percentage');
  // There is no progress bar left to hang one on.
  assert.equal(/loading-fill|loading-bar/.test(APP_CSS), false, 'the old spinner bar is gone');
  assert.equal(/class="loading/.test(SHELL), false, 'and it is gone from the shell');
});
