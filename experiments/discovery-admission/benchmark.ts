/** Replay actual, purpose-labeled API observations; no HTTP or acquired code execution. */
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {discoverRepositories} from '../../src/discovery/search.ts';
import {PREVIEW_PROFILE} from '../discovery-v2/preview.ts';
import {SNAPSHOT_NETWORK} from '../../src/discovery/resolution.ts';
import type {QueryPlan} from '../../src/discovery/query.ts';
const corpus=JSON.parse(await readFile('test/discovery/fixtures/admission/searches.json','utf8'));
assert.deepEqual(corpus.plannedTargets,['sindresorhus/p-limit','chalk/chalk','vitejs/vite','gin-gonic/gin','pallets/flask','yunmin311/GitLineage']);
assert.deepEqual([...corpus.samples.map((s:any)=>s.repository),...corpus.failedTargets.map((s:any)=>s.repository)].sort(),[...corpus.plannedTargets].sort(),'Every fixed target needs a successful or explicit failed acquisition');
const results:any[]=[];
for(const sample of corpus.samples){
 const {plan,targetMetadata,responses,labels,baseline}=sample;let calls=0;
 const started=performance.now();const result=await discoverRepositories(plan as QueryPlan,{targetMetadata,profile:PREVIEW_PROFILE,network:SNAPSHOT_NETWORK,transport:async(url)=>{
  const r=responses[calls++];assert.equal(url,r.url);return new Response(JSON.stringify(r.body),{status:r.status});
 }});
 const ids=result.candidates.map(c=>c.candidate.repositoryId),kind=(id:number)=>labels.find((l:any)=>l.repositoryId===id)!.label;
 const metrics=(selected:number[])=>({ids:selected,names:selected.map(id=>labels.find((l:any)=>l.repositoryId===id)!.name),useful:selected.filter(id=>kind(id)==='useful').length,irrelevant:selected.filter(id=>kind(id)==='irrelevant').length,unknown:selected.filter(id=>kind(id)==='unknown').length,usefulTopTwo:selected.slice(0,2).filter(id=>kind(id)==='useful').length,excludedUseful:labels.filter((l:any)=>l.label==='useful'&&!selected.includes(l.repositoryId)).map((l:any)=>l.name)});
 const before=metrics(baseline.ids),after=metrics(ids);
 assert.equal(calls,responses.length);assert.equal(result.usage.candidates,ids.length);assert.ok(ids.length<=3);
 assert.equal(result.coverage.uniqueObserved,labels.length);assert.equal(result.admission.observations.length,labels.length);
 assert.ok(after.useful>=before.useful,`useful admission regression: ${sample.repository}`);
 for(const c of result.candidates){assert.equal(c.lineageClaim,'none');assert.equal(c.verification.state,'pending');}
 results.push({repository:sample.repository,before,after,rawSearchObservations:responses.map((r:any)=>r.body.items.map((i:any)=>i.full_name)),sourceCoverage:result.queries.map(q=>({query:q.query,admitted:result.candidates.filter(c=>c.discoveries.some(d=>d.query===plan.queries[q.query].q)).length})),searchRequests:calls,originalSearchResponseBytes:responses.reduce((n:number,r:any)=>n+r.bytes,0),replayResponseBytes:result.network.receivedBytes,replayWallMs:performance.now()-started,acquisition:sample.acquisition,coverage:result.coverage});
}
const sum=(version:'before'|'after',key:'useful'|'irrelevant'|'unknown'|'usefulTopTwo')=>results.reduce((n,r)=>n+r[version][key],0);
const summary={plannedTargets:corpus.plannedTargets.length,successfulTargets:results.length,failedTargets:corpus.failedTargets,targets:results.length,admitted:results.reduce((n,r)=>n+r.before.ids.length,0),before:{useful:sum('before','useful'),irrelevant:sum('before','irrelevant'),unknown:sum('before','unknown'),usefulTopTwo:sum('before','usefulTopTwo')},after:{useful:sum('after','useful'),irrelevant:sum('after','irrelevant'),unknown:sum('after','unknown'),usefulTopTwo:sum('after','usefulTopTwo')},searchRequests:results.reduce((n,r)=>n+r.searchRequests,0),originalSearchResponseBytes:results.reduce((n,r)=>n+r.originalSearchResponseBytes,0),replayNetworkRequests:0};
assert.ok(summary.after.useful>summary.before.useful,'No actual admission benefit; reject proposed strategy');
const out='artifacts/discovery-admission/benchmark';await mkdir(out,{recursive:true});await writeFile(out+'/results.json',JSON.stringify({method:corpus.labelPolicy,summary,results},null,2));console.log(JSON.stringify({summary,results},null,2));
