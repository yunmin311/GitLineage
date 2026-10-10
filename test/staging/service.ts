/** Subprocess solely for isolated restart/SIGKILL drills, never installed by production. */
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {createBetaGate} from '../../experiments/private-beta/gate.ts';
const config=JSON.parse(readFileSync(process.argv[2]!,'utf8'));
const gate=createBetaGate({...config,transport:async(_url:string,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});})});
const server=createServer((req,res)=>{void gate.handler(req,res).catch(()=>{if(!res.destroyed)res.end();});});
server.listen(config.port,'127.0.0.1',()=>process.send?.({ready:true}));
process.once('SIGTERM',async()=>{await gate.close();server.close(()=>process.exit(0));});
