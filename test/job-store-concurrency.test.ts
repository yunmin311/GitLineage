import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {JobStore} from '../src/web/analysis/store.ts';
function barrier(){let release!:()=>void;const promise=new Promise<void>(r=>release=r);return {promise,release};}
test('overlapping phases wait for persistence and cannot overwrite terminal state',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gl-store-order-')),held=barrier(),entered=barrier();let blocked=false;
 const store=new JobStore({root,schemaVersion:'2.0.0',analyzerVersion:'test',beforePersist:async record=>{if(record.phase==='collecting'&&!blocked){blocked=true;entered.release();await held.promise;}}});
 try{await store.init();const job=await store.create({dedupKey:'k',owner:'me',name:'project',resolvedRevision:null});await store.markStarted(job.jobId);
 const phase=store.markPhase(job.jobId,'collecting');await entered.promise;
 const later=store.markPhase(job.jobId,'validating'),terminal=store.markComplete(job.jobId,'abc'),stale=store.markPhase(job.jobId,'collecting');
 let idle=false;const drained=store.whenIdle().then(()=>idle=true);await new Promise(r=>setImmediate(r));assert.equal(idle,false);assert.equal(store.get(job.jobId)!.phase,'resolving');held.release();await Promise.all([phase,later,terminal,stale,drained]);
 assert.equal(store.get(job.jobId)!.phase,'complete');assert.equal(JSON.parse(await readFile(join(root,job.jobId+'.json'),'utf8')).phase,'complete');assert.equal(store.findActive('k'),null);
 }finally{held.release();await rm(root,{recursive:true,force:true});}
});
test('a rejected write leaves the previous durable state and does not poison subsequent failure persistence',async()=>{
 const root=await mkdtemp(join(tmpdir(),'gl-store-fail-'));let fail=true;
 const store=new JobStore({root,schemaVersion:'2.0.0',analyzerVersion:'test',beforePersist:async record=>{if(record.phase==='collecting'&&fail){fail=false;throw new Error('controlled disk failure');}}});
 try{await store.init();const job=await store.create({dedupKey:'k',owner:'me',name:'project',resolvedRevision:null});await store.markStarted(job.jobId);await assert.rejects(store.markPhase(job.jobId,'collecting'),/controlled disk failure/);assert.equal(store.get(job.jobId)!.phase,'resolving');await store.markFailed(job.jobId,{code:'analysis_failed',message:'write failed'});await store.whenIdle();assert.equal(JSON.parse(await readFile(join(root,job.jobId+'.json'),'utf8')).phase,'failed');}finally{await rm(root,{recursive:true,force:true});}
});

test('scheduler idle waits for rapid phase writes and terminal persistence; completed cache is reused',async()=>{
 const {AnalysisScheduler}=await import('../src/web/analysis/scheduler.ts');
 const {AnalysisRateLimiter}=await import('../src/web/analysis/ratelimit.ts');
 const {canonicalGraph}=await import('./helpers/canonical-fixtures.ts');
 const root=await mkdtemp(join(tmpdir(),'gl-scheduler-order-')),held=barrier(),entered=barrier();let calls=0;const persistedPhases:string[]=[];
 const graph=canonicalGraph('gitlineage-root');
 const store=new JobStore({root:join(root,'jobs'),schemaVersion:'2.0.0',analyzerVersion:'test',beforePersist:async record=>{persistedPhases.push(record.phase);if(record.phase==='complete'){entered.release();await held.promise;}}});
 const scheduler=new AnalysisScheduler({store,limiter:new AnalysisRateLimiter(),cacheRoot:join(root,'cache'),depth:1,maxCandidates:1,enableGit:false,enableRegistry:false,schemaVersion:'2.0.0',analyzerVersion:'test',probeRevision:async()=>({commit:null}),timeoutMs:10000,analyzeOverride:async({onPhase})=>{calls++;for(const phase of ['collecting','resolving_relationships','validating'] as const)onPhase?.(phase);return {graph,cacheHit:false};}});
 try{const repository={provider:'github' as const,owner:'yunmin311',name:'GitLineage'};const outcome=await scheduler.request(repository,'127.0.0.1');assert.equal(outcome.kind,'accepted');if(outcome.kind!=='accepted')throw Error('expected job');await entered.promise;
 let idle=false;const drained=scheduler.whenIdle().then(()=>idle=true);await new Promise(r=>setImmediate(r));assert.equal(idle,false);assert.equal(store.get(outcome.job.jobId)!.phase,'publishing');held.release();await drained;assert.equal(store.get(outcome.job.jobId)!.phase,'complete');assert.equal(JSON.parse(await readFile(join(root,'jobs',outcome.job.jobId+'.json'),'utf8')).phase,'complete');assert.equal((await scheduler.request(repository,'127.0.0.1')).kind,'complete');assert.equal(calls,1);assert.deepEqual(persistedPhases,['queued','resolving','collecting','resolving_relationships','validating','publishing','complete']);
 }finally{held.release();await scheduler.whenIdle();scheduler.shutdown();await rm(root,{recursive:true,force:true});}
});

test('scheduler observes phase persistence failure and drains a durable failed outcome', async () => {
  const {AnalysisScheduler} = await import('../src/web/analysis/scheduler.ts');
  const {AnalysisRateLimiter} = await import('../src/web/analysis/ratelimit.ts');
  const {canonicalGraph} = await import('./helpers/canonical-fixtures.ts');
  const root = await mkdtemp(join(tmpdir(), 'gl-scheduler-write-fail-'));
  let fail = true;
  const store = new JobStore({
    root: join(root, 'jobs'), schemaVersion: '2.0.0', analyzerVersion: 'test',
    beforePersist: async record => {
      if (record.phase === 'collecting' && fail) {
        fail = false;
        throw new Error('controlled phase persistence failure');
      }
    },
  });
  const scheduler = new AnalysisScheduler({
    store, limiter: new AnalysisRateLimiter(), cacheRoot: join(root, 'cache'),
    depth: 1, maxCandidates: 1, enableGit: false, enableRegistry: false,
    schemaVersion: '2.0.0', analyzerVersion: 'test',
    probeRevision: async () => ({commit: null}), timeoutMs: 10000,
    analyzeOverride: async ({onPhase}) => {
      onPhase?.('collecting');
      return {graph: canonicalGraph('gitlineage-root'), cacheHit: false};
    },
  });
  try {
    const outcome = await scheduler.request({provider: 'github', owner: 'yunmin311', name: 'GitLineage'}, '127.0.0.1');
    assert.equal(outcome.kind, 'accepted');
    if (outcome.kind !== 'accepted') throw new Error('expected job');
    await scheduler.whenIdle();
    const durable = JSON.parse(await readFile(join(root, 'jobs', outcome.job.jobId + '.json'), 'utf8'));
    assert.equal(store.get(outcome.job.jobId)!.phase, 'failed');
    assert.equal(durable.phase, 'failed');
    assert.match(durable.error.message, /controlled phase persistence failure/);
    assert.equal(store.findActive(outcome.job.dedupKey), null);
  } finally {
    await scheduler.whenIdle();
    scheduler.shutdown();
    await rm(root, {recursive: true, force: true});
  }
});
