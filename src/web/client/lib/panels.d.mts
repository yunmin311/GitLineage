export type PanelMode = 'wide' | 'compact' | 'tablet' | 'legacy-mobile';
export interface PanelState { mode: PanelMode; rail: boolean; evidence: boolean }
export type PanelAction = {type:'resize';width:number}|{type:'selection';selected:boolean}|{type:'context';open:boolean};
export declare function panelMode(width:number):PanelMode;
export declare function initialPanels(width:number):PanelState;
export declare function transitionPanels(current:PanelState,action:PanelAction):PanelState;
export declare function visiblePanels(state:PanelState):{rail:boolean;drawer:boolean};
export declare function protectionPan(target:{left:number;right:number;top:number;bottom:number;width:number;height:number},free:{left:number;right:number;top:number;bottom:number},margin?:number):{dx:number;dy:number}|null;
