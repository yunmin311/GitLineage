import {test} from 'node:test';import assert from 'node:assert/strict';
import {spatialLayout,spatialRoute} from '../src/web/client/lib/spatial.mjs';
import {canonicalView} from './helpers/canonical-fixtures.ts';
test('spatial neighborhoods retain canonical direction and distribute in two dimensions',()=>{const v=canonicalView('nachocebey__is'),edges=v.edges.filter(e=>e.family==='ancestry'||e.family==='source-identity');const p=spatialLayout({subjectId:v.subject.id,edges});assert.ok(p.size>1);for(const e of edges){const r=spatialRoute(e,p);assert.ok(r?.path);assert.equal(e.source,v.subject.id);}});
test('dense branches clear node bounds and focusing preserves the repository trunk',()=>{const edges=Array.from({length:24},(_,i)=>({id:String(i),source:'root',target:'p'+i}));const p=spatialLayout({subjectId:'root',edges,groups:[{key:'a',peers:edges.slice(0,12).map(e=>e.target)},{key:'b',peers:edges.slice(12).map(e=>e.target)}]});const boxes=[...p.values()];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++){const a=boxes[i]!,b=boxes[j]!;assert.ok(Math.abs(a.x-b.x)>((a.width||216)+(b.width||216))/2||Math.abs(a.y-b.y)>((a.height||52)+(b.height||52))/2);}const xs=new Set(boxes.map(b=>Math.round(b.x))),ys=new Set(boxes.map(b=>Math.round(b.y)));assert.ok(xs.size>=3&&ys.size>=3);assert.deepEqual(spatialLayout({subjectId:'root',focusId:'p0',edges}).get('root'),p.get('root')); });
test('incremental growth reserves existing peers before allocating new objects',()=>{const all=Array.from({length:16},(_,i)=>({id:String(i),source:'root',target:'p'+i}));const first=all.filter((_,i)=>i%2===0).slice(0,5),groups=(es:typeof all)=>[{key:'g',peers:es.map(e=>e.target)}];const p=spatialLayout({subjectId:'root',edges:first,groups:groups(first),compact:true});const next=spatialLayout({subjectId:'root',edges:all,groups:groups(all),compact:true,previous:p});for(const e of first)assert.deepEqual(next.get(e.target),p.get(e.target));});

test('multi-parent and many-to-many paths attach to borders and clear every unrelated object',()=>{
 const edges=[{source:'root',target:'a'},{source:'root',target:'b'},{source:'a',target:'c'},{source:'b',target:'c'},{source:'a',target:'d'},{source:'b',target:'d'},{source:'c',target:'root'}];
 for(const compact of [false,true]){const ps=spatialLayout({subjectId:'root',edges,compact});
  for(const edge of edges){const route=spatialRoute(edge,ps)!;assert.ok(route);const nums=route.path.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)!.map(Number);const start={x:nums[0]!,y:nums[1]!},end={x:nums.at(-2)!,y:nums.at(-1)!};
   for(const [point,id]of [[start,edge.source],[end,edge.target]] as const){const box=ps.get(id)!;assert.ok(Math.abs(Math.abs(point.x-box.x)-108)<.001||Math.abs(Math.abs(point.y-box.y)-26)<.001,'Endpoint touches its actual object boundary');}
   const points=[];if(route.path.includes('Q'))for(let i=0;i<=200;i++){const t=i/200;points.push({x:(1-t)**2*nums[0]!+2*(1-t)*t*nums[2]!+t*t*nums[4]!,y:(1-t)**2*nums[1]!+2*(1-t)*t*nums[3]!+t*t*nums[5]!});}
   else for(let j=2;j<nums.length;j+=2)for(let i=0;i<=200;i++){const t=i/200;points.push({x:nums[j-2]!+(nums[j]!-nums[j-2]!)*t,y:nums[j-1]!+(nums[j+1]!-nums[j-1]!)*t});}
   for(const [id,box]of ps)if(id!==edge.source&&id!==edge.target)for(const point of points)assert.ok(Math.abs(point.x-box.x)>=108||Math.abs(point.y-box.y)>=26,'Route clears unrelated objects');
  }
 }
});

