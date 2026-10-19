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

// The Graph expansion request supersedes the old nested-row/container assertions.
// Real members now own selection and keyboard targets; graph-expansion-acceptance
// measures disjoint nodes, bounded batches and camera/Drawer continuity in Chromium.
test('real member selection retains the authored node depth', () => {
  assert.equal(depthTier({isSelected:true}), DepthTier.Selected);
  assert.match(code(APP), /state\.selectedNodeId === node\.id/);
});
test('group ownership uses canonical membership, never name prefixes', () => {
  assert.doesNotMatch(code(APP), /selectedEdgeId\.startsWith\(/);
  assert.match(code(APP), /plate\.memberEdgeIds\.includes\(state\.selectedEdgeId\)/);
});
test('independent nodes are keyboard selectable', () => {
  assert.match(code(APP), /selectNode\(node\.id\)/);
  assert.match(code(APP), /e\.key==='Enter'/);
});
test('group expansion never renders a member table', () => {
  assert.doesNotMatch(code(APP), /class: ['"]plate-row['"]/);
  assert.doesNotMatch(code(APP), /plateRowsFor\(/);
});
test('group title retains the complete evidence location', () => {
  assert.match(code(APP), /plate\.meta\|\|plate\.relationshipType/);
  assert.match(code(APP), /grouping only/);
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

// Rationale now precedes records so evidence boundaries are read before technical data.
// Browser coverage in relationship-reading-acceptance checks the rendered reading order.
test('the drawer block order is identity, rationale, evidence, provenance, actions', () => {
  const body = code(APP);
  const at = (needle: string) => body.indexOf(needle);
  const order = [
    at('text: \'RELATIONSHIP\''),
    at('wrap.append(why)'),
    at('wrap.append(evidenceBlock)'),
    at('wrap.append(provenance)'),
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
  // Below 1600 the rail collapses to zero width and comes back as a disclosure. The
  // world does not move: it is 1920 x 1720 at every viewport, and only the window over
  // it changes.
  assert.match(CSS, /@media \(max-width:\s*1599px\)/, 'P0.5 uses the explicit single-panel breakpoint below 1600');
  assert.match(CSS, /@media \(max-width:\s*1599px\)[\s\S]{0,600}?\.rail\s*\{\s*display:\s*none/,
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
  // Oct13: exploration is unbounded; the fixed WORLD clamp prevents reaching new nodes.
  assert.match(app, /const window = \{viewBox:/);
  assert.equal(/canvas\.setAttribute\('viewBox',/.test(app.replace(/function setCamera\([\s\S]*?\n}/, '')), false,
    'all camera writes use the same SVG path');
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