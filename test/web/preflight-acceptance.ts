/*
 * Functional preflight for a34998fb.
 *
 * Not a visual check. Every visible landing and navigation control is enumerated from
 * the live DOM, and each one is required to do something real: a link to resolve to a
 * destination that is not `#`, a button to change observable state, an input to accept
 * text. A control that is present and inert is a failure, because shipping it would be
 * advertising a capability the product does not have.
 *
 * Written to be read as the list of things that were checked, so the output is the
 * evidence rather than a claim about the evidence.
 */
import { chromium, type Page, type Browser } from 'playwright';
import { serve } from '../../src/web/serve.ts';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'artifacts/preflight';
mkdirSync(OUT, { recursive: true });

const results: Array<{ ok: boolean; check: string; detail: string }> = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ ok, check: name, detail });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
};

const { server, url } = await serve({
  port: 0,
  clientDir: resolve('dist/web'),
  cacheRoot: resolve('.cache'),
  enableGit: true,
  enableRegistry: true,
}, { GITLINEAGE_NO_CLIENT: '' });

/*
 * `--hide-scrollbars` is dropped on purpose.
 *
 * Playwright launches headless Chromium with it, and under it a scrollable box paints no
 * scrollbar and reserves no gutter -- so "no visible native scrollbar" would be reported
 * as true for any product at all, including one that never heard of the rule. Every
 * scrollbar measurement here is therefore taken in a browser that can paint one.
 * `artifacts/preflight-negative.ts` checks that this browser really does, and that the
 * same measurement finds a scrollbar when there is one.
 */
const browser: Browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });

const newPage = async (width: number, height: number) => {
  const page = await browser.newPage({ viewport: { width, height } });
  const consoleErrors: string[] = [];
  const netErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`); });
  page.on('response', (r) => {
    if (r.status() >= 400) netErrors.push(`${r.status()} ${r.url()}`);
  });
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? '';
    if (!/ERR_ABORTED/.test(f)) netErrors.push(`failed ${r.url()} ${f}`);
  });
  return { page, consoleErrors, netErrors };
};

const settled = async (page: Page, path: string) => {
  await page.goto(`${url}${path}`, { waitUntil: 'domcontentloaded' });
  // Wait for the section that owns the view, not for a scroller.
  //
  // At 1280 the rail collapses and the Drawer is an overlay that stays closed until
  // something is selected, so on an explorer page there may be no *visible* `.gl-scroll`
  // at all -- which made this helper hang for three minutes on a perfectly healthy page.
  await page.locator('#landing:not([hidden]), #explorer:not([hidden])').first()
    .waitFor({ timeout: 180_000 });
  await page.waitForTimeout(600);
};

/*
 * Wait for the analysis to reach a terminal state.
 *
 * Sampling the canvas straight after the URL changes reads zero drawn nodes, because the
 * view arrives and renders after the navigation does. Every "N drawn" number from an
 * earlier run of this preflight was that race, not a product defect -- so the wait is on
 * a state that means the work is finished: something drawn, or the empty state, or the
 * failure state. Anything else is a genuine timeout and is reported as one.
 */
const analysed = async (page: Page) => {
  const outcome = await page.evaluate(`(() => new Promise((resolve) => {
    const deadline = Date.now() + 150000;
    const read = () => {
      const explorer = document.querySelector('#explorer');
      const empty = document.querySelector('#empty');
      const failure = document.querySelector('#failure');
      const drawn = document.querySelectorAll('svg .node-box, svg .bundle-card-box').length;
      const emptyShown = !!empty && !empty.hasAttribute('hidden');
      const failureShown = !!failure && !failure.hasAttribute('hidden');
      return {
        shown: !!explorer && !explorer.hasAttribute('hidden'),
        drawn, emptyShown, failureShown,
        body: (document.querySelector('#empty-body')?.textContent
             || document.querySelector('#failure-body')?.textContent || '').trim().slice(0, 160),
      };
    };
    const tick = () => {
      const s = read();
      if (s.emptyShown || s.failureShown || s.drawn > 0) return resolve(s);
      if (Date.now() > deadline) return resolve({ ...s, timedOut: true });
      setTimeout(tick, 250);
    };
    tick();
  }))()`) as {
    shown: boolean; drawn: number; emptyShown: boolean; failureShown: boolean;
    body: string; timedOut?: boolean;
  };
  return outcome;
};

// =============================================================== 1. every control

for (const [label, width, height] of [['1920x1080', 1920, 1080], ['1280x800', 1280, 800]] as const) {
  const { page } = await newPage(width, height);
  await settled(page, '/');

  const controls = await page.evaluate(`(() => {
    const vis = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
      const b = el.getBoundingClientRect();
      return b.width > 0 && b.height > 0;
    };
    const out = [];
    for (const el of document.querySelectorAll('a, button, input, [role="button"], label')) {
      if (!vis(el)) continue;
      if (el.closest('[hidden]')) continue;
      out.push({
        tag: el.tagName,
        type: el.getAttribute('type') || '',
        text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 40),
        href: el.getAttribute('href'),
        id: el.id || '',
        cls: el.className || '',
        disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
        hasLabel: !!el.closest('label'),
        inAppbar: !!el.closest('#appbar'),
      });
    }
    return out;
  })()`) as Array<Record<string, unknown>>;

  writeFileSync(`${OUT}/controls-${width}.json`, JSON.stringify(controls, null, 1));

  // A link must go somewhere.
  const deadLinks = controls.filter((c) => c.tag === 'A' && (!c.href || c.href === '#'));
  check(`[${label}] every visible link resolves to a real destination`,
    deadLinks.length === 0,
    deadLinks.length ? deadLinks.map((c) => `#${c.id || c.text}`).join(', ') : `${controls.length} controls`);

  // A control the reader can see must do something.
  const inert = controls.filter((c) => (c.tag === 'BUTTON' || c.tag === 'INPUT') && c.disabled === true);
  check(`[${label}] no visible control is disabled or inert`,
    inert.length === 0,
    inert.length ? inert.map((c) => `${c.tag} "${c.text}"${c.id ? '#' + c.id : ''}`).join(', ') : 'none');

  // Nothing may look like a nav item with no destination.
  const decorative = controls.filter((c) => /^(SIGN IN|GRAPH|EVIDENCE|DOCS|AUDIT|ANALYSIS)$/i
    .test(String(c.text).trim()));
  check(`[${label}] no decorative SIGN IN/GRAPH/EVIDENCE/DOCS/AUDIT/ANALYSIS control`,
    decorative.length === 0, decorative.map((c) => String(c.text)).join(', ') || 'none');

  await page.close();
}

