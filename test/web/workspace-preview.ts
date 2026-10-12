/** Local-only unified workspace. All provider responses are offline fixtures. */
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const f=unifiedFixture();
const app=await fixtureServer({publicExploration:true,explorationCooldownMs:0,explorationTransport:f.transport});
console.log(`OFFLINE FIXTURE ONLY — ${app.url}/${A}`);
console.log('One graph: expand Git history, select a commit, expand changed files, expand a file into its module, find related projects. Return retains all neighborhoods.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.cleanup().then(()=>process.exit(0));});
