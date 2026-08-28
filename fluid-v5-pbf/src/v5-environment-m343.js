// Fluid V5 M3.4.6 linear Radiance environment loader.
// The supplied Day/Sunset panoramas stay stored as compact WebP assets, but are decoded to sRGB,
// converted to linear RGB, expanded into a controlled pseudo-HDR range and encoded as Radiance RGBE
// before entering the existing environment loader. Night uses a literal black Radiance panorama.

import { TIME_PRESETS } from './v5-light-presets.js';
import { DAY_ENV_WEBP_B64 } from './v5-env-day-asset-m345.js';
import { SUNSET_ENV_WEBP_B64 } from './v5-env-sunset-asset-m345.js';

const ssfr = window.__ssfr;
const lab = window.__v5LightLab;
const env = ssfr?.env;
if (!ssfr?.dev || !env?.load || !lab?.state) throw new Error('Fluid V5 M3.4.6 environment: runtime unavailable.');

const cache = new Map();
let generation = 0;

window.__v5EnvironmentStatus = {
  online:false,
  stage:'idle',
  backend:'linear-rgbe-m346',
  mode:lab.state.time || 'day',
  error:'',
};

const clamp = (x,a=0,b=255)=>Math.min(b,Math.max(a,x));
const srgbToLinear = x => {
  x /= 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
};

function bytesFromBase64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i=0;i<bin.length;i++) out[i]=bin.charCodeAt(i);
  return out;
}

function toRGBE(r,g,b,out,o) {
  const m=Math.max(r,g,b);
  if (!(m>1e-32)) { out[o]=0;out[o+1]=0;out[o+2]=0;out[o+3]=0;return; }
  const e=Math.floor(Math.log2(m))+1;
  const scale=256/Math.pow(2,e);
  out[o]=clamp(Math.floor(r*scale+0.5));
  out[o+1]=clamp(Math.floor(g*scale+0.5));
  out[o+2]=clamp(Math.floor(b*scale+0.5));
  out[o+3]=clamp(e+128);
}

function radianceFileFromPixels(px,w,h,name,baseExposure,highlightBoost) {
  const header=new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`);
  const out=new Uint8Array(header.length+w*h*4);
  out.set(header,0);
  let o=header.length;
  for(let i=0;i<w*h;i++) {
    let r=srgbToLinear(px[i*4]);
    let g=srgbToLinear(px[i*4+1]);
    let b=srgbToLinear(px[i*4+2]);
    const peak=Math.max(r,g,b);
    const boost=baseExposure*(1+highlightBoost*Math.pow(peak,3.0));
    r*=boost;g*=boost;b*=boost;
    toRGBE(r,g,b,out,o);o+=4;
  }
  return new File([out],name,{type:'application/octet-stream'});
}

function blackRadianceFile() {
  const key='night-black-hdr';
  if(cache.has(key)) return cache.get(key);
  const w=16,h=8;
  const header=new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`);
  const out=new Uint8Array(header.length+w*h*4);
  out.set(header,0);
  const file=new File([out],'fluid-v5-night-black-m346.hdr',{type:'application/octet-stream'});
  cache.set(key,file);
  return file;
}

async function panoramaToRadiance(mode) {
  if(mode==='night') return blackRadianceFile();
  if(cache.has(mode)) return cache.get(mode);

  const b64=mode==='sunset'?SUNSET_ENV_WEBP_B64:DAY_ENV_WEBP_B64;
  const bytes=bytesFromBase64(b64);
  const blob=new Blob([bytes],{type:'image/webp'});
  const bmp=await createImageBitmap(blob);
  const w=bmp.width,h=bmp.height;
  let canvas;
  if(typeof OffscreenCanvas!=='undefined') canvas=new OffscreenCanvas(w,h);
  else { canvas=document.createElement('canvas');canvas.width=w;canvas.height=h; }
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  if(!ctx) throw new Error('2D canvas unavailable for panorama linearization.');
  ctx.drawImage(bmp,0,0,w,h);
  const px=ctx.getImageData(0,0,w,h).data;
  bmp.close?.();

  // These maps are LDR source photographs, so add headroom deliberately instead of pretending the
  // JPEG/WebP values were already scene-linear HDR. Bright sun/cloud pixels receive extra headroom.
  const day=mode==='day';
  const file=radianceFileFromPixels(
    px,w,h,
    day?'fluid-v5-day-linear-m346.hdr':'fluid-v5-sunset-linear-m346.hdr',
    day?2.20:1.65,
    day?4.20:3.20
  );
  cache.set(mode,file);
  return file;
}

