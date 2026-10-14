export type Category={id:string;label:string;basis:string;parent:string;level:number;edgeIds:string[];children:Category[]};
export function classifyRelationships(view:any,plate:any):{roots:Category[];categories:Category[];paths:Map<string,Category[]>;ordered:string[]};
