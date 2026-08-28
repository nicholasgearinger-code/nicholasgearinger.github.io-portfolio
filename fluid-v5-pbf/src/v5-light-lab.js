// Fluid V5 M3.3 unified atmosphere + pool-light controller.
// The environment, sun, water mood and caustic source move together as one time-of-day preset.

import { TIME_PRESETS, POOL_LIGHT_MODES, TIME_ORDER, POOL_LIGHT_ORDER } from './v5-light-presets.js';

const sim = window.__sim;
const ssfr = window.__ssfr;
const panel = document.getElementById('settingsPanel');
if (!sim?.dev || !ssfr?.dev || !panel) throw new Error('Fluid V5 M3.3 lighting: runtime unavailable.');

const dev = ssfr.dev;
const STORE = 'fluidV5AtmosphereM33';
const clamp = (v,a,b)=>Math.min(b,Math.max(a,Number(v)));
const state = { time:'day', poolLight:'blue', poolIntensity:1.0, rainbowSpeed:0.16 };
try {
  const saved=JSON.parse(localStorage.getItem(STORE)||'null');
  if(saved&&typeof saved==='object'){
    if(TIME_ORDER.includes(saved.time))state.time=saved.time;
    if(POOL_LIGHT_ORDER.includes(saved.poolLight))state.poolLight=saved.poolLight;
    if(Number.isFinite(saved.poolIntensity))state.poolIntensity=clamp(saved.poolIntensity,.25,1.6);
    if(Number.isFinite(saved.rainbowSpeed))state.rainbowSpeed=clamp(saved.rainbowSpeed,.03,.55);
  }
}catch{}
const save=()=>{try{localStorage.setItem(STORE,JSON.stringify(state))}catch{}};

function rgb(hex){
  const h=String(hex||'#ffffff').replace('#','').padEnd(6,'f').slice(0,6);
  return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255];
}
function hsv(h,s=1,v=1){
  h=((h%1)+1)%1;const i=Math.floor(h*6),f=h*6-i,p=v*(1-s),q=v*(1-f*s),t=v*(1-(1-f)*s);
  return [[v,t,p],[q,v,p],[p,v,t],[p,q,v],[t,p,v],[v,p,q]][i%6];
}
function norm(v){const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l]}
function sunIncident(elDeg,azDeg){
  const el=elDeg*Math.PI/180,az=azDeg*Math.PI/180,c=Math.cos(el);
  const towardSun=norm([c*Math.sin(az),Math.sin(el),c*Math.cos(az)]);
  return towardSun.map(v=>-v);
}
function currentPoolColor(now=performance.now()){
  const m=POOL_LIGHT_MODES[state.poolLight]||POOL_LIGHT_MODES.blue;
  if(!m.rainbow)return rgb(m.color);
  return hsv(now*.001*state.rainbowSpeed,0.94,1.0);
}
function packed(now=performance.now()){
  const mood=TIME_PRESETS[state.time]||TIME_PRESETS.day;
  if(state.time!=='night'){
    return {
      activeType:'sun', typeCode:0, causticType:'sun', causticCode:0,
      position:[0,0,0], direction:sunIncident(mood.sunElevation,mood.sunAzimuth),
      color:rgb(mood.sunColor), intensity:mood.sunIntensity, range:6,
      coneOuterCos:.8, coneInnerCos:.95, softness:.08, volumetric:0,
      shadow:.70, causticGain:mood.causticGain,
      waterTint:rgb(mood.waterTint), waterTintStrength:mood.waterTintStrength,
      modeCode:0, cycle:0, timeOfDay:state.time,
    };
  }
  const lm=POOL_LIGHT_MODES[state.poolLight]||POOL_LIGHT_MODES.blue;
  const col=currentPoolColor(now);
  return {
    activeType:'underwater', typeCode:3, causticType:'none', causticCode:4,
    position:[0,0,0], direction:[1,0,0], color:col,
    intensity:lm.intensity*state.poolIntensity, range:3.3,
    coneOuterCos:.48, coneInnerCos:.88, softness:.22,
    volumetric:lm.volumetric*state.poolIntensity, shadow:.62, causticGain:0,
    waterTint:lm.rainbow?col:rgb(lm.waterTint), waterTintStrength:mood.waterTintStrength*state.poolIntensity,
    modeCode:POOL_LIGHT_ORDER.indexOf(state.poolLight),
    cycle:now*.001*state.rainbowSpeed,
    timeOfDay:'night',
  };
}
window.__v5LightState=packed();

