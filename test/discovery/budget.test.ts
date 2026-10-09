import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetLedger, OFFLINE_PROFILE } from '../../src/discovery/budget.ts';
test('concurrent reservations cannot overdraw and failures/retries remain charged', async () => {
  const ledger = new BudgetLedger({ ...OFFLINE_PROFILE, attempts: 3, searchAttempts: 2 });
  const results = await Promise.allSettled(Array.from({ length: 8 }, async () => { ledger.attempt(true); throw new Error('upstream failed'); }));
  assert.equal(results.length, 8); assert.equal(ledger.usage().attempts, 2); assert.equal(ledger.usage().searchAttempts, 2);
  ledger.attempt(); assert.throws(() => ledger.attempt()); assert.equal(ledger.usage().attempts, 3);
});
test('bytes/files/candidates and concurrency are reserved before work, with no partial debit on denial', () => {
  const l = new BudgetLedger({ ...OFFLINE_PROFILE, candidates: 1, filesPerCandidate: 1, bytesPerFile: 5, totalBytes: 6, concurrency: 1 });
  l.candidate('a'); assert.throws(() => l.candidate('b')); l.file('a','x'); assert.throws(() => l.file('a','y'));
  l.bytes('a','x',5); assert.throws(() => l.bytes('a','x',1)); assert.equal(l.usage().totalBytes,5);
  const release=l.worker(); assert.throws(() => l.worker()); release(); release(); assert.equal(l.usage().activeWorkers,0);
});
test('cancellation and deadline deny all new scheduling; hard CPU unavailable profiles are rejected', () => {
  const c = new AbortController(); const l = new BudgetLedger(OFFLINE_PROFILE,c.signal); c.abort();
  assert.throws(() => l.candidate('x'), /cancelled/); assert.throws(() => l.worker(), /cancelled/);
  let clock=0; const d=new BudgetLedger({...OFFLINE_PROFILE,wallMs:10},undefined,()=>clock); clock=10;
  assert.throws(() => d.attempt(), /deadline/);
  assert.throws(() => new BudgetLedger({...OFFLINE_PROFILE,cpuMs:1 as never}), /CPU/);
  assert.throws(() => new BudgetLedger({...OFFLINE_PROFILE,totalBytes:NaN}));
});
