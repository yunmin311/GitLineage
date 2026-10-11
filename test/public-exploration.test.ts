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
  assert.equal(service.usage().reservedAttempts,24);
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

test('cancelled anonymous task retains reservation; forged proxy headers cannot start work',async()=>{
 let calls=0;const service=createPublicExploration({transport:async(_url,init)=>{calls++;return await new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});}}),server=createServer((q,s)=>void service.handler(q,s));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}`;
 const post=(path:string,data:unknown,extra:Record<string,string>={})=>fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json','x-gitlineage-csrf':'1',...extra},body:JSON.stringify(data)});
 try{assert.equal((await post('/api/explore',{repository:'root/example'},{'x-forwarded-for':'10.0.0.1'})).status,403);assert.equal(calls,0);const r=await post('/api/explore',{repository:'root/example'}),task=await r.json() as any,cookie=r.headers.get('set-cookie')!.split(';')[0]!;assert.equal(r.status,202);assert.equal((await post(`/api/explore/${task.id}/cancel`,{},{cookie})).status,200);const done=await service.wait(task.id);assert.equal(done.state,'cancelled');assert.equal(service.usage().reservedAttempts,24);assert.equal(calls,1);}finally{await service.close();await new Promise<void>(r=>server.close(()=>r()));}
});
