export const ORIGIN: Readonly<{x:number;y:number}>;
export type SpatialPoint={x:number;y:number;width?:number;height?:number;aggregateKey?:string;angle?:number;depth?:number};
export type SpatialEdge={source:string;target:string;family?:string;relationshipType?:string;presentation?:string};
export function spatialLayout(options:{subjectId:string;focusId?:string;edges:SpatialEdge[];groups?:{key:string;peers:string[];family?:string}[];mode?:string;compact?:boolean;previous?:Map<string,SpatialPoint>}):Map<string,SpatialPoint>;
export function spatialRoute(edge:SpatialEdge,positions:Map<string,SpatialPoint>,fanIndex?:number,fanCount?:number):{path:string;label:{x:number;y:number}}|null;

export function spatialExpansion(options:{anchors:Map<string,SpatialPoint>;nodes:{id:string}[];edges:(SpatialEdge&{kind?:string})[];previous?:Map<string,SpatialPoint>;compact?:boolean}):Map<string,SpatialPoint>;
