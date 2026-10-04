/**
 * Selected-state and Drawer tests.
 *
 * These pin the properties the frozen design requires and that a screenshot cannot
 * measure: a selected row stays flat while its parent plate rises, the Drawer's block
 * order puts evidence above provenance, and no interaction moves the camera or the
 * topology.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { depthTier, DepthTier, depthOffset } from '../src/web/client/lib/primitives.mjs';

const APP = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.js'), 'utf8');
const CSS = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.css'), 'utf8');
const code = (of: string) => of.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

// ------------------------------------------------------------- depth on select

test('selection raises the parent plate, never the row', () => {
  // The row is content of the plate. It has no depth tier at all, so it cannot gain
  // one however it is selected.
  assert.equal(depthTier({ isRow: true, isSelected: true }), DepthTier.Flat);
  assert.equal(depthOffset(depthTier({ isRow: true, isSelected: true })), 0);
  // The plate above it rises one step.
  assert.equal(depthTier({ isSelected: true }), DepthTier.Selected);
  assert.equal(depthOffset(DepthTier.Selected), 5);
});

test('a row is marked, not raised: its selection marker is a rule not a shadow', () => {
  assert.match(code(APP), /plate-row-marker/);
  // The marker is a fill and a stroke; the hit target is transparent so selecting a
  // row cannot change how the row looks.
  assert.match(CSS, /\.plate-row-marker\s*\{[^}]*stroke:\s*var\(--ink\)/);
  assert.match(CSS, /\.plate-row-hit\s*\{[^}]*fill:\s*transparent/);
});

// --------------------------------------------------------------- ownership

test('plate ownership is explicit membership, not a string prefix', () => {
  const body = code(APP);
  // `startsWith` on a selection id was an accident of naming that happened to work.
  assert.equal(
    /selectedEdgeId\.startsWith\(/.test(body),
    false,
    'ownership must not be a string-prefix test',
  );
  assert.match(body, /plate\.memberEdgeIds\.includes\(state\.selectedEdgeId\)/);
  assert.match(body, /rowMembers\.includes\(state\.selectedEdgeId\)/);
});

test('rows are selectable, which is what makes a selected row possible', () => {
  const body = code(APP);
  assert.match(body, /plate-row-hit/, 'a row needs a hit target');
  // Selecting a row must not also toggle the plate it belongs to.
  assert.match(body, /classList\.contains\('plate-row-hit'\)/);
});

test('a selected plate draws the selected tier, and a shut plate has no rows', () => {
  const body = code(APP);
  /*
   * Rows come from `plateRows`, which returns nothing for a plate that is shut, and a
   * plate with no members is not drawn at all.
   *
   * The height must follow the rows actually shown, the held-back line included. An
   * earlier version measured only the listed rows, so a plate holding six back was
   * drawn too short and its "N more rows" line sat outside its own border.
   */
  assert.match(body, /const rows = plateRows\(plate\)/);
  assert.match(body, /const hiddenRows = plateHiddenRows\(plate\)/);
  assert.match(body, /plateHeight\(shownRows\.length, hiddenRows, !!plate\.meta\)/);
  // A plate with no members is not drawn at all.
  assert.match(body, /if \(plate\.count < 1\) continue;/);
  // And the plate says what it is holding back rather than implying a shorter list.
  assert.match(body, /plate-row-more/);
  assert.match(body, /more row\$\{/);
  assert.match(body, /in this plate/);
});

