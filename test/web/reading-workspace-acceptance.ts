import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fixtureServer, A } from './fixture-server.ts';
import { unifiedFixture } from './unified-fixture.ts';

const f = unifiedFixture();
const app = await fixtureServer({ publicExploration: true, explorationCooldownMs: 0, phaseDelayMs: 0, explorationTransport: f.transport });
const browser = await chromium.launch();
await mkdir('artifacts/ui-polish', { recursive: true });
try {
  for (const width of [1920, 1280, 430, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 932 }, hasTouch: width < 768, isMobile: width < 768, reducedMotion: 'reduce' });
    page.setDefaultTimeout(12000);
    await page.goto(app.url);
    await page.screenshot({ path: `artifacts/ui-polish/${width}-landing.png`, fullPage: true });
    await page.locator('#landing').evaluate(n => { n.scrollTop = n.scrollHeight; });
    await page.screenshot({ path: `artifacts/ui-polish/${width}-landing-details.png` });
    await page.goto(app.url + '/' + A);
    await page.locator('#workspace-history').click();
    await page.locator('.history-row').first().waitFor();
    const more = await page.locator('#history-more').boundingBox();
    assert.ok(more && more.width <= 260, 'History pagination is a compact action, not a viewport-wide bar');
    await page.locator('.history-row').first().click();
    assert.equal(await page.locator('.history-technical[open]').count(), 0, 'Full SHA is available on demand');
    assert.equal(await page.locator('.history-detail code').textContent(), await page.locator('.history-row.is-selected').getAttribute('data-sha'));
    assert.equal(await page.locator('.history-detail').evaluate(n => n.scrollWidth > n.clientWidth), false, 'Commit details never overflow horizontally');
    await page.screenshot({ path: `artifacts/ui-polish/${width}-history.png` });
    await page.locator('#history-return').click();
    await page.locator('#canvas .node').first().focus();
    await page.keyboard.press('Enter');
    if (width < 768) await page.locator('#mobile-nav [data-mobile-view=evidence]').click();
    const heading = await page.locator('#drawer-inner').evaluate(n => {
      const close = n.querySelector('.drawer-close')!.getBoundingClientRect();
      const title = n.querySelector('.d-head')!.getBoundingClientRect();
      return { overlap: close.left < title.right && title.left < close.right && close.top < title.bottom && title.top < close.bottom, overflow: n.scrollWidth > n.clientWidth };
    });
    if (width >= 1600) {
      const sizes = await page.locator('#explorer').evaluate(n => ['#rail', '#drawer'].map(s => n.querySelector(s)!.getBoundingClientRect().width));
      assert.deepEqual(sizes, [320, 320], 'Navigation and Inspector use the same reading measure');
    }
    assert.equal(heading.overlap, false, 'Inspector title reserves a separate close-control row');
    assert.equal(heading.overflow, false);
    await page.screenshot({ path: `artifacts/ui-polish/${width}-inspector.png` });
    await page.close();
    console.log(`PASS reading workspace ${width}px`);
  }
} finally { await browser.close(); await app.cleanup(); }