function upstreamSet(id,value){
  const el=document.getElementById(id);if(!el)return false;
  el.value=String(value);
  try{if(typeof el.oninput==='function')el.oninput();else el.dispatchEvent(new Event('input',{bubbles:true}))}catch{}
  return true;
}
function applyEngine(){
  const mood=TIME_PRESETS[state.time]||TIME_PRESETS.day;
  const P=packed();window.__v5LightState=P;
  if(ssfr.env){ssfr.env.intensity=mood.envIntensity;ssfr.env.yaw=mood.envYaw;}
  ssfr.exposure=mood.exposure;ssfr.absorption=mood.absorption;ssfr.roughness=mood.roughness;
  if(state.time==='night'){
    const lm=POOL_LIGHT_MODES[state.poolLight]||POOL_LIGHT_MODES.blue;
    ssfr.transmit=(lm.transmit||mood.transmit).slice();
  }else ssfr.transmit=mood.transmit.slice();
  ssfr.sunIntensity=Math.max(.001,mood.sunIntensity*4.8);
  ssfr.sunElevation=mood.sunElevation;ssfr.sunAzimuth=mood.sunAzimuth;
  upstreamSet('sunint',ssfr.sunIntensity);upstreamSet('sunelev',mood.sunElevation);upstreamSet('sunazim',mood.sunAzimuth);
  upstreamSet('envintensity',mood.envIntensity);upstreamSet('exposure',mood.exposure);
  upstreamSet('absorption',mood.absorption);upstreamSet('roughness',mood.roughness);
  ssfr.bindCache=null;save();
  window.dispatchEvent(new CustomEvent('fluid-v5-light-change',{detail:P}));
}
function setTime(name){if(!TIME_ORDER.includes(name))return;state.time=name;applyEngine();renderUI()}
function setPoolLight(name){if(!POOL_LIGHT_ORDER.includes(name))return;state.poolLight=name;applyEngine();renderUI()}

