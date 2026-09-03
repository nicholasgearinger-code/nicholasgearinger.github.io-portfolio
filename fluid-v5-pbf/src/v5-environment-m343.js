// Fluid V5 M3.5 true-HDR environment loader.
// Day/Sunset stream real scene-linear Radiance HDRIs from Poly Haven (CC0), with an adaptive
// source tier for iPhone/desktop. The upstream Environment class converts those panoramas into
// an rgba16float cube with a full mip chain. Night stays a literal black Radiance environment.
// If the remote HDR download fails, the embedded M3.4.6 panoramas are converted to RGBE as a
// last-resort fallback so the lab still starts offline.

import { TIME_PRESETS } from './v5-light-presets.js';
import { DAY_ENV_WEBP_B64 } from './v5-env-day-asset-m345.js';
import { SUNSET_ENV_WEBP_B64 } from './v5-env-sunset-asset-m345.js';

const ssfr = window.__ssfr;
const lab = window.__v5LightLab;
const env = ssfr?.env;
if (!ssfr?.dev || !env?.load || !lab?.state) throw new Error('Fluid V5 M3.5 IBL environment: runtime unavailable.');

const dev = ssfr.dev;
const query = new URLSearchParams(location.search);
const cache = new Map();
let generation = 0;

const HDRI = {
  day: { id:'resting_place', label:'Resting Place', page:'https://polyhaven.com/a/resting_place' },
  sunset: { id:'the_sky_is_on_fire', label:'The Sky Is On Fire', page:'https://polyhaven.com/a/the_sky_is_on_fire' },
};
const RES_ORDER = ['1k','2k','4k','8k'];
const isIOS = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isMobile = isIOS || /Android|Mobile/i.test(navigator.userAgent);

function qualityName() {
  const q = query.get('quality');
  if (q === 'low' || q === 'high' || q === 'medium') return q;
  return window.__v5State?.quality || 'medium';
}
function chooseResolution() {
  const forced = query.get('iblres');
  if (RES_ORDER.includes(forced)) return forced;
  const q = qualityName();
  if (isIOS) return q === 'low' ? '2k' : '4k';
  if (isMobile) return q === 'high' ? '4k' : '2k';
  if (q === 'high') return '8k';
  if (q === 'low') return '2k';
  return '4k';
}
function lowerRes(res) {
  const i = RES_ORDER.indexOf(res);
  return i > 0 ? RES_ORDER[i - 1] : null;
}
function hdriUrl(mode,res) {
  const a = HDRI[mode];
  return `https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/${res}/${a.id}_${res}.hdr`;
}
function cubeFaceFor(res) {
  return { '1k':256, '2k':512, '4k':1024, '8k':2048 }[res] || 512;
}

window.__v5EnvironmentStatus = {
  online:false, stage:'idle', backend:'true-hdr-ibl-m35', mode:lab.state.time || 'day',
  source:'', resolution:'', cubeSize:0, fallback:false, error:'',
};

function ensureStatusBadge() {
  const root=document.getElementById('v5LightLab');
  if(!root) return null;
  let el=document.getElementById('v5EnvironmentStatus');
  if(!el){
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
  if(s.online){
    if(s.mode==='night') text='ENVIRONMENT · NIGHT · BLACK HDR · READY';
    else text=`ENVIRONMENT · ${s.mode.toUpperCase()} · TRUE HDR ${String(s.resolution).toUpperCase()} · CUBE ${s.cubeSize} · ${s.source}${s.fallback?' FALLBACK':''}`;
    color=s.fallback?'#ffd890':'#9dffc8';
  }else if(s.stage==='loading'){
    text=`ENVIRONMENT · ${String(s.mode).toUpperCase()} · LOADING ${String(s.resolution||'').toUpperCase()} HDR…`;
    color='#ffd890';
  }else{
    text=`ENVIRONMENT · FALLBACK · ${s.error||s.stage}`;
    color='#ffaaaa';
  }
  if(el.textContent!==text) el.textContent=text;
  if(el.style.color!==color) el.style.color=color;
}

function bytesFromBase64(b64){
  const bin=atob(b64),out=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)out[i]=bin.charCodeAt(i);
  return out;
}
const clamp=(x,a=0,b=255)=>Math.min(b,Math.max(a,x));
const srgbToLinear=x=>{x/=255;return x<=.04045?x/12.92:Math.pow((x+.055)/1.055,2.4)};
function toRGBE(r,g,b,out,o){
  const m=Math.max(r,g,b);
  if(!(m>1e-32)){out[o]=out[o+1]=out[o+2]=out[o+3]=0;return;}
  const e=Math.floor(Math.log2(m))+1,scale=256/Math.pow(2,e);
  out[o]=clamp(Math.floor(r*scale+.5));out[o+1]=clamp(Math.floor(g*scale+.5));out[o+2]=clamp(Math.floor(b*scale+.5));out[o+3]=clamp(e+128);
}
function makeRadiance(px,w,h,name,exposure,highlight){
  const header=new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`);
  const out=new Uint8Array(header.length+w*h*4);out.set(header,0);let o=header.length;
  for(let i=0;i<w*h;i++){
    let r=srgbToLinear(px[i*4]),g=srgbToLinear(px[i*4+1]),b=srgbToLinear(px[i*4+2]);
    const p=Math.max(r,g,b),gain=exposure*(1+highlight*Math.pow(p,3));
    toRGBE(r*gain,g*gain,b*gain,out,o);o+=4;
  }
  return new File([out],name,{type:'application/octet-stream'});
}
async function embeddedFallback(mode){
  const key=`fallback-${mode}`;if(cache.has(key))return cache.get(key);
  const b64=mode==='sunset'?SUNSET_ENV_WEBP_B64:DAY_ENV_WEBP_B64;
  const bmp=await createImageBitmap(new Blob([bytesFromBase64(b64)],{type:'image/webp'}));
  let canvas;
  if(typeof OffscreenCanvas!=='undefined')canvas=new OffscreenCanvas(bmp.width,bmp.height);
  else{canvas=document.createElement('canvas');canvas.width=bmp.width;canvas.height=bmp.height;}
  const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('2D canvas unavailable for HDR fallback.');
  ctx.drawImage(bmp,0,0);const px=ctx.getImageData(0,0,bmp.width,bmp.height).data;bmp.close?.();
  const file=makeRadiance(px,canvas.width,canvas.height,`fluid-v5-${mode}-fallback-m35.hdr`,mode==='day'?2.2:1.65,mode==='day'?4.2:3.2);
  cache.set(key,file);return file;
}
function blackHDR(){
  const key='black-hdr';if(cache.has(key))return cache.get(key);
  const w=16,h=8,header=new TextEncoder().encode(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`);
  const out=new Uint8Array(header.length+w*h*4);out.set(header,0);
  const file=new File([out],'fluid-v5-night-black-m35.hdr',{type:'application/octet-stream'});cache.set(key,file);return file;
}

