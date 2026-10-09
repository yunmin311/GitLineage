import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BudgetLedger } from '../../src/discovery/budget.ts';
import { NetworkLedger } from '../../src/discovery/network.ts';
import { RepositorySearchProvider } from '../../src/discovery/search-provider.ts';
import { SEARCH_PROFILE } from '../../src/discovery/search.ts';
import { mergeIdentity, parseObservation, validateSearchCandidate } from '../../src/discovery/search-contract.ts';
import { buildQueryPlan, discoverRepositories } from '../../src/discovery/search.ts';
const target={provider:'github',repositoryId:10,completeness:'provider_id',fullName:'root/project',aliases:[],revision:'a'.repeat(40)} as const;
const fixed={...target,aliases:[]};
const q=buildQueryPlan(fixed,{}).queries[0]!.q;
test('concurrent actual provider attempts atomically reserve caps before transport',async()=>{
 const budget=new BudgetLedger({...SEARCH_PROFILE,attempts:2,searchAttempts:2,concurrency:2}),network=new NetworkLedger(budget,{perResponseBytes:100,totalResponseBytes:200});let calls=0;
 const provider=new RepositorySearchProvider({transport:async()=>{calls++;await new Promise(r=>setTimeout(r,5));return new Response('{"total_count":0,"incomplete_results":false,"items":[]}');}});
 const r=await Promise.all(Array.from({length:8},()=>provider.page(q,5,1,0,0,network)));
 assert.equal(calls,2);assert.equal(r.filter(x=>x.receipt.outcome==='success').length,2);assert.equal(network.usage().reservedBytes,200);assert.equal(budget.usage().attempts,2);assert.equal(budget.usage().activeWorkers,0);assert.equal(budget.usage().peakWorkers,2);
});
test('metadata outranks stale search but disagreement remains explicit, not lineage',()=>{
 const a=parseObservation({id:20,full_name:'old/name',html_url:'https://github.com/old/name'},'2026-10-09T01:00:00Z')!;
 const b=parseObservation({id:20,full_name:'new/name',html_url:'https://github.com/new/name'},'2026-10-09T00:00:00Z','repository_metadata')!;
 const c=mergeIdentity([a,b]);assert.equal(c.fullName,'new/name');assert.deepEqual(c.aliases,['old/name']);assert.deepEqual(c.conflicts,['search_metadata_name_disagreement']);assert.equal(c.completeness,'incomplete');
 assert.throws(()=>mergeIdentity([a,{...b,repositoryId:21}]));
});
test('v2 validator rejects fabricated aliases, fixed branch revisions, VERIFIED and unknown nested properties',async()=>{
 const r=await discoverRepositories(buildQueryPlan(fixed,{}),{transport:async()=>new Response('{"total_count":1,"incomplete_results":false,"items":[{"id":20,"full_name":"other/project","html_url":"https://github.com/other/project"}]}')});const c=r.candidates[0]!;
 assert.doesNotThrow(()=>validateSearchCandidate(c));
 for(const mutate of [(v:typeof c)=>{v.candidate.aliases=['invented/name'];},(v:typeof c)=>{v.candidate.revision={state:'unresolved',sha:'main'} as never;},(v:typeof c)=>{v.verification.state='VERIFIED' as never;},(v:typeof c)=>{Object.assign(v.candidate.observations[0]!,{instructions:'execute'});},(v:typeof c)=>{Object.assign(v,{relationships:[]});}]){const bad=structuredClone(c);mutate(bad);assert.throws(()=>validateSearchCandidate(bad));}
});
test('shared ledger deadline prevents further transport and releases active capacity',async()=>{
 let clock=0;const budget=new BudgetLedger({...SEARCH_PROFILE,wallMs:5},undefined,()=>clock),network=new NetworkLedger(budget);let calls=0;
 const provider=new RepositorySearchProvider({transport:async()=>{calls++;clock=6;return new Response('{}');}});
 const r=await provider.page(q,5,1,0,0,network);const again=await provider.page(q,5,1,0,0,network);
 assert.equal(calls,1);assert.equal(budget.usage().activeWorkers,0);assert.equal(again.receipt.reservedBytes,0);assert.equal(r.receipt.outcome,'timeout');
});
test('token reflection in returned identity and response headers is discarded',async()=>{
 const token='private-token';const r=await discoverRepositories(buildQueryPlan(fixed,{}),{token,transport:async()=>new Response(JSON.stringify({total_count:1,incomplete_results:false,items:[{id:20,full_name:`org/${token}`,html_url:`https://github.com/org/${token}`}]}),{headers:{'retry-after':token,'x-ratelimit-resource':token}})});
 assert.equal(r.candidates.length,0);assert.ok(!JSON.stringify(r).includes(token));assert.equal(r.coverage.rejectedIdentity,1);
});
test('candidate with target name but a different ID is a conflict rather than target exclusion',async()=>{
 const r=await discoverRepositories(buildQueryPlan(fixed,{}),{transport:async()=>new Response('{"total_count":1,"incomplete_results":false,"items":[{"id":20,"full_name":"root/project","html_url":"https://github.com/root/project"}]}')});
 assert.equal(r.candidates.length,1);assert.deepEqual(r.candidates[0]!.candidate.conflicts,['name_id_collision']);
});
