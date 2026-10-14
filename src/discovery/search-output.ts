import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validatePlan } from './query.ts';
import { validateSearchCandidate } from './search-contract.ts';
import type { discoverRepositories } from './search.ts';
export type SearchSidecar=Awaited<ReturnType<typeof discoverRepositories>>;
/** Explicit experimental output only. Never called by production or a cache. */
export async function writeSearchSidecar(directory:string,result:SearchSidecar):Promise<void> {
 validatePlan(result.plan);for(const candidate of result.candidates)validateSearchCandidate(candidate);
 await mkdir(directory,{recursive:true});await writeFile(resolve(directory,'search-sidecar.json'),JSON.stringify(result,null,2)+'\n');
}
