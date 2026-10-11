import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPublicExploration} from '../experiments/public-exploration/service.ts';
import {createServer} from 'node:http';

test('anonymous entry rejects cross origin before spending shared quota; caps starts across visitors',async()=>{
 let calls=0;
 const service=createPublicExploration({transport:async()=>{calls++;return new Response('{}',{status:404});}});
 const server=createServer((req,res)=>void service.handler(req,res));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address() as {port:number},origin=`http://127.0.0.1:${address.port}`;
 const post=(headers:Record<string,string>={})=>fetch(origin+'/api/deep-search/search',{method:'POST',headers:{'content-type':'application/json','x-gitlineage-csrf':'1',origin,...headers},body:JSON.stringify({repository:'owner/repo'})});
 try {
  assert.equal((await post({origin:'https://evil.example'})).status,403);assert.equal(calls,0);
  const first=await post();assert.equal(first.status,202);
  const task=await first.json() as {id:string}; await service.wait(task.id);
  assert.equal((await fetch(origin+'/api/deep-search/tasks/'+task.id)).status,404);
  const cookie=first.headers.get('set-cookie')!.split(';')[0]!;
  assert.equal((await fetch(origin+'/api/deep-search/tasks/'+task.id,{headers:{cookie}})).status,200);
  assert.equal((await post()).status,429); // identity rate limit, even without retaining cookie
  assert.equal(service.usage().spentAttempts,1);
 } finally {await service.close();await new Promise<void>(r=>server.close(()=>r()));}
});

import {createRepositoryExplorer} from '../experiments/public-exploration/repository-explorer.ts';
import {treeFixture} from './discovery/tree-fixture.ts';

test('verified nested structure, submodule-safe navigation and commit window share one budget',async()=>{
 const fixture=treeFixture();fixture.repos[0]!.files={'src/modules/main.ts':Buffer.from('export const main = (input: number) => input + 4321;'),'README.md':Buffer.from('documentation')};fixture.rebuild();
 for(const [path,value] of fixture.routes)if(path.includes('/commits/')){const c=value as {commit:Record<string,unknown>};c.commit.author={name:'Fixture',date:'2026-10-11T00:00:00Z'};c.commit.message='Add internal module';}
 fixture.routes.set('/repos/root/example/branches',{unused:true});
 const explorer=createRepositoryExplorer({transport:async(url,init)=>new URL(url).pathname.endsWith('/branches')?new Response(JSON.stringify([{name:'main',commit:{sha:fixture.repos[0]!.revision}}])):fixture.transport(url,init)});
 try{const task=explorer.start('root/example');await explorer.wait(task.id);assert.equal(task.state,'completed',task.error??'');assert.equal(task.commits.length,1);assert.equal(task.branches[0]!.sha,task.revision);assert.equal(task.directories[0]!.entries.find(e=>e.path==='src')!.category,'source modules');
  await explorer.directory(task.id,'src');await explorer.directory(task.id,'src/modules');assert.equal(task.directories.at(-1)!.entries[0]!.path,'main.ts');
  const before=fixture.calls.length;await assert.rejects(explorer.directory(task.id,'../escape'));assert.equal(fixture.calls.length,before);assert.equal(task.verification,'pending');assert.equal(task.lineageClaim,'none');
  assert.ok((task.receipt as {usage:{attempts:number}}).usage.attempts<=24);
 }finally{await explorer.close();}
});

test('tree digest mismatch is explicit partial, not an empty repository',async()=>{
 const f=treeFixture(),engine=createRepositoryExplorer({transport:async(url,init)=>{const r=await f.transport(url,init);if(new URL(url).pathname.includes('/git/trees/')){const b=await r.json() as {sha:string};b.sha='f'.repeat(40);return new Response(JSON.stringify(b));}return r;}});
 const task=engine.start('root/example');await engine.wait(task.id);assert.equal(task.state,'partial');assert.match(task.error!,/tree identity/);assert.equal(task.directories.length,0);await engine.close();
});

