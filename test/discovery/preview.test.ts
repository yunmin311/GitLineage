import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPreview} from '../../experiments/discovery-v2/preview.ts';
import {officialFixture} from '../../experiments/discovery-v2/phase1d-mock.ts';

test('search pins verified target and compares only explicitly selected discovered IDs',async()=>{
 const fixture=officialFixture(), preview=createPreview({transport:fixture.transport,cooldownMs:0});
 const search=preview.startSearch('root/example');await preview.wait(search.id);
 assert.equal(search.state,'completed');assert.equal(search.search?.target?.identity?.repositoryId,1);
 assert.equal(search.search?.target?.identity?.revision,fixture.repos[0]!.revision);
 assert.equal(search.search?.result?.candidates.length,3);
 assert.throws(()=>preview.startCompare(search.id,[999]),/discovered/);
 assert.throws(()=>preview.startCompare(search.id,[2,3,4]),/one or two/);
 const comparison=preview.startCompare(search.id,[2,4]);await preview.wait(comparison.id);
 assert.equal(comparison.state,'partial'); // Three fixed entry paths were absent; valid file scores still survive.
 assert.equal(comparison.comparison?.content.verification,'pending');
 assert.equal(comparison.comparison?.content.lineageClaim,'none');
 assert.equal(comparison.comparison?.content.comparisons[1]?.candidate?.similarity.find(m=>m.method==='normalized_token5')?.score,1);
 assert.equal(comparison.comparison?.content.snapshots[0]?.resolution?.identity?.revision,fixture.repos[0]!.revision);
 assert.ok(comparison.comparison!.content.usage.attempts<=24);
 assert.ok(fixture.calls.every(p=>!/^\/repositories\/\d+\//.test(p)));
});

test('invalid input cannot invoke network; cancellation releases concurrency and leaves an honest receipt',async()=>{
 const fixture=officialFixture();const preview=createPreview({cooldownMs:0,transport:async(url,init)=>{await new Promise<void>((r,j)=>{const t=setTimeout(r,1000);init.signal?.addEventListener('abort',()=>{clearTimeout(t);j(new Error('cancelled'));},{once:true});});return fixture.transport(url,init);}});
 for(const bad of ['https://evil.example/a/b','root/../example','file:///etc/passwd','root/example?token=x'])assert.throws(()=>preview.startSearch(bad),/repository/);
 assert.equal(fixture.calls.length,0);
 const task=preview.startSearch('root/example');assert.throws(()=>preview.startSearch('other/example'),/busy/);
 preview.cancel(task.id);await preview.wait(task.id);assert.equal(task.state,'cancelled');
 assert.ok(task.search);assert.equal(task.search?.target,null);
 const next=preview.startSearch('root/example');preview.cancel(next.id);await preview.wait(next.id);
});

test('403 stops network and preserves rate-limit receipt rather than empty success',async()=>{
 let calls=0;const preview=createPreview({transport:async()=>{calls++;return new Response('',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(Math.floor(Date.now()/1000)+3600)}});}});
 const task=preview.startSearch('root/example');await preview.wait(task.id);
 assert.equal(task.state,'partial');assert.equal(calls,1);
 assert.equal(task.search?.requests[0]?.request.outcome,'rate_limit');
 assert.throws(()=>preview.startSearch('root/example'),/quota/);
});

import {serve} from '../../src/web/serve.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function previewHTTP(run:(base:string,preview:ReturnType<typeof createPreview>)=>Promise<void>){
 const root=await mkdtemp(join(tmpdir(),'gl-preview-')),fixture=officialFixture(),preview=createPreview({transport:fixture.transport,cooldownMs:0});
 const app=await serve({port:0,host:'127.0.0.1',clientDir:null,cacheRoot:root,jobStoreRoot:join(root,'jobs'),previewHandler:preview.handler});
 try{await run(app.url,preview);}finally{await preview.close();app.app.analysis.shutdown();await new Promise<void>(r=>app.server.close(()=>r()));await rm(root,{recursive:true,force:true});}
}
test('HTTP gate denies anonymous, CSRF, forwarded access and arbitrary URLs; authorized local search works',()=>previewHTTP(async(base,preview)=>{
 assert.equal((await fetch(base+'/api/deep-search/capabilities')).status,403);
 const grant=await fetch(base+preview.accessPath,{redirect:'manual'}),cookie=grant.headers.get('set-cookie')!.split(';')[0]!;
 assert.equal(grant.status,303);assert.match(grant.headers.get('set-cookie')!,/HttpOnly; SameSite=Strict/);
 assert.equal((await fetch(base+'/api/deep-search/capabilities',{headers:{cookie,'x-forwarded-for':'127.0.0.1'}})).status,403);
 const post=(data:unknown,origin=base)=>fetch(base+'/api/deep-search/search',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(data)});
 assert.equal((await post({repository:'root/example'},'https://evil.example')).status,403);
 assert.equal((await post({repository:'https://evil.example/a/b'})).status,400);
 assert.equal((await post({repository:'root/example',token:'forbidden'})).status,400);
 const response=await post({repository:'root/example'});assert.equal(response.status,202);
 const task=await response.json() as PreviewTask;await preview.wait(task.id);
 const completed=await (await fetch(base+'/api/deep-search/tasks/'+task.id,{headers:{cookie}})).json() as PreviewTask;
 assert.equal(completed.search?.target?.identity?.repositoryId,1);
}));
import type {PreviewTask} from '../../experiments/discovery-v2/preview.ts';

 test('a quota failure after target pinning cannot masquerade as an empty search',async()=>{
 const f=officialFixture(),p=createPreview({cooldownMs:0,transport:async(url,init)=>new URL(url).pathname==='/search/repositories'?new Response('',{status:403}):f.transport(url,init)});
 const task=p.startSearch('root/example');await p.wait(task.id);
 assert.ok(task.search?.target?.identity);assert.equal(task.state,'partial');
 assert.match(task.error??'',/unavailable.*rate_limit/);
 assert.equal(task.search?.result?.candidates.length,0);
 });

test('frequency and cooldown guards fail before another HTTP request',async()=>{
 const f=officialFixture(),p=createPreview({transport:f.transport,cooldownMs:0});
 for(let i=0;i<4;i++){const t=p.startSearch('root/example');await p.wait(t.id);}
 const count=f.calls.length;assert.throws(()=>p.startSearch('root/example'),/frequency/);assert.equal(f.calls.length,count);
 const q=createPreview({transport:f.transport});const t=q.startSearch('root/example');await q.wait(t.id);assert.throws(()=>q.startSearch('root/example'),/cooldown/);
});

test('unavailable selected source produces no fabricated zero measurement',async()=>{
 const f=officialFixture();f.repos[2]!.files={};f.rebuild();
 const p=createPreview({transport:f.transport,cooldownMs:0}),s=p.startSearch('root/example');await p.wait(s.id);
 const c=p.startCompare(s.id,[3]);await p.wait(c.id);
 assert.equal(c.state,'partial');assert.equal(c.comparison?.content.comparisons[0]?.candidate,null);assert.equal(c.comparison?.content.comparisons[0]?.summary,null);assert.match(c.comparison?.content.comparisons[0]?.reason??'',/no eligible/);
 assert.equal(c.comparison?.content.verification,'pending');assert.equal(c.comparison?.content.lineageClaim,'none');
});
