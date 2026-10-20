import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createPublicExploration} from '../experiments/public-exploration/service.ts';
import {treeFixture} from './discovery/tree-fixture.ts';

async function harness(options:Parameters<typeof createPublicExploration>[0]={}) {
 const service=createPublicExploration(options),server=createServer((q,s)=>void service.handler(q,s));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 return {service,post:async(path='/search',body:unknown={repository:'root/example'},cookie='')=>{
  const response=await fetch(origin+'/api/deep-search'+path,{method:'POST',headers:{origin,'content-type':'application/json','x-gitlineage-csrf':'1',cookie},body:JSON.stringify(body)});
  return {status:response.status,value:await response.json() as any,cookie:response.headers.get('set-cookie')?.split(';')[0]??''};
 },close:async()=>{await service.close();await new Promise<void>(r=>server.close(()=>r()));}};
}

test('remaining three seconds uses original admission deadline, without spending requests',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1900000000000});let calls=0;
 const app=await harness({transport:async()=>{calls++;return new Response('{}',{status:404});}});
 try{const first=await app.post();await app.service.wait(first.value.id);t.mock.timers.tick(7000);
  const retry=await app.post();assert.equal(retry.status,429);assert.match(retry.value.error,/3 seconds/);
  assert.equal(Date.parse(retry.value.retryAt),1900000010000);assert.equal(retry.value.code,'ANONYMOUS_START_INTERVAL');assert.equal(calls,1);
 }finally{await app.close();}
});

test('Discovery stage cooldown is separate from the address start interval',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1900000000000});const fixture=treeFixture(),app=await harness({transport:fixture.transport});
 try{const first=await app.post();await app.service.wait(first.value.id);t.mock.timers.tick(12000);
  const retry=await app.post('/sources',{searchId:first.value.id,candidateIds:[2]},first.cookie);
  assert.equal(retry.status,429);assert.equal(retry.value.code,'DISCOVERY_COOLDOWN');assert.equal(Date.parse(retry.value.retryAt),1900000015000);
 }finally{await app.close();}
});

for(const [name,options,want] of [
 ['address',{attemptsPerHour:3,attemptsPerAddress:1},'ANONYMOUS_ADDRESS_QUOTA'],
 ['global',{attemptsPerHour:1,attemptsPerAddress:1},'ANONYMOUS_GLOBAL_QUOTA'],
] as const)test(name+' hourly quota has its own code and reset deadline',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1900000000000});let calls=0;
 const app=await harness({...options,transport:async()=>{calls++;return new Response('{}',{status:404});}});
 try{const first=await app.post();await app.service.wait(first.value.id);const retry=await app.post();
  assert.equal(retry.status,429);assert.equal(retry.value.code,want);assert.equal(retry.value.retryAt,'2030-03-17T18:46:40.000Z');assert.equal(calls,1);
 }finally{await app.close();}
});

test('shared running task is busy without a fabricated retry deadline',async()=>{
 let release!:(r:Response)=>void;const gate=new Promise<Response>(r=>{release=r;});const app=await harness({startIntervalMs:0,transport:async()=>gate});
 try{const first=await app.post();const retry=await app.post();assert.equal(retry.status,429);assert.equal(retry.value.code,'SERVICE_BUSY');assert.equal(retry.value.retryAt,undefined);release(new Response('{}',{status:404}));await app.service.wait(first.value.id);
 }finally{release(new Response('{}',{status:404}));await app.close();}
});

test('upstream quota uses provider deadline and remains separate from hourly budget',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1900000000000});let calls=0;
 const app=await harness({transport:async()=>{calls++;return new Response('{}',{status:429,headers:{'retry-after':'90'}});}});
 try{const first=await app.post();await app.service.wait(first.value.id);const retry=await app.post();assert.equal(retry.status,429);assert.equal(retry.value.code,'GITHUB_RATE_LIMIT');assert.equal(Date.parse(retry.value.retryAt),1900000090000);assert.equal(calls,1);
 }finally{await app.close();}
});

test('failed task exposes network classification without resetting the hourly pool',async()=>{
 const app=await harness({transport:async()=>{throw new TypeError('fixture offline');}});
 try{const first=await app.post();const task=await app.service.wait(first.value.id);assert.ok(task&&'kind' in task);
  assert.equal(task?.code,'NETWORK_ERROR');assert.equal(task?.state,'partial');assert.equal(app.service.usage().spentAttempts,1);
 }finally{await app.close();}
});

test('provider HTTP-date and short Retry-After use the actual engine hold',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1900000000000});
 for(const [retry,delay] of [['3',60000],[new Date(1900000090000).toUTCString(),90000]] as const){
  const app=await harness({transport:async()=>new Response('{}',{status:429,headers:{'retry-after':retry}})});
  try{const first=await app.post();const task=await app.service.wait(first.value.id);assert.ok(task&&'kind' in task);const denied=await app.post();
   assert.equal(task?.code,'GITHUB_RATE_LIMIT');assert.equal(Date.parse(task!.retryAt!),1900000000000+delay);assert.equal(denied.value.retryAt,task?.retryAt);
  }finally{await app.close();}
 }
});

test('four-task window expires at its deadline and rejected starts cost nothing',async t=>{
 t.mock.timers.enable({apis:['Date'],now:1900000000000});
 const app=await harness({startIntervalMs:0,cooldownMs:0,transport:async()=>new Response('{}',{status:404})});
 try{for(let i=0;i<4;i++){const task=await app.post();await app.service.wait(task.value.id);}
  const denied=await app.post();assert.equal(denied.value.code,'DISCOVERY_FREQUENCY');assert.equal(Date.parse(denied.value.retryAt),1900000060000);assert.equal(app.service.usage().spentAttempts,4);
  t.mock.timers.tick(60000);const accepted=await app.post();assert.equal(accepted.status,202);await app.service.wait(accepted.value.id);assert.equal(app.service.usage().spentAttempts,5);
 }finally{await app.close();}
});