test('history preserves merge parents and marks the six-object window partial',async()=>{
 const f=treeFixture(),root=f.repos[0]!,tree=(f.routes.get(`/repos/${root.name}/commits/${root.revision}`) as any).commit.tree.sha;
 const parents=Array.from({length:7},(_,i)=>(i+1).toString(16).repeat(40));
 const object=(sha:string,next:string[])=>({sha,commit:{tree:{sha:tree},author:null,message:'Observed merge'},parents:next.map(sha=>({sha}))});
 f.routes.set(`/repos/${root.name}/commits/${root.revision}`,object(root.revision,[parents[0]!,parents[1]!]));f.routes.set(`/repos/${root.name}/commits/main`,object(root.revision,[parents[0]!,parents[1]!]));
 for(let i=0;i<parents.length;i++)f.routes.set(`/repos/${root.name}/commits/${parents[i]}`,object(parents[i]!,i<5?[parents[i+2]!]:[]));
 const engine=createRepositoryExplorer({transport:async(url,init)=>new URL(url).pathname.endsWith('/branches')?new Response('[]'):f.transport(url,init)});
 try{const task=engine.start(root.name);await engine.wait(task.id);assert.equal(task.state,'partial');assert.equal(task.commits.length,6);assert.equal(task.commits[0]!.parents.length,2);assert.match(task.coverage.history,/partial/);assert.ok(task.coverage.pendingParents.length);assert.equal(task.historyAnchor,root.revision);assert.equal(task.commits[0]!.author,'Unknown author');assert.ok((task.receipt as any).usage.attempts<=24);}finally{await engine.close();}
});

