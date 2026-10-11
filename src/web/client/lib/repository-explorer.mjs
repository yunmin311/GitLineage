/** One reading workspace; native modal preserves the canonical canvas and URL. */
export function mountRepositoryExplorer(getRepository,deep){
 const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const action=(id,text,fn)=>{const b=el('button',text,'deep-action');b.id=id;b.type='button';b.addEventListener('click',fn);return b;};
 const dialog=el('dialog',undefined,'deep-dialog');dialog.id='repository-workspace';dialog.setAttribute('aria-label','Repository exploration');document.body.append(dialog);
 let task=null,tab='structure',path='',busy=false,repository='';
 const heading=el('header',undefined,'deep-heading');heading.append(el('h2','Repository exploration'),action('explore-back','Return to Graph',()=>dialog.close()));dialog.append(heading);
 const status=el('p','Standard Graph stays unchanged. Read structure/history only when requested.','deep-status');status.id='explore-status';status.setAttribute('role','status');
 const form=el('form',undefined,'deep-form'),label=el('label','Public GitHub repository');label.htmlFor='explore-repository';const input=el('input');input.id='explore-repository';input.required=true;input.placeholder='owner/repo or GitHub URL';const load=action('explore-load','Read structure & history',()=>form.requestSubmit()),cancel=action('explore-cancel','Cancel',async()=>{if(task)try{await request(`/${task.id}/cancel`,{});}catch(error){status.textContent=error.message;}});cancel.hidden=true;form.append(label,input,load,cancel);
 const content=el('section');content.id='explore-content';
 function open(next,fromGraph=false){if(deep.dialog.open){const selected=deep.dialog.querySelector('#deep-repository').value;if(selected&&selected!==input.value){input.value=selected;if(task&&task.repository.toLowerCase()!==selected.toLowerCase()){task=null;path='';}}}deep.dialog.close();tab=next;
  if(fromGraph||!input.value){const repo=getRepository();const current=typeof repo==='string'?repo:repo?`${repo.owner}/${repo.name}`:'';if(current&&current!==repository){repository=current;input.value=current;task=null;path='';}}
  if(!dialog.open)dialog.showModal();render();input.focus();}

 function discovery(){dialog.close();deep.dialog.querySelector('#deep-repository').value=input.value;deep.dialog.showModal();deep.dialog.querySelector('#deep-repository').focus();}
 function navigation(parent){const nav=el('nav',undefined,'explore-tabs');nav.setAttribute('aria-label','Explore repository');nav.append(action('', 'Structure',()=>open('structure')),action('', 'History',()=>open('history')),action('', 'Deep Search',discovery),action('', 'Candidates',()=>{dialog.close();deep.dialog.close();deep.openCandidates();}));parent.append(nav);return nav;}
 const nav=navigation(dialog);dialog.append(form,status,content);const deepNav=navigation(deep.dialog);deep.dialog.insertBefore(deepNav,deep.dialog.children[1]);
 deep.launcher.textContent='Explore repository';deep.layerLauncher.hidden=true;
 deep.launcher.addEventListener('click',e=>{e.stopImmediatePropagation();open('structure',true);},true);
 dialog.addEventListener('keydown',e=>e.stopPropagation());dialog.addEventListener('close',()=>deep.launcher.focus());
 async function request(path,data){const response=await fetch('/api/explore'+path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json','x-gitlineage-csrf':'1'},body:JSON.stringify(data)});const value=await response.json();if(!response.ok)throw new Error(value.error||'Unavailable');return value;}
 function locked(value){busy=value;input.disabled=value;load.disabled=value;cancel.hidden=!value;for(const b of content.querySelectorAll('button'))b.disabled=value;}
 async function work(fn){if(busy)return;locked(true);try{task=await fn();while(task.state==='running'){status.textContent='Reading fixed repository objects…';await new Promise(r=>setTimeout(r,250));task=await request(`/${task.id}`);}status.textContent=`${task.state}${task.error?' · '+task.error:''}`;render();}catch(error){status.textContent=error.message;}finally{locked(false);}}
 form.addEventListener('submit',e=>{e.preventDefault();path='';void work(()=>request('',{repository:input.value}));});
 function details(title,value){const d=el('details'),summary=el('summary',title);d.append(summary,el('pre',JSON.stringify(value,null,2)));return d;}
 function download(){const link=el('a'),url=URL.createObjectURL(new Blob([JSON.stringify(task,null,2)],{type:'application/json'}));link.href=url;link.download='gitlineage-repository-exploration.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function render(){for(const b of nav.querySelectorAll('button'))b.setAttribute('aria-pressed',String(b.textContent.toLowerCase()===tab));content.replaceChildren();if(!task)return;
  content.append(el('p',`${task.repository} · ID ${task.resolution?.requestedId??'unavailable'} · fixed ${task.revision??'unavailable'}`,'deep-digest'),el('p','Repository observations, not new lineage claims. Coverage is bounded; missing history is unknown.','deep-warning'));
  if(tab==='structure'){
   content.append(el('h3','Internal structure'),el('p','Directory categories describe paths, not inferred architecture. Submodules retain their pinned commit and are never followed.','deep-note'));
   const directory=task.directories.find(d=>d.path===path)??task.directories[0];if(!directory)content.append(el('p','No verified tree available. '+(task.error??'')));else{
    path=directory.path;const breadcrumbs=el('nav',undefined,'explore-tabs');breadcrumbs.setAttribute('aria-label','Directory path');breadcrumbs.append(action('explore-root','Repository root',()=>{path='';render();}));if(path)breadcrumbs.append(action('explore-parent','↑ Parent',()=>{path=path.split('/').slice(0,-1).join('/');render();}));content.append(breadcrumbs,el('p',`${path||'/'} · tree ${directory.sha}`,'deep-digest'));
    const list=el('ul',undefined,'explore-tree');for(const entry of directory.entries){const row=el('li');if(entry.type==='tree'){row.append(action('',`${entry.path}/`,()=>{const next=path?`${path}/${entry.path}`:entry.path;if(task.directories.some(d=>d.path===next)){path=next;render();}else void work(async()=>{const value=await request(`/${task.id}/directory`,{path:next});if(value.directories.some(d=>d.path===next))path=next;return value;});}));}else{const link=el('a',entry.path);link.href=`https://github.com/${task.repository}/${entry.type==='commit'?'tree':'blob'}/${task.revision}/${path?path+'/':''}${entry.path}`;link.target='_blank';link.rel='noopener noreferrer';row.append(link);}row.append(el('span',`${entry.category} · ${entry.size??'—'} bytes · ${entry.sha}`,'deep-note'));list.append(row);}if(!directory.entries.length)list.append(el('li','Empty directory'));content.append(list);
   }
  }else{
   content.append(el('h3','Git history'),el('p',`History sampled from ${task.historyAnchor??'unavailable'} · ${task.coverage.history}`,'deep-warning'),el('p',task.coverage.branches,'deep-note'));
   const branches=el('nav',undefined,'explore-tabs');for(const branch of task.branches)branches.append(action('',`${branch.name} @ ${branch.sha.slice(0,8)}`,()=>{path='';tab='structure';void work(()=>request(`/${task.id}/revision`,{sha:branch.sha}));}));content.append(branches);
   for(const commit of task.commits){const item=el('article',undefined,'deep-result');item.append(el('h4',commit.message.split('\n')[0]),el('p',`${commit.author} · ${commit.date}`,'deep-note'),el('code',commit.sha,'deep-digest'),el('p',commit.parents.length>1?'Merge commit — multiple recorded parents':commit.parents.length?'Recorded parent':'Root within returned object'));for(const parent of commit.parents){const loaded=task.commits.some(c=>c.sha===parent);item.append(el('p',`← ${parent} · ${loaded?'in sampled window':'outside loaded window; ancestry unexamined'}`,'deep-digest'));}item.append(action('','Explore structure at this commit',()=>{path='';tab='structure';void work(()=>request(`/${task.id}/revision`,{sha:commit.sha}));}),details('Changed file sample (at most 40; not a complete diff)',commit.changes));content.append(item);}
  }
  content.append(details('Coverage and resource receipt',{coverage:task.coverage,receipt:task.receipt}),action('explore-download','Download repository observations',download));
 }
}
