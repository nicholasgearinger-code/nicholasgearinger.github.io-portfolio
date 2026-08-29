// Fluid V5 M6.5 waterfall whitewater ownership.
// During Waterfall, keep the generic PBF-derived whitewater system at a restrained strength instead
// of disabling it completely. This lets real solved impact velocity, surface normals and depth create
// spray, foam and bubbles while the dedicated waterfall renderer still owns the bulk curtain/mist.
const state=window.__v5State;
if(!state)throw new Error('Fluid V5 M6.5 whitewater gate: state unavailable.');
let saved=null,activeLast=false;
function tick(){
 const on=state.scenario==='waterfall-m62';
 if(on&&!activeLast){saved=Number.isFinite(Number(state.whitewater))?Number(state.whitewater):.86;}
 if(on){
  const source=saved!==null?saved:(Number(state.whitewater)||0);
  state.whitewater=source>0?Math.min(.32,Math.max(.12,source*.30)):0;
 }else if(activeLast){
  if(saved!==null)state.whitewater=saved;
  saved=null;
 }
 activeLast=on;
 const S=window.__v5WaterfallWhitewaterM65;
 if(S){S.active=on;S.genericStrength=Number(state.whitewater)||0;S.savedStrength=saved!==null?saved:(Number(state.whitewater)||0);S.physicallyDriven=on;}
}
setInterval(tick,45);tick();
window.__v5WaterfallWhitewaterM65={online:true,backend:'physical-impact-whitewater-m65',active:false,genericStrength:Number(state.whitewater)||0,savedStrength:Number(state.whitewater)||0,physicallyDriven:false};
console.info('[Fluid V5 M6.5] restrained PBF-driven waterfall spray / foam / bubbles enabled.');
