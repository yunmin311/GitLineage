/** Interruptible geometry transitions. DOM always owns the final semantic state. */
const active = new WeakMap();
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const key = n => n.dataset.nodeId || n.dataset.bundleKey || n.dataset.node || n.dataset.relationshipId;
export function stopMotion(root) { active.get(root)?.(); active.delete(root); }
export function captureMotion(root) {
 stopMotion(root);
 return new Map([...root.querySelectorAll('[data-node-id], [data-bundle-key], [data-node], [data-relationship-id]')].map(n => [key(n), {rect:n.getBoundingClientRect(),paths:[...n.querySelectorAll('path')].map(p=>p.getAttribute('d'))}]));
}
export function transitionScene(root, before) {
 if (reduced() || !before.size) return;
 const animations=[],paths=[];
 const matrix=root.getScreenCTM();if(!matrix)return;
 for(const n of root.querySelectorAll('[data-node-id], [data-bundle-key], [data-node], [data-relationship-id]')) {
  const old=before.get(key(n)),rect=n.getBoundingClientRect();
  const dx=old?(old.rect.x-rect.x)/matrix.a:0,dy=old?(old.rect.y-rect.y)/matrix.d:8;
  const base=n.getAttribute('transform')?.replace(/translate\(([-\d.]+),\s*([-\d.]+)\)/g,'translate($1px, $2px)')||'';
  if(!n.dataset.relationshipId&&(dx||dy||!old))animations.push(n.animate([{transform:`translate(${dx}px, ${dy}px) ${base}`,opacity:old?1:0},{transform:`translate(0px, 0px) ${base}`,opacity:1}],{duration:260,easing:'cubic-bezier(.22,.61,.36,1)'}));
  if(old)for(const [i,p]of [...n.querySelectorAll('path')].entries()) {
   const end=p.getAttribute('d'),start=old.paths[i];if(!start||!end||start.replace(/[-\d.]+/g,'#')!==end.replace(/[-\d.]+/g,'#'))continue;
   const from=start.match(/-?\d*\.?\d+/g)?.map(Number),to=end.match(/-?\d*\.?\d+/g)?.map(Number);if(from?.length===to?.length)paths.push({p,end,from,to});
  }
 }
 let frame=0,start=performance.now();
 const finish=()=>{cancelAnimationFrame(frame);for(const a of animations)a.cancel();for(const {p,end}of paths)p.setAttribute('d',end);};active.set(root,finish);
 const tick=now=>{const t=Math.min(1,(now-start)/260),ease=1-(1-t)**3;for(const {p,end,from,to}of paths){let i=0;p.setAttribute('d',end.replace(/-?\d*\.?\d+/g,()=>String(from[i]+(to[i]-from[i++])*ease)));}if(t<1)frame=requestAnimationFrame(tick);else active.delete(root);};frame=requestAnimationFrame(tick);
}
export function transitionCamera(root, end, write=value=>root.setAttribute('viewBox',value)) {
 stopMotion(root);const from=(root.getAttribute('viewBox')||end).split(/\s+/).map(Number),to=end.split(/\s+/).map(Number);
 if(reduced()||from.length!==4){write(end);return;}
 let frame,start=performance.now();active.set(root,()=>{cancelAnimationFrame(frame);});
 const tick=now=>{const t=Math.min(1,(now-start)/260),e=1-(1-t)**3;write(to.map((v,i)=>from[i]+(v-from[i])*e).join(' '));if(t<1)frame=requestAnimationFrame(tick);else active.delete(root);};frame=requestAnimationFrame(tick);
}
export function revealInstrument(root) {if(!reduced())root.animate([{opacity:.55,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:160,easing:'ease-out'});}
