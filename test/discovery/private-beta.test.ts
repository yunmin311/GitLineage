import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,rm,readFile,writeFile,chmod,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBetaGate,passwordHash} from '../../experiments/private-beta/gate.ts';
import {officialFixture} from '../../experiments/discovery-v2/phase1d-mock.ts';
import {validatePreviewExport} from '../../experiments/discovery-v2/preview-contract.ts';
const password='test-private-credential',salt='a'.repeat(32);
const admins=['alice','bob'].map(id=>({id,salt,passwordHash:passwordHash(password,salt)}));
async function setup(opts:{enabled?:boolean;sessionMs?:number;hang?:boolean;limit?:number;rateLimit?:boolean;useDefaultCooldown?:boolean}={}){
 const root=await mkdtemp(join(tmpdir(),'gl-beta-')),fixture=officialFixture();let clock=Date.now();
 let gate:ReturnType<typeof createBetaGate>;
 const server=createServer((req,res)=>void gate.handler(req,res));await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as {port:number},origin=`http://127.0.0.1:${address.port}`;
 gate=createBetaGate({enabled:opts.enabled??true,origin,administrators:admins,storeRoot:join(root,'private'),protectedRoots:[join(root,'canonical')],cooldownMs:opts.useDefaultCooldown?undefined:0,sessionMs:opts.sessionMs,now:()=>clock,limits:{globalActive:opts.limit??2,userActive:1,attemptsPerHour:24,searchesPerUserHour:1,requestsPerMinute:90},transport:opts.hang?async(_u,init)=>new Promise((_r,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});}):async(url,init)=>{const response=await fixture.transport(url,init);return opts.rateLimit?new Response('{}',{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(Math.ceil(Date.now()/1000)+3600),'retry-after':'3600'}}):response;}});
 async function request(path:string,data?:unknown,cookie='',headers:Record<string,string>={}){return fetch(origin+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{origin,'content-type':'application/json','x-gitlineage-csrf':'1'}),cookie,...headers},...(data===undefined?{}:{body:JSON.stringify(data)})});}
 async function login(identity='alice'){const r=await request('/api/private-beta/login',{identity,password});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0]!;}
 async function done(id:string,cookie:string){for(let i=0;i<100;i++){const r=await request('/api/deep-search/tasks/'+id,undefined,cookie),task=await r.json() as any;if(task.state!=='running')return task;await new Promise(r=>setTimeout(r,15));}throw new Error('task did not finish');}
 return {root,fixture,origin,gate,request,login,done,tick:(ms:number)=>{clock+=ms;},close:async()=>{try{await gate.close();}finally{await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}}};
}
test('private gate default-off and anonymous/invalid authentication allocate no tasks or requests',async()=>{
 const off=await setup({enabled:false});try{assert.deepEqual(await(await off.request('/api/deep-search/capabilities')).json(),{enabled:false});assert.equal((await off.request('/api/private-beta/login',{identity:'alice',password})).status,404);}finally{await off.close();}
 const s=await setup();try{assert.equal((await s.request('/api/deep-search/search',{repository:'root/example'})).status,401);assert.equal((await s.request('/api/private-beta/login',{identity:'alice',password:'wrong'})).status,401);assert.equal(s.fixture.calls.length,0);assert.equal(s.gate.usage().reservedAttempts,0);}finally{await s.close();}
});
test('CSRF, origin, forged proxy and duplicate cookie fail before allocation; session rotation/expiry',async()=>{
 const s=await setup({sessionMs:1000});try{const cookie=await s.login();for(const headers of [{'x-gitlineage-csrf':''},{origin:'https://attacker.invalid'},{'x-forwarded-for':'127.0.0.1'},{forwarded:'host=localhost'}])assert.equal((await s.request('/api/deep-search/search',{repository:'root/example'},cookie,headers as unknown as Record<string,string>)).status,403);
 assert.equal((await s.request('/api/deep-search/capabilities',undefined,cookie+'; '+cookie)).status,401);
 const second=await s.login();assert.equal((await s.request('/api/deep-search/capabilities',undefined,cookie)).status,401);s.tick(1001);assert.equal((await s.request('/api/deep-search/search',{repository:'root/example'},second)).status,401);assert.equal(s.fixture.calls.length,0);assert.equal(s.gate.usage().reservedAttempts,0);
 }finally{await s.close();}
});
test('real engine bounded multi-file flow exports pending/none with no secrets; identity isolation and durable shared quota',async()=>{
 const s=await setup();try{const alice=await s.login(),bob=await s.login('bob');assert.equal((await(await s.request('/api/deep-search/capabilities',undefined,alice)).json() as any).cooldownMs,0);const response=await s.request('/api/deep-search/search',{repository:'root/example'},alice);assert.equal(response.status,202);const search=await response.json() as any;await s.done(search.id,alice);
 assert.equal((await s.request('/api/deep-search/tasks/'+search.id,undefined,bob)).status,400);
 assert.equal((await s.request('/api/deep-search/sources',{searchId:search.id,candidateIds:[4]},bob)).status,400);
 const calls=s.fixture.calls.length;assert.equal((await s.request('/api/deep-search/search',{repository:'root/example'},bob)).status,429);assert.equal(s.fixture.calls.length,calls);
 const listing=await(await s.request('/api/deep-search/sources',{searchId:search.id,candidateIds:[4]},alice)).json() as any;const sources=await s.done(listing.id,alice);assert.ok(sources.sources.repositories.length===2);
 const choice={sourceTaskId:listing.id,files:sources.sources.repositories.map((r:any)=>({repositoryId:r.repositoryId,paths:r.files.filter((f:any)=>f.selectable).slice(0,2).map((f:any)=>f.path)}))};
 const comparison=await(await s.request('/api/deep-search/compare',{searchId:search.id,candidateIds:[4],selection:choice},alice)).json() as any;const result=await s.done(comparison.id,alice);validatePreviewExport(result.export);assert.equal(result.export.probe.content.verification,'pending');assert.equal(result.export.probe.content.lineageClaim,'none');const exported=JSON.stringify(result);assert.ok(!exported.includes(password)&&!exported.includes(alice.slice(8))&&!exported.includes(admins[0]!.passwordHash));
 const storage=await readFile(join(s.root,'private/state.json'),'utf8');assert.ok(!storage.includes(password)&&!storage.includes(alice.slice(8)));assert.equal(s.gate.usage().reservedAttempts,24);
 const again=await s.login();assert.equal((await s.request('/api/deep-search/search',{repository:'root/example'},again)).status,429);
 }finally{await s.close();}
});
test('global active task limit, explicit cancellation retains nonrefundable quota',async()=>{
 const s=await setup({hang:true,limit:1});try{const alice=await s.login(),bob=await s.login('bob'),task=await(await s.request('/api/deep-search/search',{repository:'root/example'},alice)).json() as any;
 assert.equal((await s.request('/api/deep-search/search',{repository:'root/example'},bob)).status,429);assert.equal(s.gate.usage().active,1);assert.equal((await s.request('/api/deep-search/tasks/'+task.id+'/cancel',{},alice)).status,200);const result=await s.done(task.id,alice);assert.equal(result.state,'cancelled');assert.equal(s.gate.usage().reservedAttempts,24);
 }finally{await s.close();}
});
test('restart marks unfinished records partial and preserves quota; refuses overlapping physical store',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gl-beta-restart-'));const options={enabled:true,origin:'http://127.0.0.1:8083',administrators:admins,storeRoot:join(root,'private'),protectedRoots:[join(root,'canonical')]};
 try{let gate=createBetaGate(options);assert.throws(()=>createBetaGate(options),/EEXIST/);await gate.close();const file=join(root,'private/state.json'),state=JSON.parse(await readFile(file,'utf8'));state.reserved=24;state.tasks['a'.repeat(24)]={owner:'alice',task:{id:'a'.repeat(24),kind:'search',state:'running',phase:'searching',createdAt:new Date().toISOString(),error:null}};await writeFile(file,JSON.stringify(state));gate=createBetaGate(options);assert.equal(gate.usage().reservedAttempts,24);await gate.close();assert.match(await readFile(file,'utf8'),/service restarted/);assert.throws(()=>createBetaGate({...options,storeRoot:join(root,'canonical','beta')}),/physically separate/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('stricter provider timeout ends hung task inside 30 second ceiling',async()=>{
 const s=await setup({hang:true});try{const cookie=await s.login(),task=await(await s.request('/api/deep-search/search',{repository:'root/example'},cookie)).json() as any;await new Promise(r=>setTimeout(r,10200));const result=await s.done(task.id,cookie);assert.equal(result.state,'partial');assert.equal(result.search.requests[0].request.outcome,'timeout');assert.match(result.error,/timeout/);assert.equal(s.gate.usage().active,0);assert.equal(s.gate.usage().reservedAttempts,24);}finally{await s.close();}
});

test('identity request frequency and login frequency are enforced without GitHub work',async()=>{
 const s=await setup();try{const cookie=await s.login();for(let i=0;i<90;i++)assert.equal((await s.request('/api/deep-search/capabilities',undefined,cookie)).status,200);assert.equal((await s.request('/api/deep-search/capabilities',undefined,cookie)).status,429);assert.equal((await s.request('/api/private-beta/logout',{},cookie)).status,200);assert.equal((await s.request('/api/deep-search/capabilities',undefined,cookie)).status,401);for(let i=0;i<9;i++)assert.equal((await s.request('/api/private-beta/login',{identity:'absent',password:'wrong'})).status,401);assert.equal((await s.request('/api/private-beta/login',{identity:'absent',password:'wrong'})).status,429);assert.equal(s.fixture.calls.length,0);assert.equal(s.gate.usage().reservedAttempts,0);}finally{await s.close();}
});
test('logout revokes authorization and invalid selection consumes no HTTP budget',async()=>{
 const s=await setup();try{const cookie=await s.login();const search=await(await s.request('/api/deep-search/search',{repository:'root/example'},cookie)).json() as any;await s.done(search.id,cookie);const calls=s.fixture.calls.length,reserved=s.gate.usage().reservedAttempts;
 assert.equal((await s.request('/api/deep-search/compare',{searchId:search.id,candidateIds:[4],selection:{sourceTaskId:'a'.repeat(24),files:[]}},cookie)).status,400);assert.equal(s.fixture.calls.length,calls);assert.equal(s.gate.usage().reservedAttempts,reserved);assert.equal((await s.request('/api/private-beta/logout',{},cookie)).status,200);assert.equal((await s.request('/api/deep-search/tasks/'+search.id,undefined,cookie)).status,401);}finally{await s.close();}
});

test('provider exhaustion blocks all identities before another reservation or request',async()=>{
 const s=await setup({rateLimit:true});try{const alice=await s.login(),bob=await s.login('bob'),task=await(await s.request('/api/deep-search/search',{repository:'root/example'},alice)).json() as any;const result=await s.done(task.id,alice);assert.equal(result.state,'partial');assert.equal(result.search.requests[0].request.outcome,'rate_limit');const calls=s.fixture.calls.length;const response=await s.request('/api/deep-search/search',{repository:'root/example'},bob);assert.equal(response.status,429);assert.match(JSON.stringify(await response.json()),/quota/);assert.equal(s.fixture.calls.length,calls);assert.equal(s.gate.usage().reservedAttempts,24);}finally{await s.close();}
});

test('private storage rejects shared permissions before writing state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gl-beta-permissions-'));try{const store=join(root,'private');await mkdir(store);await chmod(store,0o755);assert.throws(()=>createBetaGate({enabled:true,origin:'http://127.0.0.1:8083',administrators:admins,storeRoot:store,protectedRoots:[join(root,'canonical')]}),/owner-only/);}finally{await rm(root,{recursive:true,force:true});}
});

