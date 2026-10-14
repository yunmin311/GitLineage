// Explicit bounded baseline probe; no GitHub search and no credentials.
import { writeFile } from 'node:fs/promises';
import { sha256 } from '../../src/discovery/snapshot.ts';
const receipts=[];
for(const path of ['_p-limit/7.1.1','p-limit/7.1.1','_p-limit/latest','p-limit/latest']){
 const url=`https://registry.npmjs.org/${path}`,started=performance.now();
 const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(20000)});
 const reader=response.body!.getReader();let count=0;const chunks=[];
 try{while(true){const{done,value}=await reader.read();if(done)break;count+=value.length;if(count>262144){await reader.cancel();throw new Error('response cap');}chunks.push(value);}}finally{reader.releaseLock();}
 const bytes=Buffer.concat(chunks),payload=JSON.parse(bytes.toString());receipts.push({url,status:response.status,bytes:count,digest:sha256(bytes),version:payload.version??null,repository:payload.repository??null,error:payload.error??null,wallMs:performance.now()-started});
}
await writeFile('experiments/discovery-v2/npm-baseline-probe.json',JSON.stringify({observedAt:new Date().toISOString(),attempts:4,retries:0,input:'fixed package p-limit, frozen 7.1.1 and resolver latest endpoint comparison',receipts},null,2)+'\n');console.log(receipts);
