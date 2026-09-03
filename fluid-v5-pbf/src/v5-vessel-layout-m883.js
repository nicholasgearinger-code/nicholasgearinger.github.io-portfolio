// Fluid V8 M8.8.3 — scene layout only.
// Preserve the exact M8.8.1 fluid mechanics and move the receiving glass under the
// gravity-driven trajectory instead of changing the water's velocity/contact response.
import {glass} from './v5-pitcher-fluid-physics-m872.js';

// M8.8.1's coherent stream crosses the glass-rim height farther downrange than the
// original M8.7.x emitter-oriented placement. Shift the physical and visual glass together.
glass.cx=.825;

window.__v5M883Layout={online:true,glassX:glass.cx,physics:'unchanged-m881'};
console.info('[Fluid V8 M8.8.3] receiving glass aligned to natural M8.8.1 trajectory; fluid physics unchanged.');
