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
   *
   * And the shown rows are no longer simply "all of them": a plate is bounded above
   * the band, because `Kuddev/pebrel`'s single plate of 97 manifest records is over
   * 2500 world units tall and drew straight through the edge-treatment key. Both the
   * reserved height and the drawn height come from `plateRowsFor`, so they cannot
   * disagree -- which is the property this test has always been about.
   */
  assert.match(body, /function plateRowsFor\(/, 'one function bounds a plate');
  assert.match(body, /const allRows = plateRows\(plate\)/);
  assert.match(body, /const hiddenRows = plateHiddenRows\(plate\)/);
  assert.match(body, /plateRowsFor\(plate, top, hiddenRows\)/, 'the renderer uses it');
  // The placement reserves the same bounded height, so a plate never claims space it
  // is not allowed to draw into.
  assert.match(body, /plateRowsFor\(plate, ZONES\.dataTop, plateHiddenRows\(plate\)\)/);
  assert.match(body, /plateHeight\(rows\.length, hiddenRows, !!plate\.meta\)/);
  // And the bound is the band, named.
  assert.match(body, /const PLATE_BOTTOM_LIMIT = ZONES\.bandTop - 48/);
  // A plate with no members is not drawn at all.
  assert.match(body, /if \(plate\.count < 1\) continue;/);
  // And the plate says what it is holding back rather than implying a shorter list --
  // in two different words, because the two remainders are not the same fact.
  assert.match(body, /plate-row-more/);
  assert.match(body, /plate-row-held/);
  assert.match(body, /more in the Drawer/);
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

test('the Drawer is a shell column, so opening it cannot move the world', () => {
  const body = code(APP);
  /*
   * The Drawer used to be a grid column, and the cost was invisible until the reader
   * used it: opening it deleted the context column and the bottom band and narrowed the
   * stage by its own width, so the SVG rescaled and the subject changed size and
   * position at the exact moment someone chose to read a relationship. A layout that
   * moves the scene is a camera change however the viewBox is spelled.
   *
   * So it is still a grid column -- a *shell* one. The shell is allowed to change
   * shape; the world is not, because the world never scales. The Drawer therefore has
   * its own column at every width, and the graph simply begins after it.
   */
  assert.match(CSS, /\.drawer\s*\{[^}]*grid-column:\s*3/,
    'the Drawer owns the third column, which is a shell property');
  // The third track is zero until the Drawer is opened, and `--drawer-w` after. That
  // is a shell track, not a canvas scale: the stage is `minmax(0, 1fr)`, so it takes
  // whatever is left rather than asking the world to compress.
  assert.match(CSS, /\.explorer-body\s*\{[^}]*grid-template-columns:\s*var\(--rail-w\) minmax\(0, 1fr\) 0/);
  assert.match(CSS, /\.explorer-body\.with-drawer\s*\{[^}]*grid-template-columns:[^}]*var\(--drawer-w\)/);
  assert.equal(/minmax\(0, 1fr\)/.test(CSS), true, 'the stage is the flexible track');
  // At the frozen breakpoint it becomes an overlay on the world\'s reserved gutter,
  // because by then there is no room for a third column. That is still shell-only.
  assert.match(CSS, /@media \(max-width:\s*1340px\)/,
    'the overlay breakpoint is the frozen one');
  assert.match(CSS, /@media \(max-width:\s*1340px\)[\s\S]{0,900}?\.drawer\s*\{[^}]*position:\s*absolute/,
    'the Drawer becomes an overlay only at that breakpoint');
});

