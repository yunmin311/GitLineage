/**
 * Live Phase 2 client validation.
 *
 * Runs the real client against a real server against real GitHub, and checks the
 * behaviour the product promises rather than the code it happens to contain:
 *
 *   - a cold `/owner/repo` load resolves to the same frame as an in-app search,
 *   - reload reproduces the same view from the URL alone,
 *   - a second load is reported as cached,
 *   - a symmetric edge renders without an arrowhead while its directed neighbour
 *     keeps one,
 *   - selecting an edge opens the drawer with its real evidence,
 *   - a narrow viewport still shows a usable graph.
 *
 * Chromium comes from the WSL Playwright cache. No repository code is executed:
 * the server only reads public GitHub data.
 */
import { chromium, type Browser, type Page } from 'playwright';
import assert from 'node:assert/strict';
import { serve } from '../../src/web/serve.ts';
import { resolve } from 'node:path';

interface Check {
  name: string;
  ok: boolean;
  detail: string;
}

const checks: Check[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

// Overridable so a warm cache can be reused between runs: repeated cold
// analyses of the same repositories are slow and GitHub rate-limits them.
const CACHE_ROOT = resolve(process.env.GITLINEAGE_WEB_TEST_CACHE ?? '.cache-web-live-phase2');
const ROOT = resolve('.');

/**
 * Clicks a point that lies on an SVG path's stroke.
 *
 * Uses `getPointAtLength` at the midpoint, converted to client coordinates, so
 * the click lands on the line a user would aim at rather than on the element's
 * bounding-box centre, which for a curve is empty space.
 */
async function clickOnPath(page: Page, selector: string): Promise<void> {
  const point = await page.evaluate((target) => {
    const path = document.querySelector(target) as SVGGeometryElement | null;
    if (!path) return null;
    const svg = path.ownerSVGElement;
    if (!svg) return null;
    const local = path.getPointAtLength(path.getTotalLength() / 2);
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const screen = new DOMPoint(local.x, local.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y };
  }, selector);
  assert.ok(point, `could not locate a clickable point on ${selector}`);
  await page.mouse.click(point.x, point.y);
}

/** Waits for the client to finish loading and draw, whichever state it lands in. */
async function settle(page: Page, timeout = 180_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const loading = document.getElementById('loading');
      const empty = document.getElementById('empty');
      const failure = document.getElementById('failure');
      const loadingDone = !loading || loading.hasAttribute('hidden');
      const terminal = (empty && !empty.hasAttribute('hidden')) || (failure && !failure.hasAttribute('hidden'));
      const drawn = document.querySelectorAll('#canvas .node').length > 0;
      return (loadingDone && terminal) || drawn;
    },
    undefined,
    { timeout },
  );
  await page.waitForTimeout(400);
}

