/** A review aid over shared strict token windows. Raw matching remains unchanged. */
const common=new Set('async await break case catch class const continue debugger default delete do else enum export extends false finally for from function get if implements import in instanceof interface let new null of private protected public return set static super switch this throw true try typeof undefined var void while with yield require module exports console log name value values data item items key keys result results input output options args foo bar'.split(' '));
export function reviewPriority(firstPath:string,secondPath:string,sharedTokens:string[],strictShared:number){
 const distinctive=[...new Set(sharedTokens.filter(t=>/^[a-zA-Z_$][\w$]{3,}$/.test(t)&&!common.has(t)))].sort();
 const configuration=[firstPath,secondPath].some(p=>/(^|\/)(?:[^/]*[.-])?config\.[cm]?[jt]s$|(^|\/)(?:hardhat|webpack|rollup|vite|babel|jest|eslint|prettier)\./i.test(p));
 const review=!configuration&&strictShared>=12&&distinctive.length>=4;
 return {level:review?'review' as const:'limited' as const,reason:configuration?'Configuration code: shared settings can be boilerplate':review?'Distinct strict-token overlap; inspect pinned fragments manually':'Limited distinctive strict-token support; common syntax, templates or identifier normalization may explain similarity',distinctiveTerms:distinctive.length,strictShared};
}
