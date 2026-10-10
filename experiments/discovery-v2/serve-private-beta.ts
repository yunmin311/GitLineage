/** Opt-in local validation entry; no production CLI or environment auto-enable. */
import {serve} from '../../src/web/serve.ts';
import {createBetaGate} from '../../experiments/private-beta/gate.ts';
import {resolve} from 'node:path';
if(process.env.GITLINEAGE_PRIVATE_BETA!=='1')throw new Error('Private Beta disabled; explicit opt-in required');
const origin=process.env.GITLINEAGE_BETA_ORIGIN??'http://127.0.0.1:8083';
let administrators;
try { administrators=JSON.parse(process.env.GITLINEAGE_BETA_ADMINISTRATORS??'[]'); } catch { throw new Error('Invalid administrator configuration'); }
const storeRoot=process.env.GITLINEAGE_BETA_STORE;
if(!storeRoot)throw new Error('Independent private store required');
const cacheRoot=resolve(process.env.GITLINEAGE_CACHE_DIR??'.cache'),jobStoreRoot=resolve(process.env.GITLINEAGE_JOB_STORE_DIR??'.jobs');
const gate=createBetaGate({enabled:true,origin,administrators,storeRoot,protectedRoots:[process.cwd(),cacheRoot,jobStoreRoot]});
const app=await serve({host:'127.0.0.1',port:Number(new URL(origin).port)||8083,clientDir:resolve('dist/web'),cacheRoot,jobStoreRoot,privateBetaHandler:gate.handler});
console.log('Private Beta local entry: '+app.url+'/private-beta');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await gate.close();app.app.analysis.shutdown();app.server.close(()=>process.exit(0));});
