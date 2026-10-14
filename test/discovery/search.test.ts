import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQueryPlan, discoverRepositories, SEARCH_PROFILE, comparisonIdentity } from '../../src/discovery/search.ts';
import type { SearchOptions } from '../../src/discovery/search.ts';
const target={provider:'github',repositoryId:10,completeness:'provider_id',fullName:'sindresorhus/p-limit',aliases:[],revision:'a8a6fbec4e0e866d6d779b10889bb4f5567e70eb'} as const;
const fixed={...target,aliases:[]};
const item=(id=20,name='other/p-limit')=>({id,full_name:name,html_url:`https://github.com/${name}`});
const response=(items:unknown[]=[],extra={})=>new Response(JSON.stringify({total_count:items.length,incomplete_results:false,items,...extra}));
const plan=()=>buildQueryPlan(fixed,{description:'Concurrency limiting utilities',language:'JavaScript',topics:['concurrency']});
const run=(transport:SearchOptions['transport'],options:Partial<SearchOptions>={})=>discoverRepositories(plan(),{transport,...options});
test('deterministic bounded plans reject sensitive input and qualifier injection',()=>{
 assert.deepEqual(plan(),plan());assert.equal(plan().queries.length,3);
 assert.throws(()=>buildQueryPlan(fixed,{description:'ghp_abcdefghijklmnopqrstuvwxyz0123456789'}));
 assert.throws(()=>buildQueryPlan(fixed,{topics:['foo user:someone']}));
 assert.throws(()=>buildQueryPlan({...fixed,revision:'main'},{}));
 assert.ok(plan().queries.every(q=>q.q.length<=200));
});
test('search sidecar is unresolved, pending, no relationships and fair across queries',async()=>{
 let n=0;const r=await run(async()=>response([item(++n),item(100+n,`other/repo${n}`)]),{profile:{...SEARCH_PROFILE,candidates:3}});
 assert.equal(r.candidates.length,3);assert.equal(r.candidates[0]!.discoveries.length,1);assert.deepEqual(r.candidates.map(c=>c.candidate.repositoryId),[1,2,3]);
 assert.equal(r.coverage.state,'partial_budget');assert.ok(r.candidates.every(c=>c.lineageClaim==='none'&&c.verification.state==='pending'&&c.candidate.revision.state==='unresolved'));
 assert.throws(()=>comparisonIdentity(r.candidates[0]!.candidate));assert.equal(r.usage.totalBytes,0);assert.equal(r.usage.attempts,3);
});
test('same ID rename proven only by responses; same name different IDs stay distinct',async()=>{
 let n=0;const r=await run(async()=>response(n++===0?[item(20,'old/name')]:[item(20,'new/name'),item(21,'new/name')]));
 assert.equal(r.candidates.length,2);assert.deepEqual(r.candidates[0]!.candidate.aliases,['old/name']);
 assert.ok(r.candidates.every(c=>c.candidate.completeness==='incomplete'));
 assert.equal(r.candidates[0]!.discoveries.length,3);
});
test('missing or unsafe IDs and inconsistent URLs are rejected without silent name merging',async()=>{
 const r=await run(async()=>response([{full_name:'a/b'},item(Number.MAX_SAFE_INTEGER+1),{...item(),html_url:'https://evil.test/a/b'}]));
 assert.equal(r.candidates.length,0);assert.equal(r.coverage.rejectedIdentity,9);assert.equal(r.rejectedIdentities.length,9);assert.equal(r.rejectedIdentities[0]!.reason,'invalid_or_missing_identity');assert.equal(r.coverage.state,'partial_provider');
});
for(const status of [401,403,429])test(`HTTP ${status} stops with safe receipt and completed results retained`,async()=>{
 let calls=0;const r=await run(async()=>++calls===1?response([item()]):new Response('SECRET',{status,headers:{'retry-after':'60','x-ratelimit-remaining':'0'}}),{token:'private-token'});
 assert.equal(calls,2);assert.equal(r.candidates.length,1);assert.equal(r.attempts[1]!.status,status);assert.equal(r.attempts[1]!.headers['retry-after'],'60');
 assert.ok(!JSON.stringify(r).includes('private-token'));assert.equal(r.coverage.state,'partial_provider');
});
for(const kind of ['malformed','shape','network','redirect'] as const)test(`${kind} fails diagnostically in sidecar`,async()=>{
 const r=await discoverRepositories(buildQueryPlan(fixed,{}),{transport:async()=>{if(kind==='network')throw new Error('private-token');if(kind==='redirect')return new Response(null,{status:302,headers:{location:'https://evil.test'}});return kind==='malformed'?new Response('{'):new Response('{"items":[]}');},token:'private-token'});
 assert.equal(r.candidates.length,0);assert.equal(r.coverage.state,'unavailable');assert.ok(!JSON.stringify(r).includes('private-token'));
 assert.ok(r.attempts.every(a=>a.outcome!== 'success'));
});
test('retry charges each attempt; bounded Retry-After stops rather than evading server delay',async()=>{
 let calls=0;const r=await run(async()=>++calls===1?new Response('',{status:503}):response([item()]));
 assert.equal(r.usage.attempts,4);assert.equal(r.attempts[1]!.retry,1);assert.equal(r.candidates.length,1);
 const stopped=await run(async()=>new Response('',{status:503,headers:{'retry-after':'60'}}));assert.equal(stopped.usage.attempts,1);assert.equal(stopped.coverage.state,'unavailable');
});
test('pagination charges each page and reports unrequested pages / 1000 window',async()=>{
 const p=buildQueryPlan(fixed,{}, {perPage:2,pages:2});const r=await discoverRepositories(p,{transport:async()=>response([item()],{total_count:1500})});
 assert.equal(r.usage.attempts,2);assert.equal(r.coverage.state,'partial_provider');assert.equal(r.queries[0]!.unfetchedAccessiblePages,498);assert.equal(r.queries[0]!.beyondWindow,500);
});
test('empty bounded search and provider incomplete are distinct',async()=>{
 const r=await run(async()=>response());assert.equal(r.coverage.state,'complete_within_requested');assert.equal(r.message,'在本次查询范围与预算下，未发现候选。');
 const partial=await run(async()=>response([item()],{incomplete_results:true}));assert.equal(partial.coverage.state,'partial_provider');
});
for(const headers of [{} as Record<string,string>,{'content-length':'1'}])test('chunk overflow ignores absent/forged Content-Length and cancels body',async()=>{
 let cancelled=0;const r=await run(async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(200));},cancel(){cancelled++;}}),{headers}),{network:{perResponseBytes:100,totalResponseBytes:300}});
 assert.equal(r.coverage.state,'partial_budget');assert.equal(cancelled,3);assert.equal(r.network.retainedBytes,0);assert.equal(r.network.receivedBytes,600);assert.equal(r.network.reservedBytes,300);
});
test('attempt budget denies before transport and preserves previous results',async()=>{
 let calls=0;const r=await run(async()=>{calls++;return response([item()]);},{profile:{...SEARCH_PROFILE,attempts:1,searchAttempts:1}});
 assert.equal(calls,1);assert.equal(r.candidates.length,1);assert.equal(r.coverage.state,'partial_budget');assert.equal(r.usage.attempts,1);assert.equal(r.queries[2]!.state,'not_attempted');
});
test('timeout and external cancellation stop reads and later requests',async()=>{
 const timed=await run(async()=>new Promise(()=>{}),{timeoutMs:5});assert.equal(timed.coverage.state,'unavailable');assert.equal(timed.attempts.length,3);
 const controller=new AbortController();let calls=0;const cancelled=await run(async()=>{calls++;controller.abort();return response([item()]);},{signal:controller.signal});
 assert.equal(calls,1);assert.equal(cancelled.coverage.state,'cancelled');assert.equal(cancelled.usage.activeWorkers,0);
});
test('fixed host, explicit auth, manual redirects and headers',async()=>{
 const r=await run(async(url,init)=>{assert.equal(new URL(url).origin,'https://api.github.com');assert.equal(init.redirect,'manual');assert.equal(new Headers(init.headers).get('authorization'),'Bearer private-token');assert.ok(new Headers(init.headers).has('x-github-api-version'));return response();},{token:'private-token'});
 assert.equal(r.coverage.state,'complete_within_requested');assert.ok(!JSON.stringify(r).includes('private-token'));
});

