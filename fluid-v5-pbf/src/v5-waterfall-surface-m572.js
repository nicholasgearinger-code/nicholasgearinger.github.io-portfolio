// Fluid V5 M6.0 waterfall handoff.
// M5.9's particle-sprite surfacing is intentionally retired. The new renderer follows the
// Houdini/FLIP production split: simulated particles -> reconstructed liquid body -> whitewater -> mist.
const stamp=()=>{
 const brand=document.querySelector('.hud.card.title');
 if(brand)brand.textContent='FLUID V5 · M6.0';
 document.title='Fluid V5 · M6.0 HOUDINI WATERFALL';
 window.__fluidV5Version='5.4.0-m60';
 window.__fluidV5Build='M6.0 HOUDINI WATERFALL';
};
stamp();
await import('./v5-waterfall-houdini-m60.js');
// The M5.9 bootstrap has a delayed brand write at 1.5 s. Stamp M6.0 afterward so the visible
// marker always describes the renderer actually running on-device.
setTimeout(stamp,2200);
