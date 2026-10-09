/** Local authorized experiment. No Graph/cache imports or writes; no credential discovery. */
import {randomBytes,timingSafeEqual} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {BudgetLedger} from '../../src/discovery/budget.ts';
import {NetworkLedger} from '../../src/discovery/network.ts';
import {RepositorySnapshotResolver,SNAPSHOT_PROFILE,SNAPSHOT_NETWORK} from '../../src/discovery/resolution.ts';
import type {Resolution} from '../../src/discovery/resolution.ts';
import {parseObservation} from '../../src/discovery/search-contract.ts';
import {buildQueryPlan,discoverRepositories} from '../../src/discovery/search.ts';
import {sealPreviewExport,searchDiscoveries} from './preview-contract.ts';
import type {PreviewExport} from './preview-contract.ts';
import {stableJSON} from '../../src/discovery/offline.ts';
import {sha256} from '../../src/discovery/snapshot.ts';
import {runPinnedProbe} from '../../src/discovery/pinned-probe.ts';
import type {Transport} from '../../src/discovery/search-provider.ts';
import type {SnapshotReceipt} from '../../src/discovery/snapshot-provider.ts';

export const PREVIEW_PROFILE=Object.freeze({...SNAPSHOT_PROFILE,searchAttempts:2});
const selections=[{path:'index.js',reason:'fixed root JavaScript entry'}, {path:'index.ts',reason:'fixed root TypeScript entry'}, {path:'src/index.js',reason:'fixed src JavaScript entry'}, {path:'src/index.ts',reason:'fixed src TypeScript entry'}];
type SearchOutput={target:Resolution|null;result:Awaited<ReturnType<typeof discoverRepositories>>|null;requests:SnapshotReceipt[];usage:ReturnType<BudgetLedger['usage']>;network:ReturnType<NetworkLedger['usage']>;scope:string};
export interface PreviewTask {id:string;kind:'search'|'compare';state:'running'|'completed'|'partial'|'cancelled';phase:string;createdAt:string;error:string|null;search?:SearchOutput;comparison?:Awaited<ReturnType<typeof runPinnedProbe>>;export?:PreviewExport}
export interface PreviewOptions {transport?:Transport;cooldownMs?:number}
export function repositoryInput(value:unknown):string {
 if(typeof value!=='string'||value.length>180)throw new Error('invalid repository');
 const name=value.trim().replace(/^https:\/\/github\.com\//,'').replace(/\/$/,'').toLowerCase();
 if(!/^[a-z0-9][a-z0-9-]{0,38}\/[a-z0-9_.-]{1,100}$/.test(name)||['.','..'].includes(name.split('/')[1]!))throw new Error('invalid repository; use public owner/repo');
 return name;
}
export function createPreview(options:PreviewOptions={}) {
 const session=randomBytes(32).toString('hex'),tasks=new Map<string,PreviewTask>(),controllers=new Map<string,AbortController>(),promises=new Map<string,Promise<void>>();
 let active:string|null=null,lastStart=0,quotaUntil=0;const starts:number[]=[];
 const transport:Transport=options.transport??((url,init)=>fetch(url,init));
 function get(id:string){const task=tasks.get(id);if(!task||Date.now()-Date.parse(task.createdAt)>1800000)throw new Error('task unavailable or expired');return task;}
 function tracked(task:PreviewTask):Transport{return async(url,init)=>{const path=new URL(url).pathname;task.phase=path==='/search/repositories'?'searching candidates':path.includes('/git/blobs/')?'reading pinned source':path.includes('/git/trees/')?'reading pinned tree':path.includes('/commits/')?'pinning commit':'verifying repository ID';
  const response=await transport(url,init);const retry=response.headers.get('retry-after');const reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
  if([403,429].includes(response.status)||response.headers.get('x-ratelimit-remaining')==='0'||retry){const delay=retry?( /^\d+$/.test(retry)?Date.now()+Number(retry)*1000:Date.parse(retry)):0;quotaUntil=Math.max(quotaUntil,reset||0,delay||0,Date.now()+60000);}
  return response;
 };}
 function begin(kind:PreviewTask['kind'],run:(task:PreviewTask,signal:AbortSignal)=>Promise<boolean>) {
  const now=Date.now();if(now<quotaUntil)throw new Error('quota unavailable until '+new Date(quotaUntil).toISOString());if(active)throw new Error('preview busy: one task at a time');
  if(now-lastStart<(options.cooldownMs??15000))throw new Error('preview cooldown: wait before starting another task');
  while(starts[0]!==undefined&&starts[0]<now-60000)starts.shift();if(starts.length>=4)throw new Error('preview frequency limit: four tasks per minute');
  for(const [id,task] of tasks)if(now-Date.parse(task.createdAt)>1800000){tasks.delete(id);promises.delete(id);}
  while(tasks.size>=12){const id=tasks.keys().next().value!;tasks.delete(id);promises.delete(id);}
  const task:PreviewTask={id:randomBytes(12).toString('hex'),kind,state:'running',phase:'starting',createdAt:new Date(now).toISOString(),error:null};
  const controller=new AbortController();tasks.set(task.id,task);controllers.set(task.id,controller);active=task.id;lastStart=now;starts.push(now);
  const timer=setTimeout(()=>controller.abort('deadline: 30 seconds'),30000);
  const promise=(async()=>{try{const complete=await run(task,controller.signal);task.state=controller.signal.aborted?'cancelled':complete?'completed':'partial';}catch(error){task.error=error instanceof Error?error.message:'preview failed';task.state=controller.signal.aborted?'cancelled':'partial';}finally{if(controller.signal.aborted&&!task.error)task.error=String(controller.signal.reason);clearTimeout(timer);task.phase=task.state;controllers.delete(task.id);active=null;}})();promises.set(task.id,promise);return task;
 }
 function startSearch(input:unknown){const name=repositoryInput(input);return begin('search',async(task,signal)=>{
  const ledger=new BudgetLedger(PREVIEW_PROFILE,signal),network=new NetworkLedger(ledger,SNAPSHOT_NETWORK),resolver=new RepositorySnapshotResolver(network,{transport:tracked(task)});
  const raw=await resolver.provider.get(`/repos/${name}`,network),observation=raw?parseObservation(raw,new Date().toISOString(),'repository_metadata'):null;
  const target=observation?await resolver.resolve(observation.repositoryId,[observation]):null;
  let result:SearchOutput['result']=null;
  if(target?.identity&&!resolver.provider.stopped){task.phase='searching candidates';result=await discoverRepositories(buildQueryPlan(target.identity,{}, {perPage:3,pages:1}),{transport:tracked(task)},network);}
  task.search={target,result,requests:resolver.provider.receipts,usage:ledger.usage(),network:network.usage(),scope:'one name query, first three results, at most three candidates; no whole-GitHub coverage'};
  if(!target?.identity)task.error=target?.reasons.join('; ')??'bootstrap: '+resolver.provider.failure();
  else if(result&&result.coverage.state!=='complete_within_requested')task.error=`Search ${result.coverage.state}: ${result.attempts.filter(a=>a.outcome!=='success').map(a=>a.outcome).join('; ')||'unfetched pages or rejected identities; see coverage'}`;
  return !!target?.identity&&result?.coverage.state==='complete_within_requested';
 });}
 function startCompare(searchId:string,ids:unknown){
  const parent=get(searchId),search=parent.search;if(parent.kind!=='search'||parent.state==='running'||!search?.target?.identity||!search.result)throw new Error('completed target search required');
  if(!Array.isArray(ids)||ids.length<1||ids.length>2||new Set(ids).size!==ids.length)throw new Error('select one or two distinct discovered IDs');
  const candidates=ids.map(id=>{const c=search.result!.candidates.find(c=>c.candidate.repositoryId===id);if(!c||c.candidate.conflicts.includes('name_id_collision'))throw new Error('only unambiguous discovered IDs can be compared');return c;});
  const target=search.target.identity;
  return begin('compare',async(task,signal)=>{
   task.comparison=await runPinnedProbe([{name:target.fullName,repositoryId:target.repositoryId,revision:target.revision,selections},...candidates.map(c=>({name:c.candidate.fullName,repositoryId:c.candidate.repositoryId,observations:c.candidate.observations,selections}))],{transport:tracked(task),profile:PREVIEW_PROFILE,signal,discoveryById:new Map(candidates.map(c=>[c.candidate.repositoryId,searchDiscoveries(c)]))});
   task.export=sealPreviewExport({schemaVersion:'discovery-preview-provenance@1',searchTaskId:parent.id,compareTaskId:task.id,searchContentDigest:sha256(stableJSON(search.result)),target:{repositoryId:target.repositoryId!,revision:target.revision},candidates:candidates.map((c,i)=>({repositoryId:c.candidate.repositoryId,revision:task.comparison!.content.snapshots[i+1]?.resolution?.identity?.revision??null,searchCandidate:structuredClone(c)})),status:'search_observation_only'},task.comparison);
   return task.comparison.content.coverage.state==='completed';
  });
 }
 function cancel(id:string){get(id);controllers.get(id)?.abort('user cancelled');}
 function equal(a:string,b:string){return a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
 async function handler(req:IncomingMessage,res:ServerResponse){
  const send=(code:number,value:unknown)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
  const host=req.headers.host??'',remote=req.socket.remoteAddress;
  if(!/^(?:127\.0\.0\.1|localhost):\d+$/.test(host)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote??'')||req.headers.forwarded||req.headers['x-forwarded-for']||req.headers['x-forwarded-host']){send(403,{error:'local authorized preview only'});return;}
  const url=new URL(req.url??'/',`http://${host}`);
  if(req.method==='GET'&&url.pathname.startsWith('/preview-access/')){
   if(!equal(url.pathname.slice('/preview-access/'.length),session)){send(403,{error:'invalid preview access'});return;}
   res.writeHead(303,{'set-cookie':`gl_preview=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800`,'location':'/','cache-control':'no-store','referrer-policy':'no-referrer'});res.end();return;
  }
  const cookie=req.headers.cookie?.split(';').map(p=>p.trim()).find(p=>p.startsWith('gl_preview='))?.slice(11)??'';
  if(!equal(cookie,session)){send(403,{error:'preview authorization required'});return;}
  if(req.method==='GET'&&url.pathname==='/api/deep-search/capabilities'){send(200,{enabled:true,scope:'local authorized alpha',budget:PREVIEW_PROFILE,network:SNAPSHOT_NETWORK,cooldownMs:options.cooldownMs??15000,selectedCandidates:2,paths:selections.map(s=>s.path),verification:'pending',lineageClaim:'none'});return;}
  if(req.method==='GET'&&/^\/api\/deep-search\/tasks\/[a-f0-9]{24}$/.test(url.pathname)){try{send(200,get(url.pathname.split('/').at(-1)!));}catch{send(404,{error:'task unavailable or expired'});}return;}
  if(req.method!=='POST'||req.headers.origin!==`http://${host}`||!/^application\/json(?:;|$)/.test(req.headers['content-type']??'')){send(403,{error:'same-origin JSON required'});return;}
  let data:Record<string,unknown>;try{let bytes=0;const parts:Buffer[]=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2048){send(413,{error:'request too large'});return;}parts.push(chunk);}data=JSON.parse(Buffer.concat(parts).toString());if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();}catch{send(400,{error:'invalid JSON'});return;}
  try{
   if(url.pathname==='/api/deep-search/search'&&Object.keys(data).join() ==='repository'){send(202,startSearch(data.repository));return;}
   if(url.pathname==='/api/deep-search/compare'&&Object.keys(data).sort().join()==='candidateIds,searchId'&&typeof data.searchId==='string'){send(202,startCompare(data.searchId,data.candidateIds));return;}
   if(/^\/api\/deep-search\/tasks\/[a-f0-9]{24}\/cancel$/.test(url.pathname)&&Object.keys(data).length===0){const id=url.pathname.split('/').at(-2)!;cancel(id);send(200,get(id));return;}
   send(400,{error:'invalid preview request'});
  }catch(error){const message=error instanceof Error?error.message:'preview unavailable';send(/quota|busy|cooldown|frequency/.test(message)?429:400,{error:message});}
 }
 return {handler,startSearch,startCompare,cancel,get,wait:async(id:string)=>{await promises.get(id);return get(id);},accessPath:`/preview-access/${session}`,close:async()=>{for(const id of controllers.keys())cancel(id);await Promise.all(promises.values());}};
}
