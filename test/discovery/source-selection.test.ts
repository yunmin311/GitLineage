import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreview} from '../../experiments/discovery-v2/preview.ts';
import {treeFixture} from './tree-fixture.ts';

test('fixed tree exposes non-entry JS/TS paths and binds explicit selections across differently named files',async()=>{
 const f=treeFixture();f.repos[0]!.files={'src/main.ts':Buffer.from('export function run(value: number) { return value + 1; }\n')};f.repos[3]!.files={'lib/core.ts':f.repos[0]!.files['src/main.ts']!};f.rebuild();
 const p=createPreview({transport:f.transport,cooldownMs:0}),s=p.startSearch('root/example');await p.wait(s.id);
 assert.equal(typeof p.startSources,'function','candidate source preview must be operational');
 const t=p.startSources(s.id,[4]);await p.wait(t.id);
 assert.deepEqual(t.sources?.repositories[0]?.files.filter(x=>x.selectable).map(x=>x.path),['src/main.ts']);
 assert.deepEqual(t.sources?.repositories[1]?.files.filter(x=>x.selectable).map(x=>x.path),['lib/core.ts']);
 const c=p.startCompare(s.id,[4],{sourceTaskId:t.id,files:[{repositoryId:1,paths:['src/main.ts']},{repositoryId:4,paths:['lib/core.ts']}]});await p.wait(c.id);
 assert.equal(c.comparison?.content.comparisons[0]?.candidate?.similarity.find(x=>x.method==='normalized_token5')?.score,1);
 assert.ok(c.comparison!.content.usage.attempts<=24);
 assert.equal(c.comparison!.content.usage.attempts,f.calls.length);
 assert.throws(()=>p.startSources(s.id,[4]),/already|closed/);
 assert.throws(()=>p.startCompare(s.id,[4],{sourceTaskId:t.id,files:[{repositoryId:1,paths:['../bad']},{repositoryId:4,paths:['lib/core.ts']}]}));
});

import {validatePreviewExport,validateSourceExport} from '../../experiments/discovery-v2/preview-contract.ts';

test('multiple files remain finite samples with selected, read, filtered and pending paths distinct',async()=>{
 const f=treeFixture();const content=Buffer.from('export function map(values) { return values.map(value => value + 1); }\n');
 f.repos[0]!.files={'src/main.ts':content,'src/helper.js':content,'README.md':Buffer.from('documentation example')};f.repos[3]!.files={'lib/core.ts':content,'lib/helper.js':content};f.rebuild();
 const p=createPreview({transport:f.transport,cooldownMs:0}),s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[4]);await p.wait(t.id);
 assert.equal(t.sources?.repositories[0]?.files.find(x=>x.path==='README.md')?.selectable,false);
 const c=p.startCompare(s.id,[4],{sourceTaskId:t.id,files:[{repositoryId:1,paths:['src/main.ts','src/helper.js']},{repositoryId:4,paths:['lib/core.ts','lib/helper.js']}]});await p.wait(c.id);
 const exported=JSON.parse(JSON.stringify(c.export));validatePreviewExport(exported);assert.equal(exported.schemaVersion,'discovery-preview-export@2');
 assert.equal(exported.selection?.combined.usage.attempts,f.calls.length);assert.equal(exported.selection?.stages.length,3);
 assert.equal(exported.probe.content.comparisons[0]?.summary?.comparedPairs,4);
 assert.equal(exported.probe.content.snapshots[0]?.source?.bindings.length,2);
 assert.equal(exported.selection?.coverageScope,'selected files only; repository-wide coverage unknown');
 assert.equal(exported.probe.content.verification,'pending');assert.equal(exported.probe.content.lineageClaim,'none');
 exported.selection!.selected[0]!.paths[0]='index.js';assert.throws(()=>validatePreviewExport(exported));
});

test('excluded categories and unvisited directories retain reasons without reading blobs',async()=>{
 const f=treeFixture(),body=Buffer.from('export function a(value) { return value + 1234; }');
 f.repos[0]!.files={'src/main.ts':body,'lib/a.js':body,'extra/a.js':body,'another/a.js':body,'vendor/a.js':body,'generated/a.js':body,'templates/a.js':body,'docs/a.js':body,'dist/a.js':body,'a.min.js':body,'yarn.lock':body,'LICENSE':body,'a.py':body,'huge.js':Buffer.alloc(131073)};f.rebuild();
 const p=createPreview({transport:f.transport,cooldownMs:0}),s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[4]);await p.wait(t.id);
 const r=t.sources!.repositories[0]!;assert.ok(r.coverage.filtered.some(x=>x.reason.includes('third-party')));assert.ok(r.coverage.filtered.some(x=>x.reason.includes('generated')));assert.ok(r.coverage.filtered.some(x=>x.reason.includes('scaffold')));assert.ok(r.coverage.filtered.some(x=>x.reason.includes('documentation')));
 for(const path of ['a.min.js','yarn.lock','LICENSE','a.py','huge.js'])assert.equal(r.files.find(x=>x.path===path)?.selectable,false,path);
 assert.equal(r.coverage.visitedTrees,3);assert.ok(r.coverage.unlistedDirectories.length>=2);assert.equal(r.coverage.state,'partial');assert.equal(f.calls.filter(x=>x.includes('/git/blobs/')).length,0);
});

