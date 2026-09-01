// Fluid V8 M8.8.5 — reference pitcher presentation checkpoint.
// Keep M8.8.1 water/energy behavior and M8.8.4 gentle prescribed tilt.
import {pitcher,glass} from './v5-pitcher-fluid-physics-m872.js';

pitcher.maxAngle=-1.14;

const title=document.querySelector('#m880Hud b');
if(title)title.textContent='M8.8.5 · REFERENCE PITCHER / M8.8.1 PHYSICS';
const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.8.5';
window.__fluidV5Version='8.8.5';
window.__fluidV5Build='M8.8.5 REFERENCE PITCHER / HIGH SPOUT / OPTICAL GLASS / M8.8.1 FLUID PHYSICS';
window.__v5M885={online:true,physics:'m881',glassX:glass.cx,maxAngle:pitcher.maxAngle,spoutThroat:.170};
document.title='Fluid V8 · M8.8.5 Reference Pitcher';
console.info('[Fluid V8 M8.8.5] reference pitcher + higher dry-rest spout + optical glass online; M8.8.1 water physics preserved.');
