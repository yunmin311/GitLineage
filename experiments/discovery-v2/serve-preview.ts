/** Explicit loopback-only entry; production `npm start` never enables this. */
import {serve} from '../../src/web/serve.ts';
import {createPreview} from './preview.ts';
import {resolve} from 'node:path';
if(process.env.GITLINEAGE_DEEP_PREVIEW!=='1')throw new Error('Explicit GITLINEAGE_DEEP_PREVIEW=1 required for local authorized preview');
const preview=createPreview();
const app=await serve({host:'127.0.0.1',port:8082,clientDir:resolve('dist/web'),previewHandler:preview.handler});
console.log('Local authorized Deep Search preview (ephemeral access URL): '+app.url+preview.accessPath);
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,async()=>{await preview.close();app.app.analysis.shutdown();app.server.close(()=>process.exit(0));});
