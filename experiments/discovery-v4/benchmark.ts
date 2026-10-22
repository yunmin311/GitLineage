import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {metadata,relevance} from '../../src/discovery/relevance.ts';
import {readSnapshot,sha256,gitBlob} from '../../src/discovery/snapshot.ts';
import {BudgetLedger} from '../../src/discovery/budget.ts';
import {PREVIEW_PROFILE} from '../discovery-v2/preview.ts';
import {compareSnapshots as baselineComparison} from '../../test/discovery/fixtures/v4/v3-similarity.ts';
import {compareSnapshots as currentComparison} from '../../src/discovery/similarity.ts';
import {runComparison} from '../../src/discovery/worker.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
import {core,corpus} from '../../test/discovery/v3-corpus.ts';
const dir='test/discovery/fixtures/v4',out=process.env.DISCOVERY_V4_OUT??'artifacts/discovery-v4/benchmark';await mkdir(out,{recursive:true});
const publicCorpus=JSON.parse(await readFile(dir+'/public-corpus.json','utf8'));
const candidates=publicCorpus.groups.map((group:any)=>{
 const target=metadata(publicCorpus.repositories[group.target]);const scored=group.candidates.map((c:any,index:number)=>({...c,index,...relevance(target,metadata(publicCorpus.repositories[c.name]))}));
 const permutations=<T,>(items:T[]):T[][]=>items.length?items.flatMap((item,i)=>permutations(items.filter((_,j)=>i!==j)).map(t=>[item,...t])):[[]];
 const orders=permutations(scored).map(order=>{const sorted=[...order].sort((a,b)=>b.order-a.order);return {v3:order.slice(0,2).filter(c=>c.relevant).length/2,v4:sorted.slice(0,2).filter(c=>c.relevant).length/2};});
 const orderRobustness={permutations:orders.length,v3Mean:orders.reduce((n,r)=>n+r.v3,0)/orders.length,v4Mean:orders.reduce((n,r)=>n+r.v4,0)/orders.length,better:orders.filter(r=>r.v4>r.v3).length,equal:orders.filter(r=>r.v4===r.v3).length,worse:orders.filter(r=>r.v4<r.v3).length};
 const ranked=[...scored].sort((a,b)=>b.order-a.order||a.index-b.index);
 return {target:group.target,orderRobustness,v3:scored,v4:ranked,v3Top2:scored.slice(0,2).filter((c:any)=>c.relevant).length/2,v4Top2:ranked.slice(0,2).filter((c:any)=>c.relevant).length/2,recommended:ranked.filter(c=>c.level==='supported'),missedRelevant:ranked.filter(c=>c.relevant&&c.level!=='supported'),falseRecommended:ranked.filter(c=>!c.relevant&&c.level==='supported')};
});
const source=(name:string)=>publicCorpus.sources.find((s:any)=>s.repository===name);
async function publicText(name:string){const s=source(name),text=await readFile(dir+'/'+s.fixture,'utf8');assert.equal(sha256(text),s.sha256);assert.equal(gitBlob(text),s.blob);return text;}
const limit=await publicText('sindresorhus/p-limit'),fork=await publicText('jucke/p-limit'),chalk=await publicText('chalk/chalk'),fastq=await publicText('mcollina/fastq');
// Labels come from construction or repository purpose, never from token scores.
const cases=[
 {id:'public-fork',a:limit,b:fork,valuable:true,kind:'public fork pair; lineage metadata is separate, source sharing must still be observed'},
 {id:'public-unrelated',a:limit,b:chalk,valuable:false,kind:'different purposes'},
 {id:'public-same-purpose',a:limit,b:fastq,valuable:false,kind:'concurrency utilities, independently different algorithms; no asserted shared fragment'},
 {id:'preserved-public-fragment',a:limit,b:'export const wrapperVersion = 42;\n'+limit,valuable:true,kind:'controlled extension of pinned public implementation'},
 {id:'renamed-public-implementation',a:limit,b:limit.replaceAll('activeCount','runningTotal').replaceAll('pendingCount','waitingTotal').replaceAll('concurrency','parallelism').replaceAll('queue','backlog'),valuable:true,kind:'controlled identifier renaming; exposes strict-token heuristic weakness'},
 {id:'short-template',a:'export function foo(value) { return value + 1; }',b:'export function bar(item) { return item + 2; }',valuable:false,kind:'authored common function syntax'},
 {id:'imports-template',a:'import fs from "node:fs"; import path from "node:path"; export default function main(args) { console.log(args); return true; }',b:'import fs from "node:fs"; import path from "node:path"; export default function start(options) { console.log(options); return false; }',valuable:false,kind:'common imports and template'},
 {id:'config-template',a:'export default {plugins: [], server: {port: 3000}, build: {outDir: "dist"}, resolve: {extensions: [".js", ".ts"]}};',b:'export default {plugins: [], server: {port: 8080}, build: {outDir: "build"}, resolve: {extensions: [".js", ".ts"]}};',valuable:false,path:'vite.config.js',kind:'configuration'},
 {id:'valuable-small-shared',a:core.toString(),b:'export const prefix = 42;\n'+core,valuable:true,kind:'authored known shared implementation'},
 ...corpus.filter(c=>!c.fault).flatMap(c=>Object.entries(c.target).filter(([p])=>c.relevantTarget.includes(p)).flatMap(([p,a])=>Object.entries(c.candidate).filter(([q])=>c.relevantCandidate.includes(q)).map(([q,b])=>({id:c.id+':'+p+':'+q,a:a.toString(),b:b.toString(),valuable:a.equals(b)||(a.includes(core)&&b.includes(core))||c.expectedShared.some(([x,y])=>x===p&&y===q),kind:'V3 authored corpus: exact content or known preserved implementation across paths',path:p,secondPath:q}))))
];
const rows=[];
const stripAnnotations=(result:ReturnType<typeof currentComparison>)=>({...result,measurements:result.measurements.map(m=>({...m,reasons:m.reasons.filter(r=>!r.startsWith('review-priority@1:'))}))});
function timed(run:()=>ReturnType<typeof currentComparison>){const start=performance.now(),cpu=process.cpuUsage(),result=run(),used=process.cpuUsage(cpu);return {result,wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000};}