test('the rail is a shell column that collapses to a disclosure, never a reflow of the world', () => {
  const body = code(APP);
  assert.match(CSS, /\.explorer-body\s*\{[^}]*grid-template-columns/, 'the shell is a grid');
  assert.match(CSS, /\.rail\s*\{/, 'the rail is one of its columns');
  // Below 1500 the rail collapses to zero width and comes back as a disclosure. The
  // world does not move: it is 1920 x 1720 at every viewport, and only the window over
  // it changes.
  assert.match(CSS, /@media \(max-width:\s*1500px\)/, 'the rail breakpoint is the frozen one');
  assert.match(CSS, /@media \(max-width:\s*1500px\)[\s\S]{0,600}?\.rail\s*\{\s*display:\s*none/,
    'and the rail is hidden there rather than reflowed');
  assert.match(body, /function toggleRail\(/, 'the disclosure is wired');
  assert.match(body, /rail-toggle/, 'to the shell\'s own button');
  // And the band lives on the world, so it cannot collide with a rail at any width.
  assert.match(CSS, /\.band\s*\{/);
  assert.doesNotMatch(body, /\$\('gutter'\)/, 'the old world gutter is gone from the renderer');
});

test('the world layer carries its overlays through the camera\'s own transform', () => {
  // The band is authored in world units, so it is put through the same mapping the
  // SVG's viewBox performs. Positioned in raw pixels it was correct only at a viewport
  // whose scale happened to be about one: at 1280 the canvas scaled to 0.69, the band
  // stayed at world y 876, and it landed below the fold with a scrollbar on a canvas
  // that must not scroll.
  assert.match(CSS, /\.frame\s*\{[^}]*transform:\s*translate\(var\(--frame-x[^{]*scale\(var\(--frame-scale/);
  // Sized from the world, not from the old fitted frame. The renderer writes the real
  // numbers in; the fallbacks are the world itself, so a stylesheet read on its own
  // still says 1920 x 1720.
  assert.match(CSS, /\.frame\s*\{[^}]*width:\s*var\(--world-w,\s*1920px\)/);
  assert.match(CSS, /\.frame\s*\{[^}]*height:\s*var\(--world-h,\s*1720px\)/);
  assert.match(CSS, /\.frame\s*\{[^}]*transform-origin:\s*0 0/,
    'the transform scales from the world origin, not from its centre');
  // It spans the whole world, so it must never intercept a click meant for the canvas.
  assert.match(CSS, /\.frame\s*\{[^}]*pointer-events:\s*none/);
  const app = code(APP);
  assert.match(app, /function applyFrameTransform\(/);
  assert.match(app, /--frame-scale/);
  assert.match(app, /--frame-x/);
  assert.match(app, /--frame-y/);
  // The transform takes the live viewBox, so a pan moves the band with the canvas. It
  // used to read only the viewport, which left the band behind at the world's origin
  // the first time a reader dragged.
  assert.match(app, /function applyFrameTransform\(viewport, viewBox\)/);
  assert.match(app, /frameTransform\(viewport, viewBox\)/);
  // And every camera write goes through the one clamped path.
  assert.match(app, /function setCamera\(/);
  assert.match(app, /viewBoxFor\(/, 'which clamps the window inside the world');
  assert.equal(
    /canvas\.setAttribute\('viewBox',/.test(app.replace(/function setCamera\([\s\S]*?\n}/, '')),
    false,
    'no other code writes the viewBox directly',
  );
});

test('long content is contained rather than overflowing the drawer', () => {
  // Repository names, paths and URLs are the realistic overflow cases.
  assert.match(CSS, /\.d-pair\s*\{[^}]*word-break/);
  assert.match(CSS, /\.d-card-loc\s*\{[^}]*word-break/);
  assert.match(CSS, /\.d-quote\s*\{[^}]*word-break/);
  // A URL cannot wrap on spaces, so it needs an explicit break rule.
  assert.match(CSS, /\.d-src\s*\{[^}]*word-break|overflow-wrap/);
  assert.match(CSS, /\.d-why\s*\{[^}]*word-break|overflow-wrap/);
  // The Drawer is a fixed column, so its scrolling happens inside it and the shell
  // never grows past the viewport.
  assert.match(CSS, /\.drawer\s*\{[^}]*overflow:\s*hidden/);
  assert.match(CSS, /\.drawer-inner\s*\{[^}]*overflow-y:\s*auto/);
});