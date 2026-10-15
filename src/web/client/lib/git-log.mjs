// Independent Git log. Edges are only recorded child -> parent SHA pairs.
export function openGitLog(task,{close,more,exploreFile}){
 const prior=document.querySelector('#git-history'),priorScroll=prior?.querySelector('.history-list')?.scrollTop||0,priorSha=prior?.querySelector('.history-row.is-selected')?.dataset.sha;
 const priorQuery=prior?.querySelector('input')?.value||'',priorBranch=prior?.querySelector('select')?.value;
 prior?.remove();
 const make=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
 const button=(text,fn)=>{const b=make('button',text,'d-action');b.type='button';b.onclick=fn;return b;};
 const host=make('section',undefined,'git-history');host.id='git-history';host.setAttribute('aria-label','Git commit history');
 const main=document.querySelector('#explorer');
 if(!main.historyInert)main.historyInert=[...main.children].map(n=>[n,n.inert]);
 for(const [n]of main.historyInert)n.inert=true;
 main.append(host);document.body.classList.add('history-open');
 const leave=()=>{host.remove();for(const [n,was]of main.historyInert||[])n.inert=was;delete main.historyInert;document.body.classList.remove('history-open');close();};
 const header=make('header');const back=button('← Repository graph',leave);back.id='history-return';const heading=make('div',undefined,'history-heading');heading.append(make('p','Repository history','history-kicker'),make('h2',task.repository+' · Git history'));header.append(back,heading);
 const search=make('input');search.name='history-search';search.autocomplete='off';search.spellcheck=false;search.value=priorQuery;search.placeholder='Find message, author or SHA…';search.setAttribute('aria-label','Search Git history');
 const filter=make('select');filter.setAttribute('aria-label','Highlight branch');filter.append(make('option','All branches'));for(const b of task.branches){const o=make('option',b.name);o.value=b.sha;filter.append(o);}
 if(priorBranch&&[...filter.options].some(o=>o.value===priorBranch))filter.value=priorBranch;header.append(search,filter);host.append(header);
 const coverage=make('p',`${task.commits.length} recorded commits · lines connect actual parents · unopened history remains unknown`,'history-coverage');host.append(coverage);
 const body=make('div',undefined,'history-body'),list=make('div',undefined,'history-list'),detail=make('aside',undefined,'history-detail');body.append(list,detail);host.append(body);
 // Topological order, preserving provider order for independent tips.
 const bySha=new Map(task.commits.map(c=>[c.sha,c])),children=new Map(task.commits.map(c=>[c.sha,0]));
 for(const c of task.commits)for(const p of c.parents)if(children.has(p))children.set(p,children.get(p)+1);
 const queue=task.commits.filter(c=>children.get(c.sha)===0),ordered=[];
 while(queue.length){const c=queue.shift();ordered.push(c);for(const p of c.parents)if(children.has(p)){children.set(p,children.get(p)-1);if(!children.get(p))queue.push(bySha.get(p));}}
 for(const c of task.commits)if(!ordered.includes(c))ordered.push(c);
 const active=[],lanes=new Map();
 for(const c of ordered){let lane=active.indexOf(c.sha);if(lane<0){lane=active.indexOf(null);if(lane<0)lane=active.length;active[lane]=c.sha;}lanes.set(c.sha,lane);active[lane]=null;
  c.parents.forEach((p,i)=>{if(active.includes(p))return;let at=i===0&&active[lane]===null?lane:active.indexOf(null);if(at<0)at=active.length;active[at]=p;});
 }
 const maxLane=Math.max(0,...lanes.values()),laneWidth=22,trackWidth=38+maxLane*laneWidth,rowHeight=60;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.classList.add('history-tracks');svg.setAttribute('width',trackWidth);svg.setAttribute('height',ordered.length*rowHeight);svg.setAttribute('aria-label','Recorded Git parent tracks');
 const pos=new Map(ordered.map((c,i)=>[c.sha,{x:18+lanes.get(c.sha)*laneWidth,y:i*rowHeight+30}]));
 const colors=['var(--brand)','var(--declared)','var(--verified)','var(--detected)'];
 for(const c of ordered){const a=pos.get(c.sha);for(const parent of c.parents){const b=pos.get(parent);const p=document.createElementNS(ns,'path');p.dataset.child=c.sha;p.dataset.parent=parent;p.setAttribute('d',b?`M${a.x} ${a.y} L${a.x} ${a.y+12} L${b.x} ${a.y+30} L${b.x} ${b.y}`:`M${a.x} ${a.y} l0 22`);p.setAttribute('fill','none');p.setAttribute('stroke',colors[lanes.get(parent)%colors.length]||colors[lanes.get(c.sha)%colors.length]);p.setAttribute('stroke-width','2');if(!b)p.setAttribute('stroke-dasharray','3 3');svg.append(p);}
  const dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',a.x);dot.setAttribute('cy',a.y);dot.setAttribute('r','4');dot.setAttribute('fill','var(--surface-hi)');dot.setAttribute('stroke',colors[lanes.get(c.sha)%colors.length]);dot.setAttribute('stroke-width','2');svg.append(dot);
 }
 const rows=make('div',undefined,'history-rows');rows.style.paddingLeft=trackWidth+'px';list.append(svg,rows);
 const select=c=>{for(const r of rows.children)r.classList.toggle('is-selected',r.dataset.sha===c.sha);detail.replaceChildren();detail.append(button('← Commit list',()=>host.classList.remove('show-commit')),make('p','Selected commit','history-kicker'),make('h3',c.message));const metadata=make('dl',undefined,'history-metadata');metadata.append(make('dt','Author'),make('dd',c.author),make('dt','Committed'));const time=make('time',new Date(c.date).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}));time.dateTime=c.date;const date=make('dd');date.append(time);metadata.append(date);detail.append(metadata);const identity=make('details',undefined,'history-technical');identity.append(make('summary','Commit '+c.sha.slice(0,8)),make('code',c.sha));detail.append(identity);const parents=make('div',undefined,'history-parents');if(c.parents.length)detail.append(make('h4','Parent commits'));for(const p of c.parents){const b=button('Parent '+p.slice(0,8)+(bySha.has(p)?'':' · not loaded'),()=>{if(bySha.has(p)){select(bySha.get(p));rows.querySelector(`[data-sha="${p}"]`).scrollIntoView({block:'center'});}});b.disabled=!bySha.has(p);parents.append(b);}detail.append(parents,make('h4','Changed files'));
  for(const f of c.changes)detail.append(button(`${f.status||'Changed'} · ${f.path}`,()=>{leave();exploreFile(c,f);}));host.classList.add('show-commit');};
 for(const c of ordered){const row=button('',()=>select(c));row.className='history-row';row.dataset.sha=c.sha;row.style.height=rowHeight+'px';const title=make('span',c.message.split('\n')[0],'history-message'),meta=make('span',c.author+' · '+c.sha.slice(0,8),'history-meta');const branches=task.branches.filter(b=>b.sha===c.sha);for(const b of branches)title.prepend(make('span',b.name,'history-branch'));row.append(title,meta);rows.append(row);}
 const update=()=>{const reachable=new Set(),todo=filter.selectedIndex?[filter.value]:[];while(todo.length){const id=todo.pop();if(reachable.has(id))continue;reachable.add(id);todo.push(...(bySha.get(id)?.parents||[]));}for(const row of rows.children){const c=bySha.get(row.dataset.sha),match=[c.message,c.author,c.sha].join(' ').toLowerCase().includes(search.value.toLowerCase());row.classList.toggle('is-muted',!match||(filter.selectedIndex&&!reachable.has(c.sha)));}};
 search.oninput=update;filter.onchange=update;update();
 search.onkeydown=e=>{if(e.key==='Enter'){const row=[...rows.children].find(r=>!r.classList.contains('is-muted'));if(row){row.scrollIntoView({block:'center'});select(bySha.get(row.dataset.sha));}}};
 if(task.coverage.pendingParents.length){const footer=make('footer',undefined,'history-footer'),b=button('Read earlier commits',more);b.id='history-more';footer.append(b,make('span','Continue along recorded parent links','history-footer-note'));host.append(footer);}
 if(ordered.length)select(bySha.get(priorSha)||ordered[0]);host.classList.remove('show-commit');list.scrollTop=priorScroll;if(!prior)back.focus();
 return host;
}