// ----- Unified receiver + water-surface mood pass ---------------------------------------------
window.__v5LightStatus={online:false,stage:'shader',backend:'time-of-day-m33',error:''};
const lightUni=dev.createBuffer({label:'fluidV5MoodM33Uniform',size:96,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const LF=new Float32Array(24);
const shader=`
struct Comp {
 invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f,
 boxMin:vec3f, proj00:f32, boxMax:vec3f, proj11:f32,
 absorb:vec3f, ior:f32, sunDir:vec3f, sunIntensity:f32,
 roughness:f32, exposure:f32, groundReflection:f32, thicknessScale:f32,
 bodyCount:i32, floorPlane:i32, debug:i32, hasEnvMap:i32,
 envIntensity:f32, envYaw:f32, mapScale:vec2f,
}
struct Light { meta:vec4f, color:vec4f, pos:vec4f, dir:vec4f, extra:vec4f, water:vec4f }
@group(0) @binding(0) var<uniform> C:Comp;
@group(0) @binding(1) var<uniform> L:Light;
@group(0) @binding(2) var waterZ:texture_2d<f32>;
struct V{@builtin(position)pos:vec4f,@location(0)ndc:vec2f}
struct Hit{t:f32,n:vec3f,p:vec3f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.pos=vec4f(p,0,1);o.ndc=p;return o;
}
fn hue(h:f32)->vec3f{
 let x=fract(h)*6.0;let r=clamp(abs(x-3.0)-1.0,0.0,1.0);let g=clamp(2.0-abs(x-2.0),0.0,1.0);let b=clamp(2.0-abs(x-4.0),0.0,1.0);return vec3f(r,g,b);
}
fn poolHit(o:vec3f,d:vec3f)->Hit{
 var h:Hit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.02;
 if(abs(d.y)>1e-5){let t=(lo.y-o.y)/d.y;if(t>1e-4){let p=o+d*t;if(p.x>=lo.x-pad&&p.x<=hi.x+pad&&p.z>=lo.z-pad&&p.z<=hi.z+pad){h.t=t;h.n=vec3f(0,1,0);h.p=p;}}}
 if(abs(d.x)>1e-5){var t=(lo.x-o.x)/d.x;var p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.z>=lo.z-pad&&p.z<=hi.z+pad){h.t=t;h.n=vec3f(1,0,0);h.p=p;}t=(hi.x-o.x)/d.x;p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.z>=lo.z-pad&&p.z<=hi.z+pad){h.t=t;h.n=vec3f(-1,0,0);h.p=p;}}
 if(abs(d.z)>1e-5){var t=(lo.z-o.z)/d.z;var p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.x>=lo.x-pad&&p.x<=hi.x+pad){h.t=t;h.n=vec3f(0,0,1);h.p=p;}t=(hi.z-o.z)/d.z;p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.x>=lo.x-pad&&p.x<=hi.x+pad){h.t=t;h.n=vec3f(0,0,-1);h.p=p;}}
 return h;
}
fn fixtureColor(i:f32)->vec3f{
 if(L.extra.z<2.5){return L.color.rgb;}
 return hue(L.extra.w+i*.23);
}
fn fixture(lp:vec3f,axis:vec3f,p:vec3f,n:vec3f,i:f32)->vec3f{
 let toL=lp-p;let dist=length(toL);if(dist<1e-4||dist>L.meta.z){return vec3f(0);}
 let ld=toL/dist;let fromLamp=-ld;let cone=max(dot(fromLamp,axis),0.0);let facing=max(dot(n,ld),0.0);
 let x=dist/max(L.meta.z,1e-3);let atten=(1.0-smoothstep(.72,1.0,x))/(1.0+1.15*x*x);
 let beam=smoothstep(.18,.86,cone);let col=fixtureColor(i);
 return col*L.meta.y*(.18+.82*pow(facing,.72))*atten*beam*.48;
}
fn nightLights(p:vec3f,n:vec3f)->vec3f{
 let lo=C.boxMin;let hi=C.boxMax;let y=lo.y+(hi.y-lo.y)*.17;let z0=mix(lo.z,hi.z,.27);let z1=mix(lo.z,hi.z,.73);
 var c=vec3f(0);
 c+=fixture(vec3f(lo.x+.025,y,z0),vec3f(1,0,0),p,n,0.0);
 c+=fixture(vec3f(lo.x+.025,y,z1),vec3f(1,0,0),p,n,1.0);
 c+=fixture(vec3f(hi.x-.025,y,z0),vec3f(-1,0,0),p,n,2.0);
 c+=fixture(vec3f(hi.x-.025,y,z1),vec3f(-1,0,0),p,n,3.0);
 return c;
}
fn localLight(p:vec3f,n:vec3f)->vec3f{
 let typ=i32(L.meta.x+.5);
 if(typ==0){let toLight=-normalize(L.dir.xyz);let ndl=max(dot(n,toLight),0.0);let wall=1.0-max(n.y,0.0);return L.color.rgb*L.meta.y*(.08+.34*ndl+.06*wall);}
 if(typ==3){return nightLights(p,n);}
 return vec3f(0);
}
fn rayBeam(ro:vec3f,rd:vec3f,lp:vec3f,axis:vec3f,i:f32)->vec3f{
 let toO=ro-lp;let a=dot(rd,rd);let b=dot(rd,axis);let c=dot(axis,axis);let e=dot(rd,toO);let f=dot(axis,toO);let den=max(a*c-b*b,1e-4);
 let t=max(0.0,(b*f-c*e)/den);let s=max(0.0,(a*f-b*e)/den);if(s>L.meta.z){return vec3f(0);}
 let q=ro+rd*t;let r=lp+axis*s;let d=length(q-r);let width=.045+s*.11;let core=exp(-d*d/max(width*width,1e-4));let halo=exp(-d*d/max(width*width*5.0,1e-4))*.20;
 return fixtureColor(i)*(core+halo)*(1.0-s/L.meta.z)*L.extra.x*L.meta.y*.10;
}
fn nightBeams(ro:vec3f,rd:vec3f)->vec3f{
 if(i32(L.meta.x+.5)!=3||L.extra.x<=.001){return vec3f(0);}
 let lo=C.boxMin;let hi=C.boxMax;let y=lo.y+(hi.y-lo.y)*.17;let z0=mix(lo.z,hi.z,.27);let z1=mix(lo.z,hi.z,.73);
 var c=vec3f(0);
 c+=rayBeam(ro,rd,vec3f(lo.x+.025,y,z0),vec3f(1,0,0),0.0);
 c+=rayBeam(ro,rd,vec3f(lo.x+.025,y,z1),vec3f(1,0,0),1.0);
 c+=rayBeam(ro,rd,vec3f(hi.x-.025,y,z0),vec3f(-1,0,0),2.0);
 c+=rayBeam(ro,rd,vec3f(hi.x-.025,y,z1),vec3f(-1,0,0),3.0);
 return c;
}
fn waterMood(ndc:vec2f,rd:vec3f)->vec3f{
 let dim=vec2i(textureDimensions(waterZ,0));let uv=vec2f(ndc.x*.5+.5,.5-ndc.y*.5);
 let fp=clamp(uv*vec2f(dim),vec2f(0),vec2f(dim)-vec2f(1));let p=vec2i(fp);let z=textureLoad(waterZ,p,0).r;if(z<-1e3){return vec3f(0);}
 let px=vec2i(min(p.x+1,dim.x-1),p.y);let mx=vec2i(max(p.x-1,0),p.y);let py=vec2i(p.x,min(p.y+1,dim.y-1));let my=vec2i(p.x,max(p.y-1,0));
 let zx=textureLoad(waterZ,px,0).r;let zmx=textureLoad(waterZ,mx,0).r;let zy=textureLoad(waterZ,py,0).r;let zmy=textureLoad(waterZ,my,0).r;
 let gx=select(0.0,abs(zx-zmx),zx>-1e3&&zmx>-1e3);let gy=select(0.0,abs(zy-zmy),zy>-1e3&&zmy>-1e3);let ripple=smoothstep(.002,.055,gx+gy);
 let fres=pow(1.0-clamp(abs(rd.y),0.0,1.0),2.4);var tint=L.water.rgb;if(L.extra.z>2.5){tint=hue(L.extra.w+uv.x*.42+uv.y*.16);}
 let gain=L.water.w*(.030+.145*fres+.075*ripple);return tint*gain;
}
@fragment fn fs(v:V)->@location(0)vec4f{
 let a=C.invViewProj*vec4f(v.ndc,-1,1);let b=C.invViewProj*vec4f(v.ndc,1,1);let ro=a.xyz/a.w;let rd=normalize(b.xyz/b.w-ro);
 var c=nightBeams(ro,rd)+waterMood(v.ndc,rd);let h=poolHit(ro,rd);if(h.t<1e29){c+=localLight(h.p,h.n);}return vec4f(c,0);
}`;
try{
  const mod=dev.createShaderModule({code:shader,label:'fluidV5MoodM33WGSL'});
  if(typeof mod.getCompilationInfo==='function'){
    const info=await mod.getCompilationInfo();const bad=(info.messages||[]).filter(m=>m.type==='error');
    if(bad.length)throw new Error(bad.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
  }
  window.__v5LightStatus.stage='pipeline';
  const pipe=await dev.createRenderPipelineAsync({label:'fluidV5MoodM33Overlay',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format:ssfr.format,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
  let cache=null;
  function finalEyeIndex(){return ssfr.cleanupPass&&ssfr.filterIterations>0?1:0}
  function bg(){
    const idx=finalEyeIndex(),key=`${ssfr.gen||0}|${idx}`;if(cache?.key===key)return cache.bg;
    const g=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ssfr.compUni}},{binding:1,resource:{buffer:lightUni}},{binding:2,resource:ssfr.views.eyeZ[idx]}]});cache={key,bg:g};return g;
  }
  const baseRender=ssfr.render;
  ssfr.render=function(...args){
    const out=baseRender.apply(this,args);const enc=args[0],target=args[1];const P=packed();window.__v5LightState=P;
    if(state.time==='night'&&state.poolLight==='rainbow'){
      const c=currentPoolColor();this.transmit=[.34+.46*c[0],.34+.46*c[1],.34+.46*c[2]];
    }
    LF[0]=P.typeCode;LF[1]=P.intensity;LF[2]=P.range;LF[3]=P.coneOuterCos;
    LF[4]=P.color[0];LF[5]=P.color[1];LF[6]=P.color[2];LF[7]=P.softness;
    LF[8]=P.position[0];LF[9]=P.position[1];LF[10]=P.position[2];LF[11]=P.volumetric;
    LF[12]=P.direction[0];LF[13]=P.direction[1];LF[14]=P.direction[2];LF[15]=P.coneInnerCos;
    LF[16]=P.volumetric;LF[17]=P.shadow;LF[18]=P.modeCode;LF[19]=P.cycle;
    LF[20]=P.waterTint[0];LF[21]=P.waterTint[1];LF[22]=P.waterTint[2];LF[23]=P.waterTintStrength;
    dev.queue.writeBuffer(lightUni,0,LF);
    try{const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,bg());pass.draw(3);pass.end();}
    catch(err){window.__v5LightStatus.stage='frame-error';window.__v5LightStatus.error=String(err?.message||err)}
    return out;
  };
  window.__v5LightStatus={online:true,stage:'online',backend:'time-of-day-m33',error:''};
}catch(err){
  window.__v5LightStatus={online:false,stage:'rejected',backend:'time-of-day-m33',error:String(err?.message||err)};
  console.warn('[Fluid V5 M3.3] atmosphere/water overlay rejected; base renderer remains active.',err);
}

