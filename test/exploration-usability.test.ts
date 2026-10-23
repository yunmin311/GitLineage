import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createPublicExploration} from '../experiments/public-exploration/service.ts';
import {treeFixture} from './discovery/tree-fixture.ts';

test('spent address may read only owned, identity-checked cached directories without dispatch',async()=>{
 const f=treeFixture();f.repos[0]!.files=Object.fromEntries(Array.from({length:9},(_,i)=>[`d${i}/main.ts`,Buffer.from('export const value = 4321;')]));f.rebuild();
 const service=createPublicExploration({transport:f.transport,attemptsPerHour:60,attemptsPerAddress:20,startIntervalMs:0});
 const server=createServer((q,s)=>void service.handler(q,s));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;let cookie='';
 const post=(path:string,data:unknown,identity=cookie)=>fetch(origin+path,{method:'POST',headers:{origin,'content-type':'application/json','x-gitlineage-csrf':'1',cookie:identity},body:JSON.stringify(data)});
 try{
  const first=await post('/api/explore',{repository:'root/example'});cookie=first.headers.get('set-cookie')!.split(';')[0]!;const t=await first.json() as {id:string};await service.wait(t.id);
  assert.equal((await post(`/api/explore/${t.id}/directory`,{path:'d0'})).status,200);
  // Failures cost one attempt and do not overwrite the existing verified task.
  let directory=1;while(service.usage().spentAttempts<19){assert.equal((await post(`/api/explore/${t.id}/directory`,{path:`d${directory++}`})).status,200);}
  const exhausted=await post('/api/explore',{repository:'missing/repo'});await service.wait((await exhausted.json() as {id:string}).id);
  const before=f.calls.length;
  const cached=await post(`/api/explore/${t.id}/directory`,{path:'d0'});assert.equal(cached.status,200,'previously verified content stays readable at 20/20');
  assert.equal(service.usage().spentAttempts,20);assert.equal(f.calls.length,before);
  assert.equal((await post(`/api/explore/${t.id}/directory`,{path:'d8'})).status,429);
  assert.equal((await post(`/api/explore/${t.id}/directory`,{path:'d0'},'gl_visitor='+'a'.repeat(48))).status,400);
  assert.equal((await post(`/api/explore/${t.id}/directory`,{path:'../d0'})).status,400);
  assert.equal((await post(`/api/explore/${t.id}/directory`,{path:'d0',sha:'f'.repeat(40)})).status,400);
  assert.equal((await post(`/api/explore/${t.id}/revision`,{sha:'f'.repeat(40)})).status,400);
  assert.equal(f.calls.length,before,'no denied or cached path starts background requests');
  const now=Date.now;try{Date.now=()=>now()+1800001;assert.equal((await post(`/api/explore/${t.id}/directory`,{path:'d0'})).status,400);assert.equal(f.calls.length,before);}finally{Date.now=now;}
 }finally{await service.close();await new Promise<void>(r=>server.close(()=>r()));}
});

import {createRepositoryExplorer} from '../experiments/public-exploration/repository-explorer.ts';
test('cached content remains bound to the checked repository ID and SHA; failed final identity withholds it',async()=>{
 const f=treeFixture();f.repos[0]!.files={'src/main.ts':Buffer.from('export const value = 4321;'),'lib/main.ts':Buffer.from('export const other = 6789;')};f.rebuild();let changed=false;
 const engine=createRepositoryExplorer({transport:async(u,i)=>changed&&new URL(u).pathname==='/repos/root/example'?new Response(JSON.stringify({id:999,full_name:'root/example',html_url:'https://github.com/root/example'})):f.transport(u,i)});
 try{const t=engine.start('root/example');await engine.wait(t.id);await engine.directory(t.id,'src');const before=f.calls.length,sha=t.revision!,id=t.resolution!.requestedId;
  t.revision='f'.repeat(40);await assert.rejects(engine.directory(t.id,'src'),/identity/);t.revision=sha;
  t.resolution!.requestedId=999;await assert.rejects(engine.directory(t.id,'src'));t.resolution!.requestedId=id;assert.equal(f.calls.length,before);
  changed=true;await engine.directory(t.id,'lib');assert.match(t.error!,/Final repository identity/);assert.equal(t.directories.length,0);await assert.rejects(engine.directory(t.id,'src'));assert.equal(t.revision,null);
 }finally{await engine.close();}
});

