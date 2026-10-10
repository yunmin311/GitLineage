import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runOffline } from '../../src/discovery/offline.ts';
import { classify } from '../../src/discovery/snapshot.ts';
import { OFFLINE_PROFILE } from '../../src/discovery/budget.ts';
test('filters retain independent reasons for common non-application files',()=>{
  for(const [path,source,want]of [['vendor/x.js','const a=1;','vendor'],['generated/x.js','// @generated\nconst a=1;','generated'],['x.min.js','const a=1;','minified'],['package-lock.json','{}','lockfile'],['LICENSE','MIT','license'],['README.md','hello','documentation'],['templates/x.js','const a=1;','template'],['tiny.js','x','too_small'],['thing.py','print(123456789)','unsupported']] as const){
    const f=classify(path,source);assert.equal(f.classification,want);assert.ok(f.reasons.length);
  }
});
test('fixed offline inputs produce repeatable content, preserve unknowns and never claim lineage',async()=>{
  const a=await runOffline(),b=await runOffline();assert.deepEqual(a.content,b.content);
  assert.ok(a.content.candidates.length>=12);assert.equal(a.content.usage.attempts,0);
  assert.ok(a.content.candidates.every((c:any)=>c.lineageClaim==='none'&&c.verification.state==='pending'));
  assert.ok(a.content.labels.some((l:any)=>l.label==='unknown'));
  assert.ok(a.content.candidates.flatMap((c:any)=>c.similarity).some((m:any)=>m.method==='normalized_token5'&&m.score===1));
});
test('exhausted and cancelled runs retain candidates as partial or unexecuted, never empty success',async()=>{
  const a=await runOffline({profile:{...OFFLINE_PROFILE,totalBytes:20}});assert.equal(a.content.state,'partial');
  assert.ok(a.content.candidates.some((c:any)=>c.coverage.state==='partial'));
  const c=new AbortController();c.abort();const b=await runOffline({signal:c.signal});assert.equal(b.content.state,'partial');
  assert.equal(b.content.usage.activeWorkers,0);assert.ok(b.content.candidates.every((c:any)=>c.coverage.state==='unexecuted'));
});
