/** Local-only unified workspace. All provider responses are offline fixtures. */
import {fixtureServer,A} from './fixture-server.ts';
import {unifiedFixture} from './unified-fixture.ts';
const f=unifiedFixture();
const app=await fixtureServer({publicExploration:true,explorationCooldownMs:0,explorationTransport:f.transport});
console.log(`OFFLINE FIXTURE ONLY — ${app.url}/${A}`);
console.log('Repository relationships, modules, files and comparisons share one graph. Git History opens an independent log; return retains the graph.');
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.cleanup().then(()=>process.exit(0));});
