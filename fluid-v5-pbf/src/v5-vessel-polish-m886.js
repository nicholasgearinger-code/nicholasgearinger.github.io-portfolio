// Fluid V8 M8.8.6 — centered catch + glass refinement presentation checkpoint.
// Keep M8.8.1 water/energy behavior and the gentle prescribed vessel motion.
import {pitcher,glass} from './v5-pitcher-fluid-physics-m872.js';

pitcher.maxAngle=-1.14;

const title=document.querySelector('#m880Hud b');
if(title)title.textContent='M8.8.6 · CENTERED CATCH / GLASS REFINEMENT';
const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.8.6';
window.__fluidV5Version='8.8.6';
window.__fluidV5Build='M8.8.6 CENTERED CATCH / REFINED PITCHER / OPTICAL GLASS / M8.8.1 FLUID PHYSICS';
window.__v5M886={online:true,physics:'m881',glassX:glass.cx,maxAngle:pitcher.maxAngle,spoutThroat:.170};
document.title='Fluid V8 · M8.8.6 Centered Catch + Glass Refinement';
console.info('[Fluid V8 M8.8.6] receiving glass centered under stream; pitcher/glass presentation refined; M8.8.1 water physics preserved.');
