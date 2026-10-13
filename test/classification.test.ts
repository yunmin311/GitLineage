import {test} from 'node:test';import assert from 'node:assert/strict';
import {classifyRelationships} from '../src/web/client/lib/classification.mjs';
test('taxonomy uses recorded scope and declaring sites without guessing package function',()=>{
 const ids=Array.from({length:20},(_,i)=>'e'+i),plate={key:'module',family:'dependency',count:20,memberEdgeIds:ids};
 const view={evidenceByRelationship:Object.fromEntries(ids.map((id,i)=>[id,[{type:'package_manifest',data:{scope:i<17?'runtime':'dev',manifest_path:'app/Cargo.toml'}},...(i===0?[{type:'package_manifest',data:{scope:'runtime',manifest_path:'other/Cargo.toml'}}]:[])]]))};
 const c=classifyRelationships(view,plate);assert.deepEqual(c.roots.map(n=>n.label),['Runtime','Development']);assert.equal(c.roots[0]!.children.length,2);assert.equal(c.paths.get('e0')!.at(-1)!.label,'Shared across modules');assert.equal(new Set(c.ordered).size,20);
 assert.deepEqual(classifyRelationships({evidenceByRelationship:{}},plate).categories,[],'No metadata means no invented functional classification');
});
test('partial manifest records remain reachable without an invented declaration site',()=>{
 const ids=Array.from({length:16},(_,i)=>'e'+i),plate={key:'partial',family:'dependency',count:16,memberEdgeIds:ids};
 const view={evidenceByRelationship:Object.fromEntries(ids.map((id,i)=>[id,[{type:'package_manifest',data:{scope:'runtime',...(i===15?{}:{manifest_path:'app/Cargo.toml'})}},...(i===0?[{type:'package_manifest',data:{scope:'runtime',manifest_path:'other/Cargo.toml'}}]:[])]]))};
 const c=classifyRelationships(view,plate);assert.equal(c.ordered.length,16);assert.equal(new Set(c.ordered).size,16);assert.equal(c.paths.get('e15')!.at(-1)!.label,'Declaration not recorded');
});