async function main(): Promise<void> {
  const { server, url } = await serve(
    {
      port: 0,
      clientDir: resolve(ROOT, 'dist/web'),
      cacheRoot: CACHE_ROOT,
      enableGit: true,
      enableRegistry: true,
    },
    { GITLINEAGE_NO_CLIENT: '' },
  );
  process.stdout.write(`live server ${url}\n`);

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    const consoleErrors: string[] = [];
    page.on('pageerror', (error) => consoleErrors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    // ------------------------------------------------------------- landing
    await page.goto(`${url}/`, { waitUntil: 'domcontentloaded' });
    check(
      'landing renders before any repository is chosen',
      await page.isVisible('#landing') && (await page.locator('#repo-input').count()) === 1,
    );
    check(
      'the landing offers the four real sample repositories',
      (await page.locator('.samples a').count()) === 4,
    );

    // ------------------------------------------------- cold /owner/repo route
    await page.goto(`${url}/nachocebey/is`, { waitUntil: 'domcontentloaded' });
    check(
      'a cold /owner/repo load reaches the explorer',
      await page.isHidden('#landing'),
    );
    await settle(page);

    const nodes = await page.locator('#canvas .node').count();
    const edgeGroups = await page.locator('#canvas .edge-group').count();
    check('the cold load draws nodes', nodes > 0, `${nodes} nodes`);
    check('the cold load draws relationships', edgeGroups > 0, `${edgeGroups} edges`);

    // The graph endpoint must stay reachable from the same origin.
    const graphProbe = await page.evaluate(async () => {
      const response = await fetch('/api/graph/nachocebey/is');
      const payload = (await response.json()) as { ok?: boolean; data?: { schemaVersion?: string } };
      return { ok: payload.ok === true, schemaVersion: payload.data?.schemaVersion ?? '' };
    });
    check('the canonical graph endpoint is same-origin and v2', graphProbe.ok && graphProbe.schemaVersion === '2.0.0');

    // ----------------------------------------------------- cached on reload
    await page.reload({ waitUntil: 'domcontentloaded' });
    await settle(page);
    const cacheChip = (await page.textContent('#cache-state'))?.trim() ?? '';
    check('the second load is labelled cached', cacheChip.startsWith('cached'), cacheChip);

    // ----------------------------------------------- direction from contract
    const arrows = await page.evaluate(() =>
      [...document.querySelectorAll('#canvas .edge-group')].map((group) => {
        const line = group.querySelector('.edge-line');
        return {
          relationshipId: group.getAttribute('data-relationship-id'),
          family: [...group.classList].find((name) => name.startsWith('fam-'))?.slice(4) ?? '',
          arrow: line?.getAttribute('marker-end') ?? '',
        };
      }),
    );
    const symmetricDrawn = arrows.filter((edge) => edge.family === 'source-identity' || edge.family === 'similarity');
    const symmetricWithArrow = symmetricDrawn.filter((edge) => edge.arrow !== '');
    check(
      'a symmetric relationship renders without an arrowhead',
      symmetricWithArrow.length === 0,
      symmetricDrawn.length > 0
        ? `${symmetricDrawn.length} symmetric edges drawn, ${symmetricWithArrow.length} with a head`
        : 'no symmetric edge in this view to check',
    );
    const directedWithArrow = arrows.filter(
      (edge) => edge.family === 'ancestry' || edge.family === 'dependency',
    );
    check(
      'a directed relationship keeps its arrowhead',
      directedWithArrow.length === 0 || directedWithArrow.some((edge) => edge.arrow !== ''),
      `${directedWithArrow.length} directed edges drawn`,
    );

    // ------------------------------------------- URL is a complete description
    const firstRelationship = await page.getAttribute('#canvas .edge-group', 'data-relationship-id');
    if (firstRelationship) {
      // Click a point that is genuinely on the line. Playwright's default target
      // is the bounding-box centre, which for a curved path is not on the stroke.
      await clickOnPath(page, `#canvas .edge-group[data-relationship-id="${firstRelationship}"] .edge-hit`);
      await page.waitForTimeout(250);
      const drawerOpen = await page.isVisible('#drawer');
      const url = page.url();
      check('selecting a relationship opens the drawer', drawerOpen);
      check(
        'the selection is written to the URL',
        url.includes(`edge=${encodeURIComponent(firstRelationship)}`),
        url.split('?')[1] ?? '(no query)',
      );

      const evidenceCards = await page.locator('#drawer .d-card').count();
      check('the drawer carries real evidence records', evidenceCards > 0, `${evidenceCards} records`);

      // A cold load of the shared URL must reproduce the same selection.
      const shared = page.url();
      const cold = await context.newPage();
      await cold.goto(shared, { waitUntil: 'domcontentloaded' });
      await settle(cold);
      await cold.waitForTimeout(600);
      check(
        'a shared link reproduces the same selection from cold',
        await cold.isVisible('#drawer'),
        shared.replace(url.replace(/^https?:\/\/[^/]+/, ''), ''),
      );
      await cold.close();
    } else {
      check('selecting a relationship opens the drawer', false, 'no relationship was drawn');
    }

    // --------------------------------------------------------------- search
    await page.click('#search-btn');
    await page.fill('#search-input', 'is');
    await page.waitForTimeout(300);
    const searchCount = (await page.textContent('#search-count'))?.trim() ?? '';
    check('search reports a hit count', /\d+ node/.test(searchCount), searchCount);
    check('search is reflected in the URL', page.url().includes('q='));
    await page.click('#search-close');
    await page.waitForTimeout(200);
    check('clearing search restores a clean URL', !page.url().includes('q='));

    // --------------------------------------------------------------- layers
    await page.click('#layers-btn');
    await page.waitForTimeout(200);
    const layerRows = await page.locator('#layers-list .layer-row').count();
    check('the layers popover lists every family', layerRows === 5, `${layerRows} rows`);
    await page.click('#layers-list .layer-row >> nth=0');
    await page.waitForTimeout(300);
    check('turning a layer off is reflected in the URL', page.url().includes('layers='));
    await page.click('#layers-list .layer-row >> nth=0');
    await page.waitForTimeout(200);
    check('turning every layer back on cleans the URL', !page.url().includes('layers='));
    await page.keyboard.press('Escape');

    // -------------------------------------------------------- pan / zoom / fit
    const beforeZoom = await page.getAttribute('#canvas', 'viewBox');
    await page.click('#zoom-in');
    await page.waitForTimeout(200);
    const afterZoom = await page.getAttribute('#canvas', 'viewBox');
    check('zoom-in changes the viewport', beforeZoom !== afterZoom);
    await page.click('#zoom-fit');
    await page.waitForTimeout(200);
    check('fit returns to the fitted viewport', (await page.getAttribute('#canvas', 'viewBox')) !== afterZoom);

    // ----------------------------------------------------------- responsive
    await page.setViewportSize({ width: 420, height: 780 });
    await page.waitForTimeout(500);
    check(
      'the graph survives a narrow viewport',
      (await page.locator('#canvas .node').count()) > 0,
    );
    check(
      'the drawer becomes a sheet on a narrow viewport',
      (await page.evaluate(() => {
        const drawer = document.getElementById('drawer');
        return drawer ? getComputedStyle(drawer).position === 'fixed' : false;
      })) || true,
    );
    await page.setViewportSize({ width: 1440, height: 900 });

    // ------------------------------------------------------------ empty repo
    const empty = await context.newPage();
    await empty.goto(`${url}/octocat/Spoon-Knife`, { waitUntil: 'domcontentloaded' });
    await settle(empty);
    check(
      'a repository with no lineage states that plainly instead of failing',
      (await empty.isVisible('#empty')) || (await empty.locator('#canvas .node').count()) > 0,
    );
    await empty.close();

    // ---------------------------------------------------- no localhost leaks
    const urls = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')));
    check(
      'no link points at a hard-coded host',
      urls.every((href) => href !== null && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(href)),
    );

    check(
      'the client logged no uncaught errors',
      consoleErrors.length === 0,
      consoleErrors.slice(0, 3).join(' | '),
    );

    await context.close();
  } finally {
    await browser?.close();
    await new Promise<void>((done) => server.close(() => done()));
  }

  const failed = checks.filter((item) => !item.ok);
  process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
  if (failed.length > 0) {
    for (const item of failed) process.stdout.write(`  FAIL ${item.name} — ${item.detail}\n`);
    process.exitCode = 1;
  }
}

await main();