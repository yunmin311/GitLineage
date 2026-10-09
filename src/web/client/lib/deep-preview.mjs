/** Optional local preview. Graph DOM, camera, selection and history stay owned by Explorer. */
export async function mountDeepPreview(getRepository) {
 let capabilities;try{const response=await fetch('/api/deep-search/capabilities');if(!response.ok)return;capabilities=await response.json();if(!capabilities.enabled)return;}catch{return;}
 const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
 const button=(id,text,click)=>{const b=el('button',text,'deep-action');b.id=id;b.type='button';b.addEventListener('click',click);return b;};
 const launcher=button('deep-launch','Deep Search · Alpha.1',()=>{if(!input.value){const repo=getRepository();input.value=typeof repo==='string'?repo:repo?`${repo.owner}/${repo.name}`:'';}dialog.showModal();input.focus();});launcher.classList.add('deep-launch');document.body.append(launcher);
 const dialog=el('dialog',undefined,'deep-dialog');dialog.id='deep-dialog';dialog.setAttribute('aria-labelledby','deep-title');
 const header=el('header',undefined,'deep-heading'),title=el('h2','Deep Search');title.id='deep-title';header.append(title,button('deep-back','Return to Graph',()=>dialog.close()));dialog.append(header);
 dialog.append(el('p','Authorized local Alpha · deterministic comparison · no Graph writes','deep-note'));
 dialog.append(el('p','Similarity is a measurement, not proof of ancestry. Unknown stays pending.','deep-warning'));
 const form=el('form',undefined,'deep-form'),label=el('label','Public GitHub repository');label.htmlFor='deep-repository';const input=el('input');input.id='deep-repository';input.placeholder='owner/repo';input.required=true;input.maxLength=180;input.autocomplete='off';input.spellcheck=false;
 const search=button('deep-search-submit','Search candidates',()=>form.requestSubmit()),cancel=button('deep-cancel','Cancel task',async()=>{if(current?.state==='running')try{await request(`/tasks/${current.id}/cancel`,{});}catch(error){status.textContent=error.message;}});cancel.hidden=true;form.append(label,input,search,cancel);dialog.append(form);
 const status=el('p','No request made. Enter a repository to search.','deep-status');status.id='deep-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');dialog.append(status);
 const budget=el('p',`Shared session: ≤${capabilities.budget.attempts} HTTP attempts · 30 s cumulative active work (selection/cooldown excluded) · ≤3 candidates · select ≤2 · bounded pinned trees · choose ≤8 files/repository · 32 KiB/response · 1 MiB reserved. CPU hard budget unsupported.`,'deep-note');dialog.append(budget);
 const candidates=el('section');candidates.id='deep-candidates';dialog.append(candidates);const sourcePreview=button('deep-source-preview','Source Files →',()=>startSources());sourcePreview.hidden=true;sourcePreview.disabled=true;dialog.append(sourcePreview);
 const files=el('section');files.id='deep-files';dialog.append(files);
 const compare=button('deep-compare','Confirm scope & compare',()=>startCompare());compare.disabled=true;compare.hidden=true;dialog.append(compare);
 const results=el('section');results.id='deep-results';dialog.append(results);document.body.append(dialog);
 let current=null,parent=null,selected=new Set(),polling=false,sourceTask=null,fileChoices=new Map(),nextStart=0;
 dialog.addEventListener('close',()=>launcher.focus());
 // Stop Explorer shortcuts while a native modal owns focus. Its own Escape closes it.
 dialog.addEventListener('keydown',event=>event.stopPropagation());
 async function request(path,data){const r=await fetch('/api/deep-search'+path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw new Error(value.error||'Preview unavailable');return value;}
 function busy(value){const wait=Date.now()<nextStart;search.disabled=value||wait;input.disabled=value;sourcePreview.disabled=value||wait||selected.size===0||!!sourceTask;compare.disabled=value||wait||!sourceTask||fileChoices.size!==selected.size+1||[...fileChoices.values()].some(paths=>paths.size===0);cancel.hidden=!value;}
 function details(title,content){const d=el('details'),s=el('summary',title),pre=el('pre',typeof content==='string'?content:JSON.stringify(content,null,2));d.append(s,pre);return d;}
 function score(value){return value===null||value===undefined?'Unavailable':`${(value*100).toFixed(2)}%`;}
 function usage(task){const c=task.search??task.comparison?.content;if(c)results.append(details('Coverage, requests and resource receipt',task.search?{scope:c.scope,coverage:c.result?.coverage,queries:c.result?.queries,requests:c.requests,searchRequests:c.result?.attempts,usage:c.usage,network:c.network}:{coverage:c.coverage,requests:task.comparison.receipt.requests,usage:c.usage,network:c.network,contentDigest:task.comparison.receipt.contentDigest}));}
 function showSearch(task){candidates.hidden=false;parent=task;selected=new Set();candidates.replaceChildren();results.replaceChildren();files.replaceChildren();sourceTask=null;fileChoices.clear();compare.hidden=true;sourcePreview.hidden=false;
  const output=task.search;if(output?.target?.identity){const target=output.target.identity;candidates.append(el('p',`Pinned target: ${target.fullName} · ID ${target.repositoryId}`),el('code',target.revision,'deep-digest'));}
  const list=output?.result?.candidates??[];
  if(!list.length)candidates.append(el('p',output?.result?.coverage.state==='complete_within_requested'?'No candidates found within this query and budget.':'Search incomplete or unavailable. See the failure receipt.'));
  for(const c of list){const card=el('article',undefined,'deep-candidate'),check=el('input');check.type='checkbox';check.value=String(c.candidate.repositoryId);check.disabled=c.candidate.conflicts.includes('name_id_collision');
   const label=el('label'),name=el('span',`${c.candidate.fullName} · ID ${c.candidate.repositoryId}`);label.append(check,name);card.append(label,el('p','Candidate relevance: metadata search rank · code similarity: not compared','deep-note'));
   card.append(el('p',c.discoveries.map(d=>`${d.source} · ${d.version}; ${d.reason}; query: ${d.query}; page ${d.page}; rank ${d.rank}`).join('\n'),'deep-note'),el('p','Verification: pending · Lineage claim: none','deep-warning'));
   check.addEventListener('change',()=>{if(check.checked&&selected.size>=2){check.checked=false;status.textContent='Select at most two candidates.';return;}check.checked?selected.add(c.candidate.repositoryId):selected.delete(c.candidate.repositoryId);busy(polling);});candidates.append(card);
  }usage(task);
 }
 function showComparison(task){candidates.hidden=true;files.hidden=true;sourcePreview.hidden=true;compare.hidden=true;results.replaceChildren();const probe=task.comparison;if(!probe){results.append(el('p',task.error||'Comparison unavailable. No score was produced.'));return;}
  results.append(el('h3','Pinned source comparison'),el('p','File-level measurements only. Normalized scores can be high for common patterns or templates; no repository-wide similarity or lineage probability.','deep-note'),el('p','Verification: pending · Lineage claim: none','deep-warning'));
  for(const [i,result] of probe.content.comparisons.entries()){
   const source=probe.content.snapshots[i+1],target=probe.content.snapshots[0],card=el('article',undefined,'deep-result');card.append(el('h4',source.resolution?.identity?.fullName??result.name));
   const metadata=source.resolution?.metadata;card.append(el('p',metadata?.fork?`Public Fork metadata observed (parent ID ${metadata.parentId??'unavailable'}). This is separate from code measurement.`:'Unknown · no verified lineage claim','deep-warning'));
   card.append(el('p',`Selected file scope: ${result.candidate?.coverage.state??'unavailable'}. ${result.reason??''}`));
   card.append(el('p',source.source?.coverage.reasons?.slice(0,8).join('; ')||source.resolution?.reasons?.join('; ')||'' ,'deep-note'));
   if(!result.candidate?.similarity.length)card.append(el('p','Cannot compare: no eligible identity-checked pinned source. No zero score substituted.'));
   for(const m of result.candidate?.similarity??[]){const measurement=el('div',undefined,'deep-measurement');measurement.append(el('p',`${m.method} · ${m.version}: ${score(m.score)} (${m.state})`),el('p',`${m.firstPath} ↔ ${m.secondPath}`,'deep-note'));
    const link=(identity,path)=>{const a=el('a',`${identity.fullName}/${path} @ ${identity.revision}`,'deep-digest');a.href=`https://github.com/${identity.fullName}/blob/${identity.revision}/${path}`;a.target='_blank';a.rel='noopener noreferrer';return a;};
    measurement.append(link(result.candidate.target,m.firstPath),link(result.candidate.candidate,m.secondPath),el('code',`SHA-256: ${m.firstDigest} ↔ ${m.secondDigest}`,'deep-digest'));
    measurement.append(el('p',`Tokens: ${m.firstTokens??'unavailable'} / ${m.secondTokens??'unavailable'} · bidirectional shingle coverage: ${score(m.firstCoverage)} / ${score(m.secondCoverage)}`,'deep-note'));
    measurement.append(details('Raw measurement, matched token ranges and fingerprints',m));card.append(measurement);
   }
   card.append(details('Pinned snapshots, Git blob SHA, file bindings and incomplete paths',{target,source,summary:result.summary,coverage:result.candidate?.coverage}));results.append(card);
  }usage(task);
  results.append(details('Original search provenance — observation, not verified evidence',task.export?.provenance??'Unavailable'),details('Listed / unlisted / selected scope and combined stage costs',task.export?.selection??'Legacy explicit paths'));
  const download=button('deep-download','Download Sidecar + receipt',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(task.export??probe,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='gitlineage-deep-sidecar.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});results.append(download);
 }
 function showSources(task){sourceTask=task;files.hidden=false;files.replaceChildren();results.replaceChildren();compare.hidden=false;sourcePreview.hidden=true;fileChoices.clear();
  for(const check of candidates.querySelectorAll('input'))check.disabled=true;
  files.append(el('h3','Source Files'),el('p','Choose the target files and candidate files. Only selected files are compared; this never means the repository was fully scanned.','deep-note'));
  for(const [i,r]of (task.sources?.repositories??[]).entries()){const card=el('article',undefined,'deep-file-card');card.append(el('h4',`${i===0?'Target':'Candidate'}: ${r.fullName} · ID ${r.repositoryId}`),el('code',`Fixed revision: ${r.revision??'unavailable'}`,'deep-digest'));
   const chosen=new Set();fileChoices.set(r.repositoryId,chosen);let defaultChosen=false;
   for(const f of r.files){const row=el('label',undefined,'deep-file-row'),check=el('input');check.type='checkbox';check.dataset.repository=String(r.repositoryId);check.value=f.path;check.disabled=!f.selectable;
    if(f.selectable&&!defaultChosen){check.checked=true;chosen.add(f.path);defaultChosen=true;}
    const text=el('span',`${f.path} · ${f.language} · ${f.bytes??'unknown'} bytes`);row.append(check,text);card.append(row,el('p',f.reason,'deep-note'));
    check.addEventListener('change',()=>{if(check.checked&&chosen.size>=8){check.checked=false;status.textContent='Select at most eight files per repository.';return;}check.checked?chosen.add(f.path):chosen.delete(f.path);renderScope();busy(polling);});
   }
   if(!r.files.some(f=>f.selectable))card.append(el('p','No selectable source within this listing. '+r.coverage.reasons.join('; '),'deep-warning'));
   card.append(details('Directory coverage and filter reasons',r.coverage));files.append(card);
  }
  const confirmation=el('p',undefined,'deep-status');confirmation.id='deep-scope';files.append(confirmation);renderScope();
  results.append(details('Source listing cumulative usage and network receipt',task.sources));
 }
 function renderScope(){const scope=document.querySelector('#deep-scope');if(scope)scope.textContent=`Selected scope: ${[...fileChoices].map(([id,paths])=>`ID ${id}: ${paths.size} file(s) [${[...paths].join(', ')}]`).join(' ↔ ')}. Cross-product file pairs; repository-wide coverage unknown. HTTP remaining: ${capabilities.budget.attempts-(sourceTask?.sources?.usage.attempts??0)}; selected blob reads + final identity checks: ${[...fileChoices.values()].reduce((n,paths)=>n+paths.size,0)+fileChoices.size}. Exhausted work stays partial.`;}
 async function startSources(){if(polling||!parent||!selected.size)return;try{await watch(await request('/sources',{searchId:parent.id,candidateIds:[...selected]}));}catch(error){status.textContent=error.message;}}
 async function watch(task){nextStart=Date.parse(task.createdAt)+capabilities.cooldownMs;current=task;polling=true;busy(true);try{while(current.state==='running'){status.textContent=`${current.kind}: ${current.phase} · real task progress`;await new Promise(r=>setTimeout(r,250));current=await request(`/tasks/${task.id}`);}status.textContent=`${current.kind}: ${current.state}${current.error?' · '+current.error:''}`;current.kind==='search'?showSearch(current):current.kind==='sources'?showSources(current):showComparison(current);}catch(error){status.textContent=error.message;}finally{polling=false;busy(false);const delay=nextStart-Date.now();if(delay>0){status.append(` · next stage available in ${Math.ceil(delay/1000)} s`);setTimeout(()=>busy(polling),delay+10);}}}
 form.addEventListener('submit',async event=>{event.preventDefault();if(polling)return;try{const task=await request('/search',{repository:input.value});candidates.replaceChildren();results.replaceChildren();files.replaceChildren();files.hidden=false;sourceTask=null;sourcePreview.hidden=true;parent=null;selected.clear();compare.hidden=true;await watch(task);}catch(error){status.textContent=error.message;}});
 async function startCompare(){if(polling||!parent||!sourceTask)return;try{await watch(await request('/compare',{searchId:parent.id,candidateIds:[...selected],selection:{sourceTaskId:sourceTask.id,files:[...fileChoices].map(([repositoryId,paths])=>({repositoryId,paths:[...paths]}))}}));}catch(error){status.textContent=error.message;}}
}
