/** Explicit bounded development capture. Never part of CI; no repository code runs. */
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile,readdir} from 'node:fs/promises';
import {createPreview} from '../discovery-v2/preview.ts';
if(process.argv[2]!=='--live')throw new Error('explicit --live required');
const token=execFileSync('gh',['auth','token'],{encoding:'utf8'}).trim();
const targets=['sindresorhus/p-limit','chalk/chalk','vitejs/vite','gin-gonic/gin','pallets/flask','yunmin311/GitLineage'];
const out='artifacts/discovery-admission/baseline';await mkdir(out,{recursive:true});
if((await readdir(out)).length)throw new Error('refusing to overwrite an existing baseline capture');
await writeFile(out+'/started.json',JSON.stringify({startedAt:new Date().toISOString(),targets}),{flag:'wx'});
const samples=[],failedTargets=[];
for(const repository of targets){
 const requests:{url:string;status:number;bytes:number;wallMs:number;body:unknown}[]=[];
 const preview=createPreview({enrichedSearch:true,cooldownMs:0,transport:async(url,init)=>{
  const started=performance.now(),headers=new Headers(init.headers);headers.set('authorization',`Bearer ${token}`);
  const response=await fetch(url,{...init,headers}),body=await response.text();
  let parsed:unknown;try{parsed=JSON.parse(body);}catch{parsed=body;}
  requests.push({url,status:response.status,bytes:Buffer.byteLength(body),wallMs:performance.now()-started,body:parsed});
  return new Response(body,{status:response.status,headers:response.headers});
 }});
 try{
  const task=await preview.wait(preview.startSearch(repository).id);
  await writeFile(`${out}/${repository.replace('/','--')}.json`,JSON.stringify({repository,task,requests},null,2));
  const result=task.search?.result;
  if(result){
   const responses=requests.filter(r=>new URL(r.url).pathname==='/search/repositories');
   const sample={repository,capturedAt:task.createdAt,plan:result.plan,targetMetadata:result.relevance.target,
    responses:responses.map(r=>({...r,body:{...(r.body as any),items:(r.body as any).items?.map((i:any)=>({id:i.id,full_name:i.full_name,html_url:i.html_url,description:i.description,language:i.language,topics:i.topics,fork:i.fork}))}})),
    baseline:{ids:result.candidates.map(c=>c.candidate.repositoryId),names:result.candidates.map(c=>c.candidate.fullName),usage:result.usage,network:result.network,coverage:result.coverage},
    acquisition:{requests:requests.length,responseBytes:requests.reduce((n,r)=>n+r.bytes,0),wallMs:requests.reduce((n,r)=>n+r.wallMs,0)},labels:[]};
   samples.push(sample);console.log(JSON.stringify(sample));
  }else {const failure={repository,capturedAt:task.createdAt,state:task.state,reason:task.error,usage:task.search?.usage,requests:requests.map(({body,...r})=>r),scope:'bootstrap failed before search; excluded from admission fractions, included in acquisition failures'};failedTargets.push(failure);console.log(JSON.stringify(failure));}
 }finally{await preview.close();}
}
await writeFile(out+'/searches-unlabeled.json',JSON.stringify({protocol:'docs/discovery-admission.md',baselineCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),plannedTargets:targets,failedTargets,samples},null,2));
