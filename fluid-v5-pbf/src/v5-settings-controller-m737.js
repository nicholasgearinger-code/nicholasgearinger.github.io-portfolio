// Fluid V5 M7.3.7 settings wrapper.
await import('./v5-settings-controller-m73.js');
function lockBrand(){
 document.title='Fluid V5 · M7.3.7 Physical Water';
 const b=document.querySelector('.hud.card.title');if(b)b.textContent='FLUID V5 · M7.3.7';
 const l=document.querySelector('#loading h2');if(l)l.textContent='FLUID V5 · M7.3.7';
 window.__fluidV5Version='7.3.7';window.__fluidV5Build='M7.3.7 IOS SINGLE-SUBMIT';
}
lockBrand();setInterval(lockBrand,700);
const root=document.getElementById('v5M73Root');
if(root){const sub=root.querySelector('.m73Sub');if(sub)sub.textContent='iOS stability mode · core PBF only · extra per-frame GPU submits disabled';}
window.__v5SettingsM737={online:true,stabilityMode:true};
