// Fluid V8 M8.9.1 — mesh-derived jug interior for hydrostatic PBF fill.
// The decoded high-poly jug remains the visual source of truth. This adapter samples
// its fitted vertex cloud by height, derives a conservative interior radius profile,
// mutates the hydrostatic seed profile before M8.8 initializes, and rewrites only the
// pitcher body SDF in M8.8's WGSL. Receiving-glass capture and M8.8.1 fluid physics stay intact.
import {dev,profile,outerProfile} from './v5-pitcher-fluid-physics-m872.js';
if(!dev||!profile||!outerProfile)throw new Error('M8.9.1 jug physics runtime unavailable');

const phase=new URL(import.meta.url).searchParams.has('post')?'post':'pre';
const q=new URLSearchParams(location.search);
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const quantile=(a,t)=>{if(!a.length)return NaN;const s=a.slice().sort((x,y)=>x-y),p=clamp(t,0,1)*(s.length-1),i=Math.floor(p),f=p-i;return s[i]*(1-f)+s[Math.min(s.length-1,i+1)]*f;};
const f32=v=>{const n=Math.abs(v)<5e-7?0:v;return Number(n).toFixed(6);};

function derive(){
  const S=window.__v5M890JugState;
  const data=S?.g?.data;
  if(!S?.ready||!(data instanceof Float32Array)||data.length<60)throw new Error('decoded jug vertex cloud unavailable');
  const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<data.length;i+=6)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],data[i+k]);hi[k]=Math.max(hi[k],data[i+k]);}
  const H=Math.max(1e-5,hi[1]-lo[1]),band=H*.040;
  const fracs=[.045,.13,.24,.37,.50,.62,.73,.82,.875];
  const raw=[];
  for(const t of fracs){
    const y=lo[1]+H*t,r=[];
    for(let i=0;i<data.length;i+=6){
      if(Math.abs(data[i+1]-y)>band)continue;
      const rr=Math.hypot(data[i],data[i+2]);
      if(rr>.025&&rr<.34)r.push(rr);
    }
    let rad=quantile(r,.38);
    if(!Number.isFinite(rad))rad=raw.length?raw.at(-1)[1]:.11;
    rad=clamp(rad-(Number(q.get('jugwall'))||.010),.060,.235);
    raw.push([y,rad]);
  }
  const body=raw.map((p,i)=>{
    if(i===0||i===raw.length-1)return p.slice();
    return[p[0],raw[i-1][1]*.22+p[1]*.56+raw[i+1][1]*.22];
  });
  const maxR=Math.max(...body.map(p=>p[1]));
  for(const p of body)p[1]=clamp(p[1],Math.max(.055,maxR*.43),Math.min(.235,maxR*1.08));
  const wall=clamp(Number(q.get('jugglass'))||.016,.010,.028);
  const outer=body.map(([y,r])=>[y,Math.min(.270,r+wall)]);
  profile.splice(0,profile.length,...body.map(p=>p.slice()));
  outerProfile.splice(0,outerProfile.length,...outer.map(p=>p.slice()));
  const spec={body,outer,bottom:body[0][0],top:body.at(-1)[0],maxR,wall,H,source:S.decoder||'GLB'};
  window.__v5JugPhysics=spec;
  return spec;
}

function wgslProfile(name,pts){
  let s=`fn ${name}(y:f32)->f32{\n  if(y<=${f32(pts[0][0])}){return ${f32(pts[0][1])};}`;
  for(let i=1;i<pts.length;i++){
    const [y0,r0]=pts[i-1],[y1,r1]=pts[i],dy=Math.max(1e-6,y1-y0);
    s+=`\n  if(y<${f32(y1)}){return mix(${f32(r0)},${f32(r1)},(y-${f32(y0)})/${f32(dy)});}`;
  }
  s+=`\n  return ${f32(pts.at(-1)[1])};\n}`;
  return s;
}

