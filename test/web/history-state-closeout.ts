/** Targeted offline regressions for structured errors, late discovery starts and narrow readers. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium, type Page } from 'playwright';
import { fixtureServer, A, B } from './fixture-server.ts';
import { unifiedFixture } from './unified-fixture.ts';

const out = 'artifacts/history-state-closeout';
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
const failures: string[] = [], geometry: unknown[] = [];
function check(name: string, run: () => void) {
  try { run(); console.log('PASS', name); }
  catch (error) { failures.push(name + ': ' + (error as Error).message); console.error('FAIL', name); }
}
const bounds = (page: Page, selector: string) => page.locator(selector).evaluate(n => {
  const r = n.getBoundingClientRect();
  return { width: r.width, scroll: n.scrollWidth, client: n.clientWidth, left: r.left, right: r.right };
});
try {
  const limited = await fixtureServer({ publicExploration: true, phaseDelayMs: 0, explorationCooldownMs: 0, explorationTransport: unifiedFixture().transport });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    // The public service uses 429 for busy/frequency as well as depleted quota.
    // Its structured retryAt is authoritative; human wording need not contain an ISO date.
    await page.route('**/api/explore', route => route.fulfill({ status: 429, json: {
      error: 'Shared service busy; retry after current operation',
      quota: { spentAttempts: 1, attemptsPerHour: 1200, attemptsPerAddress: 120, resetAt: '2030-01-01T12:00:00.000Z', scope: 'offline fixture' },
      retryAt: '2030-01-01T11:00:00.000Z',
    } }));
    await page.goto(limited.url + '/' + A); await page.locator('#workspace-history').click();
    await page.locator('.history-load[role=alert]').waitFor();
    const message = await page.locator('.history-load-message').innerText(), awaitedTitle = await page.locator('.history-load-title').innerText();
    check('History displays the structured retry time without falsely claiming quota exhaustion', () => {
      assert.doesNotMatch(awaitedTitle, /anonymous limit reached/i);
      assert.match(message, /2030/);
      assert.doesNotMatch(message, /T11:00/);
    });
    await page.screenshot({ path: out + '/390-limited.png' });
    await page.close();
  } finally { await limited.cleanup(); }
  const boundedFixture = unifiedFixture();
  const bounded = await fixtureServer({ publicExploration: true, phaseDelayMs: 0, explorationCooldownMs: 0,
    explorationTransport: async (url, init) => new URL(String(url)).pathname === '/repos/kuddev/pebrel'
      ? new Response(JSON.stringify({ padding: 'x'.repeat(33000) })) : boundedFixture.transport(url, init),
  });
  try {
    const page = await browser.newPage();
    let outcome: string | undefined;
    await page.route(/\/api\/explore\/[a-f0-9]{24}$/, async route => {
      const response = await route.fetch(), task = await response.json();
      if (task.error) {
        outcome = task.receipt.requests.at(-1).request.outcome;
        // Keep the real provider receipt; the UI must not depend on diagnostic wording.
        task.error = 'Repository snapshot unavailable.';
      }
      await route.fulfill({ response, json: task });
    });
    await page.goto(bounded.url + '/' + A); await page.locator('#workspace-history').click();
    await page.locator('.history-load[role=alert]').waitFor();
    const message = await page.locator('.history-load-message').innerText();
    check('History explains actual response exhaustion from its receipt rather than error wording', () => {
      assert.equal(outcome, 'response_bytes_exhausted');
      assert.match(message, /request limit/);
    });
    await page.close();
  } finally { await bounded.cleanup(); }
  const longPath = 'src/' + 'long-module-name-'.repeat(16) + '.ts';
  const longRepository = 'repository-owner-name-with-39-characters/' + 'repository-name-'.repeat(6);
  for (const width of [390, 430]) {
    const app = await fixtureServer({ publicExploration: true, phaseDelayMs: 0, explorationCooldownMs: 0, explorationTransport: unifiedFixture().transport });
    try {
      const page = await browser.newPage({ viewport: { width, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
      // Replay the actual task envelope, changing only failure and long user-controlled content.
      await page.route(/\/api\/explore(?:\/[a-f0-9]{24})?$/, async route => {
        const response = await route.fetch(), task = await response.json();
        if (task.state !== 'running' && task.commits?.length) {
          task.error = 'Unavailable_' + 'very_long_provider_detail_'.repeat(24);
          task.repository = longRepository;
          task.commits[0].message = 'LongCommitMessage'.repeat(20);
          task.commits[0].author = 'LongAuthorName'.repeat(20);
          task.commits[0].changes[0].path = longPath;
        }
        await route.fulfill({ response, json: task });
      });
      await page.goto(app.url + '/' + A); await page.locator('#workspace-history').click();
      await page.locator('.history-row').first().waitFor();
      const heading = await bounds(page, '.history-heading');
      const returnTarget = await page.locator('#history-return').boundingBox();
      const documentOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      check(`${width}px long repository name leaves the History return control accessible`, () => {
        assert.ok(heading.scroll <= heading.client + 1 && !documentOverflow, JSON.stringify(heading));
        assert.ok(returnTarget && returnTarget.height >= 44 && returnTarget.x >= 0 && returnTarget.x + returnTarget.width <= width);
      });
      const warning = await bounds(page, '.history-warning');
      geometry.push({ width, warning });
      check(`${width}px partial History warning stays inside its reader`, () => assert.ok(warning.scroll <= warning.client + 1, JSON.stringify(warning)));
      const warningScroll = await page.locator('.history-warning').evaluate(n => {
        const height = n.getBoundingClientRect().height;
        n.scrollTop = 50;
        return { height, scrolled: n.scrollTop, touch: getComputedStyle(n).touchAction };
      });
      check(`${width}px long warning remains scrollable without consuming the History reader`, () => {
        assert.ok(warningScroll.height <= 844 * .2 + 1 && warningScroll.scrolled > 0, JSON.stringify(warningScroll));
        assert.equal(warningScroll.touch, 'pan-y');
      });
      await page.locator('.history-row').first().tap();
      const detail = await bounds(page, '.history-detail');
      geometry.push({ width, detail });
      check(`${width}px commit details wrap long messages, author and changed path`, () => assert.ok(detail.scroll <= detail.client + 1, JSON.stringify(detail)));
      await page.screenshot({ path: `${out}/${width}-long-history.png` });
      const file = page.locator('.history-detail button').filter({ hasText: longPath });
      await file.tap();
      await page.locator('#canvas .kind-file').waitFor({ state: 'attached' });
      await page.locator('[data-mobile-view=evidence]').tap();
      const source = page.locator('#drawer-inner .d-src');
      await source.waitFor();
      const inspector = await bounds(page, '#drawer-inner'), target = await source.boundingBox();
      geometry.push({ width, inspector, target });
      check(`${width}px Inspector long path remains readable with a usable source target`, () => {
        assert.ok(inspector.scroll <= inspector.client + 1, JSON.stringify(inspector));
        assert.ok(target && target.height >= 44 && target.x >= 0 && target.x + target.width <= width);
      });
      await page.screenshot({ path: `${out}/${width}-long-inspector.png` });
      await page.close();
    } finally { await app.cleanup(); }
  }
  const discovery = await fixtureServer({ publicExploration: true, phaseDelayMs: 0, explorationCooldownMs: 0, explorationTransport: unifiedFixture().transport });
  let release = () => {};
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    const gate = new Promise<void>(r => { release = r; });
    let arrived!: () => void;
    const started = new Promise<void>(r => { arrived = r; });
    let starts = 0;
    await page.route('**/api/deep-search/search', async route => {
      starts++; const response = await route.fetch(); arrived(); await gate; await route.fulfill({ response });
    });
    await page.goto(discovery.url + '/' + A); await page.locator('#workspace-candidates').click();
    await page.locator('#deep-search-submit').click(); await started;
    const disabled = await page.locator('#deep-search-submit').isDisabled();
    check('Discovery disables duplicate starts while the initial POST is pending', () => assert.equal(disabled, true));
    await page.locator('#deep-repository').evaluate(n => (n.closest('form') as HTMLFormElement).requestSubmit());
    await page.locator('.brand').click();
    await page.fill('#repo-input', B); await page.click('#submit');
    await page.locator('#workspace-history').waitFor();
    const lateResponse = page.waitForResponse(r => r.url().endsWith('/api/deep-search/search'));
    release();
    await lateResponse;
    // Let the old task's normal polling finish too, rather than asserting before it can arrive.
    await page.waitForTimeout(750);
    const state = await page.locator('#deep-status').getAttribute('data-state'), candidates = await page.locator('#deep-candidates input').count();
    check('Late Discovery start cannot replace another repository state', () => {
      assert.equal(state, 'ready'); assert.equal(candidates, 0); assert.equal(starts, 1);
    });
    await page.unroute('**/api/deep-search/search');
    await page.route('**/api/deep-search/search', route => route.fulfill({ status: 503, json: { error: 'Offline search unavailable' } }));
    if (!await page.locator('#deep-search-submit').isVisible()) await page.locator('#workspace-candidates').click();
    await page.locator('#deep-search-submit').click();
    await page.locator('#deep-status[data-state=failed]').waitFor();
    const retryEnabled = await page.locator('#deep-search-submit').isEnabled(), inputEnabled = await page.locator('#deep-repository').isEnabled();
    const failureMessage = await page.locator('#deep-status').innerText();
    check('A failed Discovery start unlocks input and allows retry', () => {
      assert.equal(retryEnabled, true); assert.equal(inputEnabled, true);
      assert.match(failureMessage, /Offline search unavailable/);
    });
    await page.screenshot({ path: out + '/discovery-return.png' });
    await page.close();
  } finally { release(); await discovery.cleanup(); }
  await writeFile(out + '/geometry.json', JSON.stringify(geometry, null, 2));
} finally { await browser.close(); }
assert.deepEqual(failures, []);