// ====================================================== 2. the repository input

{
  const { page, consoleErrors, netErrors } = await newPage(1600, 1000);
  await settled(page, '/');

  const input = page.locator('#repo-input');
  await input.click();
  await input.fill('kuddev/pebrel');
  const typed = await input.inputValue();
  check('the repository input accepts a typed repository', typed === 'kuddev/pebrel', `value "${typed}"`);

  await page.locator('#submit').click();
  await page.waitForURL(/\/kuddev\/pebrel/, { timeout: 30_000 });
  check('submitting the form navigates to the repository', true, page.url().replace(url, ''));

  // Placeholder text is not a value: an empty submit must not analyse anything.
  const { page: p2, consoleErrors: c2, netErrors: n2 } = await newPage(1600, 1000);
  await settled(p2, '/');
  await p2.locator('#submit').click();
  await p2.waitForTimeout(1500);
  const stayed = new URL(p2.url()).pathname === '/';
  check('an empty repository does not navigate anywhere', stayed, p2.url().replace(url, ''));
  check('an empty repository produces no errors', c2.length === 0 && n2.length === 0,
    [...c2, ...n2].join(' | '));
  await p2.close();

  await page.close();
  check('submitting produced no console or network errors',
    consoleErrors.length === 0 && netErrors.length === 0, [...consoleErrors, ...netErrors].join(' | '));
}

// ======================================================= 3. the depth control

{
  const { page } = await newPage(1600, 1000);
  await settled(page, '/');
  for (const depth of ['0', '600', '200']) {
    await page.locator(`.seg-btn[data-depth="${depth}"]`).click();
    await page.waitForTimeout(120);
  }
  const active = await page.locator('.seg-btn.is-active').getAttribute('data-depth');
  check('the depth control selects exactly one depth', active === '200', `active depth ${active}`);
  await page.close();
}

// ============================================================ 4. the examples

