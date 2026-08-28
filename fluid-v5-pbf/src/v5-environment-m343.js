// Fluid V5 M3.4.3 self-contained Radiance HDR time-of-day environments.
// Generates small 2:1 HDR panoramas at runtime so Day/Sunset/Night have deterministic lighting
// without depending on a remote asset host. Sunset has a true >1.0 HDR sun/horizon; Night is
// deliberately near-black so submerged pool fixtures are the only meaningful light source.

import { TIME_PRESETS } from './v5-light-presets.js';

const ssfr = window.__ssfr;
const lab = window.__v5LightLab;
const env = ssfr?.env;
if (!ssfr?.dev || !env?.load || !lab?.state) throw new Error('Fluid V5 M3.4.3 environment: runtime unavailable.');

const W = 512;
const H = 256;
const fileCache = new Map();
let generation = 0;

window.__v5EnvironmentStatus = {
  online:false,
  stage:'idle',
  backend:'radiance-hdri-m343',
  mode:lab.state.time || 'day',
  error:'',
};

const clamp = (x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const mix3 = (a,b,t)=>[
  a[0]+(b[0]-a[0])*t,
  a[1]+(b[1]-a[1])*t,
  a[2]+(b[2]-a[2])*t,
];
const add3 = (a,b,s=1)=>[a[0]+b[0]*s,a[1]+b[1]*s,a[2]+b[2]*s];

function angularDistance(u,v, su,sv){
  let du=Math.abs(u-su);du=Math.min(du,1-du);
  const latA=(0.5-v)*Math.PI, latB=(0.5-sv)*Math.PI;
  const lon=du*Math.PI*2;
  const c=Math.sin(latA)*Math.sin(latB)+Math.cos(latA)*Math.cos(latB)*Math.cos(lon);
  return Math.acos(clamp(c,-1,1));
}

function daySky(u,v){
  const elev=(0.5-v)*Math.PI;
  if(elev<0){
    const k=clamp(-elev/(Math.PI*.5));
    return mix3([0.055,0.075,0.085],[0.018,0.022,0.026],k);
  }
  const y=clamp(Math.sin(elev));
  let c=mix3([0.64,0.82,1.08],[0.10,0.27,0.72],Math.pow(y,.58));
  const haze=Math.exp(-Math.pow(elev/.17,2));
  c=add3(c,[0.26,0.25,0.20],haze*.34);
  // u/v aligned with azimuth 32°, elevation 58°.
  const ang=angularDistance(u,v,.589,.178);
  const glow=Math.exp(-ang*ang/.012);
  const disc=Math.exp(-ang*ang/.000035);
  c=add3(c,[1.4,1.18,.78],glow*.24);
  c=add3(c,[18.0,15.0,9.0],disc);
  return c;
}

function sunsetSky(u,v){
  const elev=(0.5-v)*Math.PI;
  if(elev<0){
    const horizon=Math.exp(-Math.pow(elev/.16,2));
    return add3([0.010,0.008,0.014],[0.18,0.045,0.025],horizon*.38);
  }
  const y=clamp(Math.sin(elev));
  let c=mix3([2.00,.48,.13],[.055,.075,.24],Math.pow(y,.48));
  const rose=Math.exp(-Math.pow((elev-.18)/.20,2));
  c=add3(c,[.78,.10,.30],rose*.62);

  // Long dark/pink cloud shelves above the horizon.
  const band=Math.exp(-Math.pow((v-.37)/.075,2));
  const wave=.5+.5*Math.sin(u*Math.PI*2*4.2 + Math.sin(u*Math.PI*2*1.7)*1.8);
  const detail=.5+.5*Math.sin(u*Math.PI*2*9.1 + v*31.0);
  const cloud=band*clamp(wave*.72+detail*.28-.36,0,1);
  c=mix3(c,[.10,.055,.16],cloud*.62);
  c=add3(c,[.72,.15,.26],band*(1-cloud)*.14);

  // u/v aligned with azimuth 98°, elevation 8°.
  const ang=angularDistance(u,v,.772,.456);
  const glow=Math.exp(-ang*ang/.018);
  const inner=Math.exp(-ang*ang/.0013);
  const disc=Math.exp(-ang*ang/.000050);
  c=add3(c,[3.6,.70,.16],glow*.50);
  c=add3(c,[7.2,1.35,.24],inner*.42);
  c=add3(c,[34.0,9.0,2.0],disc);
  return c;
}

function nightSky(u,v){
  const elev=(0.5-v)*Math.PI;
  if(elev<0) return [0.00035,0.00045,0.00070];
  const horizon=Math.exp(-Math.pow(elev/.20,2));
  const zen=clamp(Math.sin(elev));
  let c=mix3([0.0022,0.0030,0.0060],[0.00045,0.00070,0.0018],Math.pow(zen,.55));
  c=add3(c,[0.0016,0.0012,0.0015],horizon*.35);
  return c;
}

function sample(mode,u,v){
  if(mode==='sunset') return sunsetSky(u,v);
  if(mode==='night') return nightSky(u,v);
  return daySky(u,v);
}

function toRGBE(r,g,b,out,o){
  const m=Math.max(r,g,b);
  if(!(m>1e-32)){
    out[o]=0;out[o+1]=0;out[o+2]=0;out[o+3]=0;return;
  }
  const e=Math.floor(Math.log2(m))+1;
  const scale=256/Math.pow(2,e);
  out[o]=clamp(Math.floor(r*scale+.5),0,255);
  out[o+1]=clamp(Math.floor(g*scale+.5),0,255);
  out[o+2]=clamp(Math.floor(b*scale+.5),0,255);
  out[o+3]=clamp(e+128,0,255);
}

function makeHDRFile(mode){
  if(fileCache.has(mode)) return fileCache.get(mode);
  const header=`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`;
  const head=new TextEncoder().encode(header);
  const bytes=new Uint8Array(head.length+W*H*4);
  bytes.set(head,0);
  let o=head.length;
  for(let y=0;y<H;y++){
    const v=(y+.5)/H;
    for(let x=0;x<W;x++){
      const u=(x+.5)/W;
      const c=sample(mode,u,v);
      toRGBE(c[0],c[1],c[2],bytes,o);
      o+=4;
    }
  }
  const file=new File([bytes],`fluid-v5-${mode}-m343.hdr`,{type:'application/octet-stream'});
  fileCache.set(mode,file);
  return file;
}

function ensureStatusBadge(){
  const root=document.getElementById('v5LightLab');
  if(!root)return null;
  let el=document.getElementById('v5EnvironmentStatus');
  if(!el){
    el=document.createElement('div');
    el.id='v5EnvironmentStatus';
    el.style.cssText='margin-top:9px;padding:8px 10px;border:1px solid rgba(78,214,220,.22);border-radius:10px;background:rgba(3,17,24,.55);font:700 8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.045em;color:#9fc5d0;overflow-wrap:anywhere';
    root.appendChild(el);
  }
  return el;
}
function paintStatus(){
  const s=window.__v5EnvironmentStatus;
  const el=ensureStatusBadge();
  if(!el)return;
  let text,color;
  if(s.online){
    text=`ENVIRONMENT · ${String(s.mode).toUpperCase()} HDRI · READY`;
    color='#9dffc8';
  }else if(s.stage==='loading'){
    text=`ENVIRONMENT · ${String(s.mode).toUpperCase()} HDRI · LOADING…`;
    color='#ffd890';
  }else{
    text=`ENVIRONMENT · FALLBACK · ${s.error||s.stage}`;
    color='#ffaaaa';
  }
  if(el.textContent!==text)el.textContent=text;
  if(el.style.color!==color)el.style.color=color;
}

async function applyEnvironment(mode){
  mode = TIME_PRESETS[mode] ? mode : 'day';
  const token=++generation;
  const mood=TIME_PRESETS[mode];
  window.__v5EnvironmentStatus={online:false,stage:'loading',backend:'radiance-hdri-m343',mode,error:''};
  paintStatus();

  // Prevent a bright previous panorama from flashing while Night is being decoded.
  env.intensity=mode==='night'?0.0:Math.min(.18,mood.envIntensity);
  try{
    const file=makeHDRFile(mode);
    const status=await env.load(file);
    if(token!==generation)return;
    env.intensity=mood.envIntensity;
    env.yaw=mood.envYaw||0;
    ssfr.bindCache=null;
    window.__v5EnvironmentStatus={online:true,stage:'online',backend:'radiance-hdri-m343',mode,error:'',status};
    paintStatus();
  }catch(err){
    if(token!==generation)return;
    env.intensity=mode==='night'?0.0:mood.envIntensity;
    window.__v5EnvironmentStatus={online:false,stage:'rejected',backend:'radiance-hdri-m343',mode,error:String(err?.message||err)};
    paintStatus();
    console.error('[Fluid V5 M3.4.3 HDR environment]',err);
  }
}

window.addEventListener('fluid-v5-light-change',e=>{
  const mode=e.detail?.timeOfDay||lab.state.time||'day';
  setTimeout(()=>{void applyEnvironment(mode);},0);
});

// The Lighting UI rebuilds itself after button presses, so restore the status badge after DOM moves.
const observer=new MutationObserver(()=>paintStatus());
const panel=document.getElementById('settingsPanel');
if(panel)observer.observe(panel,{childList:true,subtree:true});

void applyEnvironment(lab.state.time||'day');
window.__v5Environment={version:'M3.4.3',apply:applyEnvironment};
console.info('[Fluid V5 M3.4.3] generated Radiance HDR Day/Sunset/Night environments enabled.');
