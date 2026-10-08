/*
 * Slice 2 browser acceptance: the ported Landing.
 *
 * Everything the brief asks for, measured on the real page at both viewports:
 * default, input focus, a real submit that navigates into the analysis, an invalid
 * repository if production has an error state for one, no horizontal overflow, the
 * underprint offset measured in pixels, the typefaces proven resolved rather than
 * assumed, and no console or network errors anywhere in the run.
 *
 * The typeface check is the one worth being pedantic about. A stylesheet that NAMES a
 * font proves nothing: this product spent its whole life declaring "Geist" and
 * "JetBrains Mono" while serving no font file, and the fallback rendered perfectly
 * happily. So the assertion is `document.fonts.check()` against the family AND a
 * measured advance-width difference between the resolved face and the generic fallback --
 * a font that is not there cannot change a glyph's width.
 */
import { chromium, type Page, type Browser } from 'playwright';
import { serve } from '../../src/web/serve.ts';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'artifacts/shots/slice2';
mkdirSync(OUT, { recursive: true });

const results: Array<{ ok: boolean; check: string; detail: string }> = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ ok, check: name, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};

const { server, url } = await serve({
  port: 0, clientDir: resolve('dist/web'),
  cacheRoot: resolve('.cache'), enableGit: true, enableRegistry: true,
}, { GITLINEAGE_NO_CLIENT: '' });
const browser: Browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });

for (const [label, width, height] of [['1920x1080', 1920, 1080], ['1280x800', 1280, 800]] as const) {
  const page = await browser.newPage({ viewport: { width, height } });
  const consoleErrors: string[] = [];
  const netErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`); });
  page.on('response', (r) => { if (r.status() >= 400) netErrors.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? '';
    if (!/ERR_ABORTED/.test(f)) netErrors.push(`failed ${r.url()} ${f}`);
  });

  await page.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('#landing:not([hidden])').waitFor({ timeout: 60_000 });
  await page.evaluate(`document.fonts.ready`);
  await page.waitForTimeout(500);

  await page.screenshot({ path: `${OUT}/${label}-01-default.png` });

  // ---- default state, and the composition claims
  const state = await page.evaluate(`(() => {
    const q = (s) => document.querySelector(s);
    const r = (s) => { const e = q(s); return e ? e.getBoundingClientRect() : null; };
    const doc = document.documentElement;
    return {
      column: Math.round(r('.landing').width),
      hScroll: doc.scrollWidth - doc.clientWidth,
      docScrolls: doc.scrollHeight > window.innerHeight,
      columnOverflow: (() => { const el = q('#landing'); return el.scrollWidth - el.clientWidth; })(),
      underprintOffset: (() => {
        const u = r('.hero-u'); const f = r('.hero-f');
        return { x: Math.round(u.x - f.x), y: Math.round(u.y - f.y) };
      })(),
      lines: document.querySelectorAll('.hero-line').length,
      legends: document.querySelectorAll('.input-card .st').length,
      depth: document.querySelectorAll('.seg-btn').length,
      samples: document.querySelectorAll('.samples a').length,
      proofCols: document.querySelectorAll('.trust-cell').length,
      footRule: getComputedStyle(q('.site-foot')).borderTopWidth,
      deadLinks: [...document.querySelectorAll('#landing a')]
        .filter((a) => !a.getAttribute('href') || a.getAttribute('href') === '#').length,
      disabledControls: document.querySelectorAll('#landing button[disabled], #landing input[disabled]').length,
    };
  })()`) as Record<string, unknown>;
  writeFileSync(`${OUT}/${label}-state.json`, JSON.stringify(state, null, 1));

  check(`[${label}] bounded 852px column`, state.column === 852, `${state.column}px`);
  check(`[${label}] no horizontal overflow`, Number(state.hScroll) <= 0 && Number(state.columnOverflow) <= 0,
    `document ${state.hScroll}px, column ${state.columnOverflow}px`);
  check(`[${label}] the document itself does not scroll`, state.docScrolls === false);
  check(`[${label}] the underprint is offset exactly 6/6`,
    (state.underprintOffset as { x: number; y: number }).x === 6
      && (state.underprintOffset as { x: number; y: number }).y === 6,
    JSON.stringify(state.underprintOffset));
  check(`[${label}] the headline is two explicit lines`, state.lines === 2, `${state.lines}`);
  check(`[${label}] the evidence legend, depth control and five examples are present`,
    state.legends === 3 && state.depth === 3 && state.samples === 5,
    `${state.legends} chips, ${state.depth} depth, ${state.samples} samples`);
  check(`[${label}] the proof block is three columns and the footer rule is strong`,
    state.proofCols === 3 && state.footRule === '2px', `${state.proofCols} cells, rule ${state.footRule}`);
  check(`[${label}] no dead link and no disabled control on the landing`,
    state.deadLinks === 0 && state.disabledControls === 0,
    `${state.deadLinks} dead links, ${state.disabledControls} disabled`);

  /*
   * No seam at the column edge, and no split ink.
   *
   * Both were real defects in the first cut of this slice. The Landing element IS the
   * 852px column, so a Landing-local `--paper` painted a band down the middle of the
   * viewport with the shell's paper either side of it -- measured as rgb(242,241,235)
   * against rgb(247,245,240). And `body` sets `color: var(--ink)`, which resolves AT BODY
   * SCOPE, so inherited text on the Landing rendered in production's ink while every
   * explicit `color: var(--ink)` inside it rendered in V3.3's ink. Two papers, two inks,
   * one page.
   *
   * V3.3 gets away with both because its top bar and its column are one file. Here the
   * top bar is `.appbar`, which the Explorer also uses, so those two values are Slice 4's
   * to change. These assertions hold the line until then.
   */
  const ground = await page.evaluate(`(() => ({
    landingBg: getComputedStyle(document.querySelector('.landing')).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
    // The precise form of "one ink": the SAME token must resolve to the SAME value inside
    // the Landing as it does at body scope. Comparing two rendered elements for equality
    // would be the wrong test -- the lede is --ink-2, the proof heading is --ink-3 and the
    // headline is --ink, and those three are SUPPOSED to differ. The defect was that one
    // token resolved two ways.
    inkInside: getComputedStyle(document.querySelector('.landing')).getPropertyValue('--ink').trim(),
    inkAtBody: getComputedStyle(document.body).getPropertyValue('--ink').trim(),
    headlineInk: getComputedStyle(document.querySelector('.hero-f')).color,
    bodyInk: getComputedStyle(document.body).color,
  }))()`) as Record<string, string>;
  check(`[${label}] the Landing paints no paper band of its own`,
    ground.landingBg === 'rgba(0, 0, 0, 0)' || ground.landingBg === ground.bodyBg,
    `landing ${ground.landingBg}, shell ${ground.bodyBg}`);
  check(`[${label}] one ink across the Landing, inherited and explicit`,
    ground.inkInside!.toLowerCase() === ground.inkAtBody!.toLowerCase()
      && ground.headlineInk === ground.bodyInk,
    `--ink ${ground.inkInside} inside vs ${ground.inkAtBody} at body; headline ${ground.headlineInk}, body ${ground.bodyInk}`);

  // ---- fonts RESOLVED, not merely declared
  const fonts = await page.evaluate(`(() => {
    const probe = document.createElement('span');
    // The text matters. An empty span measures zero in every family, so "is this font
    // different from the fallback" would compare 0 with 0 and answer yes to anything.
    probe.textContent = 'Handgloves 0123456789 @#$%';
    probe.style.cssText = 'position:absolute;left:-9999px;white-space:pre;font-size:64px;font-weight:400';
    document.body.appendChild(probe);
    const width = (family) => { probe.style.fontFamily = family; return probe.getBoundingClientRect().width; };
    const sans = width('Geist');
    const sansFallback = width('monospace');
    const mono = width('"JetBrains Mono"');
    const monoFallback = width('serif');
    const serif = width('serif');
    probe.remove();
    return {
      geistLoaded: document.fonts.check('64px Geist'),
      jbmLoaded: document.fonts.check('64px "JetBrains Mono"'),
      faces: document.fonts.size,
      sansWidth: Math.round(sans),
      monoWidth: Math.round(mono),
      serifWidth: Math.round(serif),
      sansIsGeist: sans > 1 && Math.abs(sans - sansFallback) > 0.5,
      monoIsJbm: mono > 1 && Math.abs(mono - monoFallback) > 0.5,
    };
  })()`) as Record<string, unknown>;
  check(`[${label}] Geist is resolved, not falling back`,
    fonts.geistLoaded === true && fonts.sansIsGeist === true, JSON.stringify(fonts));
  check(`[${label}] JetBrains Mono is resolved, not falling back`,
    fonts.jbmLoaded === true && fonts.monoIsJbm === true,
    `faces ${fonts.faces}, mono ${fonts.monoWidth}px vs serif ${fonts.serifWidth}px`);

  // ---- input focus
  await page.click('#repo-input');
  await page.keyboard.type('kuddev/pebrel', { delay: 30 });
  await page.waitForTimeout(400);
  const focused = await page.evaluate(`(() => {
    const el = document.querySelector('#repo-input');
    const field = el.closest('.field');
    const cs = getComputedStyle(field);
    return {
      active: document.activeElement === el,
      value: el.value,
      border: cs.borderTopColor,
      outline: cs.outlineStyle + ' ' + cs.outlineWidth,
      // A focus ring must be a hard rule, never a blurred glow.
      shadowHasBlur: /px\s+(?!0px)/.test(cs.boxShadow) && cs.boxShadow !== 'none',
    };
  })()`) as Record<string, unknown>;
  check(`[${label}] the input takes focus and shows a brand-coloured hard ring`,
    focused.active === true && focused.border === 'rgb(51, 72, 90)' && /solid/.test(String(focused.outline)),
    `border ${focused.border}, outline ${focused.outline}, value "${focused.value}"`);
  check(`[${label}] the focus ring is not a blurred glow`, focused.shadowHasBlur === false);
  await page.screenshot({ path: `${OUT}/${label}-02-input-focus.png` });

  // ---- a REAL submit: navigate into the analysis flow
  await page.click('#submit');
  let navigated = '';
  try {
    await page.waitForURL(/\/kuddev\/pebrel$/, { timeout: 45_000 });
    navigated = new URL(page.url()).pathname;
  } catch { navigated = new URL(page.url()).pathname; }
  check(`[${label}] submitting the repository navigates into the analysis`,
    navigated === '/kuddev/pebrel', `landed on ${navigated}`);

  await page.locator('#explorer:not([hidden])').first().waitFor({ timeout: 120_000 });
  await page.waitForSelector('svg .node-hit', { timeout: 180_000 });
  await page.waitForTimeout(1200);
  const afterSubmit = await page.evaluate(`(() => ({
    landing: !!document.querySelector('#landing:not([hidden])'),
    drawn: document.querySelectorAll('svg .node-box, svg .bundle-card-box').length,
    crumb: (document.querySelector('#crumb-repo')?.textContent || '').trim(),
  }))()`) as Record<string, unknown>;
  check(`[${label}] the analysis resolves a real graph, and the landing is gone`,
    afterSubmit.landing === false && Number(afterSubmit.drawn) > 0,
    `${afterSubmit.drawn} drawn, crumb "${afterSubmit.crumb}"`);
  await page.screenshot({ path: `${OUT}/${label}-03-after-submit.png` });

  // ---- invalid input, if production has an error state for one
  const bad = await browser.newPage({ viewport: { width, height } });
  const badErrors: string[] = [];
  bad.on('pageerror', (e) => badErrors.push(e.message));
  await bad.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
  await bad.locator('#landing:not([hidden])').waitFor({ timeout: 60_000 });
  await bad.fill('#repo-input', 'not-a-real-repository-xyz/nope');
  await bad.click('#submit');
  let failureShown = false;
  let failureText = '';
  try {
    await bad.waitForFunction(
      `(() => { const f = document.querySelector('#failure');
         const e = document.querySelector('#empty');
         return (f && !f.hasAttribute('hidden')) || (e && !e.hasAttribute('hidden')); })()`,
      { timeout: 90_000 },
    );
    failureShown = true;
    failureText = await bad.evaluate(`(() => {
      const f = document.querySelector('#failure'); const e = document.querySelector('#empty');
      const n = (f && !f.hasAttribute('hidden')) ? f : e;
      return (n?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 140);
    })()`) as string;
  } catch { failureShown = false; }
  check(`[${label}] an invalid repository reaches a real failure or empty state`,
    failureShown && failureText.length > 0, failureShown ? failureText.slice(0, 90) : 'no state appeared');
  check(`[${label}] the invalid-repository path raises no page error`,
    badErrors.length === 0, badErrors.slice(0, 2).join(' | '));
  await bad.screenshot({ path: `${OUT}/${label}-04-invalid.png` });
  await bad.close();

  check(`[${label}] no console errors across the whole run`, consoleErrors.length === 0,
    consoleErrors.slice(0, 3).join(' | '));
  check(`[${label}] no failed or 4xx/5xx requests`, netErrors.length === 0,
    netErrors.slice(0, 3).join(' | '));
  await page.close();
}

await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} landing acceptance checks passed`);
for (const f of failed) console.log(`  FAIL ${f.check}  -- ${f.detail}`);
process.exit(failed.length ? 1 : 0);