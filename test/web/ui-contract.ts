/** UI_CONTRACT browser acceptance. Real bundle/server/cache; no screenshot baseline updates. */
import { chromium, type Page } from 'playwright';
import { serve } from '../../src/web/serve.ts';
import { resolve } from 'node:path';
import { mkdir, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const phase = process.env.UI_EVIDENCE_PHASE ?? 'after';
const out = resolve('artifacts/ui-contract', phase);
await mkdir(out, { recursive: true });
const checks: { name: string; ok: boolean; detail: unknown }[] = [];
const evidence: Record<string, unknown> = {};
const check = (name: string, ok: boolean, detail: unknown = '') => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(detail)}`);
};
const { server, url } = await serve({ port: 0, clientDir: resolve('dist/web'), cacheRoot: resolve('.cache'), enableGit: true, enableRegistry: true }, { GITLINEAGE_NO_CLIENT: '' });
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
async function geometry(page: Page) {
  return page.evaluate(() => {
    const rect = (s: string) => {
      const e = document.querySelector(s)!; const r = e.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    };
    const svg = document.querySelector<SVGSVGElement>('#canvas')!;
    const c = svg.getScreenCTM()!;
    const v = svg.viewBox.baseVal;
    return { stage: rect('#stage'), subject: rect('.node-box.is-subject'), hud: rect('#band'), controls: rect('.viewport-controls'),
      hudFont: getComputedStyle(document.querySelector('.band .ki')!).fontSize,
      viewBox: svg.getAttribute('viewBox'), ctm: { a: c.a, b: c.b, c: c.c, d: c.d, e: c.e, f: c.f },
      zoom: c.a, focal: [v.x + v.width / 2, v.y + v.height / 2], selection: new URL(location.href).searchParams.get('edge') ?? location.search,
      drawer: !document.querySelector('#drawer')!.hasAttribute('hidden'), rail: getComputedStyle(document.querySelector('#rail')!).display !== 'none' };
  });
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
async function shot(page: Page, name: string) { await page.screenshot({ path: `${out}/${name}.png` }); }
// Count painted glyph ink inside a label's exact screen bounds, using Chromium's PNG decoder.
async function ink(page: Page, selector: string) {
  const b = await page.locator(selector).first().boundingBox();
  if (!b) throw new Error('missing glyph bounds');
  const png = await page.screenshot({ clip: { x: Math.max(0, b.x), y: Math.max(0, b.y), width: b.width, height: b.height } });
  const decoder = await browser.newPage();
  try { return await decoder.evaluate(async data => {
    const img = new Image(); img.src = `data:image/png;base64,${data}`; await img.decode();
    const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const p = ctx.getImageData(0, 0, img.width, img.height).data;
    let dark = 0; for (let i = 0; i < p.length; i += 4) if (Math.max(p[i]!, p[i+1]!, p[i+2]!) < 180) dark++;
    return dark;
  }, png.toString('base64')); } finally { await decoder.close(); }
}
try {
  for (const [width, height] of [[1920,1080], [1280,800], [768,800], [640,400]]) {
    const page = await browser.newPage({ viewport: { width: width!, height: height! }, deviceScaleFactor: width === 640 ? 2 : 1, hasTouch: true });
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await page.goto(url); await page.evaluate(() => document.fonts.ready);
    check(`${width} landing project link`, await page.locator('#project-source[href="https://github.com/yunmin311/GitLineage"]').isVisible());
    await shot(page, `${width}-landing`);
    await page.goto(`${url}/yunmin311/obsidian-config`);
    await page.locator('.plate-row-label').first().waitFor({ timeout: 180000 });
    await page.evaluate(() => document.fonts.ready);
    await page.mouse.move(1, 1);
    await shot(page, `${width}-default`);
    const initial = await geometry(page);
    // A long real-world name exercises flex constraints without changing graph semantics.
    await page.evaluate(() => { const repo = document.querySelector('#crumb-repo')!; repo.textContent = 'organization-with-a-long-name/repository-with-an-extremely-long-descriptive-name'; });
    const top = await page.evaluate(() => {
      const selectors = ['.brand', '.crumb-repo', '.crumb-rev', '.cache-chip', '#search-btn', '#layers-btn', '#open-source'];
      const items = selectors.map(s => { const e = document.querySelector(s)!; const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { s, x:r.x,y:r.y,w:r.width,h:r.height,cy:r.y+r.height/2,lineHeight:c.lineHeight,align:c.alignItems }; });
      const repo = document.querySelector('.crumb-repo')!.getBoundingClientRect();
      const right = document.querySelector('.appbar-right')!.getBoundingClientRect();
      return { items, noOverlap: repo.right <= right.left || repo.top >= right.bottom, overflow: document.documentElement.scrollWidth > innerWidth,
        operations: items.slice(4).every(r => r.x >= 0 && r.x+r.w <= innerWidth && r.h > 0),
        centreSpread: Math.max(...items.map(r => r.cy))-Math.min(...items.map(r=>r.cy)) };
    });
    evidence[`${width}-topbar`] = top;
    check(`${width} topbar allocation`, top.noOverlap && !top.overflow && top.operations, top);
    // At compact widths the bar may explicitly have two rows. Each row retains centre alignment.
    const spread = (items: typeof top.items) => Math.max(...items.map(r=>r.cy))-Math.min(...items.map(r=>r.cy));
    const aligned = width! <= 700 ? spread([top.items[0]!, ...top.items.slice(4)]) <= 1 && spread(top.items.slice(1,4)) <= 1 : top.centreSpread <= 1;
    check(`${width} topbar centre alignment`, aligned, top.items);
    await shot(page, `${width}-long-name`);
    // Keep the actual glyph screen location away from overlay panels for a real hover/click.
    if (initial.rail && await page.locator('#rail-toggle').isVisible()) await page.locator('#rail-toggle').click();
    const label = page.locator('.plate-row-label').first();
    const rowText = await label.textContent();
    const beforeInk = await ink(page, '.plate-row-label');
    await label.hover();
    const afterInk = await ink(page, '.plate-row-label');
    await shot(page, `${width}-hover`);
    check(`${width} hover glyph pixels`, beforeInk > 5 && afterInk >= beforeInk * .9, { beforeInk, afterInk, rowText });
    if (process.argv.includes('--phase1')) { await page.close(); continue; }
    const base = await geometry(page);
    await label.click();
    await page.locator('#drawer:not([hidden])').waitFor();
    const drawerText = await page.locator('#drawer-inner').textContent();
    check(`${width} clicked row opens corresponding evidence`, !!drawerText?.includes(rowText!.replace(/…$/, '')) && (await geometry(page)).drawer);
    const drawer = await geometry(page);
    check(`${width} drawer screen mapping unchanged`, same(base.stage, drawer.stage) && same(base.ctm, drawer.ctm) && same(base.subject, drawer.subject) && same(base.focal, drawer.focal), { base, drawer });
    if (await page.locator('#rail-toggle').isVisible()) await page.locator('#rail-toggle').click();
    const both = await geometry(page);
    check(`${width} rail screen mapping unchanged`, same(drawer.stage, both.stage) && same(drawer.ctm, both.ctm), { drawer, both });
    await shot(page, `${width}-both-panels`);
    // Zoom controls are viewport operations, available even with both panels open.
    const controlsAccessible = await page.locator('#zoom-in').evaluate(e => { const r=e.getBoundingClientRect(); return !!document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#zoom-in'); });
    check(`${width} HUD controls hittable with both panels`, controlsAccessible);
    if (controlsAccessible) {
      for (let i=0; i<2; i++) { await page.locator('#zoom-in').click(); await page.locator('#zoom-out').click(); }
      const zoomed = await geometry(page);
      check(`${width} HUD fixed on zoom`, same(both.hud, zoomed.hud) && both.hudFont === zoomed.hudFont, { before:both.hud,after:zoomed.hud });
    }
    // Pan in the exposed centre, not on a panel or graph object. A leftward drag gives room at clamped edges.
    const spot = await page.evaluate(() => {
      for (let y=180; y<innerHeight-120; y+=30) for(let x=300; x<innerWidth-40; x+=20) if(document.elementFromPoint(x,y)?.id==='canvas') return {x,y};
      return null;
    });
    if (spot) {
      const pre = await geometry(page); await page.mouse.move(spot.x,spot.y); await page.mouse.down(); await page.mouse.move(spot.x+45,spot.y-45,{steps:8}); await page.mouse.up();
      const post = await geometry(page);
      check(`${width} drag retains selection and panels`, pre.selection === post.selection && pre.drawer === post.drawer && pre.rail === post.rail, { pre, post });
      check(`${width} pan changes camera only and fixes HUD`, pre.viewBox !== post.viewBox && same(pre.stage,post.stage) && same(pre.hud,post.hud) && pre.zoom === post.zoom, { pre,post });
      await shot(page, `${width}-drag`);
    } else check(`${width} exposed canvas for dual-panel pan`, width! < 768, 'No exposed canvas at this compact width');
    if (controlsAccessible) { const pre=await geometry(page); await page.locator('#zoom-fit').click(); const post=await geometry(page); check(`${width} HUD fixed on fit`, same(pre.hud,post.hud)); }
    if (width === 1280 && spot) {
      // Continuous trackpad deltas must make proportional camera changes.
      const pre = await geometry(page);
      await page.mouse.move(spot.x, spot.y); await page.mouse.wheel(0, .5);
      await page.waitForTimeout(80);
      const wheel = await geometry(page);
      check('trackpad fractional wheel retains panels and uses proportional zoom',
        wheel.zoom !== pre.zoom && Math.abs(wheel.zoom-pre.zoom)<.01 && wheel.selection===pre.selection && wheel.drawer && wheel.rail && same(pre.hud,wheel.hud), {pre,wheel});
      // Moving away then back remains a drag, regardless of the final displacement.
      await page.mouse.move(spot.x,spot.y); await page.mouse.down();
      await page.mouse.move(spot.x+30,spot.y-30,{steps:4}); await page.mouse.move(spot.x,spot.y,{steps:4}); await page.mouse.up();
      check('drag returning to origin suppresses deselection', (await geometry(page)).selection===pre.selection && (await geometry(page)).drawer);
      const small = await geometry(page);
      await page.mouse.move(spot.x,spot.y); await page.mouse.down(); await page.mouse.move(spot.x+2,spot.y+1); await page.mouse.up();
      const click = await geometry(page);
      check('sub-threshold blank click clears selection without panning', !click.drawer && same(small.viewBox,click.viewBox));
      const row = page.locator('.plate-row[role=button]').first(); await row.focus(); await page.keyboard.press('Enter');
      check('keyboard Enter opens evidence and preserves graph focus', (await geometry(page)).drawer && await row.evaluate(e=>e===document.activeElement));
      // Real Chromium touch events, rather than synthetic pointer callbacks.
      const touchPre = await geometry(page);
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x:spot.x,y:spot.y}]});
      await cdp.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:spot.x+45,y:spot.y-45}]});
      await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      await page.waitForTimeout(80); const touchPost = await geometry(page);
      check('touch pan retains panels selection and HUD', touchPost.viewBox!==touchPre.viewBox && touchPost.selection===touchPre.selection && touchPost.drawer && touchPost.rail && same(touchPre.hud,touchPost.hud), {touchPre,touchPost});
      await cdp.detach();
      await page.emulateMedia({ reducedMotion:'reduce' });
      check('reduced motion disables surface transitions', await page.locator('#zoom-in').evaluate(e=>getComputedStyle(e).transitionDuration.split(',').every(t=>parseFloat(t)===0)));
    }
    if (width === 1280) await page.locator('.drawer-close').focus();
    await page.keyboard.press('Escape');
    check(`${width} Escape closes drawer`, !(await geometry(page)).drawer);
    if (width === 1280) check('Escape preserves keyboard row focus', await page.locator('.plate-row[role=button]').first().evaluate(e=>e===document.activeElement));
    check(`${width} runtime errors`, errors.length===0, errors);
    evidence[`${width}-geometry`] = { initial, base, drawer, both };
    await page.close();
  }
  // Controlled long-value fixture: modify presentation strings in a real completed view.
  // IDs, relations and counts are retained; the canonical server artifact is never changed.
  const long = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  const path = 'packages/' + 'WWWW非常长的目录/'.repeat(10) + 'manifest-with-wide-glyphs-WWWWWWWWWWWWWWWW.json';
  await long.route('**/api/view/**', async route => {
    const response = await route.fetch(); const body = await response.json();
    if (body.ok && body.data) {
      for (const n of body.data.nodes) n.label = 'WWWW非常长的包名'.repeat(12);
      for (const cards of Object.values(body.data.evidenceByRelationship) as any[][]) for (const card of cards) {
        card.locator = path;
        const data = card.data.data ?? card.data;
        if (data.manifest_path) data.manifest_path = path;
      }
    }
    await route.fulfill({ response, json: body });
  });
  await long.goto(`${url}/Kuddev/pebrel`);
  await long.locator('.plate-subtitle').first().waitFor({ timeout:180000 });
  await long.evaluate(() => document.fonts.ready);
  const overflow = await long.evaluate(() => {
    const bad: string[] = [];
    for (const t of document.querySelectorAll<SVGGraphicsElement>('.bundle-card text, .node text')) {
      if(t.classList.contains('subject-tag')) continue;
      const card=t.closest('.bundle-card, .node')!;
      const b=card.querySelector<SVGGraphicsElement>('.bundle-card-box, .node-box')!.getBBox(), r=t.getBBox();
      if(r.x < b.x-1 || r.x+r.width>b.x+b.width+1) bad.push(`${t.getAttribute('class')}:${r.width}`);
      if(t.classList.contains('plate-row-label')) {
        const m=t.closest('.plate-row')?.querySelector<SVGGraphicsElement>('.plate-row-meta')?.getBBox();
        if(m && r.x+r.width>m.x-4) bad.push('label overlaps locator');
      }
    }
    return bad;
  });
  check('wide glyphs and long manifest stay inside actual cards', overflow.length===0, overflow);
  check('full long manifest remains available', await long.locator('.bundle-card title').allTextContents().then(a=>a.some(t=>t.includes(path))));
  await shot(long,'long-manifest'); await long.close();

  // Real browser page zoom, independent of the compact/device-scale probe above.
  // Full Chromium exposes settings; headless-shell has no browser zoom UI.
  if (phase !== 'before' && !process.argv.includes('--phase1')) {
    const profile = await mkdtemp(resolve(tmpdir(), 'gitlineage-zoom-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'chromium', headless: true, viewport: { width: 1280, height: 800 },
      ignoreDefaultArgs: ['--hide-scrollbars'],
    });
    try {
      const settings = await context.newPage();
      await settings.goto('chrome://settings/appearance');
      await settings.locator('#zoomLevel').selectOption('2');
      const page = await context.newPage();
      const errors: string[] = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      await page.goto(url);
      const zoom = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, dpr: devicePixelRatio, visualScale: visualViewport!.scale }));
      check('native browser 200% zoom verified', zoom.width === 640 && zoom.height === 400 && zoom.dpr === 2 && zoom.visualScale === 1, zoom);
      check('native 200% landing project link', await page.locator('#project-source').isVisible());
      await page.goto(`${url}/yunmin311/obsidian-config`);
      await page.locator('.plate-row-label').first().waitFor({ timeout: 180000 });
      await page.evaluate(() => document.fonts.ready);
      const accessible = await page.evaluate(() => {
        const visible = ['#search-btn','#layers-btn','#open-source','#rail-toggle','#zoom-in','#zoom-out','#zoom-fit'].every(s => {
          const e = document.querySelector(s)!, r = e.getBoundingClientRect();
          return r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest(s);
        });
        return visible && document.documentElement.scrollWidth <= innerWidth;
      });
      check('native 200% primary actions accessible without horizontal overflow', accessible);
      const base = await geometry(page);
      await page.locator('.plate-row-label').first().click();
      await page.locator('#rail-toggle').click();
      const both = await geometry(page);
      check('native 200% dual panels preserve screen mapping', same(base.ctm,both.ctm) && same(base.stage,both.stage) && same(base.subject,both.subject));
      await page.locator('#zoom-in').click();
      await page.locator('#zoom-out').click();
      const post = await geometry(page);
      check('native 200% zoom retains HUD and panel selection', same(both.hud,post.hud) && both.selection===post.selection && post.drawer && post.rail);
      await shot(page,'native-200-both-panels');
      await page.keyboard.press('Escape');
      check('native 200% Escape closes drawer', !(await geometry(page)).drawer);
      check('native 200% runtime errors', errors.length===0,errors);
      evidence['native-200'] = { zoom, base, both, post };
    } finally {
      await context.close();
      await rm(profile, { recursive:true, force:true });
    }
  }

} finally {
  await writeFile(`${out}/results.json`, JSON.stringify({ checks, evidence }, null, 2));
  await browser.close(); await new Promise<void>((r,j) => server.close(e => e ? j(e) : r()));
}
console.log(`${checks.filter(c=>c.ok).length}/${checks.length} UI contract checks passed`);
if (checks.some(c=>!c.ok)) process.exitCode=1;
