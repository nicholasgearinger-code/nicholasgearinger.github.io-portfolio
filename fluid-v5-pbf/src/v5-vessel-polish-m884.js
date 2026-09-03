// Fluid V8 M8.8.4 — gentle final pour polish.
// M8.8.1 remains the fluid/energy model. Only reduce the prescribed vessel tilt slightly
// so the last part of the turn is less aggressive; no particle velocity or trajectory forcing.
import {pitcher} from './v5-pitcher-fluid-physics-m872.js';

pitcher.maxAngle=-1.14;

const title=document.querySelector('#m880Hud b');if(title)title.textContent='M8.8.4 · M8.8.1 PHYSICS / GENTLE POUR';
const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.8.4';
window.__fluidV5Version='8.8.4';
window.__fluidV5Build='M8.8.4 M8.8.1 FLUID PHYSICS / REFINED GLASS ALIGNMENT / GENTLER TILT';
window.__v5M884={online:true,physics:'m881',freeSlip:false,glassX:.805,maxAngle:pitcher.maxAngle};
document.title='Fluid V8 · M8.8.4 Gentle Natural Pour';
console.info('[Fluid V8 M8.8.4] M8.8.1 fluid physics preserved; glass alignment + tilt only.');
