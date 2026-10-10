import { buildQueryPlan, discoverRepositories, SEARCH_PROFILE } from '../../src/discovery/search.ts';
import { writeSearchSidecar } from '../../src/discovery/search-output.ts';
const target={provider:'github',repositoryId:null,completeness:'name_only',fullName:'sindresorhus/p-limit',aliases:[],revision:'a8a6fbec4e0e866d6d779b10889bb4f5567e70eb'} as const;
const live=process.argv.includes('--live');
if(process.argv.slice(2).some(arg=>arg!=='--live'))throw new Error('only explicit --live is accepted');
const plan=buildQueryPlan({...target,aliases:[]},live?{}:{description:'Concurrency limiting utilities',language:'JavaScript',topics:['concurrency']});
let calls=0;
const result=await discoverRepositories(plan,live?{profile:{...SEARCH_PROFILE,attempts:1,searchAttempts:1,candidates:5,wallMs:15000,concurrency:1},timeoutMs:10000,network:{perResponseBytes:65536,totalResponseBytes:65536}}:{now:()=> '2026-10-09T00:00:00.000Z',transport:async()=>{
 const names=['example/p-limit','example/renamed-limit','example/renamed-limit'];const full_name=names[calls++]!;
 return new Response(JSON.stringify({total_count:2,incomplete_results:false,items:[{id:200,full_name,html_url:`https://github.com/${full_name}`},{id:201+calls,full_name:`example/candidate-${calls}`,html_url:`https://github.com/example/candidate-${calls}`}]}),{headers:{'x-ratelimit-limit':'30','x-ratelimit-remaining':String(30-calls),'x-ratelimit-resource':'search'}});
}});
await writeSearchSidecar(`artifacts/discovery-v2/${live?'live-search':'mock-search'}`,result);
console.log(JSON.stringify({mode:live?'explicit anonymous live probe':'offline mock',state:result.coverage.state,candidates:result.candidates.length,attempts:result.usage.attempts,network:result.network,wallMs:result.wallMs}));
