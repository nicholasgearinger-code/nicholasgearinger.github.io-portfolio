// Fluid V5 M6.5 waterfall whitewater ownership.
// The generic M4 whitewater emitter was built for pool splashes. During Waterfall it can classify
// the fast primary curtain as spray and flood the view with secondary particles. M6.5 lets the
// Houdini-style waterfall renderer own aeration/mist; generic whitewater resumes in other scenarios.
const state=window.__v5State;
if(!state)throw new Error('Fluid V5 M6.5 whitewater gate: state unavailable.');
let saved=null,activeLast=false;
function tick(){
 const on=state.scenario==='waterfall-m62';
 if(on&&!activeLast){saved=Number.isFinite(Number(state.whitewater))?Number(state.whitewater):.86;state.whitewater=0;}
 else if(!on&&activeLast){if(saved!==null)state.whitewater=saved;saved=null;}
 activeLast=on;
 const S=window.__v5WaterfallWhitewaterM65;
 if(S){S.active=on;S.genericStrength=Number(state.whitewater)||0;S.savedStrength=saved!==null?saved:(Number(state.whitewater)||0);}
}
setInterval(tick,45);tick();
window.__v5WaterfallWhitewaterM65={online:true,backend:'waterfall-primary-body-owns-whitewater-m65',active:false,genericStrength:Number(state.whitewater)||0,savedStrength:Number(state.whitewater)||0};
console.info('[Fluid V5 M6.5] generic pool whitewater gated during waterfall; Houdini body/mist owns waterfall aeration.');