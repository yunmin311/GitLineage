/** Evidence-backed display taxonomy. Categories are navigation, never graph entities. */
export function classifyRelationships(view, plate) {
 const empty={roots:[],categories:[],paths:new Map(),ordered:plate.memberEdgeIds};
 if(plate.family!=='dependency'||plate.count<12)return empty;
 const records=plate.memberEdgeIds.map(id=>{
  const recorded=view.evidenceByRelationship?.[id];
  const cards=Array.isArray(recorded)?recorded:recorded?.cards||[];
  const declarations=cards.filter(c=>c.type==='package_manifest').map(c=>c.data?.data||c.data||{});
  const primary=declarations[0];
  return {id,scope:primary?.scope||'unknown',sites:[...new Set(declarations.map(d=>d.manifest_path).filter(Boolean))]};
 });
 const labels={runtime:'Runtime',dev:'Development',development:'Development',build:'Build',optional:'Optional',unknown:'Unclassified'};
 const categories=[],paths=new Map();
 const group=(items,token,label,basis,parent,level)=>{
  const id='category:'+encodeURIComponent(plate.key)+'/'+token;
  const n={id,label,basis,parent,level,edgeIds:items.map(r=>r.id),children:[]};categories.push(n);return n;
 };
 const scopes=[...new Set(records.map(r=>r.scope))];
 const roots=[];
 for(const scope of scopes){
  const items=records.filter(r=>r.scope===scope);
  const n=group(items,encodeURIComponent(scope),labels[scope]||scope,scope==='unknown'?'Scope not recorded':'Manifest scope: '+scope,'bundle:'+plate.key,1);
  const exclusive=items.filter(r=>r.sites.length===1),shared=items.filter(r=>r.sites.length>1),unrecorded=items.filter(r=>!r.sites.length);
  if(items.length>12&&exclusive.length&&shared.length){
   n.children=[group(exclusive,encodeURIComponent(scope)+'/local','Declared here only','One recorded declaring manifest',n.id,2),group(shared,encodeURIComponent(scope)+'/shared','Shared across modules','Multiple recorded declaring manifests',n.id,2)];
   if(unrecorded.length)n.children.push(group(unrecorded,encodeURIComponent(scope)+'/unrecorded','Declaration not recorded','No recorded declaring manifest',n.id,2));
  }
  roots.push(n);
 }
 // Do not add a redundant level when evidence provides no useful partition.
 if(roots.length===1&&!roots[0].children.length)return empty;
 for(const root of roots)for(const leaf of root.children.length?root.children:[root])for(const id of leaf.edgeIds)paths.set(id,root===leaf?[root]:[root,leaf]);
 const leaves=roots.flatMap(n=>n.children.length?n.children:[n]),ordered=[];
 for(let i=0;i<Math.max(...leaves.map(n=>n.edgeIds.length));i++)for(const n of leaves)if(n.edgeIds[i])ordered.push(n.edgeIds[i]);
 return {roots,categories,paths,ordered};
}
