import {parseViewBox} from './camera.mjs';

/** Public repository views. Canonical DOM and state remain mounted and untouched. */
export function mountRepositoryExplorer(getRepository,deep){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(id,text,fn)=>{const n=el('button',text,'d-action');n.type='button';if(id)n.id=id;n.addEventListener('click',fn);return n;};
 const svgEl=(tag,attrs={},text)=>{const n=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));if(text!==undefined)n.textContent=text;return n;};
 const explorer=document.querySelector('#explorer'),canonical=document.querySelector('#explorer-body');
 const nav=el('nav',undefined,'repository-navigation');nav.setAttribute('aria-label','Repository views');explorer.prepend(nav);
 const workspace=el('section',undefined,'repository-workspace');workspace.id='repository-workspace';workspace.hidden=true;workspace.setAttribute('aria-label','Repository exploration');canonical.after(workspace);
 const left=el('aside',undefined,'workspace-rail rail'),leftInner=el('div',undefined,'rail-scroll gl-scroll'),stage=el('div',undefined,'workspace-stage stage'),right=el('aside',undefined,'workspace-drawer drawer'),rightInner=el('div',undefined,'drawer-inner gl-scroll');
 left.setAttribute('aria-label','Repository navigation');right.setAttribute('aria-label','Selected object evidence');left.append(leftInner);right.append(rightInner);workspace.append(left,stage,right);
 const svg=svgEl('svg',{id:'workspace-canvas',role:'group','aria-label':'Repository visualization',tabindex:0});stage.append(svg);
 const caption=el('div',undefined,'workspace-caption'),controls=el('div',undefined,'workspace-controls');stage.append(caption,controls);
 controls.append(button('workspace-zoom-out','−',()=>zoom(1.2)),button('workspace-zoom-in','+',()=>zoom(1/1.2)),button('workspace-fit','Fit',()=>fit()));
 controls.children[0].setAttribute('aria-label','Zoom out visualization');controls.children[1].setAttribute('aria-label','Zoom in visualization');
 const mobile=el('nav',undefined,'workspace-mobile');mobile.setAttribute('aria-label','Workspace views');workspace.append(mobile);
 const mobiles={};for(const [id,name]of [['canvas','Canvas'],['navigation','Navigate'],['evidence','Evidence']]){mobiles[id]=button('',name,()=>surface(id));mobile.append(mobiles[id]);}
 let workGeneration=0;
 let tab='graph',task=null,path='',busy=false,repository='',selection=null,scene=[],connections=[],extent={w:900,h:600},mobileView='canvas';
 const viewStates=new Map(),expanded=new Set(['']),limits=new Map();let selectedDiscovery=null,discoverySearch=null;
 const input=el('input');input.id='explore-repository';input.placeholder='owner/repo';input.required=true;input.setAttribute('aria-label','Public GitHub repository');
 const form=el('form',undefined,'workspace-form');form.append(input,button('explore-load','Read fixed version',()=>form.requestSubmit()));
 const status=el('p','Read a fixed version to explore its recorded structure and history.','deep-status');status.id='explore-status';status.setAttribute('role','status');
 const cancel=button('explore-cancel','Cancel',async()=>{if(task)try{await request(`/${task.id}/cancel`,{});}catch(e){status.textContent=e.message;}});cancel.hidden=true;
 const navigation=el('section');navigation.id='explore-content';
 const exportButton=button('explore-download','Export observations',()=>{if(task){const a=el('a'),url=URL.createObjectURL(new Blob([JSON.stringify(task,null,2)],{type:'application/json'}));a.href=url;a.download='gitlineage-repository-exploration.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}});
 const discoveryRail=el('section',undefined,'workspace-discovery-controls'),discoveryEvidence=el('section',undefined,'workspace-discovery-evidence'),inspector=el('section');
 // Reuse the actual Discovery controller, form, selections and exports. No second engine.
 for(const id of ['deep-status','deep-candidates','deep-source-preview','deep-cancel']){const n=deep.dialog.querySelector('#'+id);if(n)discoveryRail.append(n);}
 discoveryRail.prepend(deep.dialog.querySelector('.deep-form'));
 for(const id of ['deep-files','deep-compare','deep-results'])discoveryEvidence.append(deep.dialog.querySelector('#'+id));
 discoveryEvidence.prepend(inspector);
 deep.dialog.hidden=true;deep.launcher.remove();deep.layerLauncher.hidden=true;
 const tabButtons={};for(const [id,name]of [['graph','Graph'],['structure','Structure'],['history','History'],['discovery','Discovery']]){
  const b=button(id==='structure'?'deep-launch':id==='discovery'?'repository-deep':'repository-'+id,name,()=>open(id));tabButtons[id]=b;nav.append(b);
 }
 function surface(value){mobileView=value;workspace.dataset.surface=value;for(const [id,b]of Object.entries(mobiles))b.setAttribute('aria-pressed',String(id===value));}
 function open(next){
  if(tab!=='graph')viewStates.set(tab,{box:svg.getAttribute('viewBox'),selection,path,mobileView,scrollLeft:leftInner.scrollTop,scrollRight:rightInner.scrollTop});
  const layersButton=document.querySelector('#layers-btn'),layersPop=document.querySelector('#layers-pop');if(layersButton)layersButton.hidden=next!=='graph';if(layersPop){layersPop.inert=next!=='graph';layersPop.style.visibility=next==='graph'?'':'hidden';}
  const repo=getRepository(),name=typeof repo==='string'?repo:repo?`${repo.owner}/${repo.name}`:'';
  if(name&&name!==repository){workGeneration++;if(task?.state==='running')void request(`/${task.id}/cancel`,{}).catch(()=>{});busy=false;repository=name;input.value=name;input.disabled=false;form.querySelector('button').disabled=false;cancel.hidden=true;task=null;path='';selection=null;viewStates.clear();expanded.clear();expanded.add('');selectedDiscovery=null;deep.workspace.reset(name);}
  tab=next;for(const [id,b]of Object.entries(tabButtons))b.setAttribute('aria-pressed',String(id===tab));
  workspace.hidden=tab==='graph';canonical.inert=tab!=='graph';explorer.classList.toggle('workspace-active',tab!=='graph');
  // Keep the original stage dimensions and CTM while the replacement view owns pixels.
  canonical.style.visibility=tab==='graph'?'':'hidden';
  const mobileNav=document.querySelector('#mobile-nav');if(mobileNav)mobileNav.style.visibility=tab==='graph'?'':'hidden';
  if(tab==='graph'){tabButtons.graph.focus();return;}
  const saved=viewStates.get(tab);selection=saved?.selection??null;path=saved?.path??path;surface(saved?.mobileView??'canvas');
  if(tab==='discovery'){const d=discoveryRail.querySelector('#deep-repository');if(!d.value)d.value=input.value;}
  render();if(saved?.box)svg.setAttribute('viewBox',saved.box);else fit();leftInner.scrollTop=saved?.scrollLeft??0;rightInner.scrollTop=saved?.scrollRight??0;
 }
 async function request(suffix,data){const response=await fetch('/api/explore'+suffix,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-gitlineage-csrf':'1'},body:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw new Error((value.error||'Unavailable')+(value.retryAt?' · Retry after '+new Date(value.retryAt).toLocaleTimeString():''));return value;}
 async function work(fn){if(busy)return;const version=workGeneration;busy=true;cancel.hidden=false;input.disabled=true;form.querySelector('button').disabled=true;try{let next=await fn();if(version!==workGeneration)return;task=next;while(next.state==='running'){status.textContent='Reading fixed Git objects…';await new Promise(r=>setTimeout(r,250));if(version!==workGeneration)return;next=await request('/'+next.id);if(version!==workGeneration)return;task=next;}status.textContent=`${task.state}${task.error?' · '+task.error:''}`;render();}catch(e){if(version===workGeneration)status.textContent=e.message;}finally{if(version===workGeneration){busy=false;cancel.hidden=true;input.disabled=false;form.querySelector('button').disabled=false;}}}
 form.addEventListener('submit',e=>{e.preventDefault();path='';selection=null;expanded.clear();expanded.add('');void work(()=>request('',{repository:input.value})).then(()=>fit());});
 nav.addEventListener('keydown',e=>{if(tab!=='graph'){e.stopPropagation();if(e.key==='Escape'){e.preventDefault();open('graph');}}});
 workspace.addEventListener('keydown',e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();if(mobileView!=='canvas')surface('canvas');else open('graph');}});
 function heading(container,eyebrow,title){container.append(el('p',eyebrow,'d-eyebrow'),el('h2',title,'workspace-title'));}
 function fact(container,label,value){const row=el('dl',undefined,'d-kv');row.append(el('dt',label),el('dd',value??'Unavailable'));container.append(row);}
 function external(container,title,revision,file){const a=el('a',title,'d-src');a.href=`https://github.com/${task.repository}/${file?'blob':'commit'}/${revision}${file?'/'+file.split('/').map(encodeURIComponent).join('/'):''}`;a.target='_blank';a.rel='noopener noreferrer';container.append(a);}
 function choose(node){selection=node.id;if(tab==='discovery')selectedDiscovery=node.data;for(const b of navigation.querySelectorAll('[data-file], [data-path], [data-commit]')){const id=b.dataset.file?'file:'+b.dataset.file:b.hasAttribute('data-path')?'dir:'+b.dataset.path:b.dataset.commit;b.setAttribute(b.hasAttribute('data-path')?'aria-selected':'aria-pressed',String(id===selection));}for(const b of leftInner.querySelectorAll('.workspace-candidate-navigation button'))b.setAttribute('aria-pressed',String(b.textContent===node.label));renderEvidence();paint();rightInner.scrollTop=0;surface('evidence');}
 function addNode(id,label,meta,x,y,data,kind='file'){scene.push({id,label,meta,x,y,data,kind});}
 function directory(next){if(busy)return;path=next;expanded.add(next);selection='dir:'+next;if(task.directories.some(d=>d.path===next)){render();}else void work(()=>request(`/${task.id}/directory`,{path:next}));}
 function toggleDirectory(next){if(expanded.has(next)&&task.directories.some(d=>d.path===next)){expanded.delete(next);selection='dir:'+next;render();}else directory(next);}
 function render(){
  const active=document.activeElement,restoreFocus=workspace.contains(active);
  leftInner.replaceChildren();rightInner.replaceChildren();navigation.replaceChildren();scene=[];connections=[];
  heading(leftInner,'REPOSITORY EXPLORER',tab==='structure'?'Structure':tab==='history'?'Git history':'Discovery');
  if(tab==='discovery'){leftInner.append(discoveryRail);rightInner.append(discoveryEvidence);drawDiscovery();}
  else{leftInner.append(form,status,cancel,navigation);if(task){leftInner.append(el('p',`${task.repository} · ${task.revision?.slice(0,12)??'unavailable'}`,'deep-digest'),exportButton);if(tab==='structure')drawStructure();else drawHistory();if(task.serviceQuota)leftInner.append(el('p',`Shared requests ${task.serviceQuota.spentAttempts}/${task.serviceQuota.attemptsPerHour} · resets ${new Date(task.serviceQuota.resetAt).toLocaleTimeString()}`,'rail-note'));}renderEvidence();}
  caption.replaceChildren(el('span',tab==='structure'?'FIXED TREE · EXPAND DIRECTORIES':tab==='history'?'GIT DAG · NEWER → OLDER':'OBSERVATIONS · NO LINEAGE ARROWS'),el('small',tab==='discovery'?'pending / none':task?`${task.state} · ${task.coverage?.[tab==='history'?'history':'structure']??'bounded objects'}`:'No objects loaded'));
  paint();if(!svg.hasAttribute('viewBox'))fit();if(restoreFocus&&active?.isConnected)active.focus({preventScroll:true});
 }
 function drawStructure(){
  const tree=el('div',undefined,'workspace-tree');tree.setAttribute('role','tree');navigation.append(tree);let row=0;
  function walk(folder,depth,parent,objectSha){const d=task.directories.find(d=>d.path===folder),id='dir:'+folder;
   addNode(id,folder?folder.split('/').pop():task.repository,folder?'DIRECTORY':'REPOSITORY ROOT',depth*(innerWidth<768?80:240)+35,row++*76+40,{path:folder,type:'tree',sha:d?.sha??objectSha},'directory');if(parent)connections.push([parent,id]);
   const b=button('',(expanded.has(folder)?'− ':'+ ')+(folder||'/'),()=>toggleDirectory(folder));b.dataset.path=folder;b.style.paddingInlineStart=`${12+depth*12}px`;b.setAttribute('role','treeitem');b.setAttribute('aria-expanded',String(expanded.has(folder)));b.setAttribute('aria-selected',String(selection===id));tree.append(b);
   if(!expanded.has(folder)||!d)return;
   const limit=limits.get(folder)??30;for(const entry of d.entries.slice(0,limit)){const p=folder?folder+'/'+entry.path:entry.path;if(entry.type==='tree')walk(p,depth+1,id,entry.sha);else{const nodeId='file:'+p;addNode(nodeId,entry.path,entry.category, (depth+1)*(innerWidth<768?80:240)+35,row++*76+40,{...entry,path:p},entry.type==='commit'?'submodule':'file');connections.push([id,nodeId]);const fileButton=button('',entry.path,()=>{const n=scene.find(n=>n.id===nodeId);choose(n);focusNode(n);});fileButton.dataset.file=p;fileButton.setAttribute('aria-pressed',String(selection===nodeId));fileButton.style.paddingInlineStart=`${24+depth*12}px`;tree.append(fileButton);}}
   if(d.entries.length>limit){const more=button('',`Show ${Math.min(30,d.entries.length-limit)} more listed objects`,()=>{limits.set(folder,limit+30);render();});tree.append(more);}
  }walk('',0,null);
  extent={w:Math.max(innerWidth<768?400:850,...scene.map(n=>n.x+250)),h:Math.max(550,row*76+80)};
  navigation.append(el('p',`${task.directories.length} directories read. Collapsed directories are not loaded automatically; unlisted contents remain unknown.`,'rail-note'));
 }
 function drawHistory(){
  heading(navigation,'OBSERVED BRANCH TIPS','Branches');for(const branch of task.branches){const b=button('',`${branch.name} · ${branch.sha.slice(0,8)}`,()=>{const n=scene.find(n=>n.id===branch.sha);if(n){choose(n);focusNode(n);}else{status.textContent='Branch tip not loaded. Read its fixed version to inspect structure.';selection=branch.sha;renderEvidence();}});navigation.append(b);}
  navigation.append(button('explore-branches','Load branch tips',()=>void work(()=>request(`/${task.id}/branches`,{}))));
  const remaining=new Map(task.commits.map(c=>[c.sha,c])),ordered=[];while(remaining.size){const next=[...remaining.values()].find(c=>![...remaining.values()].some(other=>other.parents.includes(c.sha)));if(!next){ordered.push(...remaining.values());break;}ordered.push(next);remaining.delete(next.sha);}
  const lanes=new Map();let nextLane=1;ordered.forEach((c,i)=>{const lane=lanes.get(c.sha)??0;lanes.set(c.sha,lane);c.parents.forEach((p,j)=>{if(!lanes.has(p))lanes.set(p,j===0?lane:nextLane++);});
   addNode(c.sha,c.message.split('\n')[0],`${c.sha.slice(0,8)} · ${c.date?.slice(0,10)??'unknown date'}`,35+lane*260,50+i*(innerWidth<768?92:112),c,c.parents.length>1?'merge':'commit');
  });
  for(const c of task.commits)for(const parent of c.parents){if(scene.some(n=>n.id===parent))connections.push([c.sha,parent]);else{const id='pending:'+parent;if(!scene.some(n=>n.id===id))addNode(id,parent.slice(0,12),'PARENT OBJECT NOT LOADED',35+(lanes.get(parent)??0)*260,50+task.commits.length*(innerWidth<768?92:112),{sha:parent},'pending');connections.push([c.sha,id]);}}
  for(const c of task.commits){const b=button('',`${c.sha.slice(0,8)} · ${c.message.split('\n')[0]}`,()=>{const n=scene.find(n=>n.id===c.sha);choose(n);focusNode(n);});b.dataset.commit=c.sha;b.setAttribute('aria-pressed',String(selection===c.sha));navigation.append(b);}
  if(task.coverage.pendingParents.length)navigation.append(button('explore-history-more','Load earlier commits',()=>void work(()=>request(`/${task.id}/history`,{}))));
  extent={w:Math.max(850,(nextLane+1)*260),h:Math.max(550,...scene.map(n=>n.y+96))};
 }
 function drawDiscovery(){const {parent,current}=deep.workspace.state,list=parent?.search?.result?.candidates??[],target=parent?.search?.target?.identity,compact=innerWidth<768;
  if((parent?.id??null)!==discoverySearch){discoverySearch=parent?.id??null;selection=null;selectedDiscovery=null;inspector.replaceChildren();}
  if(target)addNode('target',target.fullName,'PINNED SEARCH TARGET',35,80,target,'target');
  for(const [i,c]of list.entries()){const comparison=current?.comparison?.content.comparisons.find(r=>r.candidate?.candidate.repositoryId===c.candidate.repositoryId),measurements=comparison?.candidate?.similarity??[];
   addNode('candidate:'+c.candidate.repositoryId,c.candidate.fullName,measurements.length?'PINNED MEASUREMENTS':'NOT COMPARED · NO SCORE',compact?120:350,(compact?190:80)+i*132,{candidate:c,comparison},'candidate');if(target)connections.push(['target','candidate:'+c.candidate.repositoryId]);}
  extent={w:compact?360:670,h:Math.max(550,list.length*132+(compact?270:160))};if(selection){const n=scene.find(n=>n.id===selection);if(n)selectedDiscovery=n.data;}if(selectedDiscovery)discoveryInspector(selectedDiscovery);if(current?.kind==='compare'){const list=el('nav',undefined,'workspace-candidate-navigation');list.setAttribute('aria-label','Discovered candidates');for(const n of scene.filter(n=>n.kind==='candidate')){const b=button('',n.label,()=>{choose(n);focusNode(n);});b.setAttribute('aria-pressed',String(selection===n.id));list.append(b);}leftInner.append(list);}
 }
 function discoveryInspector(data){inspector.replaceChildren();const c=data.candidate;for(const card of discoveryEvidence.querySelectorAll('[data-comparison-repository]'))card.hidden=!!c&&card.dataset.comparisonRepository!==String(c.candidate.repositoryId);if(!c){heading(inspector,'PINNED SEARCH TARGET',data.fullName);fact(inspector,'ID',String(data.repositoryId));fact(inspector,'Revision',data.revision);return;}
  heading(inspector,'SEARCH OBSERVATION',c.candidate.fullName);fact(inspector,'Numeric ID',String(c.candidate.repositoryId));inspector.append(el('p','Verification pending · lineage claim none','deep-warning'));
  for(const d of c.discoveries){const section=el('section',undefined,'d-card');section.append(el('h3',d.source),el('p',d.reason,'d-quote'));fact(section,'Query',d.query);fact(section,'Version',d.version);fact(section,'Rank / page',`${d.rank} / ${d.page}`);inspector.append(section);}
  if(!data.comparison?.candidate?.similarity?.length)inspector.append(el('p','Not compared. Select this candidate in Navigate, then read Source Files. No zero score is substituted.','rail-note'));
 }
 function renderEvidence(){if(tab==='discovery'){if(selectedDiscovery)discoveryInspector(selectedDiscovery);return;}
  rightInner.replaceChildren();const node=scene.find(n=>n.id===selection);heading(rightInner,tab==='structure'?'FIXED OBJECT':'RECORDED GIT OBJECT',node?.label??'Select an object');
  if(!node){rightInner.append(el('p','Select a node on the canvas or in Navigate to inspect its fixed identity and observations.','rail-note'));return;}
  fact(rightInner,'Repository',task.repository);fact(rightInner,'Numeric ID',String(task.resolution?.requestedId??'unavailable'));const data=node.data;
  if(tab==='structure'){
   fact(rightInner,'Path',data.path||'/');fact(rightInner,'Type',data.category??data.type);fact(rightInner,'Revision',task.revision);fact(rightInner,'Git object',data.sha);if(data.size!==undefined)fact(rightInner,'Bytes',String(data.size));
   if(data.type==='tree'){rightInner.append(button('explore-directory',expanded.has(data.path)?'Collapse directory':'Expand directory',()=>toggleDirectory(data.path)));const loaded=task.directories.find(d=>d.path===data.path);fact(rightInner,'Coverage',loaded?`${loaded.entries.length} entries listed; child directories loaded on demand`:'Not loaded');}
   else{external(rightInner,'Open pinned source',task.revision,data.path);if(data.category==='package manifest')rightInner.append(button('','Read package declaration',()=>void work(()=>request(`/${task.id}/manifest`,{path:data.path}))));}
   if(data.type==='commit')rightInner.append(el('p','Submodule commit identity only. External content is never followed.','deep-warning'));
   for(const p of task.packages??[])if(p.path===data.path&&p.revision===task.revision){heading(rightInner,'PACKAGE DECLARATION',p.name);fact(rightInner,'SHA-256',p.digest);fact(rightInner,'Workspaces',p.workspaces.join(', ')||'none declared');for(const d of p.dependencies)fact(rightInner,d.name,`${d.version} · ${d.kind}`);}
  }else{
   fact(rightInner,'Commit',data.sha);if(node.kind==='pending'){rightInner.append(el('p','A recorded parent reference; its commit object is not loaded. Contents and earlier ancestry are unknown.','deep-warning'));return;}
   fact(rightInner,'Author',data.author);fact(rightInner,'Date',data.date);fact(rightInner,'Tree',data.tree);rightInner.append(el('p',data.message,'d-quote'));for(const parent of data.parents)fact(rightInner,'Parent',parent);if(data.parents.length>1)rightInner.append(el('p','Merge: multiple parents recorded in the returned Git object.','deep-note'));
   rightInner.append(button('explore-commit-structure','Structure at this commit',()=>{viewStates.delete('structure');open('structure');path='';selection=null;expanded.clear();expanded.add('');void work(()=>request(`/${task.id}/revision`,{sha:data.sha})).then(()=>fit());}));
   heading(rightInner,'CHANGED FILE SAMPLE',`${data.changes.length} observed files`);for(const file of data.changes){external(rightInner,file.path,data.sha,file.path);rightInner.append(el('p',`${file.status} · +${file.additions} −${file.deletions}`,'deep-note'));}if(!data.changes.length)rightInner.append(el('p','No changed-file sample returned. This does not prove an unchanged commit.','rail-note'));rightInner.append(el('p','At most 40 file changes per commit; not a complete diff.','deep-note'));external(rightInner,'Open fixed commit',data.sha);
  }
 }
 function paint(){const focused=document.activeElement?.closest?.('[data-node]')?.getAttribute('data-node');svg.replaceChildren();svg.setAttribute('aria-label',tab==='structure'?'Repository module hierarchy':tab==='history'?'Git commit DAG':'Discovered candidate observations');
  for(const [a,b]of connections){const first=scene.find(n=>n.id===a),second=scene.find(n=>n.id===b);if(!first||!second)continue;const x1=tab==='history'?first.x+100:first.x+200,y1=tab==='history'?first.y+56:first.y+28,x2=tab==='history'?second.x+100:second.x,y2=tab==='history'?second.y:second.y+28;svg.append(svgEl('path',{d:`M${x1},${y1} C${x1},${(y1+y2)/2} ${x2},${(y1+y2)/2} ${x2},${y2}`,class:'workspace-link '+(tab==='discovery'?'observation-link':''),'data-from':a,'data-to':b}));}
  for(const node of scene){const g=svgEl('g',{class:`workspace-node ${node.kind}${selection===node.id?' is-selected':''}`,transform:`translate(${node.x},${node.y})`,role:'button',tabindex:0,'aria-label':node.label+' · '+node.meta,'data-node':node.id});g.append(svgEl('rect',{width:200,height:56,rx:3,class:'workspace-box'}),svgEl('text',{x:12,y:22,class:'node-label'},node.label),svgEl('text',{x:12,y:42,class:'node-fact'},node.meta));g.append(svgEl('title',{},node.label+' · '+node.meta));
   g.addEventListener('click',()=>{if(!dragged)choose(node);});g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();choose(node);}});svg.append(g);
   for(const text of g.querySelectorAll('text')){const full=text.textContent;while(text.getComputedTextLength()>(node.kind==='directory'?156:174)&&text.textContent.length>2)text.textContent=text.textContent.slice(0,-2)+'…';text.setAttribute('aria-label',full);}
   if(tab==='structure'&&node.kind==='directory'){const control=svgEl('g',{role:'button',tabindex:0,'aria-label':(expanded.has(node.data.path)?'Collapse ':'Expand ')+(node.data.path||'root'),transform:'translate(174,0)'});control.append(svgEl('rect',{width:26,height:56,fill:'transparent'}),svgEl('text',{x:8,y:23,class:'node-fact'},expanded.has(node.data.path)?'−':'+'));control.addEventListener('click',e=>{e.stopPropagation();if(!dragged)toggleDirectory(node.data.path);});control.addEventListener('keydown',e=>{if(e.key==='Enter'){e.stopPropagation();toggleDirectory(node.data.path);}});g.append(control);}
   if(tab==='history'){const names=task.branches.filter(b=>b.sha===node.id).map(b=>b.name);if(names.length)g.append(svgEl('text',{x:212,y:22,class:'workspace-branch'},names.join(' · ')));}
  }
  if(!scene.length){svg.append(svgEl('text',{x:40,y:80,class:'workspace-empty'},tab==='discovery'?'Search candidates to map observed projects.':'Read a fixed version to begin exploring.'));extent={w:650,h:400};}if(focused)[...svg.querySelectorAll('[data-node]')].find(n=>n.getAttribute('data-node')===focused)?.focus({preventScroll:true});
 }
 function fit(){const r=stage.getBoundingClientRect(),scale=Math.min(innerWidth<768?1.25:3,Math.max(extent.w/Math.max(1,r.width-48),extent.h/Math.max(1,r.height-100)));const w=r.width*scale,h=r.height*scale;svg.setAttribute('viewBox',`${Math.min(0,-(w-extent.w)/2)} ${-80*scale} ${w} ${h}`);}
 function focusNode(n){const b=parseViewBox(svg.getAttribute('viewBox'));if(b)svg.setAttribute('viewBox',`${n.x+100-b.width/2} ${n.y+28-b.height/2} ${b.width} ${b.height}`);}
 function zoom(factor,point){const b=parseViewBox(svg.getAttribute('viewBox'));if(!b)return;const p=point??{x:b.x+b.width/2,y:b.y+b.height/2};const f=Math.min(4,Math.max(.1,factor));svg.setAttribute('viewBox',`${p.x-(p.x-b.x)*f} ${p.y-(p.y-b.y)*f} ${b.width*f} ${b.height*f}`);}
 // Independent per-view camera; pointer ownership stays inside this SVG.
 let drag=null,dragged=false;const pointers=new Map();
 svg.addEventListener('pointerdown',e=>{pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});drag={x:e.clientX,y:e.clientY,box:parseViewBox(svg.getAttribute('viewBox'))};dragged=false;});
 svg.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!drag?.box)return;const previous=[...pointers.values()];pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){svg.setPointerCapture(e.pointerId);const current=[...pointers.values()],distance=p=>Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y),matrix=svg.getScreenCTM();if(matrix&&distance(current)>0){const a=new DOMPoint((previous[0].x+previous[1].x)/2,(previous[0].y+previous[1].y)/2).matrixTransform(matrix.inverse()),b=new DOMPoint((current[0].x+current[1].x)/2,(current[0].y+current[1].y)/2).matrixTransform(matrix.inverse());const box=parseViewBox(svg.getAttribute('viewBox'));svg.setAttribute('viewBox',`${box.x+a.x-b.x} ${box.y+a.y-b.y} ${box.width} ${box.height}`);zoom(distance(previous)/distance(current),a);}dragged=true;return;}
  const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(dx,dy)>5)dragged=true;if(!dragged)return;svg.setPointerCapture(e.pointerId);const r=svg.getBoundingClientRect(),b=drag.box;svg.setAttribute('viewBox',`${b.x-dx*b.width/r.width} ${b.y-dy*b.height/r.height} ${b.width} ${b.height}`);});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])svg.addEventListener(type,e=>{pointers.delete(e.pointerId);const remaining=[...pointers.values()][0];drag=remaining?{...remaining,box:parseViewBox(svg.getAttribute('viewBox'))}:null;if(type==='pointercancel')dragged=true;});
 svg.addEventListener('wheel',e=>{e.preventDefault();const m=svg.getScreenCTM();if(m)zoom(e.deltaY>0?1.12:1/1.12,new DOMPoint(e.clientX,e.clientY).matrixTransform(m.inverse()));},{passive:false});
 let lastDeepTask=null;deep.workspace.subscribe(()=>{if(tab==='discovery'){const current=deep.workspace.state.current;render();if(!viewStates.has('discovery'))fit();if(current&&current.state!=='running'&&current.id!==lastDeepTask){lastDeepTask=current.id;if(current.kind==='sources'||current.kind==='compare'){surface('evidence');rightInner.scrollTop=0;const candidate=scene.find(n=>n.kind==='candidate'&&deep.workspace.state.selected.includes(n.data.candidate.candidate.repositoryId));if(candidate){selection=candidate.id;selectedDiscovery=candidate.data;discoveryInspector(selectedDiscovery);paint();}}}}});
 const observer=new MutationObserver(()=>{if(explorer.hidden&&tab!=='graph')open('graph');});observer.observe(explorer,{attributes:true,attributeFilter:['hidden']});
 surface('canvas');
}
