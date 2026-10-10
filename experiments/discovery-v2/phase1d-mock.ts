import {mockFixture,FIXED_TIME} from './phase1c-mock.ts';
export {FIXED_TIME};
/** Historical object fixtures, exposed exclusively through documented API paths. */
export function officialFixture(){
 const f=mockFixture();
 function rebuild(){f.rebuild();for(const repo of f.repos){f.routes.set(`/repos/${repo.name}`,f.routes.get(`/repositories/${repo.id}`));for(const [path,value] of [...f.routes])if(path.startsWith(`/repositories/${repo.id}/`))f.routes.set(path.replace(`/repositories/${repo.id}`,`/repos/${repo.name}`),value);}}
 rebuild();
 const transport:typeof f.transport=async(url,init)=>{const path=new URL(url).pathname;if(/^\/repositories\/\d+\//.test(path))throw new Error('undocumented route forbidden');return f.transport(url,init);};
 return {...f,rebuild,transport,controls:f.repos.slice(0,3).map(r=>({name:r.searchName??r.name,repositoryId:r.id,revision:r.revision,observations:r.searchName?[{repositoryId:r.id,fullName:r.searchName,htmlUrl:`https://github.com/${r.searchName}`,source:'repository_search' as const,observedAt:FIXED_TIME}]:[],selections:[{path:'index.js',reason:'explicit mock entry'}]}))};
}