test('cancelled anonymous task retains charged attempts; forged proxy headers cannot start work',async()=>{
 let calls=0;const service=createPublicExploration({transport:async(_url,init)=>{calls++;return await new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});}}),server=createServer((q,s)=>void service.handler(q,s));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const post=(path:string,data:unknown,extra:Record<string,string>={})=>fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json','x-gitlineage-csrf':'1',...extra},body:JSON.stringify(data)});
 try{assert.equal((await post('/api/explore',{repository:'root/example'},{'x-forwarded-for':'10.0.0.1'})).status,403);assert.equal(calls,0);const r=await post('/api/explore',{repository:'root/example'}),task=await r.json() as any,cookie=r.headers.get('set-cookie')!.split(';')[0]!;assert.equal(r.status,202);assert.equal((await post(`/api/explore/${task.id}/cancel`,{},{cookie})).status,200);const done=await service.wait(task.id);assert.equal(done.state,'cancelled');assert.equal(service.usage().spentAttempts,1);assert.equal(calls,1);}finally{await service.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('directory continuation passes six reads; history pages retain parent identity and cumulative costs',async()=>{
 const f=treeFixture(),root=f.repos[0]!;root.files=Object.fromEntries(Array.from({length:9},(_,i)=>[`d${i}/main.ts`,Buffer.from('export const main = 123456;')]));f.rebuild();
 const tree=(f.routes.get(`/repos/${root.name}/commits/${root.revision}`) as any).commit.tree.sha;
 const chain=[root.revision,...Array.from({length:12},(_,i)=>(i+10).toString(16).padStart(40,'0'))];
 for(let i=0;i<chain.length;i++)f.routes.set(`/repos/${root.name}/commits/${chain[i]}`,{sha:chain[i],commit:{tree:{sha:tree},author:null,message:'Continue history'},parents:i+1<chain.length?[{sha:chain[i+1]}]:[]});
 const engine=createRepositoryExplorer({transport:async(url,init)=>new URL(url).pathname.endsWith('/branches')?new Response('[]'):f.transport(url,init)});
 try{const t=engine.start(root.name);await engine.wait(t.id);for(let i=0;i<9;i++)await engine.directory(t.id,`d${i}`);assert.equal(t.directories.length,10,t.error??'');await engine.history(t.id);await engine.history(t.id);assert.equal(t.commits.length,13);assert.equal(new Set(t.commits.map(c=>c.sha)).size,13);assert.deepEqual(t.coverage.pendingParents,[]);assert.ok((t.receipt as any).usage.attempts>24);assert.ok((t.receipt as any).stages.every((s:any)=>s.usage.attempts<=24));assert.equal(t.lineageClaim,'none');}finally{await engine.close();}
});

test('actual anonymous request costs, trusted proxy address partition and forged chain refusal',async()=>{
 let calls=0;let service:ReturnType<typeof createPublicExploration>;const server=createServer((q,s)=>void service.handler(q,s));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 service=createPublicExploration({origin,trustedProxies:['127.0.0.1'],attemptsPerHour:3,attemptsPerAddress:2,startIntervalMs:0,transport:async()=>{calls++;return new Response('{}',{status:404});}});
 const post=(ip:string)=>fetch(origin+'/api/explore',{method:'POST',headers:{origin,'content-type':'application/json','x-gitlineage-csrf':'1','x-forwarded-for':ip,'x-forwarded-host':new URL(origin).host,'x-forwarded-proto':'http'},body:JSON.stringify({repository:'root/example'})});
 try{assert.equal((await post('1.1.1.1, 2.2.2.2')).status,403);assert.equal(calls,0);for(const ip of ['1.1.1.1','1.1.1.1','2.2.2.2']){const r=await post(ip);assert.equal(r.status,202);await service.wait((await r.json() as any).id);}assert.equal(calls,3);assert.equal(service.usage().spentAttempts,3);assert.equal((await post('3.3.3.3')).status,429);assert.equal(calls,3);}finally{await service.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('package manifests verify pinned bytes and expose declarations without executing scripts',async()=>{
 const f=treeFixture();f.repos[0]!.files={'package.json':Buffer.from(JSON.stringify({name:'example',workspaces:['packages/*'],dependencies:{tiny:'^1'},scripts:{install:'never execute'}}))};f.rebuild();
 const engine=createRepositoryExplorer({transport:async(url,init)=>new URL(url).pathname.endsWith('/branches')?new Response('[]'):f.transport(url,init)});
 try{const t=engine.start('root/example');await engine.wait(t.id);await engine.manifest(t.id,'package.json');assert.equal(t.packages[0]!.revision,t.revision);assert.equal(t.packages[0]!.name,'example');assert.deepEqual(t.packages[0]!.workspaces,['packages/*']);assert.equal(t.packages[0]!.digest.length,64);assert.deepEqual(t.packages[0]!.dependencies,[{name:'tiny',version:'^1',kind:'dependencies'}]);assert.equal(JSON.stringify(t.packages).includes('never execute'),false);const before=f.calls.length;await engine.manifest(t.id,'package.json');assert.equal(f.calls.length,before);}finally{await engine.close();}
});

import {createPreview} from '../experiments/discovery-v2/preview.ts';
test('public metadata queries use language and description while numeric IDs retain all discoveries',async()=>{
 const f=treeFixture();for(const key of ['/repos/root/example','/repositories/1']){const value=f.routes.get(key);if(value)f.routes.set(key,{...(value as object),language:'JavaScript',description:'Bounded concurrency promise runner'});}
 const preview=createPreview({transport:f.transport,cooldownMs:0,enrichedSearch:true});
 try{const t=preview.startSearch('root/example');await preview.wait(t.id);const result=t.search!.result!;assert.equal(result.queries.length,2);assert.ok(result.plan.queries.every(q=>q.q.includes('language:javascript')));assert.ok(result.plan.queries.some(q=>q.source==='description'));assert.equal(new Set(result.candidates.map(c=>c.candidate.repositoryId)).size,result.candidates.length);assert.ok(result.candidates.some(c=>c.discoveries.length===2));assert.ok(result.candidates.every(c=>c.verification.state==='pending'&&c.lineageClaim==='none'));}finally{await preview.close();}
});
