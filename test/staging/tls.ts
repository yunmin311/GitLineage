/** Dedicated loopback TLS proxy; trust is imported only into an ephemeral browser HOME. */
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync,spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {request} from 'node:https';
export async function stagingTLS(){
 const caddy=process.env.GITLINEAGE_STAGING_CADDY,certutil=process.env.GITLINEAGE_STAGING_CERTUTIL;
 if(!caddy||!certutil)throw new Error('explicit Caddy and certutil executable paths required');
 const root=await mkdtemp(join(tmpdir(),'gl-tls-'));await mkdir(join(root,'home/.pki/nssdb'),{recursive:true,mode:0o700});
 const ca=join(root,'ca.pem'),key=join(root,'leaf.key'),cert=join(root,'leaf.pem');
 execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=GitLineage ephemeral staging CA','-keyout',join(root,'ca.key'),'-out',ca],{stdio:'ignore'});
 execFileSync('openssl',['req','-newkey','rsa:2048','-nodes','-subj','/CN=localhost','-keyout',key,'-out',join(root,'leaf.csr')],{stdio:'ignore'});
 await writeFile(join(root,'san.conf'),'subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n');
 execFileSync('openssl',['x509','-req','-in',join(root,'leaf.csr'),'-CA',ca,'-CAkey',join(root,'ca.key'),'-CAcreateserial','-days','1','-extfile',join(root,'san.conf'),'-out',cert],{stdio:'ignore'});
 execFileSync(certutil,['-N','--empty-password','-d','sql:'+join(root,'home/.pki/nssdb')]);
 execFileSync(certutil,['-A','-d','sql:'+join(root,'home/.pki/nssdb'),'-n','staging-only','-t','C,,','-i',ca]);
 const authority=await readFile(ca);const responses:{path:string;status:number;ms:number}[]=[];const logs:string[]=[];
 async function proxy(upstream:string,proxyKey:string,strip=true){
  const reservation=createServer();await new Promise<void>(r=>reservation.listen(0,'127.0.0.1',r));const port=(reservation.address() as {port:number}).port;await new Promise<void>(r=>reservation.close(()=>r()));
  const origin=`https://localhost:${port}`,config=join(root,`Caddyfile-${port}`);
  await writeFile(config,`{\n admin off\n auto_https disable_redirects\n}\n${origin} {\n bind 127.0.0.1\n @unexpected expression \`{http.request.hostport} != "localhost:${port}"\`\n respond @unexpected 403\n tls ${cert} ${key}\n @forwarded header Forwarded *\n respond @forwarded 403\n @xff header X-Forwarded-For *\n respond @xff 403\n @xfh header X-Forwarded-Host *\n respond @xfh 403\n @xfp header X-Forwarded-Proto *\n respond @xfp 403\n @marker header X-Gitlineage-Proxy *\n respond @marker 403\n reverse_proxy ${upstream} {\n header_up Host localhost:${port}\n ${strip?'header_up -Forwarded\n header_up -X-Forwarded-For\n header_up -X-Forwarded-Host\n header_up -X-Forwarded-Proto':''}\n header_up X-Gitlineage-Proxy ${proxyKey}\n }\n}\n`,{mode:0o600});
  const startup=performance.now();const child=spawn(caddy!,['run','--config',config,'--adapter','caddyfile'],{env:{...process.env,XDG_DATA_HOME:join(root,'caddy-data'),XDG_CONFIG_HOME:join(root,'caddy-config')},stdio:['ignore','pipe','pipe']});
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>logs.push(String(chunk).split(proxyKey).join('[redacted]')));
  const client=(path:string,options:{method?:string;headers?:Record<string,string>;body?:string;trust?:boolean;servername?:string}={})=>new Promise<{status:number;headers:import('node:http').IncomingHttpHeaders;body:string}>((resolve,reject)=>{const started=performance.now();const req=request(origin+path,{ca:options.trust===false?undefined:authority,servername:options.servername,method:options.method??'GET',headers:options.headers},res=>{let body='';res.on('data',c=>body+=c);res.on('end',()=>{responses.push({path:path.split('?')[0]!,status:res.statusCode!,ms:performance.now()-started});resolve({status:res.statusCode!,headers:res.headers,body});});});req.on('error',reject);req.setTimeout(5000,()=>req.destroy(new Error('TLS request timeout')));req.end(options.body);});
  for(let i=0;i<50;i++){if(child.exitCode!==null)throw new Error('Caddy startup failed: '+logs.join('').replace(/X-Gitlineage-Proxy[^\n]*/g,'[redacted]'));try{await client('/healthz');break;}catch{if(i===49)throw new Error('TLS proxy unavailable');await new Promise(r=>setTimeout(r,100));}}
  return {origin,client,startupMs:performance.now()-startup,resources:async()=>({rssKiB:Number((await readFile(`/proc/${child.pid}/status`,'utf8')).match(/VmRSS:\s+(\d+)/)?.[1]),cpuTicks:(await readFile(`/proc/${child.pid}/stat`,'utf8')).split(' ').slice(13,15).map(Number)}),stop:async()=>{if(child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}}};
 }
 return {root,home:join(root,'home'),authority,proxy,logs,responses,close:()=>rm(root,{recursive:true,force:true})};
}
