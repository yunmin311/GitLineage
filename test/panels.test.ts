import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialPanels,transitionPanels,visiblePanels,protectionPan} from '../src/web/client/lib/panels.mjs';

test('breakpoints select a single overlay until 1600, while retaining evidence context',()=>{
  for(const width of [375,390,430,768,820,1024,1280,1599,1600,1920]) {
    let p=initialPanels(width);
    p=transitionPanels(p,{type:'selection',selected:true});
    assert.deepEqual(visiblePanels(p),{rail:width>=1600,drawer:true});
    p=transitionPanels(p,{type:'context',open:true});
    assert.equal(p.evidence,true);
    assert.deepEqual(visiblePanels(p),{rail:true,drawer:width>=1600});
    p=transitionPanels(p,{type:'context',open:false});
    assert.deepEqual(visiblePanels(p),{rail:false,drawer:true});
  }
});
test('selecting an object while context is open returns the evidence overlay',()=>{
  const p=transitionPanels(transitionPanels(initialPanels(1280),{type:'context',open:true}),{type:'selection',selected:true});
  assert.deepEqual(visiblePanels(p),{rail:false,drawer:true});
});
test('crossing the wide breakpoint reconciles both panels without losing selection',()=>{
  let p=transitionPanels(initialPanels(1920),{type:'selection',selected:true});
  p=transitionPanels(p,{type:'resize',width:1280});
  assert.deepEqual(visiblePanels(p),{rail:false,drawer:true});
  assert.equal(p.evidence,true);
});
test('minimal protection pan is idempotent and does not shrink oversized targets',()=>{
  const free={left:264,right:1160,top:100,bottom:700};
  const target={left:200,right:544,top:680,bottom:706,width:344,height:26};
  const pan=protectionPan(target,free)!;
  assert.deepEqual(pan,{dx:72,dy:-14});
  assert.deepEqual(protectionPan({...target,left:target.left+pan.dx,right:target.right+pan.dx,top:target.top+pan.dy,bottom:target.bottom+pan.dy},free),{dx:0,dy:0});
  assert.equal(protectionPan({...target,width:1000},free),null);
});
