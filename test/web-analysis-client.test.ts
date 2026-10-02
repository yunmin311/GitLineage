/**
 * Client-side tests for the async analysis lifecycle and the bundle
 * representative cards.
 *
 * Two properties are load-bearing and are checked here rather than by reading
 * the DOM: the client never fabricates progress, and a graph whose relationships
 * are all bundled is never rendered as if it had none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ANALYSIS_PHASES as CLIENT_PHASES,
  VISIBLE_PHASES,
  PHASE_TEXT,
  isTerminal,
  isAnalysisPhase,
  parseStart,
  parseJob,
  shouldPoll,
  nextDelayMs,
  phaseIndex,
  refusalText,
} from '../src/web/client/lib/analysis.mjs';
import { orphanBundles, hasDrawnEdges, allLayersOn, visibleEdges } from '../src/web/client/lib/search.mjs';
import { ANALYSIS_PHASES as SERVER_PHASES } from '../src/web/analysis/types.ts';
import type { AnalysisPhase } from '../src/web/client/lib/analysis.mjs';
import type { ViewGraph, ViewEdge, ViewBundle, ViewNode } from '../src/web/view-model.ts';

// ------------------------------------------------------------ phase agreement

test('the browser phase list matches the server state machine exactly', () => {
  // Duplicated on purpose across the Node/browser boundary; the duplication is
  // only safe if a test proves they agree.
  assert.deepEqual([...CLIENT_PHASES], [...SERVER_PHASES]);
  for (const phase of SERVER_PHASES) {
    assert.ok(isAnalysisPhase(phase), `${phase} is recognised by the client`);
    assert.ok(isTerminal(phase) === (phase === 'complete' || phase === 'failed'), `${phase} terminality agrees`);
  }
});

test('every phase has plain-language text and no phase is unlabelled', () => {
  for (const phase of CLIENT_PHASES) {
    assert.equal(typeof PHASE_TEXT[phase], 'string', `${phase} has text`);
    assert.ok(PHASE_TEXT[phase].length > 0);
  }
  // The visible list excludes terminal states: there is no step for "complete".
  assert.equal(VISIBLE_PHASES.includes('complete'), false);
  assert.equal(VISIBLE_PHASES.includes('failed'), false);
  assert.equal(VISIBLE_PHASES.includes('queued'), true, 'waiting for a slot is a real state');
});

// ------------------------------------------------------------- start parsing

test('a completed artifact is recognised without polling', () => {
  const outcome = parseStart({
    status: 'complete',
    cacheHit: true,
    resolvedRevision: 'abc123',
    graphUrl: '/api/graph/o/r',
    viewUrl: '/api/view/o/r',
  });
  assert.equal(outcome.kind, 'complete');
  assert.equal(outcome.kind === 'complete' && outcome.resolvedRevision, 'abc123');
});

test('an accepted job yields the id and status URL to poll', () => {
  const outcome = parseStart(
    { status: 'queued', jobId: 'job-1', statusUrl: '/api/analysis/jobs/job-1', retryAfterMs: 1500, joined: false },
    new Headers(),
  );
  assert.equal(outcome.kind, 'polling');
  if (outcome.kind !== 'polling') return;
  assert.equal(outcome.jobId, 'job-1');
  assert.equal(outcome.statusUrl, '/api/analysis/jobs/job-1');
  assert.ok(outcome.retryAfterMs > 0);
  assert.equal(outcome.joined, false);
});

test('the accepted phase is taken from the server, defaulting to queued', () => {
  // Shown before the first poll, so the progress view is populated from the
  // server's own state rather than a guess.
  const queued = parseStart({ jobId: 'j', status: 'queued' });
  assert.equal(queued.kind === 'polling' && queued.status, 'queued');

  const collecting = parseStart({ jobId: 'j', status: 'collecting' });
  assert.equal(collecting.kind === 'polling' && collecting.status, 'collecting');

  // No phase reported: `queued` is the correct default for an accepted job.
  const bare = parseStart({ jobId: 'j' });
  assert.equal(bare.kind === 'polling' && bare.status, 'queued');

  // A nonsense phase is not trusted.
  const bogus = parseStart({ jobId: 'j', status: 'banana' });
  assert.equal(bogus.kind === 'polling' && bogus.status, 'queued');
});

test('a Retry-After header wins over the body hint', () => {
  const outcome = parseStart(
    { jobId: 'job-1', retryAfterMs: 1500 },
    new Headers({ 'retry-after': '5' }),
  );
  assert.equal(outcome.kind === 'polling' && outcome.retryAfterMs, 5000);
});

test('a refusal keeps its code so the message can be specific', () => {
  const limited = parseStart(
    { ok: false, error: { code: 'analysis_rate_limited', message: 'slow down' } },
    new Headers({ 'retry-after': '30' }),
  );
  assert.equal(limited.kind, 'refused');
  if (limited.kind !== 'refused') return;
  assert.equal(limited.code, 'analysis_rate_limited');
  assert.equal(limited.retryAfterMs, 30000);
  assert.match(refusalText(limited), /too many analyses/i);
  assert.doesNotMatch(refusalText(limited), /queue/i, 'a rate limit is not described as a full queue');

  const overloaded = parseStart(
    { ok: false, error: { code: 'analysis_overloaded', message: 'full' } },
    new Headers({ 'retry-after': '30' }),
  );
  if (overloaded.kind !== 'refused') throw new Error('expected a refusal');
  assert.match(refusalText(overloaded), /queue is full/i);
  assert.doesNotMatch(refusalText(overloaded), /too many analyses/i);
});

test('an unusable repository is distinguished from a refusal', () => {
  assert.equal(parseStart({ error: { code: 'invalid_repository', message: 'bad' } }).kind, 'refused');
  assert.equal(parseStart({ nonsense: true }).kind, 'invalid');
  assert.equal(parseStart(null).kind, 'invalid');
});

test('the client never invents a percentage', () => {
  const payload = JSON.stringify(parseStart({ jobId: 'j', statusUrl: '/x', retryAfterMs: 100 }));
  assert.equal(/percent|progress|\d+%/.test(payload), false);
  assert.equal(Object.keys(parseStart({ jobId: 'j' })).includes('percent'), false);
});

// -------------------------------------------------------------- job parsing

test('a job status parses from either envelope shape', () => {
  const fromEnvelope = parseJob({ ok: true, data: { jobId: 'j1', status: 'collecting', repository: 'o/r' } });
  assert.ok(fromEnvelope);
  assert.equal(fromEnvelope.status, 'collecting');
  assert.equal(fromEnvelope.repository, 'o/r');

  const bare = parseJob({ jobId: 'j1', status: 'validating' });
  assert.ok(bare);
  assert.equal(bare.status, 'validating');
});

test('an unknown status is rejected rather than guessed at', () => {
  assert.equal(parseJob({ status: 'wat' }), null);
  const complete = parseJob({ status: 'complete' });
  assert.ok(complete);
  assert.equal(complete.status, 'complete');
  assert.equal(parseJob(null), null);
  assert.equal(parseJob({}), null);
});

test('polling stops on a terminal phase and on anything unrecognised', () => {
  assert.equal(shouldPoll('collecting'), true);
  assert.equal(shouldPoll('queued'), true);
  assert.equal(shouldPoll('complete'), false);
  assert.equal(shouldPoll('failed'), false);
  // An unparseable status must end the loop rather than spin forever.
  assert.equal(shouldPoll(parseJob({ status: 'unknown' })?.status ?? null), false);
  assert.equal(shouldPoll(null), false);
  assert.equal(shouldPoll(undefined), false);
});

test('the poll delay is bounded at both ends', () => {
  assert.equal(nextDelayMs(1500, 0), 1500);
  // Back off on a long wait, but never past a few seconds.
  assert.ok(nextDelayMs(1500, 8000) > 1500);
  assert.ok(nextDelayMs(1500, 8_000_000) <= 5000);
  // A nonsense or hostile hint cannot stall or thrash the page.
  assert.equal(nextDelayMs(-1, 0), 1500);
  assert.equal(nextDelayMs(999_999, 0), 5000);
  assert.equal(nextDelayMs('abc', 0), 1500);
});

test('the phase index is monotone and safe', () => {
  assert.equal(phaseIndex('queued'), 0);
  assert.ok(phaseIndex('collecting') > phaseIndex('resolving'));
  assert.ok(phaseIndex('publishing') > phaseIndex('validating'));
  // A terminal state is not in the visible list, so it never renders a step.
  assert.equal(phaseIndex('complete'), 0);
  // An unrecognised phase must not throw; it falls back to the first step.
  assert.equal(phaseIndex('nonsense' as AnalysisPhase), 0);
});

// ------------------------------------------- all-bundled bundle representatives

function allBundledView(): ViewGraph {
  const subject: ViewNode = {
    id: 'repo:expressjs/express',
    type: 'Repository',
    slot: 'subject',
    label: 'expressjs/express',
    owner: 'expressjs',
    name: 'express',
    isSubject: true,
    isPackage: false,
    outboundRelationshipIds: [],
    inboundRelationshipIds: [],
    peerRelationshipIds: [],
  };
  const edges: ViewEdge[] = Array.from({ length: 48 }, (_, index) => ({
    id: `rel-${index}`,
    relationshipType: index < 44 ? ('depends_on' as const) : ('references' as const),
    family: index < 44 ? ('dependency' as const) : ('attribution' as const),
    status: 'DECLARED',
    directed: true,
    arrow: index < 44 ? ('end-weak' as const) : ('end' as const),
    arrowheadAt: `pkg:${index}`,
    source: subject.id,
    target: `pkg:${index}`,
    label: 'depends on',
    relationLabel: 'depends on',
    subjectRole: 'outbound',
    visibility: 'bundled',
    bundleKey: index < 44 ? 'depends_on/DECLARED' : 'references/DECLARED',
    evidenceCount: 1,
    evidenceIds: [],
    evidenceTruncated: false,
  }));
  const bundles: ViewBundle[] = [
    {
      key: 'depends_on/DECLARED',
      relationshipType: 'depends_on',
      family: 'dependency',
      status: 'DECLARED',
      count: 44,
      label: 'depends on',
      sampleRelationshipId: 'rel-0',
      totalEvidenceCount: 44,
    },
    {
      key: 'references/DECLARED',
      relationshipType: 'references',
      family: 'attribution',
      status: 'DECLARED',
      count: 4,
      label: 'references',
      sampleRelationshipId: 'rel-44',
      totalEvidenceCount: 4,
    },
  ];
  return {
    schemaVersion: '2.0.0',
    analyzer: { name: 'gitlineage', version: '0.2.0', schemaVersion: '2.0.0', extractors: [], adapters: [] },
    revision: { commit: 'a'.repeat(40), shortCommit: 'aaaaaaa', ref: 'master', defaultBranch: 'master', analyzedAt: '2026-10-01T00:00:00.000Z' },
    subject,
    nodes: [subject, ...edges.map((edge) => ({
      id: edge.target,
      type: 'Package' as const,
      slot: 'dependency' as const,
      label: `pkg-${edge.target}`,
      isSubject: false,
      isPackage: true,
      outboundRelationshipIds: [],
      inboundRelationshipIds: [edge.id],
      peerRelationshipIds: [],
    }))],
    edges,
    edgeCount: edges.length,
    primaryEdgeCount: 0,
    bundledEdgeCount: edges.length,
    bundles,
    hiddenRelationshipCount: 0,
    statusCounts: { VERIFIED: 0, DECLARED: 48, DETECTED: 0 },
    familyCounts: { ancestry: 0, dependency: 44, attribution: 4, 'source-identity': 0, similarity: 0 },
    directionContract: { directional: ['depends_on'], symmetric: [] },
    empty: { isEmpty: false, reason: '' },
    partial: { isPartial: false, notes: [] },
    evidenceByRelationship: {},
  };
}

test('an all-bundled graph has nothing drawn, which is the case to detect', () => {
  const view = allBundledView();
  const options = { layers: allLayersOn(), expandedBundles: new Set<string>() };
  assert.equal(view.edgeCount, 48);
  assert.equal(view.bundledEdgeCount, 48);
  assert.equal(visibleEdges(view, options).length, 0);
  assert.equal(hasDrawnEdges(view, options), false);
});

test('every bundle is orphaned when nothing is drawn, so all get a card', () => {
  const view = allBundledView();
  const orphans = orphanBundles(view, { layers: allLayersOn(), expandedBundles: new Set() });
  assert.equal(orphans.length, 2);
  assert.deepEqual(orphans.map((bundle) => bundle.count).sort((a, b) => b - a), [44, 4]);
  // The count is preserved, which is what the card displays.
  for (const bundle of orphans) assert.ok(bundle.count > 0);
});

test('expanding a bundle makes it a real drawn edge, not a card', () => {
  const view = allBundledView();
  const expanded = orphanBundles(view, {
    layers: allLayersOn(),
    expandedBundles: new Set(['depends_on/DECLARED']),
  });
  // The expanded bundle now has drawn members, so it no longer needs a card.
  assert.equal(expanded.some((bundle) => bundle.key === 'depends_on/DECLARED'), false);
  // The other one still does.
  assert.equal(expanded.some((bundle) => bundle.key === 'references/DECLARED'), true);
  assert.equal(hasDrawnEdges(view, { layers: allLayersOn(), expandedBundles: new Set(['depends_on/DECLARED']) }), true);
});

test('expansion reveals the real relationships with their type and direction intact', () => {
  const view = allBundledView();
  const drawn = visibleEdges(view, {
    layers: allLayersOn(),
    expandedBundles: new Set(['depends_on/DECLARED']),
  });
  assert.equal(drawn.length, 44);
  // Collapsing is presentation only: the relationships keep their contract fields.
  for (const edge of drawn) {
    assert.equal(edge.relationshipType, 'depends_on');
    assert.equal(edge.status, 'DECLARED');
    assert.equal(edge.directed, true);
    assert.equal(edge.arrow, 'end-weak');
  }
});

test('a genuine empty result is not confused with an all-bundled one', () => {
  const emptyView: ViewGraph = {
    ...allBundledView(),
    edges: [],
    nodes: [allBundledView().subject],
    bundles: [],
    edgeCount: 0,
    bundledEdgeCount: 0,
    empty: { isEmpty: true, reason: 'no relationship' },
  };
  const options = { layers: allLayersOn(), expandedBundles: new Set<string>() };
  assert.equal(emptyView.empty.isEmpty, true);
  // No bundles means no cards, so the two cases stay distinguishable.
  assert.equal(orphanBundles(emptyView, options).length, 0);
  assert.equal(allBundledView().empty.isEmpty, false);
});

test('a bundle with a drawn representative needs no card', () => {
  // nachocebey/is: 3 drawn edges plus bundled references, so the drawn bundle is
  // represented and the cards are not used.
  const view = allBundledView();
  const drawn = visibleEdges(view, {
    layers: allLayersOn(),
    expandedBundles: new Set(['references/DECLARED']),
  });
  assert.ok(drawn.length > 0);
  const orphans = orphanBundles(view, {
    layers: allLayersOn(),
    expandedBundles: new Set(['references/DECLARED']),
  });
  // Only the still-undrawn bundle is orphaned.
  assert.deepEqual(orphans.map((bundle) => bundle.key), ['depends_on/DECLARED']);
});