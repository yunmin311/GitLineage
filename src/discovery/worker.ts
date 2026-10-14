import { Worker } from 'node:worker_threads';
import { BudgetLedger, BudgetError } from './budget.ts';
import type { SourceSnapshot } from './snapshot.ts';
import type { compareSnapshots } from './similarity.ts';
// Eval/stdin-only flags cannot be inherited by a file worker. Preserve all
// permission restrictions rather than replacing execArgv with an empty list.
function workerArguments():string[]|undefined{
  // Without eval/stdin flags, let Node perform its native inheritance/filtering
  // (test-runner and process-only V8 flags are not valid explicit worker flags).
  if(!process.execArgv.some(a=>/^(--input-type|--eval|--print)(=|$)|^-[ep]$/.test(a)))return undefined;
  const out:string[]=[];
  for(let i=0;i<process.execArgv.length;i++){const arg=process.execArgv[i]!;
    if(['--input-type','--eval','-e','--print','-p'].includes(arg)){i++;continue;}
    if(/^(--input-type|--eval|--print)=/.test(arg))continue;out.push(arg);
  }return out;
}
export async function runComparison(first:SourceSnapshot,second:SourceSnapshot,ledger:BudgetLedger,maxWallMs?:number):Promise<ReturnType<typeof compareSnapshots>> {
  if(maxWallMs!==undefined&&(!Number.isSafeInteger(maxWallMs)||maxWallMs<1||maxWallMs>ledger.profile.wallMs))throw new TypeError('invalid reduced worker deadline');
  const release=ledger.worker();
  let worker:Worker;
  const args=workerArguments();
  try{worker=new Worker(new URL('./worker-entry.ts',import.meta.url),{...(args?{execArgv:args}:{}),workerData:{first,second},resourceLimits:{maxOldGenerationSizeMb:128,stackSizeMb:4}});}catch(e){release();throw e;}
  try{
    return await new Promise((resolve,reject)=>{
      let settled=false;
      const done=(error:unknown,result?:ReturnType<typeof compareSnapshots>)=>{if(settled)return;settled=true;clearTimeout(timer);ledger.signal?.removeEventListener('abort',abort);
        // Settle only after exit; cancellation cannot leave a running worker behind.
        void worker.terminate().then(()=>{release();if(error)reject(error);else resolve(result!);},reject);
      };
      const abort=()=>done(new BudgetError('cancelled'));
      const timer=setTimeout(()=>done(new BudgetError('deadline exhausted')),Math.max(1,Math.min(ledger.remainingMs(),maxWallMs??ledger.profile.wallMs)));
      ledger.signal?.addEventListener('abort',abort,{once:true});if(ledger.signal?.aborted){abort();return;}
      worker.once('message',result=>{try{ledger.guard();done(null,result);}catch(e){done(e);}});
      worker.once('error',error=>done(error));worker.once('exit',code=>{if(!settled)done(new Error(`worker exited without result: ${code}`));});
    });
  }finally{await worker.terminate();release();}
}