function ensureStatusBadge() {
  const root=document.getElementById('v5LightLab');
  if(!root) return null;
  let el=document.getElementById('v5EnvironmentStatus');
  if(!el) {
    el=document.createElement('div');
    el.id='v5EnvironmentStatus';
    el.style.cssText='margin-top:9px;padding:8px 10px;border:1px solid rgba(78,214,220,.22);border-radius:10px;background:rgba(3,17,24,.55);font:700 8px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.045em;color:#9fc5d0;overflow-wrap:anywhere';
    root.appendChild(el);
  }
  return el;
}

function paintStatus() {
  const s=window.__v5EnvironmentStatus;
  const el=ensureStatusBadge();
  if(!el) return;
  let text,color;
  if(s.online) {
    const kind=s.mode==='night'?'BLACK HDR':'LINEAR HDR PANORAMA';
    text=`ENVIRONMENT · ${String(s.mode).toUpperCase()} · ${kind} · READY`;
    color='#9dffc8';
  } else if(s.stage==='loading'||s.stage==='linearizing') {
    text=`ENVIRONMENT · ${String(s.mode).toUpperCase()} · ${s.stage==='linearizing'?'LINEARIZING…':'LOADING…'}`;
    color='#ffd890';
  } else {
    text=`ENVIRONMENT · FALLBACK · ${s.error||s.stage}`;
    color='#ffaaaa';
  }
  if(el.textContent!==text) el.textContent=text;
  if(el.style.color!==color) el.style.color=color;
}

async function applyEnvironment(mode) {
  mode=TIME_PRESETS[mode]?mode:'day';
  const mood=TIME_PRESETS[mode];
  const token=++generation;
  window.__v5EnvironmentStatus={online:false,stage:mode==='night'?'loading':'linearizing',backend:'linear-rgbe-m346',mode,error:''};
  paintStatus();
  env.intensity=mode==='night'?0.0:Math.min(0.12,mood.envIntensity);
  try {
    const file=await panoramaToRadiance(mode);
    if(token!==generation) return;
    window.__v5EnvironmentStatus.stage='loading';paintStatus();
    const status=await env.load(file);
    if(token!==generation) return;
    env.intensity=mood.envIntensity;
    env.yaw=mood.envYaw||0;
    ssfr.bindCache=null;
    window.__v5EnvironmentStatus={online:true,stage:'online',backend:'linear-rgbe-m346',mode,error:'',status};
    paintStatus();
  } catch(err) {
    if(token!==generation) return;
    env.intensity=mode==='night'?0.0:mood.envIntensity;
    window.__v5EnvironmentStatus={online:false,stage:'rejected',backend:'linear-rgbe-m346',mode,error:String(err?.message||err)};
    paintStatus();
    console.error('[Fluid V5 M3.4.6 linear environment]',err);
  }
}

window.addEventListener('fluid-v5-light-change',e=>{
  const mode=e.detail?.timeOfDay||lab.state.time||'day';
  setTimeout(()=>{void applyEnvironment(mode);},0);
});

const observer=new MutationObserver(()=>paintStatus());
const panel=document.getElementById('settingsPanel');
if(panel) observer.observe(panel,{childList:true,subtree:true});

void applyEnvironment(lab.state.time||'day');
window.__v5Environment={version:'M3.4.6',apply:applyEnvironment,backend:'linear-rgbe-m346'};
console.info('[Fluid V5 M3.4.6] supplied panoramas converted to linear Radiance HDR; black HDR Night enabled.');
