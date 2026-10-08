/*
 * The stale-repository regression, re-checked on the real page.
 *
 * The brief asks for one specific transition to be proved end to end:
 *
 *     Explorer A -> submit B -> Analysis B (early, middle, late) -> complete -> Explorer B
 *
 * with no trace of A anywhere in B's frames: no identity, no counts, no evidence, no
 * revision, and no graph behind the surface.
 *
 * `showWorking()` clears the canvas and hides the drawer, but `state.view` is only
 * reassigned in `fetchView`, so during B's job the previous repository's view model is
 * still in memory. Whether that is visible is an empirical question, not a reading of the
 * code, and it is answered here by capturing every surface that could leak it.
 */
import { chromium, type Page } from 'playwright';
import { fixtureServer, A, B } from './fixture-server.ts';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'artifacts/slice3';
mkdirSync(OUT, { recursive: true });

const { url, cleanup } = await fixtureServer();
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const snapshot = async (tag: string) => {
  const s = await page.evaluate(`(() => {
    const t = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\\s+/g, ' ').trim();
    return {
      route: location.pathname,
      crumbRepo: t('#crumb-repo'),
      crumbCtx: t('#crumb-ctx'),
      crumbRev: t('#crumb-rev'),
      crumbCount: t('#crumb-count'),
      railText: t('.rail').slice(0, 200),
      stripText: t('#strip').slice(0, 300),
      canvasNodes: document.querySelectorAll('#canvas .node-box, #canvas .bundle-card-box').length,
      drawerHidden: document.querySelector('#drawer')?.hasAttribute('hidden') ?? null,
      bodyTextHasA: document.body.innerText.includes('${A}'),
      bodyTextHas97: /\\b97\\b/.test(document.body.innerText),
      phaseNow: (document.querySelector('.phase.is-current')?.textContent || '').replace(/\\s+/g,' ').trim(),
      jobPhase: t('#strip-job'),
      analysisVisible: !document.querySelector('#analysis')?.hasAttribute('hidden'),
      explorerVisible: !document.querySelector('#explorer')?.hasAttribute('hidden'),
      anKey: t('#an-pk'),
      anTitle: t('#an-ptitle'),
      anSub: t('#an-psub'),
      anRepo: t('#an-repo'),
      anJob: t('#an-job'),
      anSrc: t('#an-src'),
      anLabels: [...document.querySelectorAll('#an-plabels .an-plabel')].map((n) => n.textContent.replace(/\\s+/g,' ').trim()),
      anSegs: document.querySelectorAll('#an-svg .an-seg').length,
      anNow: document.querySelectorAll('#an-plabels .an-plabel.is-now').length,
      anDone: document.querySelectorAll('#an-plabels .an-plabel.is-done').length,
    };
  })()`) as Record<string, unknown>;
  writeFileSync(`${OUT}/stale-${tag}.json`, JSON.stringify(s, null, 1));
  return s;
};

// ---- 1. Explorer A
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.fill('#repo-input', A); await page.click('#submit');
await page.waitForSelector('svg .node-hit', { timeout: 180_000 });
await page.waitForTimeout(1500);
const onA = await snapshot('01-explorer-A');
await page.screenshot({ path: `${OUT}/stale-01-explorer-A.png` });

// ---- 2. submit B from A's explorer
await page.goBack();
await page.waitForSelector('#landing:not([hidden])', { timeout: 60_000 });
await page.fill('#repo-input', B);
await page.click('#submit');

// ---- 3. watch B's analysis, sampling every phase it reaches
const seen = new Map<string, Record<string, unknown>>();
const deadline = Date.now() + 240_000;
let shotIndex = 10;
while (Date.now() < deadline) {
  const s = await snapshot(`poll-${shotIndex}`);
  const phase = String(s.anKey || '');
  if (s.analysisVisible && phase && !seen.has(phase)) {
    seen.set(phase, s);
    await page.screenshot({ path: `${OUT}/stale-${String(shotIndex).padStart(2, '0')}-${phase.replace(/\W+/g, '_').slice(0, 28)}.png` });
  }
  if (phase.includes('complete') || /explorer/.test(String(s.route)) && Number(s.canvasNodes) > 0
      && !String(s.stripText || '').includes('analys')) break;
  if (Number(s.canvasNodes) > 0 && String(s.route) === `/${B}`) break;
  await page.waitForTimeout(700);
  shotIndex += 1;
}

const onB = await snapshot('99-explorer-B');
await page.screenshot({ path: `${OUT}/stale-99-explorer-B.png` });

// ---- the verdict, per phase of B
const leakReport = [...seen.entries()].map(([phase, s]) => ({
  phase,
  staleIdentity: String(s.crumbRepo).toLowerCase().includes(A.toLowerCase()),
  staleCounts: /97 one-hop|97 relationships/.test(String(s.crumbCount) + String(s.railText)),
  staleEvidence: /package_manifest|cargo:/.test(String(s.railText)),
  staleRevision: String(s.crumbRev).length > 0 && String(s.crumbRev) !== String(onB.crumbRev),
  graphBehindSurface: Number(s.canvasNodes) > 0,
  repo: String(s.crumbRepo),
}));

writeFileSync(`${OUT}/stale-report.json`, JSON.stringify(leakReport, null, 1));
console.log('phases observed during B:', [...seen.keys()].join(' | '));
console.log(JSON.stringify(leakReport, null, 1));
console.log('page errors:', errors.length ? errors.slice(0, 3).join(' | ') : 'none');

await browser.close();
await cleanup();
const failed = leakReport.some(r => r.staleIdentity || r.staleCounts || r.staleEvidence || r.staleRevision || r.graphBehindSurface);
const complete = String(onB.route).toLowerCase() === ('/' + B).toLowerCase() && Number(onB.canvasNodes) > 0;
const observed = ['resolving', 'collecting', 'resolving_relationships', 'validating', 'publishing'].every(p => [...seen.values()].some(s => String(s.anKey).endsWith(p)));
console.log('STALE verdict', { failed, complete, observed, errors });
if (failed || !complete || !observed || errors.length) process.exitCode = 1;
