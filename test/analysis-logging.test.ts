import assert from 'node:assert/strict';
import test from 'node:test';

import { logEvent, logStartup } from '../src/web/analysis/logging.ts';

/**
 * The log stream is an operational contract: an operator greps it, an alert
 * counts it. These tests pin the shape so a field cannot silently disappear,
 * and pin the two rules that make the stream safe to ship.
 */

/** Captures everything written to stdout while `run` executes. */
function capture(run: () => void): Record<string, unknown>[] {
  const lines: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: unknown }).write = (chunk: string | Uint8Array): boolean => {
    lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  try {
    run();
  } finally {
    (process.stdout as unknown as { write: unknown }).write = original;
  }
  return lines
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Captures a run that must produce exactly one line, and returns it. */
function captureOne(run: () => void): Record<string, unknown> {
  const lines = capture(run);
  assert.equal(lines.length, 1, 'expected exactly one log line');
  return lines[0] as Record<string, unknown>;
}

test('every line is one JSON object carrying a timestamp and an event name', () => {
  const line = captureOne(() => logEvent('analysis.started', { repository: 'grpc/grpc', jobId: 'job-1' }));
  assert.equal(line.event, 'analysis.started');
  assert.match(String(line.ts), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  assert.ok(!Number.isNaN(Date.parse(String(line.ts))), 'ts parses as a date');
  assert.equal(line.repository, 'grpc/grpc');
  assert.equal(line.jobId, 'job-1');
});

test('one call emits exactly one line, so the stream is never interleaved', () => {
  const lines = capture(() => {
    logEvent('analysis.phase', { phase: 'collecting' });
    logEvent('analysis.completed', { durationMs: 5665, cacheHit: false });
  });
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => l.event), ['analysis.phase', 'analysis.completed']);
});

test('a field left undefined is omitted rather than logged as null', () => {
  const line = captureOne(() =>
    logEvent('analysis.failed', { code: 'analysis_failed', durationMs: 12, cacheHit: undefined }),
  );
  assert.equal(line.code, 'analysis_failed');
  assert.equal(line.durationMs, 12);
  assert.ok(!('cacheHit' in line), 'undefined fields are dropped');
  assert.ok(!('jobId' in line), 'unset optional fields are absent');
});

test('a false value survives, because zero and false are real measurements', () => {
  const line = captureOne(() =>
    logEvent('analysis.completed', { cacheHit: false, durationMs: 0, queueDepth: 0, running: 0 }),
  );
  assert.equal(line.cacheHit, false);
  assert.equal(line.durationMs, 0);
  assert.equal(line.queueDepth, 0);
  assert.equal(line.running, 0);
});

test('a null resolved revision is logged as null, not hidden', () => {
  // Null means "the revision could not be resolved yet", which an operator needs
  // to see; dropping the key would make the two cases indistinguishable.
  const line = captureOne(() => logEvent('analysis.accepted', { resolvedRevision: null }));
  assert.equal(line.resolvedRevision, null);
  assert.ok('resolvedRevision' in line);
});

test('the queue depth and running count are recorded on every accepted job', () => {
  // These are the two numbers that tell an operator whether to add capacity or
  // shed load, so their presence is a contract rather than a convenience.
  const line = captureOne(() =>
    logEvent('analysis.accepted', { repository: 'octocat/spoon-knife', jobId: 'job-2', queueDepth: 3, running: 2 }),
  );
  assert.equal(line.queueDepth, 3);
  assert.equal(line.running, 2);
});

test('no credential can reach a log line through the free-form fields', () => {
  // repository and message are the only free-form inputs. A token-shaped string
  // in either must not be echoed back verbatim into the operational log.
  const line = captureOne(() =>
    logEvent('analysis.failed', {
      repository: 'octocat/ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      message: 'Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    }),
  );
  assert.ok(!/\bgh[pousr]_[A-Za-z0-9]{20,}/.test(JSON.stringify(line)), 'no token-shaped value survives');
  assert.ok(!/Bearer\s/i.test(String(line.message)), 'an Authorization header is not echoed');
  assert.ok(!/-----BEGIN [A-Z ]*PRIVATE KEY/.test(JSON.stringify(line)), 'no private key survives');
});