test('initial History reuses its pinned head and defers branch and parent enumeration',async()=>{
 const f=treeFixture(),r=f.repos[0]!,parent='a'.repeat(40),head=f.routes.get(`/repos/${r.name}/commits/main`) as any;
 head.parents=[{sha:parent}];f.routes.set(`/repos/${r.name}/commits/${r.revision}`,head);
 f.routes.set(`/repos/${r.name}/commits/${parent}`,{...head,sha:parent,parents:[]});
 const engine=createRepositoryExplorer({transport:f.transport});
 try{const t=engine.start(r.name);await engine.wait(t.id);assert.equal(f.calls.length,5);assert.equal(t.commits.length,1);assert.ok(f.calls.every(p=>!p.includes('/branches')&&!p.includes(parent)));assert.deepEqual(t.coverage.pendingParents,[parent]);await engine.history(t.id);assert.equal(t.commits.length,2);assert.equal(f.calls.length,7);assert.equal(t.coverage.history,'complete');}finally{await engine.close();}
});

test('remaining allowance reserves final identity and preserves cached data when a new read cannot fit',async()=>{
 const f=treeFixture(),head=f.routes.get('/repos/root/example/commits/main') as any,parent='b'.repeat(40),grandparent='c'.repeat(40);head.parents=[{sha:parent}];
 f.routes.set(`/repos/root/example/commits/${parent}`,{...head,sha:parent,parents:[{sha:grandparent}]});
 let remaining=20;const engine=createRepositoryExplorer({transport:async(u,i)=>{remaining--;return f.transport(u,i);},beforeRead:n=>{if(remaining<n)throw new Error('allowance');},remainingRequests:()=>remaining});
 try{const t=engine.start('root/example');await engine.wait(t.id);remaining=1;const before=f.calls.length;await assert.rejects(engine.history(t.id),/allowance/);assert.equal(f.calls.length,before);assert.equal(t.commits.length,1);assert.equal(await engine.revision(t.id,t.revision),t);
 remaining=2;await engine.history(t.id);assert.equal(remaining,0);assert.equal(t.commits.length,2);assert.equal(t.error,null);assert.deepEqual(t.coverage.pendingParents,[grandparent]);assert.equal(f.calls.at(-1),'/repos/root/example');assert.equal(await engine.revision(t.id,t.revision),t);
 }finally{await engine.close();}
});

test('a verified cache is still bound to the original proxy address and origin',async()=>{
 const f=treeFixture();let service:ReturnType<typeof createPublicExploration>;
 const server=createServer((q,s)=>void service.handler(q,s));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${(server.address() as {port:number}).port}`,origin=url;service=createPublicExploration({transport:f.transport,origin,trustedProxies:['127.0.0.1'],startIntervalMs:0});
 const headers={origin,'content-type':'application/json','x-gitlineage-csrf':'1','x-forwarded-for':'203.0.113.1','x-forwarded-host':new URL(origin).host,'x-forwarded-proto':'http'};
 try{const first=await fetch(url+'/api/explore',{method:'POST',headers,body:JSON.stringify({repository:'root/example'})});assert.equal(first.status,202,await first.clone().text());const cookie=first.headers.get('set-cookie')!.split(';')[0]!,t=await first.json() as {id:string};await service.wait(t.id);const task=await service.wait(t.id) as any,before=f.calls.length;
 for(const extra of [{'x-forwarded-for':'203.0.113.2'},{origin:'https://evil.example'},{'x-gitlineage-csrf':'0'}])assert.ok((await fetch(url+`/api/explore/${t.id}/revision`,{method:'POST',headers:{...headers,cookie,...extra},body:JSON.stringify({sha:task.revision})})).status>=400);
 assert.equal(f.calls.length,before);
 }finally{await service.close();await new Promise<void>(r=>server.close(()=>r()));}
});
