/** Presentation only: relationship-owned branches, rectangular collision clearance,
 * and obstacle-aware canonical edges. No inference or graph mutation. */
export const ORIGIN = Object.freeze({x:960,y:800});
const W=216,H=52;
const dimensions=p=>({w:p.width||W,h:p.height||H});
function overlaps(a,b,gap=20){const aa=dimensions(a),bb=dimensions(b);return Math.abs(a.x-b.x)<(aa.w+bb.w)/2+gap&&Math.abs(a.y-b.y)<(aa.h+bb.h)/2+gap;}
// Branch ownership is presentation metadata. Canonical edges keep their endpoints.
export function spatialLayout({subjectId,edges,groups=[],compact=false,previous=new Map()}){
 const positions=new Map([[subjectId,{...ORIGIN}]]), owners=new Map();
 const family=g=>g.family||(/depends_on/.test(g.key)?'dependency':/references|attribution/.test(g.key)?'attribution':'ancestry');
 const directions={ancestry:compact?-Math.PI/2:-Math.PI*.88,'source-identity':-Math.PI*.70,dependency:compact?Math.PI/2:0,attribution:compact?-Math.PI*.15:-Math.PI*.35,similarity:Math.PI*.35};
 const counts=new Map(),ord=new Map();for(const g of groups){const f=family(g);counts.set(f,(counts.get(f)||0)+1);}
 // Branch anchors are installed first. Members grow beyond their own anchor,
 // rather than displacing the branch control to the outside of an expanding fan.
 for(const g of groups){const f=family(g),i=ord.get(f)||0;ord.set(f,i+1);const n=counts.get(f),angle=directions[f]??0;
  const dx=Math.cos(angle),dy=Math.sin(angle),spread=(i-(n-1)/2)*(Math.abs(dy)>.7?250:150);
  const anchor={x:ORIGIN.x+dx*340-dy*spread,y:ORIGIN.y+dy*(compact?170:220)+dx*spread,width:216,height:88,angle,aggregateKey:g.key};
  const old=previous.get('bundle:'+g.key);positions.set('bundle:'+g.key,old||anchor);
  for(const id of g.peers)if(!owners.has(id))owners.set(id,g);
 }
 const ids=[...new Set(edges.flatMap(e=>[e.source,e.target]))].filter(id=>id!==subjectId);
 for(const id of ids){const old=previous.get(id);if(old&&!positions.has(id)&&![...positions.values()].some(p=>overlaps(old,p,24)))positions.set(id,old);}
 const slots=new Map();
 for(const id of ids){const g=owners.get(id),edge=edges.find(e=>e.source===id||e.target===id),f=g?family(g):edge?.family;
  const angle=directions[f]??Math.PI*.4,dx=Math.cos(angle),dy=Math.sin(angle),anchor=g?positions.get('bundle:'+g.key):ORIGIN;
  const key=g?.key||f||'related',i=slots.get(key)||0;slots.set(key,i+1);
  if(positions.has(id))continue;
  const horizontal=Math.abs(dx)>.7;
  const preferred={x:anchor.x+dx*(g?290:350)+(horizontal?Math.floor(i/4)*270*dx:-dy*(i%2)*245),y:anchor.y+dy*(g?(compact?120:180):220)+(horizontal?(i%4-1.5)*92:Math.floor(i/2)*120*dy),aggregateKey:g?.key,angle};
  let p=preferred,attempt=0;
  while([...positions.values()].some(q=>overlaps(p,q,26))&&attempt<600){attempt++;const row=Math.ceil(attempt/2)*(attempt%2?1:-1);p={...preferred,x:preferred.x+(horizontal?Math.floor(attempt/18)*270*dx:row*245),y:preferred.y+(horizontal?row*94:Math.floor(attempt/18)*120*dy)};}
  positions.set(id,p);
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
