/**
 * Screenshot capture for the Web slice.
 *
 * Runs the real server against real GitHub data, drives the real client in a
 * headless browser, and writes PNGs. Run with `npm run shots`.
 *
 *   node test/web/screenshots.ts
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serve } from '../../src/web/serve.ts';

const SHOTS: { repository: string; name: string; note: string }[] = [
  { repository: 'nachocebey/is', name: '01-fork-shared-history-exact-content', note: 'fork + shared history + symmetric exact content' },
  { repository: 'vitest-dev/vitest', name: '02-declared-attribution-bundled', note: 'declared fork in README, 101 secondary edges bundled' },
  { repository: 'octocat/Spoon-Knife', name: '03-empty-strong-lineage', note: 'negative case: no evidence-backed lineage' },
];

const OUT = resolve('docs/screenshots');

async function main(): Promise<void> {
  const { server, url } = await serve({
    port: 4321,
    cacheRoot: '.cache-web-live',
    clientDir: 'src/web/client',
    depth: 200,
    maxCandidates: 12,
  });
  await mkdir(OUT, { recursive: true });

  let browser = null;
  try {
    const { chromium } = await loadPlaywright();
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
    const consoleErrors: string[] = [];
    page.on('console', (message: { type: () => string; text: () => string }) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error: unknown) => consoleErrors.push(String(error)));

    for (const shot of SHOTS) {
      const pageErrors: string[] = [];
      page.once('pageerror', (error: unknown) => pageErrors.push(String(error)));
      // `domcontentloaded`, not `networkidle`: a cold analysis can take minutes and
      // the page legitimately keeps the connection open while it waits.
      await page.goto(`${url}/${shot.repository}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      // Wait for either a drawn graph or a terminal empty/error state.
      await page
        .waitForFunction(
          `(() => {
            const canvas = document.getElementById('canvas');
            const empty = document.getElementById('empty');
            const error = document.getElementById('error');
            return (
              (canvas && canvas.childElementCount > 0) ||
              (empty && !empty.hasAttribute('hidden')) ||
              (error && !error.hasAttribute('hidden'))
            );
          })()`,
          { timeout: 900_000 },
        )
        .catch(() => pageErrors.push('timeout waiting for a terminal state'));

      const file = `${OUT}/${shot.name}.png`;
      await page.screenshot({ path: file });

      // Second capture with a relationship selected, to show the Evidence Drawer.
      let drawerShot: string | null = null;
      const hasEdge = await page.$('.edge-line');
      if (hasEdge) {
        // Click via the DOM rather than the mouse: SVG hit paths have no painted
        // geometry, so Playwright's visibility check is not meaningful here.
        await page.evaluate(`(() => {
          const group = document.querySelector('.edge-group');
          const hit = group && group.querySelector('.edge-hit');
          if (hit) hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        })()`);
        await page.waitForSelector('#drawer:not([hidden])', { timeout: 15_000 }).catch(() => {});
        drawerShot = `${OUT}/${shot.name}-evidence-drawer.png`;
        await page.screenshot({ path: drawerShot });
      }

      const metrics = (await page.evaluate(`(() => ({
          state: document.getElementById('state')?.textContent,
          statusLine: document.getElementById('status-line')?.textContent,
          nodes: document.querySelectorAll('.node').length,
          edges: document.querySelectorAll('.edge-line').length,
          arrowheads: document.querySelectorAll('[marker-end]').length,
          bundles: document.querySelectorAll('.bundle-row').length,
          horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          drawerEvidenceCards: document.querySelectorAll('.d-card').length,
          drawerQuotes: document.querySelectorAll('.d-quote').length,
        }))()`)) as {
        state: string;
        statusLine: string;
        nodes: number;
        edges: number;
        arrowheads: number;
        bundles: number;
        horizontalOverflow: boolean;
        drawerEvidenceCards: number;
        drawerQuotes: number;
      };

      process.stdout.write(`\n${shot.repository} — ${shot.note}\n`);
      process.stdout.write(`  state        ${metrics.state}\n`);
      process.stdout.write(`  status line  ${String(metrics.statusLine).replace(/\s+/g, ' ').trim()}\n`);
      process.stdout.write(`  svg nodes    ${metrics.nodes}\n`);
      process.stdout.write(`  svg edges    ${metrics.edges}\n`);
      process.stdout.write(`  arrowheads   ${metrics.arrowheads}\n`);
      process.stdout.write(`  bundle rows  ${metrics.bundles}\n`);
      process.stdout.write(`  drawer cards ${metrics.drawerEvidenceCards} (quotes ${metrics.drawerQuotes})\n`);
      process.stdout.write(`  h-overflow   ${metrics.horizontalOverflow}\n`);
      process.stdout.write(`  screenshot   ${file}\n`);
      if (drawerShot) process.stdout.write(`  drawer shot  ${drawerShot}\n`);
      if (pageErrors.length > 0) process.stdout.write(`  PAGE ERRORS  ${pageErrors.join(' | ')}\n`);
      if (consoleErrors.length > 0) process.stdout.write(`  CONSOLE      ${consoleErrors.join(' | ')}\n`);
    }
  } finally {
    if (browser) await browser.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
  process.stdout.write(`\nscreenshots written to ${OUT}\n`);
}

async function loadPlaywright(): Promise<{ chromium: { launch: () => Promise<any> } }> {
  try {
    return (await import('playwright')) as unknown as { chromium: { launch: () => Promise<any> } };
  } catch {
    throw new Error(
      'playwright is not installed. Install it with: npm i -D playwright && npx playwright install chromium',
    );
  }
}

await main();