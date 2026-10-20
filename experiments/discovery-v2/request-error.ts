/** Admission failures are machine-readable; messages remain diagnostic and compatible. */
export type DiscoveryErrorCode='ANONYMOUS_START_INTERVAL'|'ANONYMOUS_ADDRESS_QUOTA'|'ANONYMOUS_GLOBAL_QUOTA'|'SERVICE_BUSY'|'DISCOVERY_COOLDOWN'|'DISCOVERY_FREQUENCY'|'GITHUB_RATE_LIMIT'|'NETWORK_ERROR'|'INTERNAL_ERROR'|'INVALID_REQUEST'|'EXPLORATION_SESSION_QUOTA';
export class DiscoveryRequestError extends Error {
 readonly code:DiscoveryErrorCode;readonly retryAt?:string;readonly status:number;
 constructor(code:DiscoveryErrorCode,message:string,retryAt?:number,status=429){super(message);this.code=code;this.status=status;if(retryAt!==undefined)this.retryAt=new Date(retryAt).toISOString();}
}
/** Preserve the existing provider minimum hold, including HTTP-date Retry-After. */
export function providerRetryAt(headers:Headers,now=Date.now()):number {
 const retry=headers.get('retry-after');
 const delay=retry?(/^\d+$/.test(retry)?now+Number(retry)*1000:Date.parse(retry)):0;
 return Math.max(Number(headers.get('x-ratelimit-reset'))*1000||0,delay||0,now+60000);
}