test('simultaneous identities cannot race past shared task or reservation admission',async()=>{
 const s=await setup({hang:true,limit:1});try{const alice=await s.login(),bob=await s.login('bob');const responses=await Promise.all([s.request('/api/deep-search/search',{repository:'root/example'},alice),s.request('/api/deep-search/search',{repository:'root/example'},bob)]);assert.deepEqual(responses.map(r=>r.status).sort(),[202,429]);assert.equal(s.gate.usage().reservedAttempts,24);assert.equal(s.gate.usage().active,1);}finally{await s.close();}
});

test('default private capabilities expose the real engine cooldown before source admission',async()=>{
 const s=await setup({useDefaultCooldown:true});try{const cookie=await s.login(),caps=await(await s.request('/api/deep-search/capabilities',undefined,cookie)).json() as any;assert.equal(caps.cooldownMs,15000);const task=await(await s.request('/api/deep-search/search',{repository:'root/example'},cookie)).json() as any;await s.done(task.id,cookie);const calls=s.fixture.calls.length,response=await s.request('/api/deep-search/sources',{searchId:task.id,candidateIds:[4]},cookie);assert.equal(response.status,429);assert.match(JSON.stringify(await response.json()),/cooldown/);assert.equal(s.fixture.calls.length,calls);}finally{await s.close();}
});