function installShaderAdapter(spec){
  if(window.__v5M891ShaderAdapter)return;
  const oldBody=`fn bodyR(y:f32)->f32{\n  if(y<=-.225){return .074;} if(y<-.190){return mix(.074,.105,(y+.225)/.035);}\n  if(y<-.100){return mix(.105,.137,(y+.190)/.090);} if(y<.020){return mix(.137,.145,(y+.100)/.120);}\n  if(y<.105){return mix(.145,.127,(y-.020)/.085);} if(y<.165){return mix(.127,.095,(y-.105)/.060);}\n  if(y<.205){return mix(.095,.070,(y-.165)/.040);} return .070;\n}`;
  const oldOuter=`fn outerR(y:f32)->f32{\n  if(y<=-.255){return .095;} if(y<-.220){return mix(.095,.125,(y+.255)/.035);}\n  if(y<-.135){return mix(.125,.158,(y+.220)/.085);} if(y<-.020){return mix(.158,.166,(y+.135)/.115);}\n  if(y<.095){return mix(.166,.147,(y-.020)/.115);} if(y<.165){return mix(.147,.118,(y-.095)/.070);}\n  if(y<.225){return mix(.118,.090,(y-.165)/.060);} return .090;\n}`;
  const base=dev.createShaderModule.bind(dev),b0=f32(spec.bottom),b1=f32(spec.top),o0=f32(spec.outer[0][0]),o1=f32(spec.outer.at(-1)[0]);
  dev.createShaderModule=function(desc){
    if(desc?.label==='m880MovingBoundaryWGSL'&&typeof desc.code==='string'){
      let code=desc.code.replace(oldBody,wgslProfile('bodyR',spec.body)).replace(oldOuter,wgslProfile('outerR',spec.outer));
      code=code.replace(`bodyR(clamp(l0.y,-.225,.205))`,`bodyR(l0.y)`)
        .replace(`l0.y>-.225-pr*1.5 && l0.y<.205+pr*1.5`,`l0.y>${b0}-pr*1.5 && l0.y<${b1}+pr*1.5`)
        .replace(`if(l.y<-.225+pr){l.y=-.225+pr;}`,`if(l.y<${b0}+pr){l.y=${b0}+pr;}`)
        .replace(`if(l.y<.205-pr*.05 && !doorway(l,pr)){`,`if(l.y<${b1}-pr*.05 && !doorway(l,pr)){`)
        .replaceAll(`bodyR(clamp(l.y,-.225,.205))`,`bodyR(l.y)`)
        .replace(`if(l.y>-.255-pr && l.y<.225+pr && !doorway(l,pr)){`,`if(l.y>${o0}-pr && l.y<${o1}+pr && !doorway(l,pr)){`)
        .replace(`outerR(clamp(l.y,-.255,.225))`,`outerR(l.y)`);
      desc={...desc,code};
    }
    return base(desc);
  };
  window.__v5M891ShaderAdapter=true;
}

function hud(spec,error){
  const h=document.querySelector('#m880Hud b');if(h)h.textContent=error?'M8.9.1 · JUG INTERIOR FALLBACK':'M8.9.1 · MESH-DERIVED JUG INTERIOR';
  const top=document.querySelector('.hud.card.title');if(top)top.textContent='FLUID V8 · M8.9.1';
  const host=document.getElementById('m880Hud');if(!host)return;
  let d=document.getElementById('m891Status');if(!d){d=document.createElement('div');d.id='m891Status';d.style.cssText='margin-top:6px;padding-top:6px;border-top:1px solid rgba(112,225,235,.20);color:#9fe9c7';host.appendChild(d);}
  if(error)d.textContent='jug interior profile fallback · '+error;
  else d.textContent=`mesh interior ${spec.body.length} slices · radius ${(spec.maxR).toFixed(3)} m · body ${spec.bottom.toFixed(3)}…${spec.top.toFixed(3)} m · wall ${(spec.wall*1000).toFixed(0)} mm`;
}

let spec=window.__v5JugPhysics,error=null;
if(phase==='pre'){
  try{spec=derive();installShaderAdapter(spec);}catch(e){error=String(e?.message||e);console.error('[M8.9.1 jug physics]',e);}
}else{
  spec=window.__v5JugPhysics;error=spec?null:'mesh interior profile unavailable';hud(spec,error);
}
window.__v5M891JugPhysics={online:!!spec,phase,error,get profile(){return spec?.body||null},get maxRadius(){return spec?.maxR||0}};
window.__fluidV5Version='8.9.1';
window.__fluidV5Build='M8.9.1 MESH-DERIVED JUG INTERIOR / HYDROSTATIC PBF FILL / M8.9 GLB VISUAL / M8.8.1 FLUID PHYSICS';
document.title='Fluid V8 · M8.9.1 Mesh-Derived Jug Interior';
