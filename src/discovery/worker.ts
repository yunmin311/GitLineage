import { Worker } from 'node:worker_threads';
import { BudgetLedger, BudgetError } from './budget.ts';
import type { SourceSnapshot } from './snapshot.ts';
import type { compareSnapshots } from './similarity.ts';
export async function runComparison(first:SourceSnapshot,second:SourceSnapshot,ledger:BudgetLedger):Promise<ReturnType<typeof compareSnapshots>> {
  const release=ledger.worker();
  let worker:Worker;
  try{worker=new Worker(new URL('./worker-entry.ts',import.meta.url),{workerData:{first,second},resourceLimits:{maxOldGenerationSizeMb:128,stackSizeMb:4}});}catch(e){release();throw e;}
  try{
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const done=(error:unknown,result?:ReturnType<typeof compareSnapshots>)=>{if(settled)return;settled=true;clearTimeout(timer);ledger.signal?.removeEventListener('abort',abort);
        // Settle only after exit; cancellation cannot leave a running worker behind.
        void worker.terminate().then(()=>{release();if(error)reject(error);else resolve(result!);},reject);
      };
      const abort=()=>done(new BudgetError('cancelled'));
      const timer=setTimeout(()=>done(new BudgetError('deadline exhausted')),Math.max(1,ledger.remainingMs()));
      ledger.signal?.addEventListener('abort',abort,{once:true});if(ledger.signal?.aborted){abort();return;}
      worker.once('message',result=>{try{ledger.guard();done(null,result);}catch(e){done(e);}});
      worker.once('error',error=>done(error));worker.once('exit',code=>{if(!settled)done(new Error(`worker exited without result: ${code}`));});
    });
  }finally{await worker.terminate();release();}
}
