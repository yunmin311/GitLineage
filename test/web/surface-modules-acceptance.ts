/** Reading modules and native receipt interaction, using offline jobs only. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixtureServer, B } from './fixture-server.ts';
const app = await fixtureServer({ phaseDelayMs: 0 });
const browser = await chromium.launch();
const out = 'artifacts/modules';
await mkdir(out, { recursive: true });
const readings: unknown[] = [];
try {
 for (const width of [1920, 1280, 767, 430, 390]) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768 });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(app.url);
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('.trust-cell h3').count(), 3, 'Each evidence explanation has a navigable heading');
  await page.locator('#landing').evaluate(n => { n.scrollTop = n.scrollHeight; });
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {}))); });
  assert.equal(await page.locator('.samples a').count(), 2);
  await page.locator('.samples').scrollIntoViewIfNeeded();
  for (const link of await page.locator('.samples a').all()) {
   const box = await link.boundingBox(); assert.ok(box && box.width >= 44 && box.height >= 44, 'Project links have real touch targets');
   const hits = await link.evaluate(n => {
    const b = n.getBoundingClientRect();
    return [.1,.5,.9].flatMap(x => [.1,.5,.9].map(y => {
     const target = document.elementFromPoint(b.x + b.width*x, b.y + b.height*y);
     return target === n || n.contains(target);
    }));
   });
   assert.ok(hits.every(Boolean), 'Project link touch area remains unobstructed');
   await link.focus();
   assert.equal(await link.evaluate(n => n === document.activeElement), true, 'Project links remain keyboard reachable');
   assert.match(await link.getAttribute('href') ?? '', /^\/yunmin311\//, 'Public examples belong to the maintainer');
  }
  const landing = await page.locator('#landing').evaluate(n => ({ box:n.getBoundingClientRect().toJSON(),
   content:[...n.querySelectorAll('.reading-module,.hero-f,.hero-u,.site-foot')].map(e=>e.getBoundingClientRect().toJSON()) }));
  assert.ok(landing.box.right <= width + 1, 'The landing scroll surface fits the viewport');
  for (const box of landing.content) assert.ok(box.left >= 0 && box.right <= width + 1, 'Homepage copy, modules and headline stay inside the screen');
  await page.screenshot({ path: `${out}/${width}-landing-lower.png` });
  await page.locator('#landing').evaluate(n => { n.scrollTop = 0; });
  await page.screenshot({ path: `${out}/${width}-landing.png` });
  await page.route('**/api/analysis/' + B.toLowerCase(), r => r.fulfill({ status: 202, json: { jobId: 'modules', status: 'collecting', statusUrl: '/api/analysis/jobs/modules', retryAfterMs: 1500 } }));
  await page.route('**/api/analysis/jobs/modules', r => r.fulfill({ json: { jobId: 'modules', status: 'collecting', repository: B } }));
  await page.goto(`${app.url}/${B}?tracer-test=1`);
  await page.locator('.an-plabel').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('.an-work .an-plabel').count(), 5, 'Current phase and path belong to the same work module');
  const receipt = page.locator('.an-receipt'); const summary = receipt.locator('summary');
  assert.equal(await receipt.getAttribute('open'), null);
  await summary.focus(); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.an-receipt')?.hasAttribute('open'));
  await page.locator('#an-job').waitFor({ state: 'visible' });
  assert.match(await page.locator('#an-job').innerText(), /modules/, 'The job receipt is available through keyboard disclosure');
  // The current-stage pulse intentionally repeats; only finite entrances settle.
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().endTime !== Infinity).map(a => a.finished.catch(() => {}))); });
  const opened = await receipt.boundingBox();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.querySelector('.an-receipt')?.hasAttribute('open'));
  // CSS can create the closing transition after the next style update. Wait for
  // the painted closed height, rather than sampling getAnimations() too early.
  await page.waitForFunction(() => {
   const node = document.querySelector('.an-receipt')!;
   const heading = node.querySelector('summary')!;
   const css = getComputedStyle(node);
   const border = parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth);
   return Math.abs(node.getBoundingClientRect().height - heading.getBoundingClientRect().height - border) < .5;
  });
  const closed = await receipt.boundingBox(); assert.ok(opened && closed && opened.height > closed.height);
  assert.equal(await summary.evaluate(n => n === document.activeElement), true, 'Disclosure preserves keyboard focus');
  await page.screenshot({ path: `${out}/${width}-analysis.png` });
  const geometry = await page.locator('#analysis').evaluate(n => ({ width: innerWidth, scroll: n.scrollWidth, client: n.clientWidth,
   modules: [...n.querySelectorAll('.an-work,.an-grp,.an-tail > p')].map(e => e.getBoundingClientRect().toJSON()) }));
  for (const box of geometry.modules) assert.ok(box.left >= 0 && box.right <= width + 1, 'Modules stay inside the screen');
  if (width < 768) {
   // PR #6 stacks this surface with flex. grid-template-columns remains a
   // computed but inactive declaration; measure the actual occupied layout.
   const stack = await page.locator('.an-stage').evaluate(n => {
    const css = getComputedStyle(n);
    return { available: n.clientWidth - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight),
     children: [...n.children].map(e => e.getBoundingClientRect().toJSON()) };
   });
   for (const box of stack.children) assert.ok(Math.abs(box.width-stack.available)<1, 'Stacked modules occupy the content width without an empty sidebar');
   for (let i=1;i<stack.children.length;i++) assert.ok(stack.children[i]!.top>=stack.children[i-1]!.bottom, 'Stacked modules preserve reading order without overlap');
  }
  assert.ok(geometry.scroll <= geometry.client + 1, 'Analysis does not clip horizontal content');
  assert.deepEqual(errors, []); readings.push(geometry);
  await page.close();
 }
 await writeFile(`${out}/geometry.json`, JSON.stringify(readings, null, 2));
 console.log('PASS: five widths including the stacked-layout boundary, reading headings, project targets, receipt keyboard/focus, analysis module bounds.');
} finally { await browser.close(); await app.cleanup(); }