test('truncated or invalid trees withhold unverifiable paths; empty directories are unavailable',async()=>{
 for(const mode of ['truncated','invalid','empty'] as const){const f=treeFixture();if(mode==='empty'){f.repos[3]!.files={};f.rebuild();}
 const p=createPreview({cooldownMs:0,transport:async(url,init)=>{const path=new URL(url).pathname,r=await f.transport(url,init);if(path.includes('/unknown/example/git/trees/')){const data=await r.json() as {truncated:boolean;tree:{path:string}[]};if(mode==='truncated')data.truncated=true;if(mode==='invalid')data.tree[0]!.path='../escape';return new Response(JSON.stringify(data));}return r;}});
 const s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[4]);await p.wait(t.id);const r=t.sources!.repositories[1]!;
 assert.equal(r.files.filter(x=>x.selectable).length,0);assert.ok(r.coverage.reasons.length);assert.notEqual(t.state,'completed');
 }
});

test('failed source read retains failure cost and unavailable score, with no new session budget',async()=>{
 const f=treeFixture(),p=createPreview({cooldownMs:0,transport:async(url,init)=>new URL(url).pathname.includes('/unknown/example/git/blobs/')?new Response('',{status:404}):f.transport(url,init)});
 const s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[4]);await p.wait(t.id);const c=p.startCompare(s.id,[4],{sourceTaskId:t.id,files:[{repositoryId:1,paths:['index.js']},{repositoryId:4,paths:['index.js']}]});await p.wait(c.id);
 assert.equal(c.state,'partial');assert.equal(c.comparison?.content.comparisons[0]?.candidate,null);assert.ok(c.comparison?.receipt.requests.some(r=>r.request.status===404&&r.request.reservedBytes===32768));
 validatePreviewExport(c.export);assert.equal(c.export?.selection?.combined.usage.attempts,14); // 4 search + 6 listing + 2 blobs + 2 final IDs = 14 incl failed read
 assert.throws(()=>p.startCompare(s.id,[4]),/already|closed/);
});

test('combined budget denial stops at 24 attempts even with two candidates and eight selected files',async()=>{
 const f=treeFixture();for(const r of f.repos)r.files=Object.fromEntries(Array.from({length:8},(_,i)=>[`src/f${i}.js`,Buffer.from(`export const value${i}=value=>value + ${i};`)]));f.rebuild();
 const p=createPreview({transport:f.transport,cooldownMs:0}),s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[2,4]);await p.wait(t.id);const paths=Array.from({length:8},(_,i)=>`src/f${i}.js`);const c=p.startCompare(s.id,[2,4],{sourceTaskId:t.id,files:[1,2,4].map(repositoryId=>({repositoryId,paths}))});await p.wait(c.id);
 assert.equal(c.state,'partial');assert.equal(c.comparison?.content.usage.attempts,24);assert.equal(f.calls.length,24);assert.ok(c.comparison?.receipt.requests.some(r=>r.request.outcome==='budget_denied'));assert.equal(c.comparison?.content.lineageClaim,'none');validatePreviewExport(c.export);
});

test('cancel during source preview ends the shared session and releases process ownership',async()=>{
 const f=treeFixture(),p=createPreview({cooldownMs:0,transport:async(url,init)=>{if(new URL(url).pathname.includes('/git/trees/'))await new Promise<void>((_,reject)=>init.signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));return f.transport(url,init);}});
 const s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[4]);p.cancel(t.id);await p.wait(t.id);assert.equal(t.state,'cancelled');assert.ok(t.sources);assert.throws(()=>p.startSources(s.id,[4]),/already|closed/);const next=p.startSearch('root/example');await p.wait(next.id);assert.notEqual(next.state,'running');
});

