/** Accepted relationship-map presentation; data, requests and navigation remain app-owned. */
export function mountSitePresentation(){
const inner=document.querySelector('.ld-inner');const intro=document.createElement('div');intro.className='lab-intro';
for(const selector of ['.eyebrow','.hero','.lede','#form','.sub-row','.repository-reference']){const item=inner.querySelector(':scope > '+selector);if(item)intro.append(item);}
inner.prepend(intro);
const map=document.createElement('section');map.className='lab-map';map.setAttribute('aria-label','Illustrative relationship map');
map.innerHTML=`<div class="lab-map-heading"><span>One repository. Different relationships.</span><span class="lab-illustration">Illustration</span></div>
<svg viewBox="0 0 600 500" role="img" aria-label="Illustration: repository ancestry, dependencies and references remain separate">
<g class="lab-branch ancestry"><path d="M300 203 C300 126 140 180 140 88"/><rect x="56" y="30" width="168" height="58" rx="5"/><text x="74" y="53" class="lab-small">Origins</text><text x="74" y="75">Source repository</text></g>
<g class="lab-branch dependencies"><path d="M300 276 C300 330 120 296 120 353"/><path class="lab-record-link" d="M120 413 C120 423 283 423 283 433"/><rect x="34" y="353" width="174" height="60" rx="5"/><text x="52" y="376" class="lab-small">Dependencies</text><text x="52" y="399">Referenced package</text><rect x="204" y="433" width="158" height="30" rx="3"/><text x="218" y="454" class="lab-small">Manifest record</text><circle class="lab-record-port" cx="283" cy="433" r="3"/></g>
<g class="lab-branch references"><path d="M400 243 C465 243 446 141 506 141"/><rect x="404" y="78" width="182" height="63" rx="5"/><text x="422" y="101" class="lab-small">References</text><text x="422" y="125">Attributed project</text></g>
<g class="lab-root"><rect x="200" y="203" width="200" height="73" rx="6"/><circle cx="223" cy="228" r="4"/><text x="239" y="233" class="lab-small">Exploration starts here</text><text x="223" y="259">Your repository</text></g>
<g class="lab-port"><circle cx="300" cy="203" r="4"/><circle cx="300" cy="276" r="4"/><circle cx="400" cy="243" r="4"/></g></svg>
<div class="lab-map-controls" role="group" aria-label="Highlight illustrative relationship"><button type="button" data-branch="ancestry" aria-pressed="true">Origins</button><button type="button" data-branch="dependencies" aria-pressed="false">Dependencies</button><button type="button" data-branch="references" aria-pressed="false">References</button></div>
<p class="lab-map-note" aria-live="polite">Ancestry requires Git history or verified derivation evidence.</p>
<a class="lab-open" href="#repo-input">Explore your repository <span aria-hidden="true">↗</span></a>`;
intro.after(map);
const notes={ancestry:'Ancestry requires Git history or verified derivation evidence.',dependencies:'A manifest records composition. A dependency does not establish ancestry.',references:'Attribution records a reference. It does not prove shared ancestry.'};
map.dataset.focus='ancestry';map.addEventListener('click',e=>{const button=e.target.closest('[data-branch]');if(!button)return;map.dataset.focus=button.dataset.branch;for(const b of map.querySelectorAll('[data-branch]'))b.setAttribute('aria-pressed',String(b===button));const note=map.querySelector('.lab-map-note');
const opacity=getComputedStyle(note).opacity;
for(const animation of note.getAnimations())animation.cancel();
note.textContent=notes[button.dataset.branch];
// Pointer-only reading feedback; keyboard selection remains immediate. No focus transfer.
if(e.detail && !matchMedia('(prefers-reduced-motion: reduce)').matches)
 note.animate([{opacity:Math.min(Number(opacity),.45)},{opacity:1}],{duration:160,easing:getComputedStyle(document.documentElement).getPropertyValue('--ease').trim()});});
// A single map entrance, never a page-wide cascade. Native transitions can reverse immediately.
requestAnimationFrame(()=>{map.getBoundingClientRect();requestAnimationFrame(()=>map.classList.add('lab-ready'));});

// Hover is a reversible reading cue, never a selection or a new graph state.
const finePointer=matchMedia('(hover: hover) and (pointer: fine)');
for(const branch of map.querySelectorAll('.lab-branch')){
 branch.addEventListener('pointerenter',()=>{if(finePointer.matches)map.dataset.preview=[...branch.classList].find(n=>n!=='lab-branch');});
 branch.addEventListener('pointerleave',()=>delete map.dataset.preview);
}
for(const button of map.querySelectorAll('[data-branch]')){
 button.addEventListener('pointerenter',()=>{if(finePointer.matches)map.dataset.preview=button.dataset.branch;});
 button.addEventListener('pointerleave',()=>delete map.dataset.preview);
}
finePointer.addEventListener('change',()=>delete map.dataset.preview);
// Make the existing four-step explanation explorable without navigating away.
const process=document.querySelector('.hero-trace');
if(process){
 const descriptions=[
  'Start with the repository identity and revision. Every collected record belongs to this specific source, rather than an unlabelled snapshot.',
  'Read Git objects, manifests and attribution documents. A supporting record explains where a connection came from; it does not by itself prove ancestry.',
  'Keep ancestry, dependency and attribution connections distinct. Follow each branch to inspect the object and the evidence behind that particular relationship.',
  'Only supported history or derivation evidence establishes ancestry. Similar projects remain candidates to investigate, not verified origins.'
 ];
 const detail=document.createElement('div');detail.id='home-process-detail';detail.className='hero-trace-detail';detail.setAttribute('aria-hidden','true');detail.inert=true;
 detail.innerHTML='<div><p></p></div>';
 const note=process.querySelector('.hero-trace-note');process.insertBefore(detail,note);
 let opened=-1;
 const nodes=[...process.querySelectorAll('.hero-trace-node')];
 nodes.forEach((node,index)=>{
  const button=document.createElement('button');button.type='button';button.className='hero-trace-toggle';button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',detail.id);
  const stage=node.querySelector('.hero-trace-stage'),value=node.querySelector('.hero-trace-value');
  // Span children keep the native button content model valid.
  for(const text of [stage,value]){const span=document.createElement('span');span.className=text.className;span.textContent=text.textContent;button.append(span);text.remove();}
  const mark=document.createElement('span');mark.className='hero-trace-disclose';mark.setAttribute('aria-hidden','true');mark.textContent='+';button.append(mark);node.append(button);
  button.addEventListener('click',()=>{
   opened=opened===index?-1:index;
   nodes.forEach((n,i)=>n.querySelector('button').setAttribute('aria-expanded',String(i===opened)));
   if(opened>=0){detail.querySelector('p').textContent=descriptions[opened];detail.style.setProperty('--step-ink',getComputedStyle(node).getPropertyValue('--step-ink'));}
   detail.classList.toggle('is-open',opened>=0);detail.setAttribute('aria-hidden',String(opened<0));detail.inert=opened<0;
  });
 });
}

/* Presentation enhancements. App reducers, graph data and request budgets
   remain untouched. No timers drive product state. Motion has one owner per surface. */
(()=>{
 const reduce=matchMedia('(prefers-reduced-motion: reduce)');
 const active=new Set(),previous=new WeakMap();
 let pointer=false,lastIdentity='';
 document.addEventListener('pointerdown',()=>{pointer=true;document.documentElement.dataset.siteInput='pointer';},true);
 document.addEventListener('keydown',()=>{pointer=false;document.documentElement.dataset.siteInput='keyboard';stop();},true);
 function stop(){for(const a of active)a.cancel();active.clear();}
 reduce.addEventListener('change',()=>{if(reduce.matches)stop();});
 function settle(el,key,axis='y'){
  if(!el||previous.get(el)===key)return;
  previous.set(el,key);
  for(const a of el.getAnimations())if(active.has(a))a.cancel();
  if(reduce.matches||!pointer||!el.getClientRects().length)return;
  const easing=getComputedStyle(document.documentElement).getPropertyValue('--ease').trim()||'ease-out';
  const a=el.animate([{opacity:.5,transform:axis==='x'?'translateX(10px)':'translateY(8px)'},{opacity:1,transform:'none'}],{duration:220,easing});
  a.id='site-context';active.add(a);a.finished.catch(()=>{}).finally(()=>active.delete(a));
 }
 function refresh(){
  const discovery=document.querySelector('#workspace-discovery');
  if(discovery&&!discovery.querySelector('.site-discovery-heading')){
   const h=document.createElement('h3');h.className='site-discovery-heading';h.textContent='Related projects';discovery.prepend(h);
  }
  for(const title of document.querySelectorAll('#drawer-inner .d-head')){
   const parent=title.parentElement;if(parent.classList.contains('site-object-heading'))continue;
   const identity=document.createElement('div');identity.className='site-object-heading';
   const items=[...parent.children].filter(n=>n.matches('.d-eyebrow,.d-head,.d-sub'));
   parent.insertBefore(identity,items[0]);identity.append(...items);
   const type=identity.querySelector('.d-eyebrow')?.textContent.toLowerCase()||'';
   identity.dataset.kind=/file|directory|module/.test(type)?'structure':/candidate|similar/.test(type)?'discovery':'repository';
   const key=identity.textContent;
   if(key!==lastIdentity){lastIdentity=key;settle(identity,key,'x');}
  }
  for(const disclosure of document.querySelectorAll('.rail details,.drawer details,#workspace-discovery details,.history-detail details,.history-branches details,.an-aside details,details.mobile-family,details.mobile-group'))disclosure.classList.add('site-disclosure');
  for(const action of document.querySelectorAll('.deep-layer-candidate,#deep-source-preview,#deep-compare,#deep-download,.workspace-measurement-picker button,.history-related-row,#history-more,#history-list-return,.d-actions button,.d-actions a,.bundle-actions button'))action.classList.add('site-action');
  const phaseNumber=document.querySelector('.an-plabel.is-now .n')?.textContent;
  const work=document.querySelector('.an-work');
  if(work&&phaseNumber)work.dataset.step=phaseNumber.padStart(2,'0');
  const detail=document.querySelector('.history-detail');
  settle(detail,detail?.querySelector('.history-commit-summary')?.textContent,'x');
  const phase=document.querySelector('.an-phase');
  // Only a changed phase title settles. Verb / polling updates never replay it.
  settle(phase,phase?.querySelector('#an-ptitle')?.textContent);
 }
 let queued=false;
 const observer=new MutationObserver(()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;refresh();});});
 observer.observe(document.body,{subtree:true,childList:true,characterData:true});refresh();
 // The selected branch owns its underline in CSS. A shared, asynchronously sized
 // cursor could keep the previous button's width while selection moved.
 // A single first-encounter explanation: the four real analysis steps resolve
 // across the process strip as it enters the reading viewport. Never on focus.
 const process=document.querySelector('.hero-trace');
 if(process){const io=new IntersectionObserver(entries=>{if(!entries.some(e=>e.isIntersecting))return;io.disconnect();if(reduce.matches)return;
  const steps=[...process.querySelectorAll('.hero-trace-node')];
  steps.forEach((el,i)=>{const a=el.animate([{opacity:.45,transform:'translateY(12px)'},{opacity:1,transform:'none'}],{duration:260,delay:i*55,easing:'ease-out'});a.id='site-explanation';active.add(a);a.finished.catch(()=>{}).finally(()=>active.delete(a));});
 },{threshold:.3});io.observe(process);}
})();

}