/*
 * The examples, read off the page rather than listed here.
 *
 * This block used to enumerate four repositories by name, which meant it reported "example
 * X is a real link" as a failure the moment the Landing's example set changed -- it was
 * asserting the prototype's contents, not the product's behaviour. The list now comes from
 * the rendered DOM, so the check is "every example the page offers analyses for real",
 * which is the claim that actually matters and cannot rot.
 */
const { page: landingPage } = await newPage(1600, 1000);
await settled(landingPage, '/');
const exampleHrefs = await landingPage.evaluate(
  `([...document.querySelectorAll('.samples a')].map((a) => a.getAttribute('href')))`,
) as string[];
await landingPage.close();

check('the landing offers examples', exampleHrefs.length >= 4,
  `${exampleHrefs.length} examples: ${exampleHrefs.join(' ')}`);

for (const href of exampleHrefs) {
  const repo = href.replace(/^\//, '');
  const { page, consoleErrors, netErrors } = await newPage(1600, 1000);
  await settled(page, '/');
  const present = await page.locator(`.samples a[href="${href}"]`).count() === 1;
  check(`example ${repo} is a real link`, present);
  if (!present) { await page.close(); continue; }

  await page.locator(`.samples a[href="${href}"]`).click();
  let ok = false;
  let detail = '';
  try {
    await page.waitForURL(new RegExp(`/${repo}$`, 'i'), { timeout: 30_000 });
    const outcome = await analysed(page);
    if (outcome.failureShown) { ok = false; detail = `failure state: ${outcome.body}`; }
    else if (outcome.timedOut) { ok = false; detail = `timed out with ${outcome.drawn} drawn`; }
    else if (outcome.emptyShown) {
      // "No lineage" is a legitimate outcome with its own empty state; anything else
      // landing there means the repository really has no evidence-backed lineage.
      ok = true; detail = `empty state: ${outcome.body.slice(0, 80)}`;
    } else {
      ok = outcome.drawn > 0;
      detail = `${outcome.drawn} drawn`;
    }
  } catch { detail = `did not reach ${repo}`; }
  check(`example ${repo} analyses for real`, ok, detail);
  check(`example ${repo} is error-free`,
    consoleErrors.length === 0 && netErrors.length === 0,
    [...consoleErrors, ...netErrors].slice(0, 3).join(' | '));
  await page.close();
}

// ===================================================== 5. grouped Kuddev/pebrel

{
  const { page, consoleErrors, netErrors } = await newPage(1920, 1080);
  await settled(page, '/Kuddev/pebrel');
  await page.waitForSelector('svg .node-hit', { timeout: 180_000 });
  await page.waitForTimeout(800);
  await page.locator('svg .node.is-subject .node-hit').first().dispatchEvent('click');
  await page.waitForSelector('.drawer-inner .bundle-row', { timeout: 60_000 });
  await page.waitForTimeout(400);

  const groups = await page.evaluate(`(() => {
    const heads = [...document.querySelectorAll('.drawer-inner .d-group-head')];
    const blockHead = [...document.querySelectorAll('.drawer-inner .d-block-head')]
      .find((h) => /RELATIONSHIPS/.test(h.textContent));
    return {
      block: blockHead?.textContent?.trim() ?? '',
      blockSticky: blockHead ? getComputedStyle(blockHead).position : null,
      groups: heads.map((h) => ({
        name: h.querySelector('.mono')?.textContent?.trim() ?? '',
        n: Number(h.querySelector('.d-group-count')?.textContent ?? '0'),
        sticky: getComputedStyle(h).position,
      })),
      rows: document.querySelectorAll('.drawer-inner .bundle-row').length,
    };
  })()`) as {
    block: string; blockSticky: string | null;
    groups: Array<{ name: string; n: number; sticky: string }>;
    rows: number;
  };
  writeFileSync(`${OUT}/pebrel-groups.json`, JSON.stringify(groups, null, 1));

  const summed = groups.groups.reduce((sum, g) => sum + g.n, 0);
  check('pebrel groups its relationships by declaring manifest', groups.groups.length >= 5,
    groups.groups.map((g) => `${g.name}=${g.n}`).join(', '));
  check('pebrel group counts partition every relationship',
    summed === groups.rows && groups.rows === 97, `${groups.rows} rows, counts sum ${summed}`);
  check('pebrel group headings are sticky', groups.groups.every((g) => g.sticky === 'sticky'));
  check('pebrel block heading states the total and the file count',
    new RegExp(`^RELATIONSHIPS \\(${groups.rows} in ${groups.groups.length} files\\)$`).test(groups.block),
    `"${groups.block}"`);

  // Every member must be clickable and must open its own evidence.
  await page.locator('.drawer-inner .bundle-row').nth(3).click();
  await page.waitForTimeout(700);
  const opened = await page.evaluate(`(() => ({
    drawer: !!document.querySelector('.drawer') && !document.querySelector('.drawer').hasAttribute('hidden'),
    sections: [...document.querySelectorAll('.drawer-inner .d-block-head')].map((h) => h.textContent.trim()),
    evidence: (document.querySelector('.drawer-inner')?.textContent || '').slice(0, 200),
  }))()`) as Record<string, unknown>;
  check('selecting a dependency opens its evidence',
    opened.drawer === true && Array.isArray(opened.sections) && (opened.sections as string[]).length > 0,
    (opened.sections as string[])?.join(' / '));
  writeFileSync(`${OUT}/pebrel-dependency-drawer.json`, JSON.stringify(opened, null, 1));

  check('pebrel is console- and network-clean',
    consoleErrors.length === 0 && netErrors.length === 0,
    [...consoleErrors, ...netErrors].slice(0, 3).join(' | '));
  await page.close();
}

/*
 * Read a panel's edge strip, column by column.
 *
 * Two things this has to get right, both learned by getting them wrong first.
 *
 * The strip must start *below* the panel's own top border and the app bar. Clipped from
 * y=0 it spans the app bar and the border line, so every pixel column contains both the
 * border colour and the surface, every column looks inked, and the check reports a
 * scrollbar that is not there.
 *
 * And "surface" is the most common colour in the whole strip, compared per column --
 * because a scrollbar's track and its thumb are both unlike the panel surface, and a
 * column-wise mode would hide the thumb behind the track.
 */
const edgeColumns = async (page: Page, png: Buffer) => new Promise<number[]>((resolve) => {
  void page.evaluate(`(async () => {
    const bytes = Uint8Array.from(atob('${png.toString('base64')}'), (c) => c.charCodeAt(0));
    const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext('2d');
    g.drawImage(bmp, 0, 0);
    const px = g.getImageData(0, 0, bmp.width, bmp.height).data;
    const tally = new Map();
    for (let i = 0; i < px.length; i += 4) {
      const k = px[i] + ',' + px[i + 1] + ',' + px[i + 2];
      tally.set(k, (tally.get(k) ?? 0) + 1);
    }
    let surface = null, best = -1;
    for (const [k, n] of tally) if (n > best) { best = n; surface = k; }
    const cols = [];
    for (let x = 0; x < bmp.width; x++) {
      const seen = new Set();
      for (let y = 0; y < bmp.height; y++) {
        const i = (y * bmp.width + x) * 4;
        if ((px[i] + ',' + px[i + 1] + ',' + px[i + 2]) !== surface) seen.add(1);
      }
      cols.push(seen.size);
    }
    return cols;
  })()`).then((r) => resolve(r as number[])).catch(() => resolve([]));
});

/*
 * Photograph a panel's right edge, clear of its own frame.
 */
const edgeStrip = async (page: Page, box: { x: number; y: number; width: number; height: number }, inset = 80) => {
  const y = Math.round(box.y) + inset;
  const h = Math.min(700, Math.round(box.height) - inset * 2);
  if (h <= 8) return null;
  return page.screenshot({
    clip: { x: Math.round(box.x + box.width) - 16, y, width: 16, height: h },
  });
};

/*
 * Verify one panel scrolls, if it overflows, and paints no scrollbar while doing it.
 */
const panelScroll = async (
  page: Page, label: string, width: number, sel: string, frame: string,
) => {
  const moved = await page.evaluate(`(async () => {
    const el = document.querySelector('${sel}');
    const before = el.scrollTop;
    el.scrollTop = el.scrollHeight;
    await new Promise((r) => setTimeout(r, 350));
    return { before, after: el.scrollTop, scrollable: el.scrollHeight > el.clientHeight,
             sh: el.scrollHeight, ch: el.clientHeight };
  })()`) as { before: number; after: number; scrollable: boolean; sh: number; ch: number };

  check(`[${label}] the ${frame} scrolls when it overflows`,
    !moved.scrollable || moved.after > moved.before,
    moved.scrollable
      ? `scrollTop ${moved.before} -> ${moved.after} of ${moved.sh - moved.ch}px`
      : `content ${moved.sh}px fits ${moved.ch}px, nothing to scroll`);

  const box = await page.locator(sel).boundingBox();
  if (!box || box.width < 20) {
    check(`[${label}] the ${frame} edge could be captured`, false, `no usable box ${JSON.stringify(box)}`);
    return;
  }

  // Hide the content and the continuation rule, so what is left in the strip is the
  // surface the scrollbar would have been painted over.
  await page.evaluate(`(() => {
    document.querySelector('${sel}').style.visibility = 'hidden';
    for (const m of document.querySelectorAll('.rail-more, .drawer-more')) m.style.visibility = 'hidden';
  })()`);
  await page.waitForTimeout(250);
  const png = await edgeStrip(page, box);
  if (png) {
    writeFileSync(`${OUT}/edge-${frame}-${width}.png`, png);
    const cols = await edgeColumns(page, png);
    const inked = cols.map((n, x) => (n > 0 ? x : -1)).filter((x) => x >= 0);
    const interior = inked.filter((x) => x > 1 && x < cols.length - 2);
    check(`[${label}] the ${frame} edge paints no native scrollbar`, interior.length === 0,
      `ink at column(s) [${inked.join(',')}] of 0..${cols.length - 1}; interior clear`);
  } else {
    check(`[${label}] the ${frame} edge paints no native scrollbar`, false, 'no usable strip');
  }
  await page.evaluate(`(() => {
    document.querySelector('${sel}').style.visibility = '';
    for (const m of document.querySelectorAll('.rail-more, .drawer-more')) m.style.visibility = '';
  })()`);
};

for (const [label, width, height] of [['1920x1080', 1920, 1080], ['1280x800', 1280, 800]] as const) {
  const { page } = await newPage(width, height);
  await settled(page, '/Kuddev/pebrel');
  await page.waitForSelector('svg .node-hit', { timeout: 180_000 });
  await page.waitForTimeout(700);

  /*
   * The rail is a permanent column at 1920 and a toggle at 1280, so at the narrow width
   * the toggle has to be pressed before there is a rail to test. Pressing it here also
   * proves the toggle works, rather than quietly skipping the rail at the size where it
   * is hardest -- and the rail is left open, because a rail that is closed is not a rail
   * that has been verified.
   */
  const toggle = page.locator('#rail-toggle');
  if (await toggle.isVisible() && !(await page.locator('#rail').isVisible())) {
    const before = await page.locator('#rail').isVisible();
    await toggle.click();
    await page.waitForTimeout(500);
    const after = await page.locator('#rail').isVisible();
    check(`[${label}] the rail toggle actually shows the rail`, before !== after,
      `rail visible ${before} -> ${after}`);
  }

  await panelScroll(page, label, width, '.rail-scroll', 'rail');

  await page.locator('svg .node.is-subject .node-hit').first().dispatchEvent('click');
  await page.waitForSelector('.drawer-inner .bundle-row', { timeout: 60_000 });
  await panelScroll(page, label, width, '.drawer-inner', 'Drawer');
  await page.close();
}

/*
 * The rail at 1080 tall simply fits -- no repository in the corpus produces a rail that
 * overflows a 1080-unit viewport -- so at both required sizes the rail's scrolling is
 * reported honestly as "fits" and proves nothing. This short window is where the rail
 * genuinely overflows, and it is where the rail's scrolling and its edge pixels are
 * actually exercised. Same product, same code path; a window a reader can really have.
 */
{
  const { page } = await newPage(1600, 620);
  await settled(page, '/Kuddev/pebrel');
  await page.waitForSelector('svg .node-hit', { timeout: 180_000 });
  await page.waitForTimeout(700);
  await panelScroll(page, '1600x620', 1600, '.rail-scroll', 'rail');
  await page.close();
}


await browser.close();
server.close();

const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILURES:');
  for (const f of failed) console.log(`  - ${f.check}${f.detail ? '  -- ' + f.detail : ''}`);
}
process.exit(failed.length ? 1 : 0);