test('a plate states where its claims were written, and only when it knows', () => {
  const body = code(APP);
  // The subtitle is the only place the reader is told the grouping is about evidence
  // rather than about the relationship, so it is rendered from the plate's own meta.
  assert.match(body, /if \(plate\.meta\) \{/);
  assert.match(body, /declared in: \$\{plate\.meta\}/);
  // "Declared in" is a place, never a category: it must not name what the claim means.
  assert.doesNotMatch(body, /declared in: \$\{[^}]*relationshipType/);
});

// ------------------------------------------------------------ drawer order

test('the drawer shows evidence before provenance', () => {
  const body = code(APP);
  const evidenceAt = body.indexOf('wrap.append(evidenceBlock)');
  const provenanceAt = body.indexOf('wrap.append(provenance)');
  assert.ok(evidenceAt > -1 && provenanceAt > -1, 'both blocks must be appended');
  assert.ok(evidenceAt < provenanceAt, 'evidence must be appended before provenance');
});

test('the analyzer name is not in the drawer provenance block', () => {
  // `gitlineage-analyzer 0.2.0` in the reader-facing provenance list was an
  // implementation detail of the pipeline competing with the record. It stays in the
  // graph, the view model and the context column's provenance block; it is not
  // repeated beside the evidence the reader came for.
  const drawer = APP.slice(APP.indexOf('function renderEdgeDrawer'), APP.indexOf('function renderEvidenceCard'));
  assert.equal(/row\('Analyzer'/.test(drawer), false, 'no analyzer row in the drawer provenance');
  assert.match(drawer, /row\('Revision'/, 'provenance still names what was analysed');
  assert.match(drawer, /row\('Evidence'/, 'provenance still counts the records');
});

test('the drawer block order is identity, evidence, provenance, rationale, actions', () => {
  const body = code(APP);
  const at = (needle: string) => body.indexOf(needle);
  const order = [
    at('text: \'RELATIONSHIP\''),
    at('wrap.append(evidenceBlock)'),
    at('wrap.append(provenance)'),
    at('WHY THIS IS '),
    at('class: \'d-actions\''),
  ];
  for (const [i, position] of order.entries()) {
    assert.ok(position > -1, `block ${i} must exist`);
    if (i > 0) {
      const previous = order[i - 1] ?? -1;
      assert.ok(previous < position, `block ${i} must follow block ${i - 1}`);
    }
  }
});

test('evidence carries more visual weight than provenance', () => {
  assert.match(CSS, /\.d-block-head\.is-evidence\s*\{[^}]*color:\s*var\(--ink-2\)/);
  assert.match(CSS, /\.d-block-head\.is-provenance\s*\{[^}]*color:\s*var\(--ink-4\)/);
  // The record itself is the largest body text in the drawer.
  const quote = /\.d-quote\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  const kv = /\.d-kv\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
  const size = (rule: string) => Number(/font-size:\s*([\d.]+)px/.exec(rule)?.[1] ?? 0);
  assert.ok(size(quote) > size(kv), 'the evidence quote must be larger than the metadata');
});

// ------------------------------------------------------------ no blur, flat

test('nothing in the drawer or the selected state uses blur', () => {
  assert.equal(/filter:\s*blur/.test(CSS), false, 'no blur in the client stylesheet');
  assert.equal(/backdrop-filter/.test(CSS), false, 'no backdrop blur');
  for (const surface of ['.drawer', '.d-card', '.d-why', '.d-actions', '.d-quote']) {
    const rule = new RegExp(`${surface.replace('.', '\\.')}\\s*\\{([^}]*)\\}`).exec(CSS)?.[1] ?? '';
    assert.equal(/box-shadow/.test(rule), false, `${surface} must stay flat`);
  }
});

// ------------------------------------------------------------ camera safety

test('no selection or Drawer path requests a camera change', () => {
  const body = code(APP);
  for (const name of ['selectEdge', 'selectNode', 'closeDrawer', 'renderDrawer', 'toggleBundle']) {
    const start = body.indexOf(`function ${name}(`);
    if (start === -1) continue;
    const next = body.indexOf('\nfunction ', start + 1);
    const scope = body.slice(start, next === -1 ? undefined : next);
    assert.equal(/refitPending\s*=\s*true/.test(scope), false, `${name} must not refit`);
    assert.equal(/hasFitted\s*=\s*false/.test(scope), false, `${name} must not reset hasFitted`);
    assert.equal(/fitViewBox/.test(scope), false, `${name} must not fit`);
  }
});

test('the rail has a single owner: the drawer replaces the gutter, never stacks', () => {
  const body = code(APP);
  /*
   * The Drawer overlays the gutter the frame already reserved.
   *
   * It used to be a grid column, and the cost was invisible until the reader used it:
   * opening it deleted the context column and the bottom band and narrowed the stage
   * by its own width, so the SVG rescaled and the subject changed size and position
   * at the exact moment someone chose to read a relationship. A layout that moves the
   * scene is a camera change however the viewBox is spelled, so the column is gone and
   * the Drawer is positioned instead.
   */
  assert.doesNotMatch(CSS, /\.explorer-body\.with-drawer\s*\{[^}]*grid-template-columns/);
  assert.match(CSS, /\.drawer\s*\{[^}]*position:\s*absolute/);
  // Its width comes from the reserved gutter at the current frame scale, which is
  // what makes "the Drawer never moves anything" true at every viewport.
  assert.match(CSS, /\.drawer\s*\{[^}]*width:\s*var\(--gutter-w/);
  assert.match(body, /--gutter-w/);
  /*
   * And the things that live in the Drawer's space switch out while it is open. The
   * gutter rail is the one that matters: two things claiming one column is how a
   * reader ends up unsure which one they are reading.
   */
  assert.match(CSS, /\.explorer-body\.with-drawer \.gutter/);
  assert.match(CSS, /\.explorer-body\.with-drawer \.legend/);
  /*
   * The context column and the bottom band deliberately stay. They are the frame's own
   * zones rather than the right rail, and the frozen design keeps both while a
   * relationship is being read -- so hiding them would be the regression.
   */
  assert.doesNotMatch(CSS, /\.explorer-body\.with-drawer[^{]*\.lcol/);
  assert.doesNotMatch(CSS, /\.explorer-body\.with-drawer[^{]*\.band/);
});

test('the frame layer carries the overlays through the canvas own transform', () => {
  // The context column, the band and the gutter are authored in world units, so they
  // are put through the same scale and offset the SVG's viewBox applies. Positioned in
  // raw pixels they were correct only at a viewport whose scale happened to be about
  // one: at 1280 the canvas scaled to 0.69, the band stayed at world y 876, and it
  // landed below the fold with a scrollbar on a canvas that must not scroll.
  assert.match(CSS, /\.frame\s*\{[^}]*transform:\s*translate\(var\(--frame-x[^{]*scale\(var\(--frame-scale/);
  assert.match(CSS, /\.frame\s*\{[^}]*width:\s*1864px/);
  // It spans the whole frame, so it must never intercept a click meant for the canvas.
  assert.match(CSS, /\.frame\s*\{[^}]*pointer-events:\s*none/);
  const app = code(APP);
  assert.match(app, /function applyFrameTransform\(/);
  assert.match(app, /--frame-scale/);
  assert.match(app, /--frame-x/);
  assert.match(app, /--frame-y/);
});

test('long content is contained rather than overflowing the drawer', () => {
  // Repository names, paths and URLs are the realistic overflow cases.
  assert.match(CSS, /\.d-pair\s*\{[^}]*word-break/);
  assert.match(CSS, /\.d-card-loc\s*\{[^}]*word-break/);
  assert.match(CSS, /\.d-quote\s*\{[^}]*word-break/);
  // A URL cannot wrap on spaces, so it needs an explicit break rule.
  assert.match(CSS, /\.d-src\s*\{[^}]*word-break|overflow-wrap/);
  assert.match(CSS, /\.d-why\s*\{[^}]*word-break|overflow-wrap/);
  // The drawer itself scrolls rather than growing past the viewport.
  assert.match(CSS, /\.drawer\s*\{[^}]*overflow-y:\s*auto/);
});