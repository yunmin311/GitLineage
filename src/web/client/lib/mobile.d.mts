import type { ViewGraph, ViewEdge } from '../../../web/view-model.ts';
export declare function phoneViewport(width:number,height:number):boolean;
export declare function relationGroups(view:ViewGraph):{family:string;count:number;groups:{label:string;edges:ViewEdge[];evidenceCount:number}[]}[];
export declare function installTouchCamera(canvas:unknown,hooks:unknown):()=>void;
