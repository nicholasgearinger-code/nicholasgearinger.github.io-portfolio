// Fluid V8 M8.9.5 — sanitize the GLB-derived jug shell before moving-boundary shaders compile.
// M8.9.2 correctly finds inward-facing surfaces, but the handle/spout can contribute large
// radii to a few angular bins. That makes the PBF body boundary non-physical. Keep the real
// per-height GLB shape while robustly clipping angular outliers to the jug body envelope.
import {profile} from './v5-pitcher-fluid-physics-m872.js';

const spec=window.__v5JugShell892;
if(!spec?.ys?.length||!spec?.rows?.length)throw new Error('M8.9.5 GLB shell unavailable');
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const quantile=(a,t)=>{const s=a.filter(Number.isFinite).slice().sort((x,y)=>x-y);if(!s.length)return 0;const p=clamp(t,0,1)*(s.length-1),i=Math.floor(p),f=p-i;return s[i]*(1-f)+s[Math.min(i+1,s.length-1)]*f;};
const raw=spec.rows.map(r=>r.slice());
const rows=raw.map(row=>{
  const q25=quantile(row,.25),q50=quantile(row,.50),q66=quantile(row,.66);
  // Robust body band: reject handle/spout excursions without forcing the whole jug circular.
  const lo=Math.max(.038,Math.max(q25*.94,q50*.72));
  const hi=Math.max(lo+.006,Math.min(.205,Math.max(q50*1.08,q66*1.02)));
  let r=row.map(v=>clamp(v,lo,hi));
  // Light circumferential smoothing removes isolated mesh bins while retaining asymmetry.
  for(let pass=0;pass<2;pass++){
    const s=r.slice();
    r=r.map((v,i)=>s[(i+s.length-1)%s.length]*.17+v*.66+s[(i+1)%s.length]*.17);
  }
  return r;
});
// Gentle vertical smoothing keeps the collision normal continuous from belly to shoulder.
for(let y=1;y<rows.length-1;y++){
  const prev=rows[y-1].slice(),cur=rows[y].slice(),next=rows[y+1].slice();
  for(let a=0;a<cur.length;a++)rows[y][a]=prev[a]*.08+cur[a]*.84+next[a]*.08;
}
for(let y=0;y<rows.length;y++)for(let a=0;a<rows[y].length;a++)spec.rows[y][a]=rows[y][a];
spec.rawRowsM895=raw;
spec.minR=Math.min(...rows.flat());
spec.maxR=Math.max(...rows.flat());
spec.bodyOnly=true;
spec.bodyQuantile='q25/q50/q66 robust angular clamp';

// M8.8's seed helper reads profile; point it at the cleaned body rather than the minimum
// angular radius used by M8.9.2. M8.9.5's own reservoir still clips against every angle.
const seed=spec.ys.map((y,i)=>[y,Math.max(.040,quantile(rows[i],.45)*.97)]);
profile.splice(0,profile.length,...seed.map(p=>p.slice()));

window.__v5M895ShellFix={online:true,backend:'robust-body-envelope-from-glb-inner-shell',rawMin:Math.min(...raw.flat()),rawMax:Math.max(...raw.flat()),minR:spec.minR,maxR:spec.maxR};
console.info(`[Fluid V8 M8.9.5] GLB body shell sanitized ${spec.minR.toFixed(3)}…${spec.maxR.toFixed(3)} m (raw ${window.__v5M895ShellFix.rawMin.toFixed(3)}…${window.__v5M895ShellFix.rawMax.toFixed(3)} m).`);