test('cancellation after a completed query retains admitted candidate and its receipt',async()=>{
 const c=new AbortController();let calls=0;const r=await run(async()=>{if(++calls===2)c.abort();return response([item()]);},{signal:c.signal});
 assert.equal(calls,2);assert.equal(r.coverage.state,'cancelled');assert.equal(r.candidates.length,1);assert.equal(r.candidates[0]!.discoveries.length,1);assert.equal(r.usage.activeWorkers,0);
});
test('body timeout cancels stalled reader; no half JSON becomes a candidate',async()=>{
 let cancellations=0;const r=await discoverRepositories(buildQueryPlan(fixed,{}),{timeoutMs:5,transport:async()=>new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('{"items":['));},cancel(){cancellations++;}}))});
 assert.equal(r.coverage.state,'unavailable');assert.equal(r.attempts[0]!.outcome,'timeout');assert.equal(r.candidates.length,0);assert.equal(cancellations,1);assert.equal(r.usage.activeWorkers,0);
});
test('network total reservation denies before transport; source byte meaning unchanged',async()=>{
 let calls=0;const r=await run(async()=>{calls++;return response();},{network:{perResponseBytes:100,totalResponseBytes:100}});
 assert.equal(calls,1);assert.equal(r.coverage.state,'partial_budget');assert.equal(r.network.reservedBytes,100);assert.equal(r.usage.attempts,1);assert.equal(r.usage.totalBytes,0);
});
test('pre-cancelled run has no HTTP activity',async()=>{
 const c=new AbortController();c.abort();let calls=0;const r=await run(async()=>{calls++;return response();},{signal:c.signal});
 assert.equal(calls,0);assert.equal(r.coverage.state,'cancelled');assert.equal(r.network.reservedBytes,0);
});
test('unsafe mutated plan cannot become free-form Search API client',async()=>{
 const p=plan();p.queries[0]!.q='ghp_abcdefghijklmnopqrstuvwxyz0123456789';let calls=0;
 await assert.rejects(discoverRepositories(p,{transport:async()=>{calls++;return response();}}));assert.equal(calls,0);
});
test('retry and pagination both remain inside search cap; no recursive retry',async()=>{
 let calls=0;const r=await run(async()=>{calls++;return new Response('',{status:503});});
 assert.equal(calls,4);assert.equal(r.usage.attempts,4);assert.equal(r.attempts.filter(a=>a.retry===1).length,2);assert.equal(r.coverage.state,'partial_budget');
});

test('positive Retry-After prevents follow-up queries to the same search service',async()=>{
 let calls=0;const r=await run(async()=>++calls===1?response([item()]):new Response('',{status:503,headers:{'retry-after':'60'}}));
 assert.equal(calls,2);assert.equal(r.candidates.length,1);assert.equal(r.attempts.length,2);assert.equal(r.queries[2]!.state,'not_attempted');assert.equal(r.coverage.state,'partial_provider');
});
