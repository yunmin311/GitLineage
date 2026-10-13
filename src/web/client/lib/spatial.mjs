/** Presentation only: relationship-owned branches, rectangular collision clearance,
 * and obstacle-aware canonical edges. No inference or graph mutation. */
export const ORIGIN = Object.freeze({x:960,y:800});
const W=216,H=52;
const fanReach=(i,mid)=>310+140*Math.max(0,1-(Math.abs(i-mid)/Math.max(1,mid))**2);
const dimensions=p=>({w:p.width||W,h:p.height||H});
function overlaps(a,b,gap=20){const aa=dimensions(a),bb=dimensions(b);return Math.abs(a.x-b.x)<(aa.w+bb.w)/2+gap&&Math.abs(a.y-b.y)<(aa.h+bb.h)/2+gap;}
// Branch ownership is presentation metadata. Canonical edges keep their endpoints.
export function spatialLayout({subjectId,edges,groups=[],compact=false,previous=new Map()}){
 const positions=new Map([[subjectId,{...ORIGIN}]]), owners=new Map();
 const ids=[...new Set(edges.flatMap(e=>[e.source,e.target]))].filter(id=>id!==subjectId), visible=new Set(ids);
 const family=g=>g.family||(/depends_on/.test(g.key)?'dependency':/references|attribution/.test(g.key)?'attribution':'ancestry');
 const families=new Map();
 for(const g of groups){const f=family(g);if(!families.has(f))families.set(f,[]);families.get(f).push(g);for(const id of g.peers)if(visible.has(id)&&!owners.has(id))owners.set(id,g);}
 // Allocate the envelope of a neighborhood, not individual free rectangles.
 // Each declaration owns a band; expansion extends that band outwards. Shared
 // entities keep one owner and one identity; the other links remain cross references.
 for(const [f,branches]of families){
  const vertical=compact&&f==='dependency', sign=f==='ancestry'||f==='source-identity'?-1:1;
  const heights=branches.map(g=>g.reserve|| (vertical?(g.peers.filter(id=>owners.get(id)===g).length>1?768:256):Math.max(128,g.peers.filter(id=>owners.get(id)===g).length*76+48)));
  let cursor=-heights.reduce((a,b)=>a+b,0)/2;
  for(let k=0;k<branches.length;k++){
   const g=branches[k],band=heights[k],center=cursor+band/2;cursor+=band;
   const offset=f==='attribution'?-480:f==='similarity'?480:0;
   const anchor=vertical?{x:ORIGIN.x+center,y:ORIGIN.y+170}:{x:ORIGIN.x+sign*340,y:ORIGIN.y+center+offset};
   const old=previous.get('bundle:'+g.key);
   // A lone branch can grow without moving anything already explored. Multiple
   // siblings reflow as entire neighborhoods, preserving relative member offsets.
   if(branches.length===1&&old){anchor.x=old.x;anchor.y=old.y;}
   const angle=vertical?Math.PI/2:sign<0?Math.PI:0;
   positions.set('bundle:'+g.key,{...anchor,width:216,height:88,angle,aggregateKey:g.key});
   const members=g.peers.filter(id=>owners.get(id)===g),rows=members.length,mid=(members.length-1)/2;
   for(const id of members){const prior=previous.get(id);if(branches.length===1&&prior&&old&&prior.aggregateKey===g.key)positions.set(id,{...prior,x:prior.x+anchor.x-old.x,y:prior.y+anchor.y-old.y});}
   for(let i=0;i<members.length;i++){
    if(positions.has(members[i]))continue;
    const id=members[i],prior=previous.get(id);let point;
    if(prior&&old&&prior.aggregateKey===g.key)point={...prior,x:prior.x+anchor.x-old.x,y:prior.y+anchor.y-old.y};
    else point=vertical?{x:anchor.x+(i%2)*248,y:anchor.y+170+Math.floor(i/2)*100}:{x:anchor.x+sign*fanReach(i,mid),y:anchor.y+(i-mid)*76};
    // New members use the remaining slots in their own band, never a neighbor's.
    if([...positions.values()].some(q=>overlaps(point,q,20))){let slot=0;do{point=vertical?{x:anchor.x+(slot%2)*248,y:anchor.y+170+Math.floor(slot/2)*100}:{x:anchor.x+sign*fanReach(slot,mid),y:anchor.y+(slot-mid)*76};slot++;}while([...positions.values()].some(q=>overlaps(point,q,20))&&slot<600);}
    positions.set(id,{...point,angle,aggregateKey:g.key});
   }
  }
 }
 const slots=new Map();
 for(const id of ids){if(positions.has(id))continue;const e=edges.find(e=>e.source===id||e.target===id),f=e?.family||'related';const i=slots.get(f)||0;slots.set(f,i+1);
  const angle=f==='ancestry'||f==='source-identity'?(compact?-Math.PI/2:Math.PI):f==='attribution'?-.8:2.3;
  const old=previous.get(id);let p=old||{x:ORIGIN.x+Math.cos(angle)*380,y:ORIGIN.y+Math.sin(angle)*220+i*96,angle};
  let n=0;while([...positions.values()].some(q=>overlaps(p,q,24))&&n<600){n++;p={x:ORIGIN.x+Math.cos(angle)*(380+Math.floor(n/12)*280),y:ORIGIN.y+Math.sin(angle)*220+(i+n)*96,angle};}
  positions.set(id,p);
 }
 return positions;
}
function blocked(a,b,boxes){return boxes.some(p=>{const{w,h}=dimensions(p);let low=0,high=1;for(const [delta,start,min,max]of [[b.x-a.x,a.x,p.x-w/2-12,p.x+w/2+12],[b.y-a.y,a.y,p.y-h/2-12,p.y+h/2+12]]){if(Math.abs(delta)<1e-9){if(start<=min||start>=max)return false;}else{let t1=(min-start)/delta,t2=(max-start)/delta;if(t1>t2)[t1,t2]=[t2,t1];low=Math.max(low,t1);high=Math.min(high,t2);if(high<=low)return false;}}return high>low&&high>0&&low<1;});}
export function spatialRoute(edge,positions,fanIndex=0,fanCount=1){
 const a=positions.get(edge.source),b=positions.get(edge.target);if(!a||!b)return null;
 const da=dimensions(a),db=dimensions(b),dx=b.x-a.x,dy=b.y-a.y;
 const branchAngle=a.angle??b.angle;
 const horizontal=edge.presentation==='branch'&&branchAngle!==undefined?Math.abs(Math.cos(branchAngle))>.7:Math.abs(dx)>Math.abs(dy)*1.5,sign=Math.sign(horizontal?dx:dy)||1;
 const offset=(fanIndex-(fanCount-1)/2)*Math.min(10,32/Math.max(1,fanCount-1));
 const start=horizontal?{x:a.x+sign*da.w/2,y:a.y+offset}:{x:a.x+offset,y:a.y+sign*da.h/2};
 const end=horizontal?{x:b.x-sign*db.w/2,y:b.y+offset}:{x:b.x+offset,y:b.y-sign*db.h/2};
 const s=horizontal?{x:start.x+sign*24,y:start.y}:{x:start.x,y:start.y+sign*24};
 const t=horizontal?{x:end.x-sign*24,y:end.y}:{x:end.x,y:end.y-sign*24};
 const obstacles=[...positions.entries()].filter(([id])=>id!==edge.source&&id!==edge.target).map(([,p])=>p);
 const clear=points=>points.every((p,i)=>!i||!blocked(points[i-1],p,obstacles));
 if(edge.presentation==='branch'&&!horizontal&&a.aggregateKey&&a.aggregateKey===b.aggregateKey){
  // Compact neighborhoods connect down either side of their member column.
  // Side-entry curves avoid routing lower members through the rows above them.
  const side=b.x>a.x?1:-1,reach=100+Math.abs(dy)*.2;
  const from={x:a.x+side*da.w/2,y:a.y+offset},to={x:b.x+side*db.w/2,y:b.y};
  const c1={x:from.x+side*reach,y:from.y},c2={x:to.x+side*reach,y:to.y};
  const curve=t=>({x:(1-t)**3*from.x+3*(1-t)**2*t*c1.x+3*(1-t)*t*t*c2.x+t**3*to.x,y:(1-t)**3*from.y+3*(1-t)**2*t*c1.y+3*(1-t)*t*t*c2.y+t**3*to.y});
  if(clear(Array.from({length:33},(_,i)=>curve(i/32))))return{path:`M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`,label:curve(.5)};
 }
 if(edge.presentation==='branch'){
  const reach=Math.max(24,Math.abs(horizontal?end.x-start.x:end.y-start.y)/2);
  const c1=horizontal?{x:start.x+sign*reach,y:start.y}:{x:start.x,y:start.y+sign*reach};
  const c2=horizontal?{x:end.x-sign*reach,y:end.y}:{x:end.x,y:end.y-sign*reach};
  const curve=t=>({x:(1-t)**3*start.x+3*(1-t)**2*t*c1.x+3*(1-t)*t*t*c2.x+t**3*end.x,y:(1-t)**3*start.y+3*(1-t)**2*t*c1.y+3*(1-t)*t*t*c2.y+t**3*end.y});
  if(clear(Array.from({length:33},(_,i)=>curve(i/32))))return{path:`M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`,label:curve(.5)};
 }

 const candidates=horizontal?[
  [s,{x:(s.x+t.x)/2+offset,y:s.y},{x:(s.x+t.x)/2+offset,y:t.y},t],
  [s,{x:s.x,y:t.y},t],[s,{x:t.x,y:s.y},t]
 ]:[ [s,{x:s.x,y:(s.y+t.y)/2+offset},{x:t.x,y:(s.y+t.y)/2+offset},t],[s,{x:t.x,y:s.y},t],[s,{x:s.x,y:t.y},t] ];
 let route=candidates.find(clear);
 if(!route){
  // Rectilinear visibility graph. Each obstacle corner offers horizontal/vertical
  // projections; bend cost discourages zigzags. No diagonal corner shortcuts.
  const corners=obstacles.flatMap(p=>{const{w,h}=dimensions(p);return[-1,1].flatMap(x=>[-1,1].map(y=>({x:p.x+x*(w/2+18),y:p.y+y*(h/2+18)})));});
  const vertices=[s,t,...corners],dist=vertices.map(()=>Infinity),parent=vertices.map(()=>null),done=new Set();dist[0]=0;
  for(let pass=0;pass<vertices.length;pass++){
   let u=-1;for(let i=0;i<vertices.length;i++)if(!done.has(i)&&(u<0||dist[i]<dist[u]))u=i;
   if(u<0||!Number.isFinite(dist[u])||u===1)break;done.add(u);
   for(let v=0;v<vertices.length;v++)if(v!==u&&!done.has(v)){
    const p=vertices[u],q=vertices[v];for(const elbow of [{x:p.x,y:q.y},{x:q.x,y:p.y}]){
     if(!clear([p,elbow,q]))continue;
     const cost=dist[u]+Math.abs(q.x-p.x)+Math.abs(q.y-p.y)+((q.x===p.x||q.y===p.y)?0:40);
     if(cost<dist[v]){dist[v]=cost;parent[v]={u,elbow};}
    }
   }
  }
  if(Number.isFinite(dist[1])){route=[t];let v=1;while(parent[v]){const hop=parent[v];route.unshift(vertices[hop.u],hop.elbow);v=hop.u;}}
 }
 if(!route)return null; // Never substitute an edge through an unrelated node.
 const points=[start,...route,end].filter((p,i,ps)=>!i||p.x!==ps[i-1].x||p.y!==ps[i-1].y);
 for(let i=points.length-2;i>0;i--)if((points[i-1].x===points[i].x&&points[i].x===points[i+1].x)||(points[i-1].y===points[i].y&&points[i].y===points[i+1].y))points.splice(i,1);
 const label=points.length===2?{x:(start.x+end.x)/2,y:(start.y+end.y)/2}:points[Math.floor(points.length/2)];
 return{path:points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' '),label};
}

