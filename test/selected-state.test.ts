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
  assert.match(body, /const rows = plateRows\(plate\)/);
  assert.match(body, /const hiddenRows = plateHiddenRows\(plate\)/);
  assert.match(body, /plateRowsFor\(plate, top, hiddenRows\)/, 'the renderer uses it');
  /*
 * The placement reserves the same bounded height, so a plate never claims space it is not
 * allowed to draw into.
 *
 * This used to assert one reservation call -- `plateRowsFor(plate, ZONES.dataTop, ...)`.
 * That was correct when a fan was one plate and the reservation was therefore one line.
 * Frozen V3.3 lets a fan become several masses, so the reservation is now a PAIR: the
 * collapsed height and the worst-case expanded height, both measured by the same
 * `plateRowsFor`, and the stack is laid out from the pair. The property is unchanged and
 * stronger -- a mass is bounded by the height it reserved, and it is bounded in both
 * states rather than in one -- so the assertion follows the property, not the line.
 */
assert.match(
    body,
    /const collapsed = plateRowsFor\(plate, ZONES\.dataTop, hiddenRows\)/,
    'the placement reserves the collapsed height with the same function',
  );
assert.match(
    body,
    /const expanded = plateRowsFor\(\s*\{ \.\.\.plate, open: true, expanded: true \},\s*ZONES\.dataTop,\s*0,\s*\)/,
    'and reserves the worst-case expanded height with it',
  );
assert.match(body, /layoutMassStacks\(reserved,/, 'the stack is laid out from those reservations');
// And the draw is clipped to the slot it was given, so a mass that outgrows its slot is
// cut back and says so rather than drawing over the mass beneath it.
assert.match(body, /const fitsSlot = plan\.height <= position\.height \+ 1/);
assert.match(body, /overflow: /, 'and the clipped rows are counted as held back');
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

test('the Drawer is a shell overlay that cannot resize the SVG viewport', () => {
  assert.match(CSS, /\.drawer\s*\{[^}]*position:\s*absolute/);
  assert.match(CSS, /\.explorer-body\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.doesNotMatch(CSS, /\.explorer-body\.with-drawer\s*\{[^}]*grid-template-columns/);
  assert.match(CSS, /\.drawer\s*\{[^}]*bottom:\s*var\(--hud-h\)/);
});

test('the rail is a shell overlay with responsive disclosure', () => {
  const body = code(APP);
  assert.match(CSS, /\.explorer-body\s*\{[^}]*grid-template-columns/, 'the shell is a grid');
  assert.match(CSS, /\.rail\s*\{[^}]*position:\s*absolute/, 'the rail overlays the stage');
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

test('the HUD stays in screen space and only the SVG owns camera transforms', () => {
  assert.match(CSS, /\.viewport-hud\s*\{[^}]*position:\s*absolute/);
  assert.match(CSS, /\.viewport-hud\s*\{[^}]*inset:\s*auto 0 0/);
  assert.match(CSS, /\.viewport-hud\s*\{[^}]*pointer-events:\s*none/);
  assert.doesNotMatch(CSS, /--frame-scale|--frame-x|--frame-y/);
  const app = code(APP);
  assert.doesNotMatch(app, /applyFrameTransform/);
  assert.match(app, /function setCamera\(/);
  assert.match(app, /viewBoxFor\(/);
  assert.equal(/canvas\.setAttribute\('viewBox',/.test(app.replace(/function setCamera\([\s\S]*?\n}/, '')), false,
    'all camera writes use the same clamped path');
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