import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metadata,relevance} from '../../src/discovery/relevance.ts';
import {reviewPriority} from '../../src/discovery/review-priority.ts';
test('purpose support outweighs name collisions; abstain without sufficient metadata',()=>{
 const target=metadata({description:'Run multiple promise-returning async functions with limited concurrency',language:'JavaScript',topics:['concurrency']});
 assert.equal(relevance(target,metadata({description:'Limit order protocol for decentralized exchange',language:'Solidity'})).level,'insufficient');
 assert.equal(relevance(target,metadata({description:'Promise queue with concurrency control',language:'TypeScript'})).level,'supported');
 assert.equal(relevance(target,metadata({language:'JavaScript'})).level,'insufficient');
 assert.equal(relevance(target,metadata({description:'Promise queue with concurrency control',language:'Python'})).level,'insufficient');
 assert.equal(relevance(target,metadata({topics:['concurrency'],language:'JavaScript'})).level,'supported');
 assert.deepEqual(relevance(target,target),relevance(target,target));
 assert.deepEqual(metadata({description:'x'.repeat(513),language:{},topics:['ok',42]}),{description:null,language:null,topics:['ok']});
 assert.equal(metadata({description:'credential-value'},'credential-value').description,null);
});
test('review priority separates syntax from distinctive shared implementation, without changing measurements',()=>{
 const syntax=['export','function','foo','(',')','{','return','bar','(',')',';','}'];
 assert.equal(reviewPriority('a.js','b.js',syntax,5).level,'limited');
 assert.equal(reviewPriority('config.js','config.js',['concurrency','queue','enqueue','pending'],30).level,'limited');
 assert.equal(reviewPriority('src/a.js','lib/b.ts',['concurrency','queue','enqueue','pending'],30).level,'review');
 assert.equal(reviewPriority('src/a.js','lib/b.ts',['distinctive','algorithm'],6).level,'limited');
});
import {buildQueryPlan,discoverRepositories} from '../../src/discovery/search.ts';
import {createPreview} from '../../experiments/discovery-v2/preview.ts';
import {relevanceFixture,purpose} from './v4-fixture.ts';
test('real provider orders admitted candidates without extra requests and preserves manual scope',async()=>{
 const f=relevanceFixture(),p=createPreview({transport:f.transport,cooldownMs:0});
 try{const s=p.startSearch('root/example');await p.wait(s.id);assert.deepEqual(s.search!.result!.candidates.map(c=>c.candidate.repositoryId),[4,2,3]);assert.equal(s.search!.result!.relevance.sufficient,true);assert.equal(f.calls.filter(c=>c==='/search/repositories').length,1);
 const t=p.startSources(s.id,[3]);await p.wait(t.id);assert.deepEqual(t.sources!.candidateIds,[3]);assert.equal(t.sourceExport!.lineageClaim,'none');
 }finally{await p.close();}
});
test('no relevant results abstains, metadata cannot leak a credential',async()=>{
 const target={provider:'github' as const,repositoryId:1,completeness:'provider_id' as const,fullName:'root/example',aliases:[],revision:'a'.repeat(40)};
 const r=await discoverRepositories(buildQueryPlan(target),{token:'private-token',targetMetadata:purpose,transport:async()=>new Response(JSON.stringify({total_count:1,incomplete_results:false,items:[{id:2,full_name:'other/example',html_url:'https://github.com/other/example',description:'private-token',topics:['private-token'],language:'private-token'}]}))});
 assert.equal(r.relevance.sufficient,false);assert.equal(r.usage.attempts,1);assert.ok(!JSON.stringify(r).includes('private-token'));assert.equal(r.candidates[0]!.lineageClaim,'none');
});

test('promotional words and repository self-tags do not imply common purpose',()=>{
 const a=metadata({full_name:'vitejs/vite',description:'Next generation frontend tooling. It is fast!',topics:['vite','build-tool'],language:'TypeScript'});
 const b=metadata({description:'Next generation testing framework powered by Vite.',topics:['vite','testing-tools'],language:'TypeScript'});
 assert.equal(relevance(a,b).level,'insufficient');
});

test('language, platform and package topics alone never imply shared purpose',()=>{
 for(const topic of ['javascript','nodejs','npm-package','node-module','nodejs-module','npm-module','node-modules','package','modules']){
 const target=metadata({description:'Color terminal text',language:'JavaScript',topics:[topic]});
 const candidate=metadata({description:'HTTP request router',language:'JavaScript',topics:[topic]});
 assert.equal(relevance(target,candidate).level,'insufficient',topic);
 }
});
import {validateReviewReceipt} from '../../experiments/discovery-v2/review-receipt.ts';
import {sha256} from '../../src/discovery/snapshot.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
test('new receipt version preserves validation of sealed V3 review receipts',async()=>{
 const f=relevanceFixture(),p=createPreview({transport:f.transport,cooldownMs:0});
 try{const s=p.startSearch('root/example');await p.wait(s.id);const t=p.startSources(s.id,[4]);await p.wait(t.id);
 const files=t.recommendation!.repositories.map(r=>({repositoryId:r.repositoryId,paths:r.selected.map(f=>f.path)}));
 const c=p.startCompare(s.id,[4],{sourceTaskId:t.id,files});await p.wait(c.id);
 const legacy:any=structuredClone(c.review!);legacy.schemaVersion='discovery-review-receipt@1';
 for(const comparison of legacy.comparisons)for(const pair of comparison.pairs){delete pair.priority;delete pair.priorityReason;}
 delete legacy.contentDigest;legacy.contentDigest=sha256(stableJSON(legacy));validateReviewReceipt(legacy,c.export!);
 assert.equal(c.review!.schemaVersion,'discovery-review-receipt@2');validateReviewReceipt(c.review!,c.export!);
 legacy.comparisons[0].pairs[0].outcome='unavailable';assert.throws(()=>validateReviewReceipt(legacy,c.export!));
 }finally{await p.close();}
});
