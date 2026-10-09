import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BudgetLedger, OFFLINE_PROFILE } from '../../src/discovery/budget.ts';
import { readSnapshot, sha256, gitBlob } from '../../src/discovery/snapshot.ts';
import { runComparison } from '../../src/discovery/worker.ts';
import { precision, loadFixturePool } from '../../src/discovery/offline.ts';
const identity={provider:'synthetic',repositoryId:null,completeness:'synthetic',fullName:'synthetic/test',aliases:[],revision:'a'.repeat(40)} as const;
async function snapshot(content:string,path='index.js',ledger=new BudgetLedger(OFFLINE_PROFILE)) {
  return readSnapshot({identity:{...identity,aliases:[]},files:[{path,digest:sha256(content),content}]},ledger);
}
test('corrupt pinned content and unsafe paths leave explicit pending files instead of negative similarity',async()=>{
 const s=await readSnapshot({identity:{...identity,aliases:[]},files:[{path:'x.js',digest:'f'.repeat(64),content:'export const value = 123;'}, {path:'../escape.js',digest:'f'.repeat(64),content:'anything'}]},new BudgetLedger(OFFLINE_PROFILE));
 assert.equal(s.state,'partial');assert.deepEqual(s.pending,['../escape.js','x.js']);assert.equal(s.sources.length,0);assert.ok(s.reasons.some(r=>r.includes('digest mismatch')));
});
test('worker preserves literal/regex tokens, locates 5-token spans and auxiliary renaming confounds',async()=>{
 const a=await snapshot('export function validate(value) { if (value === undefined) throw new TypeError("required"); return Promise.resolve(value); }');
 const b=await snapshot('export function check(input) { if (input === undefined) throw new TypeError("required"); return Promise.resolve(input); }');
 const r=await runComparison(a,b,new BudgetLedger(OFFLINE_PROFILE));
 assert.equal(r.measurements.find(m=>m.method==='exact_blob')!.score,0);
 const norm=r.measurements.find(m=>m.method==='normalized_token5')!;assert.equal(norm.score,1);assert.ok(r.measurements.find(m=>m.method==='strict_token5')!.score!<1);
 assert.ok(norm.ranges.length);assert.ok(norm.ranges.every(x=>x.first[1]-x.first[0]===5));
 const malformed=await snapshot('export const broken = ; // malformed source');const failure=await runComparison(a,malformed,new BudgetLedger(OFFLINE_PROFILE));
 assert.equal(failure.measurements.find(m=>m.method==='strict_token5')!.score,null);
 assert.equal(failure.measurements.find(m=>m.method==='exact_blob')!.score,0);
 const regex=await snapshot('export const regex=/a\\/b/g; export const text="// not comment"; // ignored');
 const formatted=await snapshot('export const regex = /a\\/b/g; export const text = "// not comment";');
 const same=await runComparison(regex,formatted,new BudgetLedger(OFFLINE_PROFILE));assert.equal(same.summary.strict.score,1);
});
test('deadline/cancellation terminate active parsing and release capacity before rejection',async()=>{
 const a=await snapshot('export const value = 123;');
 const c=new AbortController(),ledger=new BudgetLedger(OFFLINE_PROFILE,c.signal);
 const work=runComparison(a,a,ledger);assert.equal(ledger.usage().activeWorkers,1);c.abort();await assert.rejects(work,/cancelled/);assert.equal(ledger.usage().activeWorkers,0);
 const deadline=new BudgetLedger({...OFFLINE_PROFILE,wallMs:10});await assert.rejects(runComparison(a,a,deadline),/deadline/);assert.equal(deadline.usage().activeWorkers,0);
});
test('exact blob matches real Git and all pinned public snapshots are digest-checked',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'discovery-blob-'));
 try{const content='export const value = 123;\n',file=join(dir,'x.js');await writeFile(file,content);
 const git=await promisify(execFile)('git',['hash-object',file]);assert.equal(gitBlob(content),git.stdout.trim());
 const pool=await loadFixturePool();for(const spec of pool.snapshots.filter(s=>s.identity.provider==='github')){const snap=await readSnapshot(spec,new BudgetLedger(OFFLINE_PROFILE));assert.equal(snap.state,'completed');assert.equal(snap.files.length,spec.files.length);}
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Unknown labels widen precision bounds rather than becoming negatives',()=>{
 assert.deepEqual(precision(['positive','unknown','negative'],5,2),{k:5,returned:3,unknown:1,recall:.5,precisionJudged:.5,precisionLower:.2,precisionUpper:.4});
});