test('branch drift after listing cannot change selected commit, trees or blobs',async()=>{
 const f=treeFixture(),p=createPreview({transport:f.transport,cooldownMs:0}),s=p.startSearch('root/example');await p.wait(s.id);
 const t=p.startSources(s.id,[4]);await p.wait(t.id);const pinned=t.sources!.repositories.map(r=>r.revision);
 const before=f.calls.length;f.routes.set('/repos/unknown/example/commits/main',{sha:'f'.repeat(40),commit:{tree:{sha:'e'.repeat(40)}},parents:[]});
 const c=p.startCompare(s.id,[4],{sourceTaskId:t.id,files:[1,4].map(repositoryId=>({repositoryId,paths:['index.js']}))});await p.wait(c.id);
 validatePreviewExport(c.export);assert.deepEqual(c.comparison!.content.snapshots.map(s=>s.resolution?.identity?.revision),pinned);
 assert.ok(f.calls.slice(before).every(path=>!path.endsWith('/commits/main')));
});

test('post-listing identity conflict withholds all candidate files',async()=>{
 const f=treeFixture();let reads=0;
 const p=createPreview({cooldownMs:0,transport:async(url,init)=>{
  if(new URL(url).pathname==='/repos/unknown/example'&&++reads===1){const response=await f.transport(url,init),body=await response.json() as {id:number};body.id=987;return new Response(JSON.stringify(body));}
  return f.transport(url,init);
 }}),s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[4]);await p.wait(t.id);
 assert.equal(t.sources!.repositories[1]!.coverage.state,'unavailable');assert.deepEqual(t.sources!.repositories[1]!.files,[]);
 assert.throws(()=>p.startCompare(s.id,[4],{sourceTaskId:t.id,files:[1,4].map(repositoryId=>({repositoryId,paths:['index.js']}))}),/verified selectable/);
});

test('filtered-only listing distinguishes successful enumeration from source availability',async()=>{
 const f=treeFixture();f.repos[3]!.files={'README.md':Buffer.from('Documentation only, no executable source')};f.rebuild();
 const p=createPreview({transport:f.transport,cooldownMs:0}),s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[4]);await p.wait(t.id);
 const r=t.sources!.repositories[1]!;
 assert.equal(r.coverage.state,'listed');assert.equal(r.coverage.eligibleFiles,0);assert.equal(r.coverage.enumeration,'complete');assert.equal(t.state,'partial');
 assert.ok(r.coverage.filtered.some(f=>f.path==='README.md'));
 assert.ok(t.sourceExport,'partial listing must have a downloadable independent receipt');
 const receipt=JSON.parse(JSON.stringify(t.sourceExport));validateSourceExport(receipt);assert.deepEqual(receipt.sources.repositories[1]!.coverage,r.coverage);receipt.sources.repositories[1]!.coverage.eligibleFiles=1;assert.throws(()=>validateSourceExport(receipt));
});

test('compare refuses changed fixed candidate set before any resource consumption',async()=>{
 const f=treeFixture(),p=createPreview({transport:f.transport,cooldownMs:0}),s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[2,4]);await p.wait(t.id);
 const before=f.calls.length,usage=JSON.stringify(t.sources!.usage);
 assert.throws(()=>p.startCompare(s.id,[4],{sourceTaskId:t.id,files:[1,4].map(repositoryId=>({repositoryId,paths:['index.js']}))}),/candidate set/);
 assert.equal(f.calls.length,before);assert.equal(JSON.stringify(t.sources!.usage),usage);
});

test('duplicate, missing, cross-session and invalid file choices are rejected without requests or workers',async()=>{
 const f=treeFixture(),p=createPreview({transport:f.transport,cooldownMs:0}),s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[4]);await p.wait(t.id);
 const other=p.startSearch('root/example');await p.wait(other.id);
 const before=f.calls.length,usage=JSON.stringify(t.sources!.usage),files=[1,4].map(repositoryId=>({repositoryId,paths:['index.js']}));
 for(const [ids,choice] of [
  [[4,4],{sourceTaskId:t.id,files}],
  [[4],{sourceTaskId:t.id,files:files.slice(1)}],
  [[4],{sourceTaskId:other.id,files}],
  [[4],{sourceTaskId:t.id,files:[files[0],files[0]]}],
  [[4],{sourceTaskId:t.id,files:[files[0],{repositoryId:4,paths:['../escape.js']}]}]
 ] as const)assert.throws(()=>p.startCompare(s.id,ids,choice as never));
 assert.equal(f.calls.length,before);assert.equal(JSON.stringify(t.sources!.usage),usage);
 assert.throws(()=>p.startCompare(other.id,[4],{sourceTaskId:t.id,files}));
 const c=p.startCompare(s.id,[4],{sourceTaskId:t.id,files});await p.wait(c.id);assert.equal(c.state,'completed');assert.equal(c.comparison!.content.usage.peakWorkers,1);assert.equal(Object.values(c.comparison!.content.usage.files).reduce((a,b)=>a+b,0),2);assert.equal(c.comparison!.content.usage.attempts,f.calls.length-other.search!.usage.attempts);
});