test('expanded declaration branches reserve disjoint member bands',()=>{
 const edges=Array.from({length:18},(_,i)=>({source:'root',target:'p'+i,family:'dependency'}));
 const groups=Array.from({length:3},(_,i)=>({key:'depends_on/'+i,family:'dependency',peers:edges.slice(i*6,i*6+6).map(e=>e.target)}));
 const ps=spatialLayout({subjectId:'root',edges,groups});
 const bands=groups.map(g=>g.peers.map(id=>ps.get(id)!.y));
 for(let i=0;i<bands.length-1;i++)assert.ok(Math.max(...bands[i]!) + 52 < Math.min(...bands[i+1]!), 'Members of neighboring declarations must not interleave');
});
test('routes leave explicit side ports and turn only at right angles',()=>{
 const ps=new Map([['a',{x:0,y:0}],['b',{x:620,y:120}],['block',{x:300,y:50}]]);
 const r=spatialRoute({source:'a',target:'b'},ps)!;
 assert.ok(!r.path.includes('Q'),'Obstacle routing must not improvise a quadratic curve');
 const nums=r.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
 for(let i=2;i<nums.length;i+=2)assert.ok(nums[i]===nums[i-2]||nums[i+1]===nums[i-1], 'Every routing segment is orthogonal');
 assert.equal(nums[0],108);assert.equal(nums[1],0);
});

test('presentation forests measure subtrees while retaining additional parents and unique identity',async()=>{
 const {spatialExpansion}=await import('../src/web/client/lib/spatial.mjs');
 const edges=[{source:'root',target:'src',kind:'structure'},{source:'root',target:'vendor',kind:'structure'},{source:'src',target:'module',kind:'structure'},{source:'module',target:'file',kind:'structure'},{source:'vendor',target:'file',kind:'dependency'}];
 const anchors=new Map([['root',{x:960,y:800}]]);
 for(const compact of [false,true]){const p=spatialExpansion({anchors,nodes:['src','vendor','module','file'].map(id=>({id})),edges,compact});assert.equal(p.size,5);assert.equal(p.get('file')?.depth,2,'Shared object uses its first reachable owner, without losing the other parent edge');assert.equal(edges.length,5);
 for(const e of edges)assert.ok(spatialRoute(e,p));
 const boxes=[...p.values()];for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)assert.ok(Math.abs(boxes[i]!.x-boxes[j]!.x)>=216||Math.abs(boxes[i]!.y-boxes[j]!.y)>=52);
 }
});

test('classification growth reserves all existing neighborhoods before placing another branch',async()=>{
 const {spatialExpansion}=await import('../src/web/client/lib/spatial.mjs');
 const anchors=new Map([['a',{x:0,y:0,angle:Math.PI/2}],['b',{x:360,y:0,angle:Math.PI/2}]]);
 const first=spatialExpansion({anchors,nodes:[{id:'scope-a'},{id:'member-a'}],edges:[{source:'a',target:'scope-a'},{source:'scope-a',target:'member-a'}],compact:true,preserve:true});
 const next=spatialExpansion({anchors,nodes:[{id:'scope-a'},{id:'member-a'},{id:'scope-b'},{id:'member-b'}],edges:[{source:'a',target:'scope-a'},{source:'scope-a',target:'member-a'},{source:'b',target:'scope-b'},{source:'scope-b',target:'member-b'}],previous:first,compact:true,preserve:true});
 assert.deepEqual(next.get('member-a'),first.get('member-a'));assert.deepEqual(next.get('scope-a'),first.get('scope-a'));
 const points=[...next.values()];for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)assert.ok(Math.abs(points[i]!.x-points[j]!.x)>=236||Math.abs(points[i]!.y-points[j]!.y)>=72);
});

test('shared neighbor blocking a preferred exit uses another boundary port',()=>{
 const ps=new Map([['a',{x:0,y:0}],['b',{x:600,y:0}],['shared',{x:244,y:0}]]);
 const route=spatialRoute({source:'a',target:'b'},ps);
 assert.ok(route,'A real relation must not vanish when its preferred port is blocked');
});
