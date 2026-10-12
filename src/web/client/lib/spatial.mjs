/** Presentation only: focus-centred neighborhoods, rectangular collision clearance,
 * and obstacle-aware canonical edges. No inference or graph mutation. */
export const ORIGIN = Object.freeze({x:960,y:800});
const W=216,H=52;
const dimensions=p=>({w:p.width||W,h:p.height||H});
function overlaps(a,b,gap=20){const aa=dimensions(a),bb=dimensions(b);return Math.abs(a.x-b.x)<(aa.w+bb.w)/2+gap&&Math.abs(a.y-b.y)<(aa.h+bb.h)/2+gap;}
export function spatialLayout({subjectId,focusId=subjectId,edges,groups=[],mode='adaptive',compact=false,previous=new Map()}){
 const positions=new Map([[focusId,{...ORIGIN}]]), peers=new Map(), groupFor=new Map();
 for(const g of groups)for(const id of g.peers)groupFor.set(id,g.key);
 for(const e of edges)for(const id of [e.source,e.target])if(id!==focusId&&!peers.has(id))peers.set(id,{id,edge:e});
 if(focusId!==subjectId&&!peers.has(subjectId))peers.set(subjectId,{id:subjectId,edge:null});
 const sectors=new Map(groups.map((g,i)=>[g.key,-Math.PI/2+i*2*Math.PI/Math.max(1,groups.length)]));
 const buckets=new Map();for(const p of peers.values()){const key=groupFor.get(p.id)||'relations';if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(p);}
 const dense=groups.length>0&&mode!=='orbit';
 // Reserve old objects first; newly sorted IDs must not displace earlier peers.
 if(mode!=='orbit')for(const peer of peers.values()){const old=previous.get(peer.id);if(old&&old.aggregateKey===groupFor.get(peer.id)&&![...positions.values()].some(p=>overlaps(old,p,28)))positions.set(peer.id,{...old});}
 for(const [key,list]of buckets){list.sort((a,b)=>a.id.localeCompare(b.id));const centre=sectors.get(key)??0;
  list.forEach((peer,i)=>{
   if(positions.has(peer.id))return;
   let angle,rx,ry;
   if(dense){const spread=groups.length>1?Math.min(2.4,2*Math.PI/groups.length*.84):2*Math.PI;const inRing=Math.min(6,list.length),ring=Math.floor(i/inRing),index=i%inRing;
    angle=centre+(index-(inRing-1)/2)*spread/inRing;rx=340+ring*220;ry=210+ring*150;
   }else{angle=-Math.PI/2+i*2*Math.PI/Math.max(1,list.length);rx=360;ry=200;
    if(peer.edge?.family==='ancestry'&&list.length<=3){angle=peer.edge.relationshipType==='forked_from'?-Math.PI*.78:Math.PI*.1;rx=350;ry=210;}
   }
   if(compact){rx=Math.min(rx,160+Math.floor(i/6)*230);ry=Math.max(ry,180+Math.floor(i/6)*130);if(peer.edge?.family==='ancestry'&&list.length<=3){angle=-Math.PI/2;rx=80;ry=170;}}
   const preferred={x:ORIGIN.x+Math.cos(angle)*rx,y:ORIGIN.y+Math.sin(angle)*ry,aggregateKey:groupFor.get(peer.id)};
   // Keep existing neighborhoods stable when possible. New neighbors search local
   // angular space; all existing objects reserve their real rectangular footprint.
   const old=previous.get(peer.id);let p=old&&!overlaps(old,ORIGIN,40)&&old.aggregateKey===preferred.aggregateKey?{...old}:preferred;
   if(mode==='orbit')p=preferred;
   let attempt=0;while([...positions.values()].some(other=>overlaps(p,other,28))&&attempt<180){attempt++;const a=angle+(attempt%2?1:-1)*Math.ceil(attempt/2)*.13,r=Math.floor(attempt/24);p={...preferred,x:ORIGIN.x+Math.cos(a)*(rx+r*100),y:ORIGIN.y+Math.sin(a)*(ry+r*90)};}
   positions.set(peer.id,p);
  });
 }
 for(const g of groups){const a=sectors.get(g.key),members=g.peers.map(id=>positions.get(id)).filter(Boolean);const radius=members.length?Math.max(...members.map(p=>Math.hypot(p.x-ORIGIN.x,p.y-ORIGIN.y)))+155:355;
  let p={x:ORIGIN.x+Math.cos(a)*radius,y:ORIGIN.y+Math.sin(a)*radius*.65,width:216,height:88};let tries=0;
  while([...positions.values()].some(other=>overlaps(p,other,24))&&tries++<80){const t=a+tries*.17;p={...p,x:ORIGIN.x+Math.cos(t)*(radius+Math.floor(tries/12)*80),y:ORIGIN.y+Math.sin(t)*(radius*.65+Math.floor(tries/12)*60)};}
  positions.set('bundle:'+g.key,p);
 }
 return positions;
}
function port(p,t){const {w,h}=dimensions(p),dx=t.x-p.x,dy=t.y-p.y;const s=Math.min(dx? w/2/Math.abs(dx):Infinity,dy?h/2/Math.abs(dy):Infinity);return{x:p.x+dx*s,y:p.y+dy*s};}
function blocked(a,b,boxes){return boxes.some(p=>{const{w,h}=dimensions(p);let low=0,high=1;for(const [delta,start,min,max]of [[b.x-a.x,a.x,p.x-w/2-9,p.x+w/2+9],[b.y-a.y,a.y,p.y-h/2-9,p.y+h/2+9]]){if(Math.abs(delta)<1e-9){if(start<=min||start>=max)return false;}else{let t1=(min-start)/delta,t2=(max-start)/delta;if(t1>t2)[t1,t2]=[t2,t1];low=Math.max(low,t1);high=Math.min(high,t2);if(high<=low)return false;}}return high>low&&high>0&&low<1;});}
export function spatialRoute(edge,positions,fanIndex=0,fanCount=1){
 const a=positions.get(edge.source),b=positions.get(edge.target);if(!a||!b)return null;
 const offset=(fanIndex-(fanCount-1)/2)*52,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1;
 const control={x:(a.x+b.x)/2-dy/len*offset,y:(a.y+b.y)/2+dx/len*offset};const start=port(a,control),end=port(b,control);
 const obstacles=[...positions.entries()].filter(([id])=>id!==edge.source&&id!==edge.target).map(([,p])=>p);
 const curve=t=>({x:(1-t)**2*start.x+2*(1-t)*t*control.x+t*t*end.x,y:(1-t)**2*start.y+2*(1-t)*t*control.y+t*t*end.y});
 let collision=false;for(let i=0;i<24;i++)if(blocked(curve(i/24),curve((i+1)/24),obstacles)){collision=true;break;}
 if(!collision)return{path:`M ${start.x} ${start.y} Q ${control.x} ${control.y} ${end.x} ${end.y}`,label:curve(.5)};
 // Visibility graph over padded obstacle corners: shortest clear route, never a
 // shared bus. Endpoints are recomputed on the actual entity boundary afterwards.
 const vertices=[a,b,...obstacles.flatMap(p=>{const{w,h}=dimensions(p);return[-1,1].flatMap(sx=>[-1,1].map(sy=>({x:p.x+sx*(w/2+12),y:p.y+sy*(h/2+12)})));})];
 const distance=vertices.map(()=>Infinity),parent=vertices.map(()=>-1),done=new Set();distance[0]=0;
 for(let pass=0;pass<vertices.length;pass++){let u=-1;for(let i=0;i<vertices.length;i++)if(!done.has(i)&&(u<0||distance[i]<distance[u]))u=i;if(u<0||!Number.isFinite(distance[u]))break;if(u===1)break;done.add(u);
  for(let v=0;v<vertices.length;v++)if(v!==u&&!done.has(v)&&!blocked(vertices[u],vertices[v],obstacles)){const d=distance[u]+Math.hypot(vertices[u].x-vertices[v].x,vertices[u].y-vertices[v].y);if(d<distance[v]){distance[v]=d;parent[v]=u;}}
 }
 const points=[];let current=1;while(current>=0){points.unshift(vertices[current]);current=parent[current];}if(points.length<2)return{path:`M ${start.x} ${start.y} L ${end.x} ${end.y}`,label:control};points[0]=port(a,points[1]);points[points.length-1]=port(b,points[points.length-2]);
 return{path:points.map((p,i)=>`${i?'L':'M'} ${p.x} ${p.y}`).join(' '),label:points[Math.floor(points.length/2)]};
}