test('body has an absolute deadline despite continuous chunks; oversized lengths and disconnects allocate nothing',async()=>{
 const {connect}=await import('node:net');const s=await setup();
 async function raw(length:string|undefined,slow=false,abort=false){
  const started=Date.now();await new Promise<void>((resolve,reject)=>{
   const socket=connect(Number(new URL(s.origin).port),'127.0.0.1');let interval:ReturnType<typeof setInterval>|undefined;
   const guard=setTimeout(()=>{socket.destroy();reject(new Error('body deadline did not close connection'));},6500);
   socket.resume();socket.on('error',()=>{});socket.on('close',()=>{clearTimeout(guard);if(interval)clearInterval(interval);resolve();});
   socket.on('connect',()=>{socket.write(`POST /api/private-beta/login HTTP/1.1\r\nHost: ${new URL(s.origin).host}\r\nOrigin: ${s.origin}\r\nContent-Type: application/json\r\nX-Gitlineage-CSRF: 1\r\n${length===undefined?'Transfer-Encoding: chunked':'Content-Length: '+length}\r\n\r\n`);if(abort){socket.destroy();return;}if(slow){socket.write('1\r\n{\r\n');interval=setInterval(()=>socket.write('1\r\n \r\n'),200);}});
  });return Date.now()-started;
 }
 try{const elapsed=await raw(undefined,true);assert.ok(elapsed>=4800&&elapsed<6500,`elapsed ${elapsed}`);assert.ok(await raw('4097')<1500);assert.ok(await raw('999999999999999999999999')<1500);await raw('100',false,true);assert.equal(s.fixture.calls.length,0);assert.equal(s.gate.usage().reservedAttempts,0);assert.equal((await s.request('/api/private-beta/login',{identity:'alice',password})).status,200);}finally{await s.close();}
});

test('durable reservation failure refuses network work and further admission',async()=>{
 const s=await setup();try{const cookie=await s.login();await rm(join(s.root,'private/state.json'));await mkdir(join(s.root,'private/state.json'));assert.equal((await s.request('/api/deep-search/search',{repository:'root/example'},cookie)).status,400);assert.equal((await s.request('/api/deep-search/search',{repository:'root/example'},cookie)).status,400);assert.equal(s.fixture.calls.length,0);assert.equal(s.gate.usage().active,0);await assert.rejects(s.gate.close(),/persistence unavailable/);}finally{await s.close().catch(()=>{});await rm(s.root,{recursive:true,force:true});}
});
