/**
 * Screenshot capture for the Web slice.
 *
 * Runs the real server against real GitHub data, drives the real production
 * bundle in a headless browser, and writes PNGs plus a metrics line per capture.
 * Run with `npm run shots`.
 *
 *   node test/web/screenshots.ts
 *
 * What is captured, and why each frame earns its place:
 *
 *   - the landing, because that is what a first-time visitor sees;
 *   - a cold `/owner/repo` route, because URL-first is the product's promise;
 *   - the Evidence Drawer, because every edge must be checkable;
 *   - a search frame, because search is a primary navigation affordance;
 *   - the layers popover, because layer state lives in the URL;
 *   - a narrow viewport, because the drawer becomes a sheet there;
 *   - a repository with no lineage, because a negative result must read as a
 *     result rather than a failure.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { serve } from '../../src/web/serve.ts';

interface Shot {
  repository: string;
  name: string;
  note: string;
}

const SHOTS: Shot[] = [
  {
    repository: 'nachocebey/is',
    name: '01-fork-shared-history-exact-content',
    note: 'fork + shared history + symmetric exact content',
  },
  {
    repository: 'grpc/grpc',
    name: '02-submodules-and-shared-history',
    note: 'uses_submodule edges and shared history',
  },
  {
    repository: 'vitest-dev/vitest',
    name: '03-declared-attribution-bundled',
    note: 'declared attribution in a README, bulk edges bundled',
  },
  {
    repository: 'octocat/Spoon-Knife',
    name: '04-empty-strong-lineage',
    note: 'negative case: no evidence-backed lineage',
  },
];

const OUT = resolve('docs/screenshots');
const DESKTOP = { width: 1600, height: 1000 };
const PHONE = { width: 420, height: 780 };

interface Metrics {
  state: string;
  cacheChip: string;
  statusLine: string;
  nodes: number;
  edges: number;
  arrowheads: number;
  symmetricEdges: number;
  bundles: number;
  horizontalOverflow: boolean;
  drawerEvidenceCards: number;
  drawerQuotes: number;
}

async function waitForTerminal(page: import('playwright').Page, timeout = 900_000): Promise<void> {
  // `domcontentloaded`, not `networkidle`: a cold analysis can take minutes and
  // the page legitimately holds the connection open while it waits.
  await page.waitForFunction(
    () => {
      const canvas = document.getElementById('canvas');
      const empty = document.getElementById('empty');
      const failure = document.getElementById('failure');
      return (
        (canvas && canvas.querySelectorAll('.node').length > 0) ||
        (empty && !empty.hasAttribute('hidden')) ||
        (failure && !failure.hasAttribute('hidden'))
      );
    },
    undefined,
    { timeout },
  );
  await page.waitForTimeout(500);
}

async function readMetrics(page: import('playwright').Page): Promise<Metrics> {
  return page.evaluate(() => {
    const groups = [...document.querySelectorAll('#canvas .edge-group')];
    const isSymmetricFamily = (group: Element) =>
      [...group.classList].some((name) => name === 'fam-source-identity' || name === 'fam-similarity');
    return {
      state: document.getElementById('cache-state')?.textContent?.trim() ?? '',
      cacheChip: document.getElementById('cache-state')?.textContent?.trim() ?? '',
      statusLine: document.getElementById('status-line')?.textContent ?? '',
      nodes: document.querySelectorAll('#canvas .node').length,
      edges: document.querySelectorAll('#canvas .edge-line').length,
      arrowheads: groups.filter((group) => group.querySelector('.edge-line')?.getAttribute('marker-end')).length,
      symmetricEdges: groups.filter(isSymmetricFamily).length,
      bundles: document.querySelectorAll('.bundle-row').length,
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      drawerEvidenceCards: document.querySelectorAll('#drawer .d-card').length,
      drawerQuotes: document.querySelectorAll('#drawer .d-quote').length,
    };
  });
}

async function main(): Promise<void> {
  const { server, url } = await serve({
    port: 4321,
    // Overridable so a warm cache can be reused between capture runs: a cold
    // analysis of a large repository takes minutes, and GitHub rate-limits
    // repeated cold analyses of the same repositories.
    cacheRoot: process.env.GITLINEAGE_SHOT_CACHE ?? '.cache-web-live',
    // The production bundle, not the unbundled source: a screenshot of the source
    // tree is not evidence that the shipped artefact works.
    clientDir: 'dist/web',
    depth: 200,
    maxCandidates: 12,
  });
  await mkdir(OUT, { recursive: true });
  process.stdout.write(`screenshots from ${url}\n`);

  const { chromium } = await import('playwright');
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    // ---------------------------------------------------------------- landing
    await page.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#landing:not([hidden])', { timeout: 30_000 });
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/00-landing.png` });
    process.stdout.write(`\nlanding\n  screenshot   ${OUT}/00-landing.png\n`);

    for (const shot of SHOTS) {
      // A 502 is a real outcome for one repository in this set, so it is
      // reported with its status rather than crashing the whole capture run.
      let terminalStatus = 0;
      const consoleErrorsForShot: string[] = [];
      const onError = (error: unknown) => consoleErrorsForShot.push(String(error));
      page.on('pageerror', onError);
      await page.goto(`${url}/${shot.repository}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await waitForTerminal(page);
      terminalStatus = await page.evaluate(() =>
        document.getElementById('failure') && !document.getElementById('failure')!.hasAttribute('hidden') ? 1 : 0,
      );
      page.off('pageerror', onError);

      const file = `${OUT}/${shot.name}.png`;
      await page.screenshot({ path: file });
      const metrics = await readMetrics(page);

      process.stdout.write(`\n${shot.repository} — ${shot.note}\n`);
      if (terminalStatus === 1) {
        const body = (await page.textContent('#failure-body'))?.trim() ?? '';
        process.stdout.write(`  STATE        failed — ${body.slice(0, 200)}\n`);
        process.stdout.write(`  screenshot   ${file}\n`);
        continue;
      }
      process.stdout.write(`  cache chip   ${metrics.cacheChip}\n`);
      process.stdout.write(
        `  status line  ${metrics.statusLine.replace(/\s+/g, ' ').trim().slice(0, 150)}\n`,
      );
      process.stdout.write(`  svg nodes    ${metrics.nodes}\n`);
      process.stdout.write(`  svg edges    ${metrics.edges} (arrowheads ${metrics.arrowheads}, symmetric ${metrics.symmetricEdges})\n`);
      process.stdout.write(`  bundle rows  ${metrics.bundles}\n`);
      process.stdout.write(`  h-overflow   ${metrics.horizontalOverflow}\n`);
      process.stdout.write(`  screenshot   ${file}\n`);

      // The Evidence Drawer, selected through a real click on the line itself.
      const group = await page.$('#canvas .edge-group');
      if (group) {
        await clickOnPath(page, '#canvas .edge-group .edge-hit');
        await page.waitForSelector('#drawer:not([hidden])', { timeout: 20_000 }).catch(() => {});
        const drawerShot = `${OUT}/${shot.name}-evidence-drawer.png`;
        await page.screenshot({ path: drawerShot });
        const withDrawer = await readMetrics(page);
        process.stdout.write(
          `  drawer       ${withDrawer.drawerEvidenceCards} cards (${withDrawer.drawerQuotes} quotes)\n`,
        );
        process.stdout.write(`  drawer shot  ${drawerShot}\n`);

        // Search, with the drawer still open: proves both coexist.
        await page.click('#search-btn');
        await page.fill('#search-input', 'history');
        await page.waitForTimeout(400);
        const searchShot = `${OUT}/${shot.name}-search.png`;
        await page.screenshot({ path: searchShot });
        process.stdout.write(
          `  search       ${(await page.textContent('#search-count'))?.trim() ?? ''}\n`,
        );
        process.stdout.write(`  search shot  ${searchShot}\n`);
        await page.click('#search-close');
        await page.keyboard.press('Escape');

        // Layers, because layer state is part of the shared URL.
        await page.click('#layers-btn');
        await page.waitForSelector('#layers-pop:not([hidden])', { timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(250);
        const layersShot = `${OUT}/${shot.name}-layers.png`;
        await page.screenshot({ path: layersShot });
        process.stdout.write(`  layers shot  ${layersShot}\n`);
        await page.keyboard.press('Escape');
      }

      // Responsive: the same frame at phone width, where the drawer is a sheet.
      await page.setViewportSize(PHONE);
      await page.waitForTimeout(700);
      const phoneShot = `${OUT}/${shot.name}-phone.png`;
      await page.screenshot({ path: phoneShot });
      const phoneMetrics = await readMetrics(page);
      process.stdout.write(
        `  phone        nodes ${phoneMetrics.nodes}, h-overflow ${phoneMetrics.horizontalOverflow}\n`,
      );
      process.stdout.write(`  phone shot   ${phoneShot}\n`);
      await page.setViewportSize(DESKTOP);
      await page.waitForTimeout(300);
    }

    if (consoleErrors.length > 0) {
      process.stdout.write(`\nCONSOLE ERRORS\n${[...new Set(consoleErrors)].join('\n')}\n`);
      process.exitCode = 1;
    }
  } finally {
    await browser?.close();
    await new Promise<void>((done) => server.close(() => done()));
  }
  process.stdout.write(`\nscreenshots written to ${OUT}\n`);
}

/**
 * Clicks a point that lies on an SVG path's stroke, at its midpoint. Playwright's
 * default target is the bounding-box centre, which for a curve is empty space.
 */
async function clickOnPath(page: import('playwright').Page, selector: string): Promise<void> {
  const point = await page.evaluate((target) => {
    const path = document.querySelector(target) as SVGGeometryElement | null;
    if (!path || !path.ownerSVGElement) return null;
    const local = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = path.ownerSVGElement.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, selector);
  if (!point) return;
  await page.mouse.click(point.x, point.y);
}

await main();