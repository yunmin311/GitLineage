import {BudgetError} from './budget.ts';
import {NetworkLedger} from './network.ts';
import type {ProviderOptions, Transport, AttemptOutcome} from './search-provider.ts';
export interface SnapshotRequest {endpoint:string;status:number|null;outcome:AttemptOutcome;reason:string|null;reservedBytes:number;receivedBytes:number;retainedBytes:number}
export interface SnapshotReceipt {request:SnapshotRequest;startedAt:string;wallMs:number;headers:Record<string,string>}
/** ID-scoped, content-addressed GitHub API only; no redirects, cache or automatic retry.
 * Numeric-ID subroutes are probed separately; unavailable routes never fall back to HEAD.
 */
export class SnapshotProvider {
 private transport:Transport;private token:string|undefined;private timeout:number;
 readonly receipts:SnapshotReceipt[]=[];stopped=false;private now:()=>string;
 constructor(options:ProviderOptions={},now=()=>new Date().toISOString()){
  this.now=now;
  if(options.token!==undefined&&!/^[a-zA-Z0-9_.-]{1,256}$/.test(options.token))throw new TypeError('invalid explicit credential');
  this.timeout=options.timeoutMs??10000;if(!Number.isSafeInteger(this.timeout)||this.timeout<1||this.timeout>20000)throw new TypeError('invalid request timeout');
  this.token=options.token;this.transport=options.transport??((url,init)=>fetch(url,init));
 }
 async get(endpoint:string,network:NetworkLedger):Promise<unknown|null>{
  if(!/^\/repositories\/[1-9]\d*(?:\/commits\/[^/?#]+|\/git\/(?:trees|blobs)\/[a-f0-9]{40})?$/.test(endpoint)&&!/^\/repos\/[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(endpoint))throw new TypeError('endpoint not allowed');
  if(endpoint.split('/').some(p=>p==='.'||p==='..'))throw new TypeError('unsafe endpoint segment');
  const startedAt=this.now();if(!Number.isFinite(Date.parse(startedAt)))throw new TypeError('invalid receipt clock');
  const started=performance.now(),request:SnapshotRequest={endpoint,status:null,outcome:'budget_denied',reason:null,reservedBytes:0,receivedBytes:0,retainedBytes:0};
  const receipt:SnapshotReceipt={request,startedAt,wallMs:0,headers:{}};this.receipts.push(receipt);
  let release:(()=>void)|undefined;const controller=new AbortController();let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,body:Response['body']=null,finished=false,timedOut=false;
  let rejectStop:(error:Error)=>void=()=>{};const interrupted=new Promise<never>((_,reject)=>{rejectStop=reject;});void interrupted.catch(()=>{});
  const stop=()=>{controller.abort();rejectStop(new Error('interrupted'));if(reader)void reader.cancel().catch(()=>{});else if(body)void body.cancel().catch(()=>{});};
  let timer:ReturnType<typeof setTimeout>|undefined;
  const guarded=async<T>(promise:Promise<T>):Promise<T>=>{network.budget.guard();if(controller.signal.aborted)throw new Error('interrupted');const result=await Promise.race([promise,interrupted]);network.budget.guard();if(controller.signal.aborted)throw new Error('interrupted');return result;};
  try{
   if(this.stopped){request.reason='provider stopped by rate limit or redirect';return null;}
   release=network.reserve(false);request.reservedBytes=network.profile.perResponseBytes;
   network.budget.signal?.addEventListener('abort',stop,{once:true});timer=setTimeout(()=>{timedOut=true;stop();},Math.max(1,Math.min(this.timeout,network.budget.remainingMs())));
   const url=`https://api.github.com${endpoint}`,headers:Record<string,string>={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10','User-Agent':'GitLineage-Discovery-Experiment'};if(this.token)headers.Authorization=`Bearer ${this.token}`;
   network.budget.guard();const pending=this.transport(url,{method:'GET',redirect:'manual',headers,signal:controller.signal});void pending.then(r=>{if(finished||controller.signal.aborted)void r.body?.cancel().catch(()=>{});},()=>{});
   const response=await guarded(pending);body=response.body;request.status=response.status;
   for(const key of ['x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset','x-ratelimit-used','retry-after','x-ratelimit-resource','x-github-api-version-selected']){const value=response.headers.get(key);if(value&&value.length<=64&&(!this.token||!value.includes(this.token))&&(key==='x-ratelimit-resource'?/^(core|search)$/.test(value):key==='x-github-api-version-selected'?/^\d{4}-\d{2}-\d{2}$/.test(value):/^\d{1,16}$/.test(value)))receipt.headers[key]=value;}
   const retry=response.headers.get('retry-after');this.stopped=receipt.headers['x-ratelimit-remaining']==='0'||!!retry&&(/^[0-9]+$/.test(retry)?Number(retry)>0:Number.isFinite(Date.parse(retry)));
   if(response.redirected||response.url&&response.url!==url||response.status>=300&&response.status<400){request.outcome='redirect_rejected';this.stopped=true;return null;}
   if(response.status!==200){request.outcome=response.status===401?'unauthorized':[403,429].includes(response.status)?'rate_limit':'http_error';this.stopped ||= ['unauthorized','rate_limit'].includes(request.outcome);return null;}
   if(!body){request.outcome='invalid_response';return null;}reader=body.getReader();const chunks:Uint8Array[]=[];
   while(true){const part=await guarded(reader.read());if(part.done)break;const bytes=part.value.byteLength;request.receivedBytes+=bytes;if(request.retainedBytes+bytes>network.profile.perResponseBytes){network.received(bytes,0);request.outcome='response_bytes_exhausted';stop();return null;}request.retainedBytes+=bytes;network.received(bytes,bytes);chunks.push(part.value);}
   let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{request.outcome='invalid_json';return null;}
   // Never persist reflected credentials or untrusted API error text.
   if(this.token&&JSON.stringify(value).includes(this.token)){request.outcome='invalid_response';request.reason='credential reflection rejected';return null;}
   if(!value||typeof value!=='object'||Array.isArray(value)){request.outcome='invalid_response';return null;}request.outcome='success';return value;
  }catch(error){request.outcome=network.budget.signal?.aborted?'cancelled':timedOut||error instanceof BudgetError&&error.message.includes('deadline')?'timeout':!release?'budget_denied':'network_error';request.reason=error instanceof BudgetError?error.message:null;return null;
  }finally{finished=true;clearTimeout(timer);network.budget.signal?.removeEventListener('abort',stop);controller.abort();if(reader)void reader.cancel().catch(()=>{});else if(body)void body.cancel().catch(()=>{});release?.();receipt.wallMs=performance.now()-started;}
 }
 failure():string{const r=this.receipts.at(-1)?.request;return r?`${r.outcome}${r.reason?`: ${r.reason}`:''}`:'not attempted';}
}
