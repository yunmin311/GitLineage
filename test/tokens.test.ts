/**
 * The shared visual foundation: one token source, asserted.
 *
 * Frozen V3.3 keeps its grammar in two files -- `tokens.css` for Landing and Analysis,
 * and the frozen `primitives.css` for Explorer. Their shared values are identical, and
 * the design asserts that with `audit-tokens.mjs` so the two cannot drift. Production
 * does not want two copies of the same numbers, so it converges them into one `:root`
 * in `app.css` and this file is that assertion.
 *
 * It asserts three things, and the third is the one that matters most.
 *
 * 1. Every global token is defined EXACTLY ONCE. Two definition sites is how a
 *    parallel token system starts: one copy wins in some scopes and loses in others,
 *    and the bug only reproduces on the page you did not test.
 *
 * 2. Every global token has the value it is supposed to have, recorded as a golden
 *    value. This is what makes the Slice 1 rename falsifiable. Sixty-nine call sites
 *    changed name and none of them was supposed to change meaning, and a golden table
 *    is the only thing that can say so afterwards rather than before.
 *
 * 3. The values Frozen V3.3 specifies but production has NOT adopted yet are listed
 *    explicitly, each with the slice that owns it. That list is the honest part: a
 *    reader can see that `--paper` is still `#F7F5F0` rather than V3.3's `#F2F1EB`, that
 *    it is deliberate, and that it is not forgotten. When a slice adopts the value the
 *    entry is removed in that slice's commit, so this file is the migration ledger.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const APP_CSS = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/app.css'), 'utf8');
const ROOT_BLOCK = /:root\s*\{([\s\S]*?)\n\}/.exec(APP_CSS)?.[1] ?? '';

/**
 * The stylesheet with its comments removed.
 *
 * Every assertion below is about what the product renders, not about what the file says
 * about itself -- and the stylesheet now explains, in prose, that `--accent` was renamed
 * to `--brand`. A search for `--accent` over the raw text therefore finds its own
 * obituary and reports the token as still present. Stripping comments first is what makes
 * "this token is gone" a checkable claim instead of a self-contradiction.
 */
const DECLARED_TEXT = APP_CSS.replace(/\/\*[\s\S]*?\*\//g, ' ');

/**
 * Surfaces allowed to RE-DECLARE a global token rather than inherit it.
 *
 * Frozen V3.3's paper, ink and status values are adopted per surface, not globally: Slice
 * 2 adopted them for the Landing by declaring them on `.landing`, where they cascade into
 * the Landing subtree and stop at its edge, so the Explorer is not restyled by a commit
 * about the Landing. That is a scoped override, not a second token system -- there is
 * still exactly one global definition of every token in `:root`.
 *
 * The distinction matters, because a genuinely parallel token system looks identical to
 * this from a distance. So the rule is stated as it actually is: exactly one global
 * definition per token, and re-declaration permitted only inside a selector on this list.
 * A surface that stops being ported removes itself; a token that starts being re-declared
 * in two places fails.
 */
const ALLOWED_SCOPES = ['.landing', '.analysis'] as const;

/** Every token declared anywhere, with the scope each declaration was found in. */
function declarations(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  // Walk top-level blocks so a declaration can be attributed to the selector that owns it.
  const re = /(^|\})([^{}@]+)\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(DECLARED_TEXT)) !== null) {
    const selector = (m[2] ?? '').trim().split(/\s*,\s*/)[0] ?? '';
    const block = DECLARED_TEXT.slice(m.index + m[0].length);
    const depthAt = block.search(/[{}]/);
    const body = depthAt === -1 ? block : block.slice(0, depthAt);
    for (const d of body.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      if (!d[1]) continue;
      const list = out.get(d[1]) ?? [];
      list.push(selector);
      out.set(d[1], list);
    }
  }
  return out;
}

/**
 * Token -> value, from the GLOBAL `:root` block only.
 *
 * Deliberately global. The golden table records what the product's base tokens are, and a
 * per-surface override that quietly changed a global value would defeat the point of
 * having a golden table at all. Landing-scoped adoption is asserted separately, against
 * the `.landing` block, so the two claims cannot be confused.
 */
function declared(): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of ROOT_BLOCK.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (m[1] && m[2]) out.set(m[1], m[2].trim());
  }
  return out;
}