for(const c of cases){const ledger=new BudgetLedger(PREVIEW_PROFILE),start=performance.now(),cpu=process.cpuUsage();
 const snapshot=async(text:string,id:number,path:string)=>readSnapshot({identity:{provider:'github',repositoryId:id,fullName:`fixture/r${id}`,completeness:'provider_id',aliases:[],revision:'a'.repeat(40)},files:[{path,content:text,digest:sha256(text)}]},ledger);
 const a=await snapshot(c.a,1,c.path??'src/a.js'),b=await snapshot(c.b,2,('secondPath' in c?c.secondPath:undefined)??c.path??'lib/b.js'),result=await runComparison(a,b,ledger);
 // Same snapshots, same process and alternating order for engine-cost comparison;
 // production worker is also exercised independently above. Not a latency SLA.
 let baseline,current;
 if(rows.length%2){current=timed(()=>currentComparison(a,b));baseline=timed(()=>baselineComparison(a,b));}
 else{baseline=timed(()=>baselineComparison(a,b));current=timed(()=>currentComparison(a,b));}
 assert.deepEqual(stripAnnotations(result),baseline.result,'V3 raw measurements/summary must remain unchanged');
 assert.deepEqual(result,current.result,'production worker and direct comparison must agree');
 const exact=result.measurements.find(m=>m.method==='exact_blob'),strict=result.measurements.find(m=>m.method==='strict_token5'),normalized=result.measurements.find(m=>m.method==='normalized_token5');
 const v3=exact?.score===1||(strict?.sharedShingles??0)>=5||(normalized?.sharedShingles??0)>=5;
 const v4=exact?.score===1||v3&&strict?.reasons.some(r=>r.startsWith('review-priority@1:review:'))===true;
 const used=process.cpuUsage(cpu);rows.push({id:c.id,kind:c.kind,valuable:c.valuable,v3Promoted:v3,v4Promoted:v4,rawPreserved:true,additionalMeasurementJSONBytes:Buffer.byteLength(JSON.stringify(result.measurements))-Buffer.byteLength(JSON.stringify(baseline.result.measurements)),measurements:result.measurements,engineCost:{v3:{wallMs:baseline.wallMs,cpuMs:baseline.cpuMs},v4:{wallMs:current.wallMs,cpuMs:current.cpuMs}},cost:{requests:0,responseBytes:0,sourceBytes:ledger.usage().totalBytes,wallMs:performance.now()-start,cpuMs:(used.user+used.system)/1000},budget:PREVIEW_PROFILE});
}
const groupMean=(key:'v3Top2'|'v4Top2')=>candidates.reduce((n:any,c:any)=>n+c[key],0)/candidates.length;
const negatives=rows.filter(r=>!r.valuable),positives=rows.filter(r=>r.valuable);
const summary={candidateCases:candidates.length,candidateCount:candidates.reduce((n:any,c:any)=>n+c.v3.length,0),v3Top2:groupMean('v3Top2'),v4Top2:groupMean('v4Top2'),orderRobustness:{permutations:candidates.reduce((n:any,c:any)=>n+c.orderRobustness.permutations,0),v3Mean:candidates.reduce((n:any,c:any)=>n+c.orderRobustness.v3Mean,0)/candidates.length,v4Mean:candidates.reduce((n:any,c:any)=>n+c.orderRobustness.v4Mean,0)/candidates.length,worse:candidates.reduce((n:any,c:any)=>n+c.orderRobustness.worse,0)},falseRecommendations:candidates.flatMap((c:any)=>c.falseRecommended).length,relevantAbstentions:candidates.flatMap((c:any)=>c.missedRelevant).map((c:any)=>c.name),sourceCases:rows.length,negativePairs:negatives.length,lowValuePromotedV3:negatives.filter(r=>r.v3Promoted).length,lowValuePromotedV4:negatives.filter(r=>r.v4Promoted).length,valuablePairs:positives.length,valuablePromotedV3:positives.filter(r=>r.v3Promoted).length,valuablePromotedV4:positives.filter(r=>r.v4Promoted).length,valuablePriorityLoss:positives.filter(r=>r.v3Promoted&&!r.v4Promoted).map(r=>r.id),rawEvidenceLoss:0,additionalMeasurementJSONBytes:rows.reduce((n,r)=>n+r.additionalMeasurementJSONBytes,0),replayRequests:0,replayResponseBytes:0,sourceBytes:rows.reduce((n,r)=>n+r.cost.sourceBytes,0),wallMs:rows.reduce((n,r)=>n+r.cost.wallMs,0),engineWallMs:{v3:rows.reduce((n,r)=>n+r.engineCost.v3.wallMs,0),v4:rows.reduce((n,r)=>n+r.engineCost.v4.wallMs,0)},engineCpuMs:{v3:rows.reduce((n,r)=>n+r.engineCost.v3.cpuMs,0),v4:rows.reduce((n,r)=>n+r.engineCost.v4.cpuMs,0)}};
const gate={rankingImproved:summary.orderRobustness.v4Mean>summary.orderRobustness.v3Mean,noFalseRecommendations:summary.falseRecommendations===0,lowValueReduced:summary.lowValuePromotedV4<summary.lowValuePromotedV3,valuablePriorityRetained:summary.valuablePromotedV4===summary.valuablePromotedV3};
const report={schemaVersion:'discovery-v4-benchmark@1',method:'Same metadata set and source pairs for V3 and V4. V3 original input order and >=5 strict/normalized shingles; V4 changes review priority only; every raw measurement and summary checked against frozen V3 engine at main 01563bc7. Alternating-order direct engine timing; production V4 worker additionally checked. Source worker under unchanged preview caps. All 24 input permutations per four-candidate set guard against favorable input ordering. Curated candidate sets expose ranking, not live-search recall or statistical precision. Public source and authored counterexamples reported separately by kind. Frozen labels precede algorithm execution. Authored cross-path positives include exact bytes and known core fragments; negatives mean no labeled distinctive shared implementation, not proof of independent authorship.',environment:{node:process.version,platform:process.platform,arch:process.arch},corpusDigest:sha256(stableJSON(publicCorpus)),summary,gate,candidates,rows,acquisition:publicCorpus.acquisition};
await writeFile(out+'/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify({summary,gate},null,2));if(!Object.values(gate).every(Boolean))process.exitCode=1;
