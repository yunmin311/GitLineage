import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixtureServer, A, D } from './fixture-server.ts';
import { unifiedFixture } from './unified-fixture.ts';

const f = unifiedFixture();
const app = await fixtureServer({ publicExploration: true, explorationCooldownMs: 0, phaseDelayMs: 0, explorationTransport: f.transport });
const browser = await chromium.launch();
await mkdir('artifacts/history-polish', { recursive: true });
try {
 const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
 await page.goto(app.url + '/' + A);
 await page.locator('#workspace-history').waitFor();
 let release!: () => void;
 const gate = new Promise<void>(r => { release = r; });
 let fail = true, calls = 0;
 await page.route('**/api/explore', async route => {
   calls++;
   await gate;
   if (fail) await route.fulfill({ status: 503, json: { error: 'History fixture unavailable' } });
   else await route.continue();
 });
 await page.locator('#workspace-history').click();
 try {
   await page.locator('#git-history[aria-busy=true]').waitFor({ timeout: 1000 });
   assert.equal(await page.locator('#history-return').isVisible(), true, 'Pending history always offers a return path');
   await page.screenshot({ path: 'artifacts/history-polish/history-loading.png' });
 } finally { release(); }
 await page.locator('#history-retry').waitFor();
 assert.match(await page.locator('.history-load-message').innerText(), /History fixture unavailable/);
 fail = false;
 await page.locator('#history-retry').click();
 await page.locator('.history-row').first().waitFor();
 assert.equal(calls, 2, 'Retry performs one new request');
 await page.screenshot({ path: 'artifacts/history-polish/history-ready.png' });
 await page.locator('#history-return').click();
 await page.locator('#workspace-history').click();
 await page.locator('.history-row').first().waitFor();
 assert.equal(calls, 2, 'Reopening fixed history uses already loaded commits');
 await page.route('**/api/explore/*/history', route => route.fulfill({ status: 503, json: { error: 'Earlier history fixture unavailable' } }));
 const count = await page.locator('.history-row').count();
 await page.locator('#history-more').click();
 await page.locator('.history-footer-note').filter({ hasText: 'Earlier history fixture unavailable' }).waitFor();
 assert.equal(await page.locator('.history-row').count(), count, 'Pagination failure retains readable commits');
 assert.equal(await page.locator('#history-more').isEnabled(), true, 'Failed pagination can be retried');
 await page.locator('#history-return').click();
 await page.goto(app.url + '/' + D);
 if(await page.locator('#rail-toggle').getAttribute('aria-expanded')!=='true') await page.locator('#rail-toggle').click();
 await page.locator('.rail-reference > summary').filter({hasText:'Analysis details'}).click();
 const census = await page.locator('.rail-scroll .census').evaluate(n => {
   const rows = [...n.children].map(c => c.getBoundingClientRect());
   return rows.every((r, i) => i === 0 || r.top >= rows[i-1]!.bottom);
 });
 assert.ok(census, 'Relationship census has independent, nonoverlapping rows');
 await page.screenshot({path:'artifacts/history-polish/census.png'});
 await page.evaluate(() => sessionStorage.clear());
 await page.goto(app.url + '/' + A);
 let finish!: () => void;
 let pendingCalls=0;
 const delayed = new Promise<void>(r => { finish = r; });
 await page.route('**/api/explore', async route => { pendingCalls++;await delayed; await route.continue(); });
 await page.locator('#workspace-structure').click();
 await page.locator('#workspace-history').click();
 await page.locator('#git-history[aria-busy=true]').waitFor();
 await page.locator('#history-return').click();
 finish();
 await page.waitForResponse(r => r.url().includes('/api/explore/') && r.request().method()==='GET');
 await page.locator('#workspace-status').filter({hasText:'Objects added'}).waitFor();
 assert.equal(pendingCalls,1,'Structure and History share their in-flight repository read');
 assert.equal(await page.locator('#git-history').count(),0,'Returning while loading prevents a late history takeover');
 console.log('PASS immediate History, inline failure/retry, cached reopen, pagination recovery, census geometry');
} finally { await browser.close(); await app.cleanup(); }
