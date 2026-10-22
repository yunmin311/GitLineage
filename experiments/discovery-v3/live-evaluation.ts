/** Explicit opt-in live smoke, never part of the fixed offline quality gate. No credentials discovered. */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createPreview} from '../discovery-v2/preview.ts';
import {validateReviewReceipt} from '../discovery-v2/review-receipt.ts';
const out=resolve('artifacts/discovery-v3/live');await mkdir(out,{recursive:true});
const p=createPreview({cooldownMs:0}),target=process.argv[2]??'sindresorhus/p-limit';
try{const s=p.startSearch(target);await p.wait(s.id);await writeFile(resolve(out,'search.json'),JSON.stringify(s,null,2));
 const ids=s.search?.result?.candidates.slice(0,1).map(c=>c.candidate.repositoryId!)??[];
 if(!ids.length)throw new Error(s.error??'No admitted candidate within live search budget');
 const t=p.startSources(s.id,ids);await p.wait(t.id);await writeFile(resolve(out,'listing.json'),JSON.stringify(t,null,2));
 const files=t.recommendation?.repositories.map(r=>({repositoryId:r.repositoryId,paths:r.selected.map(f=>f.path)}))??[];
 if(files.length<2||files.some(f=>!f.paths.length))throw new Error(t.error??'No comparable source recommendation within live listing/budget');
 const c=p.startCompare(s.id,ids,{sourceTaskId:t.id,files});await p.wait(c.id);await writeFile(resolve(out,'comparison.json'),JSON.stringify(c,null,2));
 if(!c.export||!c.review)throw new Error(c.error??'No validated comparison export');validateReviewReceipt(c.review,c.export);
 console.log(JSON.stringify({target,state:c.state,selected:files,review:c.review,scope:'Live smoke only; mutable live candidate set, no fair strategy comparison or provenance inference'},null,2));
}catch(error){await writeFile(resolve(out,'failure.json'),JSON.stringify({target,error:String(error),at:new Date().toISOString(),scope:'live smoke unavailable; offline benchmark is separate'},null,2));console.error(error);process.exitCode=1;}finally{await p.close();}