/** Token -> value, from one named top-level selector's block. */
function declaredIn(selector: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = new RegExp(`(?:^|\\})${selector.replace(/[.]/g, '\\.')}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const body = re.exec(DECLARED_TEXT)?.[1] ?? '';
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    if (m[1] && m[2]) out.set(m[1], m[2].trim());
  }
  return out;
}

/**
 * The values Slice 1 must produce, as approved in `d26cfc6c` and asserted here so a
 * rename cannot quietly change one. Colour is the V2.1 approved palette; the brand
 * values are the V3.3 mineral blue, which is the one deliberate colour change in this
 * slice and is called out in the commit.
 */
const GOLDEN: Record<string, string> = {
  // paper & surface
  '--paper': '#F2F1EB',
  '--paper-deep': '#E9E8E0',
  '--surface': '#F8F7F2',
  '--surface-hi': '#FDFCFA',
  '--surface-sunk': '#E3E2DD',
  // ink ramp
  '--ink': '#17150F',
  '--ink-2': '#525048',
  '--ink-3': '#6B6961',
  '--ink-4': '#8D8C86',
  '--ink-5': '#C4C0B6',
  // rules
  '--rule': '#D5D4CE',
  '--rule-2': '#BCBBB4',
  '--rule-3': '#B4AFA2',
  '--rule-strong': '#17150F',
  '--rule-hair': '1px',
  '--rule-firm': '1px solid var(--rule)',
  '--rule-heavy': '1px solid var(--ink)',
  '--rule-key': '3px solid var(--ink)',
  // brand -- the mineral blue. Green is gone.
  '--brand': '#33485A',
  '--brand-press': '#1E3548',
  '--brand-wash': '#DFE9F3',
  '--brand-edge': '#8295A6',
  // evidence status
  '--verified': '#486884',
  '--verified-wash': '#E0EDF9',
  '--declared': '#806151',
  '--declared-wash': '#FBE9E0',
  '--detected': '#6B7177',
  '--detected-wash': '#E7ECF0',
  '--alert': '#83564F',
  '--alert-wash': '#FCE7E4',
  // geometry
  '--r-sm': '3px',
  '--r-md': '5px',
  '--r-lg': '6px',
  '--r-pill': '999px',
  '--bw': '2px',
  // the spacing ladder. Eleven steps, because the approved layout also uses 20, 40 and
  // 96 and this slice must not move a single one of them.
  '--s1': '4px',
  '--s2': '8px',
  '--s3': '12px',
  '--s4': '16px',
  '--s5': '20px',
  '--s6': '24px',
  '--s7': '32px',
  '--s8': '40px',
  '--s9': '48px',
  '--s10': '64px',
  '--s11': '96px',
  // motion
  '--d-fast': '110ms',
  '--d-move': '260ms',
  '--d-trace': '620ms',
  '--ease': 'cubic-bezier(.22, .61, .36, 1)',
  '--ease-inout': 'cubic-bezier(.4, 0, .2, 1)',
  // topological depth
  '--depth-connected': '4px',
  '--depth-selected': '5px',
  '--depth-subject': '6px',
  // shell
  '--rail-w': '264px',
  '--bar-h': '44px',
  '--strip-h': '46px',
};

/**
 * Frozen V3.3 values production has deliberately NOT adopted yet.
 *
 * Each is deferred to the slice that owns the surface it belongs to, because adopting
 * one here would restyle an approved surface before that surface has been ported.
 * Removing an entry from this table is how a slice claims it.
 */
const DEFERRED: Record<string, { v33: string; owner: string }> = {
  '--d-trace': { v33: '900ms', owner: 'slice 4 -- declined on purpose, see app.css' },
};

test('every global token is defined exactly once', () => {
  /*
   * Not "defined in the file" -- defined once, globally. A token declared in `:root` and
   * again at top level wins or loses by specificity and by scope, and the result is a
   * second token system that looks like one until a page renders differently from its
   * neighbour.
   *
   * A re-declaration inside an ALLOWED_SCOPES selector is the deliberate per-surface
   * adoption of V3.3's values and is permitted; anywhere else it is the bug this test is
   * for.
   */
  const offenders: string[] = [];
  for (const [token, scopes] of declarations()) {
    // Runtime-set custom properties are written by app.js onto the world frame and are
    // declared nowhere; those are not global tokens and cannot collide.
    if (token.startsWith('--world') || token.startsWith('--frame') || token.startsWith('--gl-')) continue;
    for (const scope of scopes) {
      const isGlobal = scope === ':root';
      const isAllowedScope = (ALLOWED_SCOPES as readonly string[]).includes(scope);
      if (!isGlobal && !isAllowedScope) offenders.push(`${token} in "${scope}"`);
    }
    const globals = scopes.filter((s) => s === ':root').length;
    if (globals > 1) offenders.push(`${token} declared ${globals} times at global scope`);
  }
  assert.deepEqual(offenders, [], 'these tokens are declared outside the global :root, or more than once');
});

test('no reference points at a token that does not exist', () => {
  const declared_ = declared();
  // Set by app.js at runtime, so absent from the stylesheet by design.
  const runtime = /^(--(world|frame|band|gl-))/;
  const scopes = Object.fromEntries(ALLOWED_SCOPES.map((s) => [s, declaredIn(s)]));
  const missing = [...new Set([...APP_CSS.matchAll(/var\((--[a-z0-9-]+)/g)]
    .map((m) => m[1])
    .filter((t): t is string => typeof t === 'string'))]
    .filter((t) => !declared_.has(t) && !runtime.test(t)
      && !Object.values(scopes).some((m2) => m2.has(t)));
  assert.deepEqual(missing, [], 'these tokens are referenced but never declared');
});

test('every shared token keeps its approved value', () => {
  const declared_ = declared();
  const wrong: string[] = [];
  for (const [token, value] of Object.entries(GOLDEN)) {
    if (declared_.get(token) !== value) wrong.push(`${token}: expected ${value}, got ${declared_.get(token)}`);
  }
  assert.deepEqual(wrong, [], 'token values drifted');
});

test('the green accent is gone and the brand pigment is in place', () => {
  /*
   * The one deliberate colour change in this slice. The accent was green, which put
   * "what is this analysis doing right now" in the same channel as the three
   * evidence-status hues; hue is now reserved for active state alone.
   */
  assert.equal(/(^|[;{\s])--accent\s*:/.test(DECLARED_TEXT), false, 'the --accent token is not declared');
  assert.equal(/var\(--accent\)/.test(DECLARED_TEXT), false, 'and nothing references it');
  assert.equal(declared().get('--brand'), '#33485A', 'brand is the V3.3 mineral blue');
  // And it is used for active state only: the tracer dot and the current phase.
  for (const selector of ['.tracer-dot', '.phase.is-current .phase-n', '.phase.is-current .pm']) {
    assert.match(DECLARED_TEXT, new RegExp(selector.replace(/[.]/g, '\\.') + '[^}]*var\\(--brand\\)'),
      `${selector} marks the active state with the brand pigment`);
  }
});

test('the deferred V3.3 values are declared as deferred, not silently skipped', () => {
  /*
   * A migration ledger has to be falsifiable in both directions: every deferred token must
   * still be at its production value (so nobody adopted one by accident), and every token
   * still marked deferred must not have quietly acquired the V3.3 value (so the ledger
   * cannot outlive the work).
   */
  const declared_ = declared();
  for (const [token, { v33, owner }] of Object.entries(DEFERRED)) {
    const current = declared_.get(token);
    assert.notEqual(current, v33,
      `${token} already has the V3.3 value (${v33}) but is still listed as deferred to ${owner}`);
  }
  assert.ok(Object.keys(DEFERRED).length > 0, 'the ledger is not empty');
});

test('the status primitive draws its swatches without a gradient', () => {
  /*
   * Frozen V3.3 draws the three swatches with identical-stop and repeating gradients.
   * `test/phases.test.ts` forbids any painted gradient in this sheet, and that rule has
   * been deliberately hardened twice, so it stays untouched and the swatch is rebuilt
   * from the geometry the gradients described.
   *
   * The shapes are the point: solid, dashed and dotted, so the three statuses survive
   * both a monochrome screenshot and a reader who cannot separate the hues.
   */
  const st = /\.st\s*\{[\s\S]*?\n\}/.exec(DECLARED_TEXT)?.[0] ?? '';
  assert.ok(st, 'the status primitive exists');
  for (const variant of ['.st-v', '.st-d', '.st-t', '.st-b']) {
    const rule = new RegExp(variant.replace(/[.]/g, '\\.') + '\\s*\\.sw::before[^}]*}').exec(DECLARED_TEXT);
    assert.ok(rule, `${variant} draws a swatch`);
    // Strip the mask declarations before searching, exactly as the production guard does.
    // A `mask-image: repeating-linear-gradient(...)` modulates alpha and paints no colour;
    // treating the word "gradient" as a failure here would forbid the one form the
    // stylesheet is allowed to use, and would say nothing about a painted fill.
    const painted = rule![0].replace(/(-webkit-)?mask(-image)?\s*:[^;}]*;?/g, ' ');
    assert.doesNotMatch(painted, /(^|[;{\s])(repeating-)?(linear|radial|conic)-gradient\(/,
      `${variant} paints no gradient`);
  }
  // And the dash/dot patterns are masks, not fills -- the one gradient form production
  // permits, and the form V3.3's numbers actually describe.
  assert.match(DECLARED_TEXT, /\.st-d \.sw::before[^}]*mask-image:\s*repeating-linear-gradient/,
    'the dash is an alpha mask over a solid fill');
  // A mask paints no colour of its own, so no swatch may declare a fill gradient.
  const fills = DECLARED_TEXT.replace(/(-webkit-)?mask(-image)?\s*:[^;}]*;?/g, ' ');
  assert.doesNotMatch(fills, /(^|[;{\s])(repeating-)?(linear|radial|conic)-gradient\(/,
    'no swatch paints a gradient');
  // Each shape is placed explicitly rather than left to a UA dash phase.
  assert.match(DECLARED_TEXT, /\.st-d \.sw::before[^}]*repeating-linear-gradient\(90deg, #000 0 4px, transparent 4px 7px\)/,
    'declared is V3.3\'s own 4px-on / 3px-off dash geometry');
  assert.match(DECLARED_TEXT, /\.st-t \.sw::before[^}]*repeating-linear-gradient\(90deg, #000 0 1\.2px, transparent 1\.2px 4px\)/,
    'detected is V3.3\'s own 1.2px-on / 2.8px-off dot geometry');
});

test('the shipped typefaces are the ones the design specifies', () => {
  const fonts = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/fonts.css'), 'utf8');
  assert.match(fonts, /@font-face\{font-family:'Geist'/, 'Geist is shipped');
  assert.match(fonts, /font-family:'JetBrains Mono'/, 'JetBrains Mono is shipped');
  const declared_ = declared();
  const sans = declared_.get('--sans') ?? '';
  const mono = declared_.get('--mono') ?? '';
  assert.match(sans, /^"Geist"/, 'sans resolves to the shipped face');
  assert.match(mono, /^"JetBrains Mono"/, 'mono resolves to the shipped face');
  // The dead reference is gone rather than left to fail silently on every visitor.
  assert.doesNotMatch(mono, /Geist Mono/, 'the unshipped Geist Mono reference is removed');
});

test('the spacing ladder is one ladder on a 4px base', () => {
  const declared_ = declared();
  const steps = Object.entries(GOLDEN)
    .filter(([t]) => /^--s\d+$/.test(t))
    .map(([t, v]) => [t, parseInt(v, 10)] as const);
  assert.equal(steps.length, 11, 'eleven steps');
  for (const [token, px] of steps) {
    assert.equal(px % 4, 0, `${token} is a multiple of 4`);
    assert.equal(declared_.get(token), `${px}px`, `${token} keeps its approved value`);
  }
  // Ascending, with no duplicate steps: two names for one gap is the parallel system.
  for (let i = 1; i < steps.length; i++) {
    const here = steps[i]!;
    const prev = steps[i - 1]!;
    assert.ok(here[1] > prev[1], `${here[0]} is larger than ${prev[0]}`);
  }
});
/*
 * The headline's two layers, and why they are asserted together.
 *
 * The Landing title is two layers of the same filled words in one grid cell: the display
 * in ink, and an underprint offset down-right in the rule colour. The composition only
 * exists while both layers break at the same place. When the glyph layer was a single text
 * run its break was the browser's choice, and it was the browser's choice *per font*: this
 * slice ships the real typeface, Geist's metrics let "Where did this software" fit on one
 * line, and the underprint -- which broke explicitly -- was left stranded on a line of its
 * own, printing behind nothing.
 *
 * A screenshot caught it and a geometry check did not, because the h1 box stayed exactly
 * two lines tall while the break inside it moved. So this asserts the invariant directly:
 * same words, same number of explicit breaks, in the same order.
 */
test('the headline layers carry the same words and break in the same places', () => {
  const shell = readFileSync(resolve(import.meta.dirname, '..', 'src/web/client/index.html'), 'utf8');
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(shell)?.[1];
  assert.ok(h1, 'the headline exists');
  // One `.hero-line` per statement, each a grid cell holding the underprint pass and the
  // foreground pass. The break between statements is therefore structure, not wrapping.
  const lines = h1.split('<span class="hero-line">').slice(1)
    .map((chunk) => chunk.split('</span>')[0] ?? '');
  assert.ok(lines.length >= 2, 'the headline is more than one explicit line');
  const underprint = lines.map((l) => /<span class="hero-u"[^>]*>([\s\S]*?)<\/span>/.exec(l)?.[1] ?? '').join('<br>');
  const glyphs = lines.map((l) => /<span class="hero-f"[^>]*>([\s\S]*?)<\/span>/.exec(l)?.[1] ?? '').join('<br>');
  assert.ok(underprint && glyphs, 'both layers are present');

  // Words, with markup stripped, must be identical.
  const words = (s: string) => s.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]*>/g, '')
    .split('\n').map((line) => line.trim()).filter(Boolean);
  assert.deepEqual(words(underprint), words(glyphs),
    'the underprint prints the same words as the display');

  // And the break count must match, which is the part that actually drifted.
  const breaks = (s: string) => (s.match(/<br\s*\/?>/g) ?? []).length;
  assert.equal(breaks(underprint), breaks(glyphs),
    'both layers break at the same number of places');
  assert.ok(breaks(glyphs) >= 1, 'the headline has an explicit break, not a natural one');
});
