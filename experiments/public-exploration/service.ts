/** Anonymous, bounded sidecars. No canonical graph/cache imports or writes. */
import {randomBytes} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {isIP} from 'node:net';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {createPreview,repositoryInput,PREVIEW_PROFILE} from '../discovery-v2/preview.ts';
import type {FileChoice} from '../discovery-v2/preview.ts';
import type {Transport} from '../../src/discovery/search-provider.ts';
export type {Transport} from '../../src/discovery/search-provider.ts';
import {createRepositoryExplorer} from './repository-explorer.ts';

export function createPublicExploration(options:{transport?:Transport;cooldownMs?:number;origin?:string;trustedProxies?:string[];attemptsPerHour?:number;attemptsPerAddress?:number;startIntervalMs?:number}={}) {
 const fixedOrigin=options.origin?new URL(options.origin):null;
 if(fixedOrigin&&(fixedOrigin.origin!==options.origin||!['http:','https:'].includes(fixedOrigin.protocol)||fixedOrigin.username||fixedOrigin.password))throw new Error('Public exploration requires an exact HTTP(S) origin');
 const owners=new Map<string,{visitor:string;address:string;searchId:string;kind:'deep'|'explore';created:number}>();
 const trusted=new Set(options.trustedProxies??[]);if([...trusted].some(ip=>!isIP(ip))||trusted.size&&!fixedOrigin)throw new Error('Trusted proxies require exact origin and IP addresses');
 const limits={global:options.attemptsPerHour??1200,address:options.attemptsPerAddress??120,interval:options.startIntervalMs??10000};
 if(!Number.isSafeInteger(limits.global)||limits.global<1||limits.global>10000||!Number.isSafeInteger(limits.address)||limits.address<1||limits.address>limits.global||!Number.isSafeInteger(limits.interval)||limits.interval<0)throw new Error('Invalid anonymous limits');
 const starts=new Map<string,number>(),costs=new Map<string,number>(),scope=new AsyncLocalStorage<string>();let spentAttempts=0,windowEnd=Date.now()+3600000,quotaUntil=0;
 function refresh(){if(Date.now()>=windowEnd){spentAttempts=0;windowEnd=Date.now()+3600000;costs.clear();starts.clear();}}
 const usage=()=>{refresh();return {spentAttempts,attemptsPerHour:limits.global,attemptsPerAddress:limits.address,resetAt:new Date(windowEnd).toISOString(),scope:'actual HTTP attempts charged before dispatch, including failures; per process; restart resets anonymous quota'};};
 function available(address:string){refresh();if(Date.now()<quotaUntil)throw new Error('GitHub quota unavailable until '+new Date(quotaUntil).toISOString());if(spentAttempts>=limits.global||(costs.get(address)??0)>=limits.address)throw new Error('Anonymous quota exhausted; resets '+new Date(windowEnd).toISOString());}
 const send=(res:ServerResponse,status:number,value:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff'});res.end(JSON.stringify(value));};
 const transport:Transport=async(url,init)=>{
  const address=scope.getStore();if(!address)throw new Error('Request owner unavailable');available(address);spentAttempts++;costs.set(address,(costs.get(address)??0)+1);
  const response=await (options.transport??fetch)(url,init);
  if([403,429].includes(response.status)||response.headers.get('x-ratelimit-remaining')==='0'){
   const reset=Number(response.headers.get('x-ratelimit-reset'))*1000,retry=Number(response.headers.get('retry-after'))*1000;
   quotaUntil=Math.max(quotaUntil,reset||0,Date.now()+(retry||60000));
  }return response;
 };
 // Both engines consume the same process-wide provider cooldown and actual request pool.
 const engine=createPreview({...options,enrichedSearch:true,transport}),repoEngine=createRepositoryExplorer({...options,transport});
 function reserve(address:string){available(address);const last=starts.get(address);if(last!==undefined&&Date.now()-last<limits.interval)throw new Error('Anonymous frequency limit; retry in '+Math.ceil((limits.interval-(Date.now()-last))/1000)+' seconds');if(repoEngine.busy()||engineBusy())throw new Error('Shared service busy; retry after current operation');}
 function engineBusy(){return [...owners].some(([id,o])=>o.kind==='deep'&&(()=>{try{return engine.get(id).state==='running';}catch{return false;}})());}
 function debit(address:string){starts.set(address,Date.now());}
 async function handler(req:IncomingMessage,res:ServerResponse){
  const host=req.headers.host??'',socket=req.socket.remoteAddress??'unknown',forwarded=Object.keys(req.headers).filter(k=>k==='forwarded'||k.startsWith('x-forwarded-'));
  let address=socket;
  if(forwarded.length){const allowed=['x-forwarded-for','x-forwarded-host','x-forwarded-proto'];const client=req.headers['x-forwarded-for'];
   if(!trusted.has(socket)||!fixedOrigin||forwarded.some(k=>!allowed.includes(k))||typeof client!=='string'||!isIP(client)||req.headers['x-forwarded-host']!==fixedOrigin.host||req.headers['x-forwarded-proto']!==fixedOrigin.protocol.slice(0,-1)){send(res,403,{error:'Untrusted or ambiguous proxy headers'});return;}address=client;
  }
  if(fixedOrigin?host!==fixedOrigin.host:!/^localhost:\d+$|^127\.0\.0\.1:\d+$/.test(host)){send(res,403,{error:'Invalid host'});return;}
  const origin=fixedOrigin?.origin??`http://${host}`,url=new URL(req.url??'/',origin);
  const cookie=req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>/^gl_visitor=[a-f0-9]{48}$/.test(s))?.slice(11);
  const visitor=cookie??randomBytes(24).toString('hex');
  const owned=(id:string)=>{const o=owners.get(id);if(!o||o.visitor!==visitor||o.address!==address||Date.now()-o.created>1800000)throw new Error('Result unavailable or expired');return o;};
  const remember=(id:string,kind:'deep'|'explore',searchId=id)=>{owners.set(id,{visitor,address,kind,searchId,created:Date.now()});res.setHeader('set-cookie',`gl_visitor=${visitor}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${fixedOrigin?.protocol==='https:'?'; Secure':''}`);};
  for(const [id,o] of owners)if(Date.now()-o.created>1800000)owners.delete(id);
  if(req.method==='GET'&&url.pathname==='/api/deep-search/capabilities'){send(res,200,{enabled:true,scope:'anonymous',budget:PREVIEW_PROFILE,cooldownMs:options.cooldownMs??15000,quota:usage(),verification:'pending',lineageClaim:'none'});return;}
  if(req.method==='GET'&&/^\/api\/(?:deep-search\/tasks|explore)\/[a-f0-9]{24}$/.test(url.pathname)){
   try{const id=url.pathname.split('/').at(-1)!,o=owned(id);send(res,200,{...(o.kind==='deep'?engine.get(id):repoEngine.get(id)),serviceQuota:usage()});}catch{send(res,404,{error:'Result unavailable or expired'});}return;
  }
  if(req.method!=='POST'||req.headers.origin!==origin||req.headers['x-gitlineage-csrf']!=='1'||!/^application\/json(?:;|$)/.test(req.headers['content-type']??'')){send(res,403,{error:'Same-origin JSON with CSRF header required'});return;}
  let body:Record<string,unknown>;
  try {
   const chunks:Buffer[]=[];let bytes=0;const timeout=setTimeout(()=>req.destroy(),5000);
   try{for await(const chunk of req){bytes+=chunk.length;if(bytes>4096)throw new Error('Body exceeds 4 KiB');chunks.push(chunk);}body=JSON.parse(Buffer.concat(chunks).toString());if(!body||typeof body!=='object'||Array.isArray(body))throw new Error('Invalid JSON');}finally{clearTimeout(timeout);}
  }catch{if(!res.destroyed)send(res,400,{error:'Invalid or oversized JSON body'});return;}
  try{
   if(['/api/deep-search/search','/api/explore'].includes(url.pathname)&&Object.keys(body).join()==='repository'){
    const repository=repositoryInput(body.repository);reserve(address);
    const kind=url.pathname==='/api/explore'?'explore':'deep';
    const task=scope.run(address,()=>kind==='deep'?engine.startSearch(repository):repoEngine.start(repository));debit(address);remember(task.id,kind);send(res,202,{...task,serviceQuota:usage()});return;
   }
   if(['/api/deep-search/sources','/api/deep-search/compare'].includes(url.pathname)&&typeof body.searchId==='string'){
    if(repoEngine.busy())throw new Error('Shared service busy');const owner=owned(body.searchId);if(owner.kind!=='deep')throw new Error('Search task required');
    if(body.selection){const choice=body.selection as FileChoice;const source=owned(choice.sourceTaskId);if(source.searchId!==body.searchId)throw new Error('Source task mismatch');}
    available(address);const task=scope.run(address,()=>url.pathname.endsWith('/sources')?engine.startSources(body.searchId as string,body.candidateIds):engine.startCompare(body.searchId as string,body.candidateIds,body.selection as FileChoice|undefined));
    remember(task.id,'deep',body.searchId);send(res,202,{...task,serviceQuota:usage()});return;
   }
   const match=url.pathname.match(/^\/api\/(deep-search\/tasks|explore)\/([a-f0-9]{24})\/(cancel|directory|revision|history|branches|manifest)$/);
   if(match){const id=match[2]!,owner=owned(id);if(match[3]==='cancel'){owner.kind==='deep'?engine.cancel(id):repoEngine.cancel(id);send(res,200,{cancelled:true});return;}
    if(engineBusy())throw new Error('Shared service busy');if(owner.kind!=='explore')throw new Error('Repository exploration required');
    available(address);const task=await scope.run(address,()=>match[3]==='directory'?repoEngine.directory(id,body.path):match[3]==='history'?repoEngine.history(id):match[3]==='branches'?repoEngine.branches(id):match[3]==='manifest'?repoEngine.manifest(id,body.path):repoEngine.revision(id,body.sha));send(res,200,{...task,serviceQuota:usage()});return;}
   send(res,400,{error:'Invalid exploration request'});
  }catch(error){const message=error instanceof Error?error.message:'Exploration unavailable';send(res,/quota|frequency|busy|cooldown|exhausted/.test(message)?429:400,{error:message,quota:usage(),retryAt:new Date(Math.max(quotaUntil,Date.now()+limits.interval,spentAttempts>=limits.global||(costs.get(address)??0)>=limits.address?windowEnd:0)).toISOString()});}
 }
 return {handler,usage,wait:async(id:string)=>{const o=owners.get(id);return o?.kind==='deep'?engine.wait(id):repoEngine.wait(id);},close:async()=>{await Promise.all([engine.close(),repoEngine.close()]);}};
}
