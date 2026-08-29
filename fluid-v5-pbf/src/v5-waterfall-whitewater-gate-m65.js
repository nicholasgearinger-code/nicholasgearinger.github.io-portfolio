// Fluid V5 M6.5 waterfall whitewater ownership.
// During Waterfall, keep the generic PBF-derived whitewater system active at a controlled strength.
// Real solved impact velocity, normals and depth then create spray, foam and bubbles at the plunge,
// while the dedicated waterfall renderer supplies only the bulk curtain and low mist volume.
const state=window.__v5State;
if(!state)throw new Error('Fluid V5 M6.5 whitewater gate: state unavailable.');
let saved=null,activeLast=false;
function tick(){
 const on=state.scenario==='waterfall-m62';
 if(on&&!activeLast){saved=Number.isFinite(Number(state.whitewater))?Number(state.whitewater):.86;}
 if(on){
  const source=saved!==null?saved:(Number(state.whitewater)||0);
  // More impact-derived whitewater than the previous pass, but still bounded for mobile.
  state.whitewater=source>0?Math.min(.46,Math.max(.18,source*.45)):0;
 }else if(activeLast){
  if(saved!==null)state.whitewater=saved;
  saved=null;
 }
 activeLast=on;
 const S=window.__v5WaterfallWhitewaterM65;
 if(S){S.active=on;S.genericStrength=Number(state.whitewater)||0;S.savedStrength=saved!==null?saved:(Number(state.whitewater)||0);S.physicallyDriven=on;}
}
setInterval(tick,45);tick();
window.__v5WaterfallWhitewaterM65={online:true,backend:'physical-plunge-whitewater-m65',active:false,genericStrength:Number(state.whitewater)||0,savedStrength:Number(state.whitewater)||0,physicallyDriven:false};
console.info('[Fluid V5 M6.5] PBF-driven plunge spray / foam / bubbles enabled.');
