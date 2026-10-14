import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fixtureServer } from './fixture-server.ts';

const { url, cleanup } = await fixtureServer({ phaseDelayMs: 0 });
const browser = await chromium.launch();
try {
  for (const width of [1920, 1280, 430, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 1080 } });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(url);
    const geometry = await page.evaluate(() => {
      const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
      return {
        input: rect('.field').height, submit: rect('#submit').height,
        trace: [...document.querySelectorAll('.hero-trace-node')].map(e => ({ x: e.getBoundingClientRect().x, y: e.getBoundingClientRect().y })),
        overflow: document.documentElement.scrollWidth - innerWidth,
        shortcut: document.querySelector('.foot')!.textContent,
      };
    });
    assert.equal(geometry.input, geometry.submit, 'input and primary action share a baseline and height');
    assert.equal(geometry.overflow, 0);
    assert.equal(await page.locator('.ld-inner').evaluate(e => e.getAnimations().length), 0, 'entry motion respects reduced motion');
    if (width < 768) {
      assert.equal(geometry.trace[0]!.y, geometry.trace[1]!.y, 'mobile example is a compact two-column summary');
      assert.notEqual(geometry.trace[0]!.x, geometry.trace[1]!.x);
    }
    assert.ok(!geometry.shortcut?.includes('gitlineage.com'), 'shortcut must not advertise an unused domain');
    console.log(`PASS reading surfaces ${width}px`);
    await page.close();
  }
} finally { await browser.close(); await cleanup(); }