/** Tidy local forests with measured subtree footprints. The forest is only a
 * placement scaffold: all original DAG edges, including additional parents and
 * cycles, are routed afterwards. Canonical anchors cannot be moved here. */
export function spatialExpansion({anchors,nodes,edges,previous=new Map(),compact=false,preserve=false}){
 const occupied=new Map(anchors),ids=new Set(nodes.map(n=>n.id)),children=new Map(),owned=new Set(anchors.keys());
 if(preserve)for(const id of ids){const old=previous.get(id);if(old&&old.angle===(compact?Math.PI/2:0))occupied.set(id,{...old});}
 // Breadth-first ownership ensures the first real reachable parent supplies
 // spatial context. Additional incoming edges never duplicate the object.
 const queue=[...anchors.keys()];
 for(let i=0;i<queue.length;i++)for(const e of edges)if(e.source===queue[i]&&ids.has(e.target)&&!owned.has(e.target)){
  owned.add(e.target);queue.push(e.target);if(!children.has(e.source))children.set(e.source,[]);children.get(e.source).push(e.target);
 }
 const bounds=ps=>{const points=[...ps.values()];return{left:Math.min(...points.map(p=>p.x-108)),right:Math.max(...points.map(p=>p.x+108)),top:Math.min(...points.map(p=>p.y-26)),bottom:Math.max(...points.map(p=>p.y+26))};};
 const build=(id,vertical,sign,depth)=>{
  const map=new Map([[id,{x:0,y:0,angle:vertical?Math.PI/2:sign<0?Math.PI:0,depth}]]),kids=children.get(id)||[];
  const sub=kids.map(k=>build(k,vertical,sign,depth+1));
  const leaves=kids.length>4&&kids.every(k=>!children.has(k));
  if(leaves){for(let i=0;i<kids.length;i++)map.set(kids[i],{x:vertical?(i%2)*248:sign*(310+Math.floor(i/4)*280),y:vertical?170+Math.floor(i/2)*100:(i%4-1.5)*88,angle:vertical?Math.PI/2:sign<0?Math.PI:0,depth:depth+1});}
  else{
   const sizes=sub.map(m=>{const b=bounds(m);return vertical?b.right-b.left+40:b.bottom-b.top+36;}),total=sizes.reduce((a,b)=>a+b,0);let cursor=-total/2;
   for(let i=0;i<sub.length;i++){const b=bounds(sub[i]);const cross=cursor+sizes[i]/2;cursor+=sizes[i];
    const shift=vertical?{x:cross-(b.left+b.right)/2,y:170-b.top-26}:{x:sign>0?310-b.left-108:-310-b.right+108,y:cross-(b.top+b.bottom)/2};
    for(const [key,p]of sub[i])map.set(key,{...p,x:p.x+shift.x,y:p.y+shift.y});
   }
  }
  return map;
 };
 for(const [id,anchor]of anchors){const kids=children.get(id);if(!kids)continue;
  const first=edges.find(e=>e.source===id&&kids.includes(e.target));
  const vertical=compact,sign=anchor.angle!==undefined?Math.sign(Math.cos(anchor.angle))||1:first?.kind==='observation'?1:-1;
  const tree=build(id,vertical,sign,0);tree.delete(id);
  // Keep the neighborhood entry stationary across deeper expansion; move only
  // this subtree when its measured footprint intersects another neighborhood.
  let shift={x:anchor.x,y:anchor.y};
  if(kids.length===1&&previous.has(kids[0])){const old=previous.get(kids[0]),local=tree.get(kids[0]);shift={x:old.x-local.x,y:old.y-local.y};}
  const collides=offset=>[...tree.values()].some(p=>[...occupied.values()].some(q=>overlaps({x:p.x+offset.x,y:p.y+offset.y},q,20)));
  if(preserve&&[...tree.keys()].some(key=>previous.has(key))){
   // Reserve existing objects before finding space for additions. Classification
   // growth must not reshuffle siblings merely because a leaf gains another child.
   for(const [key]of tree){const old=previous.get(key);if(old&&old.angle===tree.get(key).angle)occupied.set(key,{...old});}
   for(const [key,p]of tree){if(occupied.has(key))continue;
    const parent=edges.find(e=>e.target===key)?.source,at=occupied.get(parent)||anchor;
    const localParent=tree.get(parent)||{x:0,y:0};
    const desired={...p,x:at.x+p.x-localParent.x,y:at.y+p.y-localParent.y};
    let candidate=desired,attempt=0;
    while([...occupied.values()].some(q=>overlaps(candidate,q,20))&&attempt<600){attempt++;const step=Math.ceil(attempt/2)*(attempt%2?1:-1);candidate=vertical?{...desired,x:desired.x+step*248,y:desired.y+Math.floor(attempt/20)*100}:{...desired,x:desired.x+Math.floor(attempt/20)*280*sign,y:desired.y+step*88};}
    occupied.set(key,candidate);
   }
   continue;
  }
  const base={...shift};let attempt=0;
  while(collides(shift)&&attempt<600){attempt++;const step=Math.ceil(attempt/2)*(attempt%2?1:-1);shift=vertical?{x:base.x+step*248,y:base.y+Math.floor(attempt/30)*170}:{x:base.x+Math.floor(attempt/30)*280*sign,y:base.y+step*88};}
  for(const [key,p]of tree)occupied.set(key,{...p,x:p.x+shift.x,y:p.y+shift.y});
 }
 return occupied;
}