async function loadRemoteWithDowngrade(mode,wanted,token){
  let res=wanted,lastErr=null;
  while(res){
    const url=hdriUrl(mode,res);
    window.__v5EnvironmentStatus={online:false,stage:'loading',backend:'true-hdr-ibl-m35',mode,source:HDRI[mode].label,resolution:res,cubeSize:cubeFaceFor(res),fallback:false,error:''};
    paintStatus();
    try{
      const status=await env.load(url);
      if(token!==generation)return null;
      return {status,res,url};
    }catch(err){
      lastErr=err;
      console.warn(`[Fluid V5 M3.5] ${mode} ${res} HDR failed; trying lower tier.`,err);
      res=lowerRes(res);
    }
  }
  throw lastErr||new Error('No HDR tier could be loaded.');
}

async function applyEnvironment(mode){
  mode=TIME_PRESETS[mode]?mode:'day';
  const mood=TIME_PRESETS[mode],token=++generation;
  env.intensity=0;
  if(mode==='night'){
    try{
      const status=await env.load(blackHDR());if(token!==generation)return;
      env.intensity=0;env.yaw=0;ssfr.bindCache=null;
      window.__v5EnvironmentStatus={online:true,stage:'online',backend:'true-hdr-ibl-m35',mode,source:'Black HDR',resolution:'16x8',cubeSize:16,fallback:false,error:'',status};
      paintStatus();
    }catch(err){
      if(token!==generation)return;
      env.intensity=0;
      window.__v5EnvironmentStatus={online:false,stage:'rejected',backend:'true-hdr-ibl-m35',mode,error:String(err?.message||err)};paintStatus();
    }
    return;
  }

  const wanted=chooseResolution();
  try{
    const loaded=await loadRemoteWithDowngrade(mode,wanted,token);if(!loaded||token!==generation)return;
    env.intensity=mood.envIntensity;env.yaw=mood.envYaw||0;ssfr.bindCache=null;
    window.__v5EnvironmentStatus={online:true,stage:'online',backend:'true-hdr-ibl-m35',mode,source:HDRI[mode].label,resolution:loaded.res,cubeSize:cubeFaceFor(loaded.res),fallback:false,error:'',status:loaded.status,url:loaded.url};
    paintStatus();
  }catch(remoteErr){
    console.warn('[Fluid V5 M3.5] true HDR unavailable; using embedded RGBE fallback.',remoteErr);
    try{
      const file=await embeddedFallback(mode);if(token!==generation)return;
      const status=await env.load(file);if(token!==generation)return;
      env.intensity=mood.envIntensity;env.yaw=mood.envYaw||0;ssfr.bindCache=null;
      window.__v5EnvironmentStatus={online:true,stage:'online',backend:'true-hdr-ibl-m35',mode,source:'Embedded panorama',resolution:'fallback',cubeSize:128,fallback:true,error:String(remoteErr?.message||remoteErr),status};
      paintStatus();
    }catch(err){
      if(token!==generation)return;
      window.__v5EnvironmentStatus={online:false,stage:'rejected',backend:'true-hdr-ibl-m35',mode,error:String(err?.message||err)};paintStatus();
      console.error('[Fluid V5 M3.5 environment]',err);
    }
  }
}

window.addEventListener('fluid-v5-light-change',e=>{
  const mode=e.detail?.timeOfDay||lab.state.time||'day';setTimeout(()=>{void applyEnvironment(mode);},0);
});
const observer=new MutationObserver(()=>paintStatus());
const panel=document.getElementById('settingsPanel');if(panel)observer.observe(panel,{childList:true,subtree:true});

void applyEnvironment(lab.state.time||'day');
window.__v5Environment={version:'M3.5',apply:applyEnvironment,backend:'true-hdr-ibl-m35',chooseResolution,assets:HDRI};
window.__v5IBLSourceInfo={isIOS,isMobile,maxTextureDimension2D:dev.limits?.maxTextureDimension2D||0,quality:qualityName()};
console.info('[Fluid V5 M3.5] true Radiance HDR environments enabled with adaptive 2K/4K/8K tiers.');
