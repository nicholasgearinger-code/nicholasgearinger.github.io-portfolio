// Fluid V5 M6.0 waterfall handoff.
// M5.9's particle-sprite surfacing is intentionally retired. The new renderer follows the
// Houdini/FLIP production split: simulated particles -> reconstructed liquid body -> whitewater -> mist.
const brand=document.querySelector('.hud.card.title');
if(brand)brand.textContent='FLUID V5 · M6.0';
document.title='Fluid V5 · M6.0 HOUDINI WATERFALL';
window.__fluidV5Version='5.4.0-m60-loading';
await import('./v5-waterfall-houdini-m60.js');
