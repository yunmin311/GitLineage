import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalView } from './helpers/canonical-fixtures.ts';
import { relationGroups, phoneViewport } from '../src/web/client/lib/mobile.mjs';
test('phone policy accounts for landscape height and preserves tablet/desktop widths',()=>{
 for(const [w,h] of [[375,667],[390,844],[430,932],[844,390]]) assert.equal(phoneViewport(w!,h!),true);
 for(const [w,h] of [[768,1024],[820,1180],[1024,768],[1280,800],[1920,1080]]) assert.equal(phoneViewport(w!,h!),false);
});
for(const [path, fixture] of [
 ['kuddev/pebrel@51514bd50094', 'mobile-kuddev-pebrel-51514bd'],
 ['yunmin311/obsidian-config@3982a219c102', 'mobile-yunmin311-obsidian-config-3982a219'],
 ['grpc/grpc@724b3ccb608b', 'mobile-grpc-grpc-724b3ccb'],
] as const){
 test(`${path}: phone index is a total disjoint partition of actual canonical relationships`,()=>{
 const view=canonicalView(fixture);const families=relationGroups(view);
 const edges=families.flatMap(f=>f.groups.flatMap(g=>g.edges));
 assert.deepEqual(edges.map(e=>e.id).sort(),view.edges.map(e=>e.id).sort());
 assert.equal(new Set(edges.map(e=>e.id)).size,edges.length);
 for(const family of families){assert.equal(family.count,family.groups.reduce((n,g)=>n+g.edges.length,0));
 for(const group of family.groups){ assert.equal(group.evidenceCount,group.edges.reduce((n,e)=>n+e.evidenceCount,0));assert.ok(group.edges.every(e=>e.family===family.family)); }}
 if(path.startsWith('kuddev'))assert.equal(edges.length,97);
 });
}
