import { BudgetLedger, BudgetError } from './budget.ts';
export interface NetworkProfile {perResponseBytes:number;totalResponseBytes:number}
export interface NetworkUsage {reservedBytes:number;receivedBytes:number;retainedBytes:number;overflowBytes:number}
export const NETWORK_PROFILE:Readonly<NetworkProfile>=Object.freeze({perResponseBytes:262144,totalResponseBytes:1048576});
/** Conservative nonrefundable response-cap reservation, separate from source bytes.
 * Fetch chunks are already delivered: overflow bytes are observed, never hidden.
 * Retention/parse bytes have a hard cap; wire transfer cannot be capped by Fetch.
 */
export class NetworkLedger {
 readonly budget:BudgetLedger;readonly profile:Readonly<NetworkProfile>;
 private counts:NetworkUsage={reservedBytes:0,receivedBytes:0,retainedBytes:0,overflowBytes:0};
 constructor(budget:BudgetLedger,profile:NetworkProfile=NETWORK_PROFILE){
  for(const key of ['perResponseBytes','totalResponseBytes'] as const)if(!Number.isSafeInteger(profile[key])||profile[key]<1||profile[key]>NETWORK_PROFILE[key])throw new BudgetError('invalid network budget');
  if(Object.keys(profile).length!==2)throw new BudgetError('invalid network budget shape');this.budget=budget;this.profile=Object.freeze({...profile});
 }
 reserve(search=true):()=>void {this.budget.guard();if(this.counts.reservedBytes+this.profile.perResponseBytes>this.profile.totalResponseBytes)throw new BudgetError('network bytes exhausted');
  const release=this.budget.worker();try{this.budget.attempt(search);}catch(error){release();throw error;}this.counts.reservedBytes+=this.profile.perResponseBytes;return release;
 }
 received(bytes:number,accepted:number):void {this.counts.receivedBytes+=bytes;this.counts.retainedBytes+=accepted;this.counts.overflowBytes+=bytes-accepted;}
 usage():NetworkUsage{return {...this.counts};}
}