// ----- Simplified UI ---------------------------------------------------------------------------
const root=document.createElement('div');root.id='v5LightLab';root.className='v5LightLab';
const style=document.createElement('style');style.textContent=`
.v5LightLab{margin-top:8px;padding-top:7px}.v5MoodTitle{font:800 8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:#9dffc8;margin-bottom:6px}.v5MoodDesc{font-size:7.4px;line-height:1.5;color:#93b4c0;margin:0 0 9px}.v5MoodSub{margin:9px 0 6px;font:800 7px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.10em;color:#82e7ed}.v5MoodGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}.v5MoodGrid.four{grid-template-columns:repeat(4,1fr)}.v5MoodBtn{appearance:none;min-height:34px;border:1px solid rgba(78,214,220,.30);background:rgba(4,17,24,.78);color:#b9d5de;border-radius:8px;padding:7px 4px;font:800 7px ui-monospace,SFMono-Regular,Menlo,monospace}.v5MoodBtn.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.46)}.v5MoodRow{display:grid;grid-template-columns:86px 1fr 45px;align-items:center;gap:6px;margin:7px 0}.v5MoodRow label{font:700 6.8px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9db9c4}.v5MoodRow input{width:100%;accent-color:#49d6dc}.v5MoodVal{text-align:right;font:700 6.8px ui-monospace,SFMono-Regular,Menlo,monospace;color:#d8f6fb}.v5MoodNote{margin-top:9px;padding:8px 9px;border:1px solid rgba(78,214,220,.16);border-radius:8px;background:rgba(4,17,24,.55);font-size:7.1px;line-height:1.45;color:#9bb9c4}.v5MoodNight{margin-top:4px}@media(max-width:600px){.v5MoodGrid.four{grid-template-columns:repeat(2,1fr)}.v5MoodRow{grid-template-columns:78px 1fr 40px}.v5MoodBtn{min-height:38px}}
`;document.head.appendChild(style);panel.appendChild(root);
function slider(label,key,min,max,step,fmt=v=>Number(v).toFixed(2)){
  const w=document.createElement('div');w.className='v5MoodRow';const l=document.createElement('label');l.textContent=label;const i=document.createElement('input');i.type='range';i.min=min;i.max=max;i.step=step;i.value=state[key];const o=document.createElement('span');o.className='v5MoodVal';o.textContent=fmt(state[key]);i.oninput=()=>{state[key]=Number(i.value);o.textContent=fmt(state[key]);applyEngine()};w.append(l,i,o);return w;
}
function renderUI(){
  root.innerHTML='';const title=document.createElement('div');title.className='v5MoodTitle';title.textContent='ATMOSPHERE + POOL LIGHTS · M3.3';root.appendChild(title);
  const desc=document.createElement('p');desc.className='v5MoodDesc';desc.textContent='Choose a time of day. The sky/environment, sun, exposure, water color and caustics change together. At night, wall-mounted pool lights become the primary illumination.';root.appendChild(desc);
  const sub=document.createElement('div');sub.className='v5MoodSub';sub.textContent='TIME OF DAY';root.appendChild(sub);
  const times=document.createElement('div');times.className='v5MoodGrid';for(const k of TIME_ORDER){const b=document.createElement('button');b.className='v5MoodBtn'+(state.time===k?' active':'');b.textContent=TIME_PRESETS[k].label;b.onclick=e=>{e.preventDefault();e.stopPropagation();setTime(k)};times.appendChild(b)}root.appendChild(times);
  if(state.time==='night'){
    const night=document.createElement('div');night.className='v5MoodNight';const s=document.createElement('div');s.className='v5MoodSub';s.textContent='POOL LIGHT COLOR';night.appendChild(s);
    const modes=document.createElement('div');modes.className='v5MoodGrid four';for(const k of POOL_LIGHT_ORDER){const b=document.createElement('button');b.className='v5MoodBtn'+(state.poolLight===k?' active':'');b.textContent=POOL_LIGHT_MODES[k].label;b.onclick=e=>{e.preventDefault();e.stopPropagation();setPoolLight(k)};modes.appendChild(b)}night.appendChild(modes);
    night.appendChild(slider('LIGHT POWER','poolIntensity',.25,1.6,.02,v=>Number(v).toFixed(2)));
    if(state.poolLight==='rainbow')night.appendChild(slider('CYCLE SPEED','rainbowSpeed',.03,.55,.01,v=>Number(v).toFixed(2)));
    root.appendChild(night);
  }
  const note=document.createElement('div');note.className='v5MoodNote';note.textContent=TIME_PRESETS[state.time].description+(state.time==='night'?' Four underwater fixtures on the pool side walls illuminate the tiles, volumetric water and the visible water surface. Rainbow assigns a different moving hue to each fixture.':'');root.appendChild(note);
}

window.__v5LightLab={version:'M3.3',state,setTime,setPoolLight,getPackedState:packed,apply:applyEngine};
applyEngine();renderUI();
console.info('[Fluid V5 M3.3] unified time-of-day and pool-light mood system enabled.');
