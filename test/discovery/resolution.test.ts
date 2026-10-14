import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BudgetLedger} from '../../src/discovery/budget.ts';
import {NetworkLedger} from '../../src/discovery/network.ts';
import {RepositorySnapshotResolver, SNAPSHOT_PROFILE} from '../../src/discovery/resolution.ts';
const sha='a'.repeat(40),tree='b'.repeat(40);
const observation={repositoryId:2,fullName:'old/root',htmlUrl:'https://github.com/old/root',source:'repository_search' as const,observedAt:'2026-10-09T00:00:00.000Z'};
function setup(metadata:unknown,commit:unknown={sha,commit:{tree:{sha:tree}},parents:[]}){
 const network=new NetworkLedger(new BudgetLedger(SNAPSHOT_PROFILE),{perResponseBytes:32768,totalResponseBytes:1048576});
 const calls:string[]=[];const resolver=new RepositorySnapshotResolver(network,{historicalRoutes:true,now:()=>observation.observedAt,transport:async url=>{calls.push(url);return new Response(JSON.stringify(calls.length===1?metadata:commit));}});
 return{resolver,network,calls};
}
test('stable ID resolves current name, observed aliases, full commit and tree',async()=>{
 const {resolver,network,calls}=setup({id:2,full_name:'new/root',html_url:'https://github.com/new/root',default_branch:'main'});
 const r=await resolver.resolve(2,[observation]);assert.equal(r.state,'resolved');assert.equal(r.identity?.revision,sha);assert.deepEqual(r.identity?.aliases,['old/root']);assert.equal(r.identity?.fullName,'new/root');assert.equal(r.tree,tree);assert.equal(network.budget.usage().searchAttempts,0);assert.equal(calls.length,2);assert.ok(calls.every(c=>c.startsWith('https://api.github.com/repositories/2')));
});
test('metadata ID mismatch rejects sample without commit request',async()=>{
 const {resolver,calls}=setup({id:3,full_name:'old/root',html_url:'https://github.com/old/root',default_branch:'main'});
 const r=await resolver.resolve(2,[observation]);assert.equal(r.state,'inconclusive');assert.equal(r.identity,null);assert.ok(r.reasons.includes('repository ID mismatch'));assert.equal(calls.length,1);
});
test('short revision and missing branch stay unresolved',async()=>{
 for(const [metadata,commit,reason] of [[{id:2,full_name:'new/root',html_url:'https://github.com/new/root',default_branch:null},{},'default branch unavailable'],[{id:2,full_name:'new/root',html_url:'https://github.com/new/root',default_branch:'main'},{sha:'abcdef'},'invalid full commit or tree SHA']] as const){
 const {resolver}=setup(metadata,commit);const r=await resolver.resolve(2,[observation]);assert.equal(r.state,'inconclusive');assert.equal(r.identity,null);assert.ok(r.reasons.includes(reason));}
});