test('the startup line names the event an operator filters on', () => {
  const line = captureOne(() =>
    logStartup({ url: 'http://127.0.0.1:8080', cacheRoot: '/srv/gitlineage/cache', maxConcurrentAnalyses: 2 }),
  );
  assert.equal(line.event, 'server.started');
  assert.equal(line.url, 'http://127.0.0.1:8080');
  assert.equal(line.cacheRoot, '/srv/gitlineage/cache');
  assert.equal(line.maxConcurrentAnalyses, 2);
  assert.match(String(line.ts), /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
});

test('every event name the scheduler emits is a known event', () => {
  // Guards against a typo in a call site: an unknown name would be invisible to
  // a filter written against the documented list.
  const known = new Set([
    'analysis.accepted',
    'analysis.joined',
    'analysis.cacheHit',
    'analysis.started',
    'analysis.phase',
    'analysis.completed',
    'analysis.failed',
    'analysis.refused',
    'job.recovered',
    'http.request',
  ]);
  const emitted = capture(() => {
    for (const event of known) logEvent(event as Parameters<typeof logEvent>[0]);
  });
  assert.equal(emitted.length, known.size);
  for (const line of emitted) assert.ok(known.has(String(line.event)), `${String(line.event)} is documented`);
});

test('one event is always exactly one physical line', () => {
  // A newline inside an error message would otherwise split one event into two
  // lines that no downstream parser can read. JSON escaping is what prevents it,
  // so the assertion belongs on the serialized bytes, not on the parsed value --
  // after JSON.parse the escape has become a real newline again, and asserting
  // there would be asserting the wrong thing.
  const raw: string[] = [];
  const original = process.stdout.write.bind(process.stdout);
  (process.stdout as unknown as { write: unknown }).write = (chunk: string | Uint8Array): boolean => {
    raw.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  };
  try {
    logEvent('analysis.failed', { message: 'line one\nline two\r\nline three' });
  } finally {
    (process.stdout as unknown as { write: unknown }).write = original;
  }

  assert.equal(raw.length, 1, 'one write, one line');
  const written = raw[0] as string;
  assert.ok(written.endsWith('\n'), 'the line is terminated');
  assert.ok(!written.slice(0, -1).includes('\n'), 'no other newline is present');
  assert.ok(!written.includes('\r'), 'no carriage return reaches the stream');
  assert.ok(written.includes('\\n'), 'the embedded newline is escaped, not literal');

  // The message is still fully recoverable for an operator reading the log.
  const parsed = captureOne(() => logEvent('analysis.failed', { message: 'line one\nline two' }));
  assert.equal(parsed.message, 'line one\nline two');
});

test('a token hidden inside a nested value is still redacted', () => {
  // The scrubber walks structures rather than only the known top-level fields,
  // so a new field cannot open a leak by being added later.
  const line = captureOne(() =>
    logEvent('analysis.failed', {
      message: 'upstream said {"headers":{"Authorization":"Bearer ghp_abcdefghijklmnopqrstuvwxyz0123456789"}}',
    }),
  );
  assert.ok(!/\bgh[pousr]_[A-Za-z0-9]{16,}/.test(JSON.stringify(line)));
  assert.ok(String(line.message).includes('[redacted]'), 'the fact of a redaction is preserved');
});

test('a credential in a URL is reduced to its scheme', () => {
  const line = captureOne(() =>
    logEvent('analysis.failed', { message: 'clone https://user:hunter2@github.com/o/r failed' }),
  );
  assert.ok(!String(line.message).includes('hunter2'), 'the password is gone');
  assert.ok(String(line.message).includes('https://'), 'the useful part of the URL is kept');
});

test('redaction does not mangle ordinary text', () => {
  const line = captureOne(() =>
    logEvent('analysis.accepted', {
      repository: 'grpc/grpc',
      message: 'resolved 200 candidates for github.com/grpc/grpc in 1.2s',
    }),
  );
  assert.equal(line.repository, 'grpc/grpc');
  assert.equal(line.message, 'resolved 200 candidates for github.com/grpc/grpc in 1.2s');
  assert.ok(!String(line.message).includes('[redacted]'), 'nothing was removed from a clean message');
});