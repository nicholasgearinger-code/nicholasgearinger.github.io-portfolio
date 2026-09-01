// Fluid V8 M8.8.4 — subtle scene alignment only.
// Preserve M8.8.1 fluid mechanics; nudge the receiving glass slightly back toward
// the natural stream centerline before the vessel renderer builds its mesh.
import {glass} from './v5-pitcher-fluid-physics-m872.js';

glass.cx=.805;

window.__v5M884Layout={online:true,glassX:glass.cx,physics:'unchanged-m881'};
console.info('[Fluid V8 M8.8.4] glass centerline refined; fluid physics unchanged.');
