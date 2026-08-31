// Fluid V8 M8.5.5 — gentle continuity tune on the known-good M8.5.3 faucet.
// Intentionally preserves M8.5.3's 10.5K / 25 mm PBF, camera, SSFR, viscosity and tension.
// Only adjusts the existing M8.5.2 inlet controls: more nozzle travel per frame and slightly
// tighter axial layer spacing. No close-packed offsets, no extra cohesion and no added passes.

const faucet=window.__v5M852Faucet,sim=window.__sim;
if(!faucet?.online||!sim)throw new Error('M8.5.5 tune: M8.5.3 faucet runtime unavailable.');

function findRange(labelText){
  const labels=[...document.querySelectorAll('.m742Row label')];
  const label=labels.find(x=>x.textContent.trim()===labelText);
  if(!label)return null;
  return label.parentElement?.querySelector('input[type="range"]')||null;
}
function setRange(input,value,min,max){
  if(!input)return false;
  if(min!=null)input.min=String(min);
  if(max!=null)input.max=String(max);
  input.value=String(value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
  return true;
}

function apply(){
  // At 25 mm particles this gives ~19 mm of nozzle travel per 60 Hz frame, versus ~11 mm
  // in M8.5.3. Combined with 0.86d axial spacing, layers arrive almost every frame rather
  // than every ~2 frames, but without the aggressive packing/tension that destabilized M8.5.4.
  const speed=findRange('EXIT SPEED');
  const axial=findRange('AXIAL SPACING');
  setRange(speed,1.14,.35,1.30);
  setRange(axial,.86,.82,1.08);

  // Preserve the known-good M8.5.3 fluid parameters explicitly.
  if(sim.params){
    sim.params.xsphC=.046;
    sim.params.sCorrK=.030;
    sim.params.surfaceTensionK=.070;
    sim.params.substeps=2;
    sim.params.iterations=3;
  }
}

setTimeout(apply,120);
setTimeout(apply,500);

window.__v5M855Gentle={online:true,backend:'m853-gentle-inlet-continuity-m855',exitSpeed:1.14,axialSpacing:.86};
window.__fluidV5Version='8.5.5';
window.__fluidV5Build='M8.5.5 M8.5.3 ROLLBACK + GENTLE CONTINUITY TUNE';
const title=document.querySelector('.hud.card.title');if(title)title.textContent='FLUID V8 · M8.5.5';
document.title='Fluid V8 · M8.5.5 Gentle Faucet';
console.info('[Fluid V8 M8.5.5] M8.5.3 preserved; gentle inlet continuity tune applied.');
