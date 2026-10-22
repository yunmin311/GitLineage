"""Explicit bounded corpus acquisition, never imported by the application. No third-party code executed."""
import json, subprocess, time, pathlib, hashlib
out=pathlib.Path('test/discovery/fixtures/v4')
# Labels frozen by purpose before evaluating the ranking function. Not provenance labels.
groups=[('sindresorhus/p-limit',[('1inch/limit-order-protocol',False),('sindresorhus/p-queue',True),('sindresorhus/p-map',True),('mcollina/fastq',True)]),('chalk/chalk',[('styled-components/styled-components',False),('chalk/ansi-styles',True),('Textualize/rich',True),('sindresorhus/p-limit',False)]),('vitejs/vite',[('vuejs/core',False),('webpack/webpack',True),('rollup/rollup',True),('vitest-dev/vitest',False)])]
requests=[]; repos={}; start=time.monotonic()
def get(path):
 t=time.monotonic(); r=subprocess.run(['gh','api',path],capture_output=True,check=True);requests.append({'path':path,'bytes':len(r.stdout),'ms':(time.monotonic()-t)*1000});return json.loads(r.stdout)
for name in dict.fromkeys([n for t,cs in groups for n in [t]+[c for c,_ in cs]]):
 r=get('repos/'+name);repos[name]={k:r.get(k) for k in ['id','full_name','html_url','description','language','topics','default_branch']}
sources=[]
for name,path in [('sindresorhus/p-limit','index.js'),('jucke/p-limit','index.js'),('chalk/chalk','source/index.js'),('mcollina/fastq','queue.js')]:
 r=get('repos/'+name+'/commits?per_page=1');sha=r[0]['sha']; r=get('repos/'+name+'/contents/'+path+'?ref='+sha)
 import base64
 content=base64.b64decode(r['content']);assert len(content)<=24000
 filename=name.replace('/','--')+'.js';(out/filename).write_bytes(content)
 license=get('repos/'+name+'/license?ref='+sha);license_file=name.replace('/','--')+'.LICENSE';(out/license_file).write_bytes(base64.b64decode(license['content']))
 sources.append({'license':license_file,'repository':name,'revision':sha,'path':path,'blob':r['sha'],'bytes':len(content),'sha256':hashlib.sha256(content).hexdigest(),'fixture':filename})
report={'method':'Purpose-labeled controlled candidate sets using actual public metadata; not a sample of live search precision. Rich is deliberately a related cross-language counterexample. Public source fetched at pinned revisions. Acquisition costs are separate from zero-request replay.','groups':[{'target':t,'candidates':[{'name':n,'relevant':label} for n,label in cs]} for t,cs in groups],'repositories':repos,'sources':sources,'acquisition':{'requests':requests,'count':len(requests),'bytes':sum(r['bytes'] for r in requests),'wallMs':(time.monotonic()-start)*1000}}
(out/'public-corpus.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report['acquisition'],indent=2))
