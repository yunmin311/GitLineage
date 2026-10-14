/** Single-isolate ledger: synchronous check+debit is atomic between async callers.
 * Workers receive data, never this mutable ledger. Reservations are not refunded
 * after failed operations; releasing a worker frees capacity, not usage counters.
 */
export interface BudgetProfile {
  attempts: number; searchAttempts: number; candidates: number; filesPerCandidate: number;
  bytesPerFile: number; totalBytes: number; wallMs: number; concurrency: number; cpuMs: null;
}
export interface BudgetUsage {
  attempts: number; searchAttempts: number; candidates: number; files: Record<string, number>;
  bytesByFile: Record<string, number>; totalBytes: number; activeWorkers: number; peakWorkers: number;
}
export const OFFLINE_PROFILE: Readonly<BudgetProfile> = Object.freeze({ attempts:0, searchAttempts:0, candidates:32,
  filesPerCandidate:32, bytesPerFile:262144, totalBytes:2097152, wallMs:30000, concurrency:2, cpuMs:null });
export class BudgetError extends Error {}
export class BudgetLedger {
  readonly profile: Readonly<BudgetProfile>;
  readonly signal: AbortSignal | undefined;
  readonly deadline: number;
  private clock: () => number;
  private counts: BudgetUsage = {attempts:0,searchAttempts:0,candidates:0,files:Object.create(null),bytesByFile:Object.create(null),totalBytes:0,activeWorkers:0,peakWorkers:0};
  private candidateKeys = new Set<string>();
  private fileKeys = new Set<string>();
  constructor(profile: BudgetProfile, signal?: AbortSignal, clock = () => performance.now()) {
    const fields=Object.keys(OFFLINE_PROFILE);
    if(!profile||typeof profile!=='object'||Object.keys(profile).length!==fields.length||fields.some(k=>!Object.hasOwn(profile,k)))throw new BudgetError('invalid budget shape');
    if (profile.cpuMs !== null) throw new BudgetError('hard worker CPU budget unsupported; use interruptible wall deadline');
    for (const [key,value] of Object.entries(profile)) if (key !== 'cpuMs' && (!Number.isSafeInteger(value) || value! < 0)) throw new BudgetError(`invalid budget: ${key}`);
    if (profile.concurrency < 1 || profile.wallMs < 1) throw new BudgetError('concurrency and wallMs must be positive');
    this.profile=Object.freeze({...profile}); this.signal=signal; this.clock=clock; this.deadline=clock()+profile.wallMs;
  }
  guard(): void { if(this.signal?.aborted) throw new BudgetError('cancelled'); if(this.clock()>=this.deadline) throw new BudgetError('deadline exhausted'); }
  remainingMs(): number { this.guard(); return this.deadline-this.clock(); }
  private fits(value:number,cap:number,label:string):void { if(value>cap) throw new BudgetError(`${label} exhausted`); }
  attempt(search=false):void { this.guard(); const c=this.counts,p=this.profile;
    this.fits(c.attempts+1,p.attempts,'attempts'); if(search) this.fits(c.searchAttempts+1,p.searchAttempts,'searchAttempts');
    c.attempts++; if(search)c.searchAttempts++;
  }
  candidate(key:string):void { this.guard(); if(this.candidateKeys.has(key))return;
    this.fits(this.counts.candidates+1,this.profile.candidates,'candidates'); this.candidateKeys.add(key); this.counts.candidates++;
  }
  file(candidate:string,path:string):void { this.guard(); const key=JSON.stringify([candidate,path]);
    if(this.fileKeys.has(key)) throw new BudgetError('file already reserved');
    this.fits((this.counts.files[candidate]??0)+1,this.profile.filesPerCandidate,'files');
    this.fileKeys.add(key); this.counts.files[candidate]=(this.counts.files[candidate]??0)+1;
  }
  bytes(candidate:string,path:string,size:number):void { this.guard();
    if(!Number.isSafeInteger(size)||size<0)throw new BudgetError('invalid byte reservation');
    const key=JSON.stringify([candidate,path]); if(!this.fileKeys.has(key))throw new BudgetError('reserve file before bytes');
    this.fits((this.counts.bytesByFile[key]??0)+size,this.profile.bytesPerFile,'bytesPerFile');
    this.fits(this.counts.totalBytes+size,this.profile.totalBytes,'totalBytes');
    this.counts.bytesByFile[key]=(this.counts.bytesByFile[key]??0)+size; this.counts.totalBytes+=size;
  }
  worker():()=>void { this.guard(); this.fits(this.counts.activeWorkers+1,this.profile.concurrency,'concurrency');
    this.counts.activeWorkers++; this.counts.peakWorkers=Math.max(this.counts.peakWorkers,this.counts.activeWorkers);
    let done=false;return()=>{if(!done){done=true;this.counts.activeWorkers--;}};
  }
  usage():BudgetUsage { return structuredClone(this.counts); }
}
