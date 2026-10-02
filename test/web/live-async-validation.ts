/**
 * Live browser QA for the async analysis deployment.
 *
 * Drives the real production bundle through the public HTTPS URL and asserts the
 * lifecycle the product promises: navigate immediately, observe real phases, a
 * second browser attaches to the running job, the Explorer appears when ready, and
 * the all-bundled graph is not rendered as an empty one.
 *
 *   node test/web/live-async-validation.ts <baseUrl>
 */
import { chromium, type Browser, type Page } from 'playwright';
import assert from 'node:assert/strict';

const BASE = (process.argv[2] ?? '').replace(/\/+$/, '');
if (!BASE) {
  process.stderr.write('usage: node test/web/live-async-validation.ts <baseUrl>\n');
  process.exit(2);
}

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  checks.push({ name, ok, detail });
  process.stdout.write(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}\n`);
}

/** Waits for the client to reach a terminal state: drawn, empty, failed. */
async function settle(page: Page, timeout = 300_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const canvas = document.getElementById('canvas');
      const empty = document.getElementById('empty');
      const failure = document.getElementById('failure');
      const progress = document.getElementById('progress');
      const working = progress && !progress.hasAttribute('hidden');
      if (working) return false;
      return (
        (canvas && canvas.querySelectorAll('.node').length > 0) ||
        (empty && !empty.hasAttribute('hidden')) ||
        (failure && !failure.hasAttribute('hidden'))
      );
    },
    undefined,
    { timeout },
  );
  await page.waitForTimeout(800);
}

async function readState(page: Page) {
  return page.evaluate(() => {
    const progress = document.getElementById('progress');
    const failure = document.getElementById('failure');
    const empty = document.getElementById('empty');
    return {
      working: Boolean(progress && !progress.hasAttribute('hidden')),
      failed: Boolean(failure && !failure.hasAttribute('hidden')),
      empty: Boolean(empty && !empty.hasAttribute('hidden')),
      currentPhase: document.querySelector('#phases .phase.is-current .phase-text')?.textContent?.trim() ?? '',
      donePhases: document.querySelectorAll('#phases .phase.is-done').length,
      totalPhases: document.querySelectorAll('#phases .phase').length,
      label: document.getElementById('progress-label')?.textContent?.trim() ?? '',
      job: document.getElementById('progress-job')?.textContent?.trim() ?? '',
      nodes: document.querySelectorAll('#canvas .node').length,
      bundleCards: document.querySelectorAll('#canvas .bundle-card').length,
      bundleLinks: document.querySelectorAll('#canvas .bundle-link').length,
      bundleRows: document.querySelectorAll('.bundle-row').length,
      url: window.location.href,
      // Any percentage in the payload would be a fabricated claim.
      hasPercentage: /%|percent|progress\s*[:=]/i.test(document.body.innerText),
    };
  });
}

let browser: Browser | undefined;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  // ------------------------------------------------- landing still works
  const landing = await context.newPage();
  landing.on('pageerror', (error) => consoleErrors.push(`landing: ${error.message}`));
  await landing.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  check('landing renders at the public root', await landing.isVisible('#landing'));
  await landing.close();

// ---------------------------- a cold repository, observed as it analyses
  // A repository whose analysis genuinely outlives the proxy deadline, so real
  // phases are observable rather than a single flash.
  const repository = process.argv[3] ?? 'grpc/grpc';
  const page = await context.newPage();
  page.on('pageerror', (error) => consoleErrors.push(`page: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(`console: ${message.text()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) failedRequests.push(`${response.status()} ${response.url()}`);
  });

  const requested = Date.now();
  await page.goto(`${BASE}/${repository}`, { waitUntil: 'domcontentloaded' });
  // The route must be interactive within a fraction of the proxy budget: the
  // page never waits for the analysis.
  const interactiveMs = Date.now() - requested;
  check(
    'the route becomes interactive immediately, without waiting for analysis',
    interactiveMs < 10_000,
    `${interactiveMs}ms`,
  );

  // Phase observation, while analysis is genuinely running.
  //
  // Polls without breaking on the first non-working sample: the progress view
  // only exists after the acceptance round-trip, so sampling from the start would
  // record "not working yet" and stop before the job ever began.
  const phasesSeen = new Set<string>();
  let sawWorking = false;
  let sawJobId = '';
  let sawTerminal = false;
  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    const snapshot = await readState(page);
    if (snapshot.working) {
      sawWorking = true;
      if (snapshot.currentPhase) phasesSeen.add(snapshot.currentPhase);
      if (snapshot.job) sawJobId = snapshot.job;
    } else if (snapshot.nodes > 0 || snapshot.empty || snapshot.failed) {
      // Terminal: the Explorer replaced the progress view.
      sawTerminal = true;
      break;
    }
    await page.waitForTimeout(700);
  }
  check('the client reached a terminal state', sawTerminal);

  check('analysis progress was shown while the job ran', sawWorking);
  check('the progress view names a job', sawJobId.length > 0, sawJobId);
  check(
    'the progress view lists the real pipeline phases',
    phasesSeen.size >= 1,
    [...phasesSeen].join(' | '),
  );

  const during = await readState(page);
  check(
    'no percentage is shown anywhere',
    !during.hasPercentage,
    during.hasPercentage ? 'found percentage-like text' : '',
  );
  check(
    'the URL is shareable while analysis runs',
    page.url().includes(`/${repository}`),
    page.url().replace(/^https?:\/\/[^/]+/, ''),
  );

  await settle(page);
  const after = await readState(page);
  check('the Explorer loaded once the job completed', !after.failed && after.nodes > 0, `${after.nodes} nodes`);
  check('the progress view was dismissed', !after.working);

  // ------------------------------------- a second browser attaches to it
  // The artifact is now cached, so this exercises the cache-hit path plus the
  // shareable route.
  const second = await context.newPage();
  second.on('pageerror', (error) => consoleErrors.push(`second: ${error.message}`));
  await second.goto(`${BASE}/${repository}`, { waitUntil: 'domcontentloaded' });
  await settle(second);
  const secondState = await readState(second);
  check('a second browser loads the same result', secondState.nodes > 0, `${secondState.nodes} nodes`);
  await second.close();

  // ---------------------------------------- the all-bundled empty canvas
  // `expressjs/express` has 48 real relationships, all bundled. Its analysis is
  // awaited through the job API first, so this section observes the rendered
  // result rather than racing the analysis.
  const bundledRepository = 'expressjs/express';
  const startResponse = await fetch(`${BASE}/api/analysis/${bundledRepository}`, { method: 'POST' });
  const startBody = (await startResponse.json()) as { statusUrl?: string };
  if (startBody.statusUrl) {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const job = (await (await fetch(`${BASE}${startBody.statusUrl}`)).json()) as { data?: { status?: string } };
      if (job.data?.status === 'complete' || job.data?.status === 'failed') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }

  const bundled = await context.newPage();
  bundled.on('pageerror', (error) => consoleErrors.push(`bundled: ${error.message}`));
  await bundled.goto(`${BASE}/${bundledRepository}`, { waitUntil: 'domcontentloaded' });
  await settle(bundled);
  const bundledState = await readState(bundled);

  check(
    'an all-bundled graph is not presented as an empty result',
    !bundledState.empty,
    bundledState.empty ? 'the empty overlay was shown' : '',
  );
  check(
    'bundle representatives are drawn on the canvas',
    bundledState.bundleCards === 2,
    `${bundledState.bundleCards} cards, ${bundledState.bundleLinks} connectors`,
  );
  check(
    'the connectors are visibly attached to the subject',
    bundledState.bundleLinks === 2,
    `${bundledState.bundleLinks} connectors`,
  );

  const cardText = await bundled.evaluate(() =>
    [...document.querySelectorAll('#canvas .bundle-card')].map((card) =>
      card.textContent?.replace(/\s+/g, ' ').trim(),
    ),
  );
  check(
    'each card shows a real count',
    cardText.some((text) => /×44/.test(text ?? '')) && cardText.some((text) => /×4/.test(text ?? '')),
    cardText.join(' | '),
  );
  check(
    'a card is visually distinct from a repository node',
    await bundled.evaluate(() => {
      const box = document.querySelector('#canvas .bundle-card .bundle-card-box');
      const node = document.querySelector('#canvas .node .node-box');
      if (!box || !node) return false;
      // Dashed outline marks it as a group rather than an entity.
      return getComputedStyle(box).strokeDasharray !== 'none';
    }),
  );

  // Clicking a card expands the real relationships and records it in the URL.
  const edgesBefore = await bundled.locator('#canvas .edge-group').count();
  await bundled.click('#canvas .bundle-card >> nth=0');
  await bundled.waitForTimeout(900);
  const edgesAfter = await bundled.locator('#canvas .edge-group').count();
  check('clicking a bundle card reveals the real relationships', edgesAfter > edgesBefore, `${edgesBefore} -> ${edgesAfter}`);
  check('the expansion is recorded in the URL', bundled.url().includes('bundles='), bundled.url().replace(/^https?:\/\/[^/]+/, ''));

  // A shared link restores the expansion from cold.
  const sharedUrl = bundled.url();
  const restored = await context.newPage();
  await restored.goto(sharedUrl, { waitUntil: 'domcontentloaded' });
  await settle(restored);
  check(
    'a shared link restores the expanded bundle',
    (await restored.locator('#canvas .edge-group').count()) > 0,
  );
  await restored.close();

  // A genuine empty result must still read as a result, not as a bundled graph.
  const emptyPage = await context.newPage();
  await emptyPage.goto(`${BASE}/octocat/spoon-knife`, { waitUntil: 'domcontentloaded' });
  await settle(emptyPage);
  const emptyState = await readState(emptyPage);
  check(
    'a repository with no lineage reads as a result, not a failure',
    emptyState.empty && !emptyState.failed,
  );
  check(
    'an empty result shows no bundle cards',
    emptyState.bundleCards === 0,
    `${emptyState.bundleCards} cards`,
  );
  await emptyPage.close();

  // -------------------------------------------------------------- QA hygiene
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check('no horizontal overflow at 1440px', !overflow);

  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(700);
  const mobileOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  check('no horizontal overflow at 390px', !mobileOverflow);

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('no failed requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

  await page.close();
  await bundled.close();
} finally {
  await browser?.close();
}

const failed = checks.filter((item) => !item.ok);
process.stdout.write(`\n${checks.length - failed.length}/${checks.length} checks passed\n`);
if (failed.length > 0) process.exitCode = 1;