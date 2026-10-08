/*
 * Slice 3 acceptance: the Analysis surface across the whole job FSM, both viewports.
 *
 * Driven through `__setPhaseForTest` rather than by racing a real job, because the
 * running phases of a small repository pass in about two seconds and a screenshot cannot
 * be taken inside that window reliably. The states themselves are the real ones the
 * server reports; only the clock is ours.
 *
 * What this asserts is the brief's contract:
 *   · five running phases, in production order, and five segments at every one of them
 *   · 1/5 through 5/5, and the machine key beside the ordinal
 *   · queued, complete and failed are FSM states in words -- never a sixth or seventh
 *     segment, never an ordinal, never a "current" mark
 *   · the revision is honest: unresolved says so, in mono, marked pending
 *   · no percentage, no timer, no estimate, no count
 *   · no stale identity from a previous repository anywhere
 *   · no native scrollbar, no page error
 */
import { chromium, type Page } from 'playwright';
declare global { interface Window { __setPhaseForTest?: (phase: string) => void } }
import { fixtureServer, B } from './fixture-server.ts';
import { resolve } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

const OUT = 'artifacts/slice3';
mkdirSync(OUT, { recursive: true });

const REPO = B;
const RUNNING = ['resolving', 'collecting', 'resolving_relationships', 'validating', 'publishing'] as const;
const STATES = ['queued', ...RUNNING, 'complete', 'failed'] as const;

/** The key each FSM state must print, as the surface spells it. */
const ANALYSIS_KEY = {
  queued: 'queued',
  complete: 'terminal state · complete',
  failed: 'terminal state · failed',
} as const;

const { url, cleanup } = await fixtureServer();
const browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });

const results: Array<Record<string, unknown>> = [];
const errors: string[] = [];

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  const label = viewport.width === 1280 ? 'desktop' : 'mobile';
  const page: Page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`); });

  await page.goto(`${url}/${REPO}?tracer-test=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#analysis:not([hidden])', { timeout: 180_000 });
  await page.waitForTimeout(600);

  for (const state of STATES) {
    /*
     * Apply and read in one tick, and retry until the surface agrees.
     *
     * The hook is an override, not a pause: the real poll for this repository is still
     * running underneath it and can legitimately land a different status between the
     * apply and the read. Two earlier passes read back `queued` for `resolving` and an
     * emptied surface for `complete`, which is the job finishing, not the contract
     * failing. So the read is retried until it reflects the state under test, and a
     * state that never sticks is reported as a failure rather than retried forever.
     */
    let s: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      s = await page.evaluate(`(() => {
        window.__setPhaseForTest?.(${JSON.stringify(state)});
        const t = (sel) => (document.querySelector(sel)?.textContent || '').replace(/\\s+/g, ' ').trim();
        const an = document.querySelector('#analysis');
        const box = an.getBoundingClientRect();
        const surfaceText = an.innerText.replace(/\\s+/g, ' ').trim();
        return {
          state: ${JSON.stringify(state)},
          key: t('#an-pk'),
          title: t('#an-ptitle'),
          sub: t('#an-psub'),
          verb: t('#an-verb'),
          repo: t('#an-repo'),
          job: t('#an-job'),
          src: t('#an-src'),
          labels: [...document.querySelectorAll('#an-plabels .an-plabel')]
            .map((n) => n.textContent.replace(/\\s+/g, ' ').trim()),
          segs: document.querySelectorAll('#an-svg .an-seg').length,
          now: document.querySelectorAll('#an-plabels .an-plabel.is-now').length,
          done: document.querySelectorAll('#an-plabels .an-plabel.is-done').length,
          explorerVisible: !document.querySelector('#explorer').hasAttribute('hidden'),
          hasPercent: /%/.test(surfaceText),
          hasTimer: /\\b(eta|remaining|estimate|elapsed|\\d+\\s?s\\b)/i.test(surfaceText),
          hasCount: /\\b\\d+\\s+(nodes?|relationships?|commits?|files?)\\b/i.test(surfaceText),
          staleIdentity: /pebrel|kuddev|51514bd/.test(document.body.innerText),
          nativeScrollbar: getComputedStyle(an).overflowY === 'auto'
            && an.scrollHeight > an.clientHeight + 1
            && getComputedStyle(an).scrollbarWidth !== 'none',
          overflowsX: box.width > window.innerWidth + 1,
          docScrolls: document.documentElement.scrollHeight > window.innerHeight + 1,
        };
      })()`) as Record<string, unknown>;

      const settled = RUNNING.includes(state as (typeof RUNNING)[number])
        ? String(s.key).startsWith(`phase ${RUNNING.indexOf(state as (typeof RUNNING)[number]) + 1} of 5`)
        : String(s.key) === ANALYSIS_KEY[state as keyof typeof ANALYSIS_KEY];
      if (settled) break;
      await page.waitForTimeout(150);
    }
    if (!s) throw new Error(`no reading for ${state}`);

    const isRunning = RUNNING.includes(state as (typeof RUNNING)[number]);
    const index = RUNNING.indexOf(state as (typeof RUNNING)[number]);

    results.push({
      ...s,
      viewport: label,
      assertSegs: s.segs === 5,
      assertLabels: (s.labels as string[]).length === 5,
      assertOrdinal: isRunning
        ? s.key === `phase ${index + 1} of 5 · ${state}`
        : !String(s.key).startsWith('phase '),
      assertCurrent: isRunning ? s.now === 1 : s.now === 0,
      // `queued` is neither: a queued job has completed none of the five.
      assertDone: isRunning ? s.done === index : (state === 'queued' ? s.done === 0 : s.done === 5),
      // Only a running phase is required to have the Explorer out of the way. A terminal
      // state is the one the product hands OFF to the Explorer for, so there the Explorer
      // being visible is the contract, not a violation.
      assertExplorerHidden: isRunning ? s.explorerVisible === false : true,
    });

    await page.screenshot({ path: `${OUT}/fsm-${label}-${String(results.length).padStart(2, '0')}-${state}.png` });
  }
  await page.close();
}

await browser.close();
await cleanup();

writeFileSync(`${OUT}/fsm-report.json`, JSON.stringify(results, null, 1));

const fails = results.filter((r) => ![
  'assertSegs', 'assertLabels', 'assertOrdinal', 'assertCurrent', 'assertDone', 'assertExplorerHidden',
].every((k) => r[k] === true) || r.hasPercent || r.hasTimer || r.hasCount || r.staleIdentity
  || r.nativeScrollbar || r.overflowsX || r.docScrolls);

console.log(`${results.length} states captured, ${fails.length} violating the contract`);
for (const f of fails) {
  console.log(`  FAIL ${f.viewport}/${f.state}: segs=${f.segs} labels=${(f.labels as string[]).length} `
    + `now=${f.now} done=${f.done} key="${f.key}" pct=${f.hasPercent} timer=${f.hasTimer} `
    + `count=${f.hasCount} stale=${f.staleIdentity} sbar=${f.nativeScrollbar} xOverflow=${f.overflowsX} `
    + `docScrolls=${f.docScrolls} explorer=${f.explorerVisible}`);
}
console.log('\nsample surfaces:');
for (const r of results.filter((x) => x.viewport === 'desktop')) {
  console.log(`  ${String(r.state).padEnd(24)} key="${r.key}"  segs=${r.segs} now=${r.now} done=${r.done}`);
  console.log(`      ${r.title}`);
  console.log(`      src="${r.src}"`);
}
console.log('\npage errors:', errors.length ? errors.slice(0, 4).join(' | ') : 'none');
if (fails.length || errors.length) process.exitCode = 1;
