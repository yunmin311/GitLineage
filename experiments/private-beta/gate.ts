/** Explicit single-instance private gate. Never installed by normal production startup. */
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, realpathSync, openSync, closeSync, unlinkSync, statSync} from 'node:fs';
import {resolve, join, dirname, basename} from 'node:path';
import type {IncomingMessage, ServerResponse} from 'node:http';
import {createPreview, PREVIEW_PROFILE} from '../discovery-v2/preview.ts';
import type {PreviewTask, FileChoice} from '../discovery-v2/preview.ts';
import type {Transport} from '../../src/discovery/search-provider.ts';
import {SNAPSHOT_NETWORK} from '../../src/discovery/resolution.ts';

export interface Administrator {id:string;salt:string;passwordHash:string}
export function passwordHash(password:string,salt:string):string {return scryptSync(password,salt,64).toString('hex');}
export interface BetaOptions {
 enabled:boolean;origin:string;administrators:Administrator[];storeRoot:string;protectedRoots:string[];
 transport?:Transport;sessionMs?:number;cooldownMs?:number;
 limits?:{globalActive:number;userActive:number;attemptsPerHour:number;searchesPerUserHour:number;requestsPerMinute:number};
 now?:()=>number;
}
interface StoredTask {owner:string;task:PreviewTask}
interface State {version:1;window:number;reserved:number;blockedUntil:number;coreRemaining:number|null;searches:Record<string,number>;tasks:Record<string,StoredTask>}
const defaults={globalActive:2,userActive:1,attemptsPerHour:96,searchesPerUserHour:2,requestsPerMinute:90};
function physical(path:string):string {const full=resolve(path);return existsSync(full)?realpathSync(full):join(physical(dirname(full)),basename(full));}
function inside(path:string,root:string){return path===root||path.startsWith(root+'/');}
export function createBetaGate(options:BetaOptions){
 const now=options.now??Date.now, origin=new URL(options.origin);
 if(origin.origin!==options.origin||origin.pathname!=='/'||origin.username||origin.password||!(origin.protocol==='https:'||origin.protocol==='http:'&&['127.0.0.1','localhost'].includes(origin.hostname)))throw new Error('fixed HTTPS origin or loopback HTTP required');
 const limits={...defaults,...options.limits};for(const [k,v] of Object.entries(limits))if(!Number.isSafeInteger(v)||v<1||v>defaults[k as keyof typeof defaults])throw new Error('invalid service ceiling');
 if(options.enabled&&(!options.administrators.length||options.administrators.length>16))throw new Error('explicit administrators required');
 if(options.sessionMs!==undefined&&(!Number.isSafeInteger(options.sessionMs)||options.sessionMs<1||options.sessionMs>900000))throw new Error('session lifetime exceeds ceiling');
 const ids=new Set<string>();for(const a of options.administrators){if(!/^[a-zA-Z0-9_-]{1,48}$/.test(a.id)||Object.hasOwn(Object.prototype,a.id)||ids.has(a.id)||!/^[a-f0-9]{32,128}$/.test(a.salt)||!/^[a-f0-9]{128}$/.test(a.passwordHash))throw new Error('invalid administrator configuration');ids.add(a.id);}
 const sessions=new Map<string,{owner:string;expires:number}>(),engines=new Map<string,ReturnType<typeof createPreview>>(),active=new Map<string,string>(),rates=new Map<string,number[]>();
 const cookieName=origin.protocol==='https:'?'__Host-gl_beta':'gl_beta';
 const file=join(resolve(options.storeRoot),'state.json'),lock=join(resolve(options.storeRoot),'instance.lock');let closed=false;
 let state:State={version:1,window:now(),reserved:0,blockedUntil:0,coreRemaining:null,searches:{},tasks:{}};
 function save(){if(!options.enabled)return;const temporary=file+'.'+randomBytes(12).toString('hex')+'.tmp';writeFileSync(temporary,JSON.stringify(state),{mode:0o600,flag:'wx'});renameSync(temporary,file);}
 if(options.enabled){
  const root=physical(options.storeRoot);
  if(!options.protectedRoots.length||options.protectedRoots.some(p=>{const protectedRoot=physical(p);return inside(root,protectedRoot)||inside(protectedRoot,root);}))throw new Error('Beta store must be physically separate from checkout, cache and jobs');
  // Lock is deliberately fail-closed after an unclean exit. Operator must verify the old instance stopped before removing it.
  mkdirSync(options.storeRoot,{recursive:true,mode:0o700});
  const directory=statSync(options.storeRoot);if((directory.mode&0o077)!==0||directory.uid!==process.getuid?.())throw new Error('private store requires owner-only permissions');
  closeSync(openSync(lock,'wx',0o600));
  try{if(existsSync(file)){state=JSON.parse(readFileSync(file,'utf8'));if(state.version!==1||!Number.isFinite(state.window)||!Number.isSafeInteger(state.reserved)||!state.tasks||!state.searches||!Number.isFinite(state.blockedUntil))throw new Error('invalid durable state');for(const stored of Object.values(state.tasks))if(stored.task.state==='running'){stored.task.state='partial';stored.task.phase='partial';stored.task.error='service restarted; task failed; new bounded search required';delete stored.task.export;delete stored.task.sourceExport;}}save();}catch(error){unlinkSync(lock);throw error;}
 }
 function window(){if(now()-state.window>=3600000){state.window=now();state.reserved=0;state.coreRemaining=null;state.searches={};save();}}
 function rate(key:string,max:number){const list=(rates.get(key)??[]).filter(t=>now()-t<60000);if(list.length>=max)throw new Error('request frequency exhausted');list.push(now());rates.set(key,list);}
 function clean<T>(value:T):T {let text=JSON.stringify(value);for(const secret of [...sessions.keys(),...options.administrators.map(a=>a.passwordHash)])text=text.split(secret).join('[redacted]');return JSON.parse(text);}
 function engine(owner:string){let e=engines.get(owner);if(!e){e=createPreview({cooldownMs:options.cooldownMs,transport:async(url,init)=>{
   if(now()<state.blockedUntil)throw new Error('shared GitHub quota unavailable');
   const response=await (options.transport??fetch)(url,init);const remaining=response.headers.get('x-ratelimit-remaining'),reset=Number(response.headers.get('x-ratelimit-reset'))*1000;
   if(response.headers.get('x-ratelimit-resource')==='core'&&remaining!==null&&/^\d+$/.test(remaining))state.coreRemaining=Number(remaining);
   const retry=response.headers.get('retry-after'),retryAt=retry?(/^\d+$/.test(retry)?now()+Number(retry)*1000:Date.parse(retry)):0;
   if([403,429].includes(response.status)||remaining==='0'||retry)state.blockedUntil=Math.max(now()+60000,Number.isFinite(reset)?reset:0,Number.isFinite(retryAt)?retryAt:0);
   save();return response;
  }});engines.set(owner,e);}return e;}
 function owned(owner:string,id:unknown){if(typeof id!=='string'||state.tasks[id]?.owner!==owner)throw new Error('task unavailable');return state.tasks[id]!;}
 async function body(req:IncomingMessage){req.setTimeout(5000,()=>req.destroy());let size=0;const parts:Buffer[]=[];for await(const chunk of req){size+=chunk.length;if(size>4096)throw new Error('invalid request');parts.push(chunk);}const data=JSON.parse(Buffer.concat(parts).toString());if(!data||typeof data!=='object'||Array.isArray(data))throw new Error('invalid request');return data as Record<string,unknown>;}
 async function handler(req:IncomingMessage,res:ServerResponse){
  const send=(status:number,data:unknown)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});res.end(JSON.stringify(clean(data)));};
  const path=req.url??'/';if(!options.enabled||closed){if(path==='/api/deep-search/capabilities')send(200,{enabled:false});else send(404,{error:'private beta disabled'});return;}
  if(req.headers.host!==origin.host||Object.keys(req.headers).some(k=>k==='forwarded'||k.startsWith('x-forwarded-'))||path.includes('?')||req.headers['sec-fetch-site']==='cross-site'){send(403,{error:'untrusted request context'});return;}
  if(req.method==='GET'&&path==='/private-beta'){
   res.writeHead(200,{'content-type':'text/html','cache-control':'no-store','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'"});res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitLineage Private Beta</title><link rel="stylesheet" href="/private-beta/style.css"><main><h1>Private Beta</h1><p>Administrator authorization. Public Graph remains available.</p><form id="login"><label>Identity<input name="identity" autocomplete="username" required></label><label>Password<input name="password" type="password" autocomplete="current-password" required></label><button>Authorize</button></form><p id="status" role="status"></p><a href="/">Public Graph</a></main><script src="/private-beta/login.js"></script>');return;
  }
  if(req.method==='GET'&&path==='/private-beta/style.css'){res.writeHead(200,{'content-type':'text/css'});res.end('body{background:#111;color:#eee;font:16px system-ui}main{max-width:420px;margin:10vh auto;padding:24px}label{display:block;margin:16px 0}input,button{display:block;box-sizing:border-box;width:100%;min-height:44px;font:inherit}a{color:#afd}');return;}
  if(req.method==='GET'&&path==='/private-beta/login.js'){res.writeHead(200,{'content-type':'text/javascript','cache-control':'no-store'});res.end(`document.querySelector('#login').addEventListener('submit',async e=>{e.preventDefault();const f=e.target,s=document.querySelector('#status');try{const r=await fetch('/api/private-beta/login',{method:'POST',headers:{'content-type':'application/json','x-gitlineage-csrf':'1'},body:JSON.stringify({identity:f.identity.value,password:f.password.value})});f.password.value='';if(!r.ok){s.textContent=(await r.json()).error;return;}location.replace('/');}catch{s.textContent='Authorization unavailable';}});`);return;}
  const mutating=req.method==='POST';if(mutating&&(req.headers.origin!==options.origin||!/^application\/json(?:;|$)/.test(req.headers['content-type']??'')||req.headers['x-gitlineage-csrf']!=='1')){send(403,{error:'same-origin JSON and CSRF header required'});return;}
  try{
   if(mutating&&path==='/api/private-beta/login'){
    rate('login-global',10);const data=await body(req);const admin=options.administrators.find(a=>a.id===data.identity);const password=typeof data.password==='string'&&data.password.length<=512?data.password:'';
    const hash=passwordHash(password,admin?.salt??'00000000000000000000000000000000');if(!admin||!timingSafeEqual(Buffer.from(hash,'hex'),Buffer.from(admin.passwordHash,'hex'))){send(401,{error:'invalid authorization'});return;}
    for(const [token,s] of sessions)if(s.owner===admin.id||s.expires<=now())sessions.delete(token);
    const token=randomBytes(32).toString('hex');sessions.set(token,{owner:admin.id,expires:now()+(options.sessionMs??900000)});
    res.setHeader('set-cookie',`${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor((options.sessionMs??900000)/1000)}${origin.protocol==='https:'?'; Secure':''}`);send(200,{authorized:true});return;
   }
   const cookies=(req.headers.cookie??'').split(';').map(x=>x.trim()).filter(x=>x.startsWith(cookieName+'='));const token=cookies.length===1?cookies[0]!.slice(cookieName.length+1):'',session=sessions.get(token);
   if(!session||session.expires<=now()){sessions.delete(token);send(401,{error:'authorization required or expired'});return;}
   const owner=session.owner;
   // Session revocation remains available even after this identity exhausts its request allowance.
   if(mutating&&path==='/api/private-beta/logout'){sessions.delete(token);send(200,{authorized:false});return;}
   rate('identity:'+owner,limits.requestsPerMinute);
   if(req.method==='GET'&&path==='/api/deep-search/capabilities'){send(200,{enabled:true,scope:'private beta',budget:PREVIEW_PROFILE,network:SNAPSHOT_NETWORK,verification:'pending',lineageClaim:'none',serviceLimits:limits,serviceUsage:{reservedAttempts:state.reserved,activeTasks:active.size}});return;}
   const taskRoute=path.match(/^\/api\/deep-search\/tasks\/([a-f0-9]{24})(\/cancel)?$/);
   if(taskRoute){const stored=owned(owner,taskRoute[1]);if(req.method==='GET'&&!taskRoute[2]){send(200,stored.task);return;}if(mutating&&taskRoute[2]){await body(req);engines.get(owner)?.cancel(stored.task.id);send(200,stored.task);return;}}
   if(!mutating){send(404,{error:'private route unavailable'});return;}
   const data=await body(req);let task:PreviewTask;const e=engine(owner);
   // Ownership and shape validation precede task admission and all network/worker budget allocation.
   if(path==='/api/deep-search/search'){if(Object.keys(data).join()!=='repository')throw new Error('invalid search');}
   else if(path==='/api/deep-search/sources'||path==='/api/deep-search/compare'){
    if(Object.keys(data).sort().join()!==(path.endsWith('/sources')?'candidateIds,searchId':'candidateIds,searchId,selection'))throw new Error('invalid stage request');
    const search=owned(owner,data.searchId);if(search.task.kind!=='search')throw new Error('matching search required');
    if(path.endsWith('/compare')){if(!data.selection)throw new Error('visible source selection required');owned(owner,(data.selection as FileChoice).sourceTaskId);}
   }else {send(404,{error:'private route unavailable'});return;}
   if(active.size>=limits.globalActive||[...active.values()].filter(id=>id===owner).length>=limits.userActive)throw new Error('active task limit exhausted');
   for(const [id,stored] of Object.entries(state.tasks))if(stored.task.state!=='running'&&now()-Date.parse(stored.task.createdAt)>1800000)delete state.tasks[id];
   if(Object.keys(state.tasks).length>=24)throw new Error('private storage task limit exhausted');
   window();if(now()<state.blockedUntil)throw new Error('shared GitHub quota unavailable');
   if(path.endsWith('/search')){
    if(state.coreRemaining!==null&&state.coreRemaining<24)throw new Error('shared GitHub quota insufficient for bounded search');
    if(state.reserved+24>limits.attemptsPerHour||(state.searches[owner]??0)>=limits.searchesPerUserHour)throw new Error('shared search budget exhausted');
    // Validate before reservation; failed admitted searches remain charged across login/restart.
    const {repositoryInput}=await import('../discovery-v2/preview.ts');repositoryInput(data.repository);
    state.reserved+=24;state.searches[owner]=(state.searches[owner]??0)+1;save();task=e.startSearch(data.repository);
   }else if(path.endsWith('/sources'))task=e.startSources(String(data.searchId),data.candidateIds);
   else task=e.startCompare(String(data.searchId),data.candidateIds,data.selection as FileChoice);
   state.tasks[task.id]={owner,task};active.set(task.id,owner);save();
   void e.wait(task.id).then(()=>{state.tasks[task.id]={owner,task:clean(task)};}).finally(()=>{active.delete(task.id);save();});send(202,task);
  }catch(error){const message=error instanceof Error?error.message:'';send(/limit|frequency|budget|quota|busy|cooldown/.test(message)?429:400,{error:/task unavailable/.test(message)?'task unavailable':/limit|frequency|budget|quota|busy|cooldown/.test(message)?message:'invalid private beta request'});}
 }
 return {handler,usage:()=>({reservedAttempts:state.reserved,active:active.size,blockedUntil:state.blockedUntil}),close:async()=>{closed=true;await Promise.all([...engines.values()].map(e=>e.close()));save();if(options.enabled)unlinkSync(lock);}};
}
