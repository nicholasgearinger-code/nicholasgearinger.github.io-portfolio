// Fluid V8 M8.8.7 — screenshot-calibrated receiving-glass alignment.
// Preserve M8.8.6 pitcher geometry/optics and M8.8.1 fluid/energy behavior.
// The M8.8.6 screenshot shows the stream entering near the far-right rim; moving the
// tumbler from x=.846 to x=.942 places the opening under the measured stream trajectory
// while retaining a small margin inside the 1.10 m simulation box.
import {pitcher,glass} from './v5-pitcher-fluid-physics-m872.js';

const previousGlassX=glass.cx;
glass.cx=.942;
pitcher.maxAngle=-1.14;

const title=document.querySelector('#m880Hud b');
if(title)title.textContent='M8.8.7 · STREAM / GLASS ALIGNMENT';
const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.8.7';
window.__fluidV5Version='8.8.7';
window.__fluidV5Build='M8.8.7 SCREENSHOT-CALIBRATED CATCH / M8.8.6 VESSELS / M8.8.1 FLUID PHYSICS';
window.__v5M887={
  online:true,physics:'m881',vessels:'m886',glassX:glass.cx,previousGlassX,
  maxAngle:pitcher.maxAngle,alignment:'screenshot-calibrated-right-shift'
};
document.title='Fluid V8 · M8.8.7 Stream / Glass Alignment';
console.info(`[Fluid V8 M8.8.7] receiving glass aligned x ${previousGlassX.toFixed(3)} -> ${glass.cx.toFixed(3)}; M8.8.1 fluid physics preserved.`);
