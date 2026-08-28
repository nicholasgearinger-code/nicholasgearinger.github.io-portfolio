// Fluid V5 M3.2 Multi-Light Lab.
// Each preset now has a deliberately distinctive receiver-light response. Sun/Spot/Point may
// drive atomic caustics; underwater and skylight remain direct/ambient sources.

import { LIGHT_TYPES, LIGHT_PRESETS, ENV_PRESETS, clonePreset } from './v5-light-presets.js';

const sim = window.__sim;
const ssfr = window.__ssfr;
const panel = document.getElementById('settingsPanel');
if (!sim?.dev || !ssfr?.dev || !panel) throw new Error('Fluid V5 light lab: runtime unavailable.');

const dev = ssfr.dev;
const STORE = 'fluidV5LightLabM32';
const clamp = (v,a,b)=>Math.min(b,Math.max(a,Number(v)));
const copy = v=>JSON.parse(JSON.stringify(v));
const defaultRigs = {
  sun: clonePreset('noon'),
  spot: clonePreset('spot'),
  point: clonePreset('bulb'),
  underwater: clonePreset('poolBlue'),
  skylight: clonePreset('overcast'),
};
const state = {
  activeType:'sun', preset:'noon', envPreset:'bright', causticEnabled:true,
  rigs:copy(defaultRigs), shadow:0.70,
};
try {
  const saved=JSON.parse(localStorage.getItem(STORE)||'null');
  if(saved&&typeof saved==='object'){
    if(LIGHT_TYPES.includes(saved.activeType))state.activeType=saved.activeType;
    if(saved.preset&&LIGHT_PRESETS[saved.preset])state.preset=saved.preset;
    if(saved.envPreset&&ENV_PRESETS[saved.envPreset])state.envPreset=saved.envPreset;
    if(saved.rigs&&typeof saved.rigs==='object')state.rigs={...state.rigs,...saved.rigs};
    if(typeof saved.causticEnabled==='boolean')state.causticEnabled=saved.causticEnabled;
    if(Number.isFinite(saved.shadow))state.shadow=clamp(saved.shadow,0,1);
  }
}catch{}
const save=()=>{try{localStorage.setItem(STORE,JSON.stringify(state))}catch{}};

function rgb(hex){
  const h=String(hex||'#ffffff').replace('#','').padEnd(6,'f').slice(0,6);
  return [parseInt(h.slice(0,2),16)/255,parseInt(h.slice(2,4),16)/255,parseInt(h.slice(4,6),16)/255];
}
function norm(v){const l=Math.hypot(v[0],v[1],v[2])||1;return [v[0]/l,v[1]/l,v[2]/l]}
function sunToward(elDeg,azDeg){
  const el=elDeg*Math.PI/180,az=azDeg*Math.PI/180,c=Math.cos(el);
  return norm([c*Math.sin(az),Math.sin(el),c*Math.cos(az)]);
}
function beamDir(azDeg,downDeg){
  const el=downDeg*Math.PI/180,az=azDeg*Math.PI/180,c=Math.cos(el);
  return norm([c*Math.sin(az),-Math.sin(el),c*Math.cos(az)]);
}
function worldPos(p){
  const b=sim.params?.box||[1.9,2.5,1.25];
  return [clamp(p?.[0]??.5,-.1,1.1)*b[0],clamp(p?.[1]??.8,-.1,1.15)*b[1],clamp(p?.[2]??.5,-.1,1.1)*b[2]];
}
function supportedCaustic(type){return type==='sun'||type==='spot'||type==='point'}
function packed(){
  const type=state.activeType, r=state.rigs[type]||state.rigs.sun;
  const col=rgb(r.color);
  let dir=[0,-1,0];
  if(type==='sun'){const toward=sunToward(r.elevation??55,r.azimuth??40);dir=toward.map(v=>-v)}
  else if(type==='spot'||type==='underwater')dir=beamDir(r.azimuth??0,r.elevation??70);
  const pos=worldPos(r.position||[.5,.9,.5]);
  const cone=clamp(r.cone??40,4,86),soft=clamp(r.softness??.2,.01,.95);
  const inner=Math.max(2,cone*(1-soft*.72));
  return {
    activeType:type,
    typeCode:{sun:0,spot:1,point:2,underwater:3,skylight:4}[type]??4,
    causticType:state.causticEnabled&&supportedCaustic(type)?type:'none',
    causticCode:state.causticEnabled?({sun:0,spot:1,point:2}[type]??4):4,
    position:pos, direction:dir, color:col,
    intensity:clamp(r.intensity??1,0,2.5), range:clamp(r.range??3.2,.25,8),
    cone, coneOuterCos:Math.cos(cone*Math.PI/180), coneInnerCos:Math.cos(inner*Math.PI/180),
    softness:soft, volumetric:clamp(r.volumetric??0,0,1.5), shadow:state.shadow,
    causticGain:clamp(r.causticGain??1,0,2), character:r.character||'custom',
    envPreset:state.envPreset,
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
  const P=packed(),r=state.rigs[state.activeType],env=ENV_PRESETS[state.envPreset]||ENV_PRESETS.bright;
  window.__v5LightState=P;
  if(ssfr.env){ssfr.env.intensity=env.intensity;ssfr.env.yaw=env.yaw;}
  if(state.activeType==='sun'){
    upstreamSet('sunint',Math.max(.08,P.intensity*4.8));
    upstreamSet('sunelev',r.elevation??55);upstreamSet('sunazim',r.azimuth??40);
  }else if(state.activeType==='skylight'){
    upstreamSet('sunint',0.035);
  }else{
    // Local rigs define the scene; retain only a tiny inherited PBR fill.
    upstreamSet('sunint',0.055);
  }
  upstreamSet('envintensity',env.intensity);
  ssfr.bindCache=null;save();
  window.dispatchEvent(new CustomEvent('fluid-v5-light-change',{detail:P}));
}

function applyPreset(name){
  const p=LIGHT_PRESETS[name];if(!p)return;
  state.preset=name;state.activeType=p.type;state.envPreset=p.envPreset||state.envPreset;
  state.rigs[p.type]={...state.rigs[p.type],...copy(p)};
  state.causticEnabled=!!p.caustic&&supportedCaustic(p.type);
  applyEngine();renderUI();
}
function setType(type){
  if(!LIGHT_TYPES.includes(type))return;
  state.activeType=type;state.causticEnabled=supportedCaustic(type);state.preset='custom';
  applyEngine();renderUI();
}
function setEnv(name){if(!ENV_PRESETS[name])return;state.envPreset=name;state.preset='custom';applyEngine();renderUI()}

// ----- Mobile-safe additive receiver-light pass -----------------------------------------------
window.__v5LightStatus={online:false,stage:'shader',error:''};
const lightUni=dev.createBuffer({label:'fluidV5MultiLightM32Uniform',size:80,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const LF=new Float32Array(20);
const shader=`
struct Comp {
 invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f,
 boxMin:vec3f, proj00:f32, boxMax:vec3f, proj11:f32,
 absorb:vec3f, ior:f32, sunDir:vec3f, sunIntensity:f32,
 roughness:f32, exposure:f32, groundReflection:f32, thicknessScale:f32,
 bodyCount:i32, floorPlane:i32, debug:i32, hasEnvMap:i32,
 envIntensity:f32, envYaw:f32, mapScale:vec2f,
}
struct Light { meta:vec4f, color:vec4f, pos:vec4f, dir:vec4f, extra:vec4f }
@group(0) @binding(0) var<uniform> C:Comp;
@group(0) @binding(1) var<uniform> L:Light;
struct V{@builtin(position)pos:vec4f,@location(0)ndc:vec2f}
struct Hit{t:f32,n:vec3f,p:vec3f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.pos=vec4f(p,0,1);o.ndc=p;return o;
}
fn poolHit(o:vec3f,d:vec3f)->Hit{
 var h:Hit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.02;
 if(abs(d.y)>1e-5){let t=(lo.y-o.y)/d.y;if(t>1e-4){let p=o+d*t;if(p.x>=lo.x-pad&&p.x<=hi.x+pad&&p.z>=lo.z-pad&&p.z<=hi.z+pad){h.t=t;h.n=vec3f(0,1,0);h.p=p;}}}
 if(abs(d.x)>1e-5){var t=(lo.x-o.x)/d.x;var p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.z>=lo.z-pad&&p.z<=hi.z+pad){h.t=t;h.n=vec3f(1,0,0);h.p=p;}t=(hi.x-o.x)/d.x;p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.z>=lo.z-pad&&p.z<=hi.z+pad){h.t=t;h.n=vec3f(-1,0,0);h.p=p;}}
 if(abs(d.z)>1e-5){var t=(lo.z-o.z)/d.z;var p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.x>=lo.x-pad&&p.x<=hi.x+pad){h.t=t;h.n=vec3f(0,0,1);h.p=p;}t=(hi.z-o.z)/d.z;p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.x>=lo.x-pad&&p.x<=hi.x+pad){h.t=t;h.n=vec3f(0,0,-1);h.p=p;}}
 return h;
}
fn localLight(p:vec3f,n:vec3f)->vec3f{
 let typ=i32(L.meta.x+.5);let power=max(L.meta.y,0.0);let col=L.color.rgb;
 if(typ==0){
  let toLight=-normalize(L.dir.xyz);let ndl=max(dot(n,toLight),0.0);
  let wall=1.0-max(n.y,0.0);let shape=.10+.31*ndl+.055*wall;
  return col*power*shape;
 }
 if(typ==4){
  let up=max(n.y,0.0);let hemi=.34+.66*up;
  return col*power*(.055+.105*hemi);
 }
 let toL=L.pos.xyz-p;let dist=length(toL);if(dist<1e-4||dist>L.meta.z){return vec3f(0);}
 let ld=toL/dist;let ndl=max(dot(n,ld),0.0);let x=dist/max(L.meta.z,1e-3);var atten=(1.0-smoothstep(.72,1.0,x))/(1.0+1.5*x*x);
 if(typ==1||typ==3){let fromLamp=-ld;let cone=dot(fromLamp,normalize(L.dir.xyz));atten*=smoothstep(L.meta.w,L.dir.w,cone);}
 let waterLoss=select(1.0,exp(-dist*.28),typ==3);
 let localGain=select(.34,.64,typ==3);
 let hotspot=pow(max(ndl,0.0),select(1.15,.78,typ==3));
 return col*(power*(.18*ndl+.82*hotspot)*atten*waterLoss*localGain);
}
fn beam(ro:vec3f,rd:vec3f)->vec3f{
 let typ=i32(L.meta.x+.5);if((typ!=1&&typ!=3)||L.extra.x<=.001){return vec3f(0);}
 let d=normalize(L.dir.xyz);let toO=ro-L.pos.xyz;let a=dot(rd,rd);let b=dot(rd,d);let c=dot(d,d);let e=dot(rd,toO);let f=dot(d,toO);let den=max(a*c-b*b,1e-4);
 let t=max(0.0,(b*f-c*e)/den);let s=max(0.0,(a*f-b*e)/den);if(s>L.meta.z){return vec3f(0);}
 let q=ro+rd*t;let r=L.pos.xyz+d*s;let dist=length(q-r);let width=.035+s*tan(acos(clamp(L.meta.w,-.99,.99)))*.38;
 let beamGain=select(.095,.19,typ==3);
 let core=exp(-dist*dist/max(width*width,1e-4));let halo=exp(-dist*dist/max(width*width*4.0,1e-4))*.22;
 let glow=(core+halo)*(1.0-s/L.meta.z)*L.extra.x*L.meta.y*beamGain;
 return L.color.rgb*glow;
}
@fragment fn fs(v:V)->@location(0)vec4f{
 let a=C.invViewProj*vec4f(v.ndc,-1,1);let b=C.invViewProj*vec4f(v.ndc,1,1);let ro=a.xyz/a.w;let rd=normalize(b.xyz/b.w-ro);
 var c=beam(ro,rd);let h=poolHit(ro,rd);if(h.t<1e29){c+=localLight(h.p,h.n);}return vec4f(c,0);
}`;
try{
  const mod=dev.createShaderModule({code:shader,label:'fluidV5MultiLightM32WGSL'});
  if(typeof mod.getCompilationInfo==='function'){
    const info=await mod.getCompilationInfo();const bad=(info.messages||[]).filter(m=>m.type==='error');
    if(bad.length)throw new Error(bad.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
  }
  window.__v5LightStatus.stage='pipeline';
  const pipe=await dev.createRenderPipelineAsync({label:'fluidV5MultiLightM32Overlay',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format:ssfr.format,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
  let cache=null;
  const bg=()=>{if(cache?.comp===ssfr.compUni)return cache.bg;const g=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ssfr.compUni}},{binding:1,resource:{buffer:lightUni}}]});cache={comp:ssfr.compUni,bg:g};return g};
  const baseRender=ssfr.render;
  ssfr.render=function(...args){
    const out=baseRender.apply(this,args);const enc=args[0],target=args[1];const P=packed();
    LF[0]=P.typeCode;LF[1]=P.intensity;LF[2]=P.range;LF[3]=P.coneOuterCos;
    LF[4]=P.color[0];LF[5]=P.color[1];LF[6]=P.color[2];LF[7]=P.softness;
    LF[8]=P.position[0];LF[9]=P.position[1];LF[10]=P.position[2];LF[11]=P.volumetric;
    LF[12]=P.direction[0];LF[13]=P.direction[1];LF[14]=P.direction[2];LF[15]=P.coneInnerCos;
    LF[16]=P.volumetric;LF[17]=P.shadow;LF[18]=0;LF[19]=0;dev.queue.writeBuffer(lightUni,0,LF);
    try{const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,bg());pass.draw(3);pass.end();}catch(err){window.__v5LightStatus.stage='frame-error';window.__v5LightStatus.error=String(err?.message||err)}
    return out;
  };
  window.__v5LightStatus={online:true,stage:'online',backend:'receiver-character-m32',error:''};
}catch(err){window.__v5LightStatus={online:false,stage:'rejected',backend:'receiver-character-m32',error:String(err?.message||err)};console.warn('[Fluid V5 Light Lab M3.2] receiver-light overlay rejected; controls/base lighting remain active.',err)}

// ----- UI --------------------------------------------------------------------------------------
const root=document.createElement('div');root.id='v5LightLab';root.className='v5LightLab';
const style=document.createElement('style');style.textContent=`
.v5LightLab{margin-top:8px;padding-top:7px}.v5LightHead{display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:7px}.v5LightTitle{font:800 8px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;color:#9dffc8}.v5LightBadge{font:700 6.8px ui-monospace,SFMono-Regular,Menlo,monospace;color:#8ec7d4}.v5LightDesc{font-size:7.3px;line-height:1.45;color:#8faeba;margin:0 0 8px}.v5LightGrid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;margin-bottom:8px}.v5LightBtn{appearance:none;border:1px solid rgba(78,214,220,.3);background:rgba(4,17,24,.78);color:#b9d5de;border-radius:8px;padding:7px 4px;font:800 7px ui-monospace,SFMono-Regular,Menlo,monospace}.v5LightBtn.active{border-color:#f1ad43;color:#ffd890;background:rgba(77,54,17,.46)}.v5LightRow{display:grid;grid-template-columns:86px 1fr 45px;align-items:center;gap:6px;margin:6px 0}.v5LightRow label{font:700 6.8px ui-monospace,SFMono-Regular,Menlo,monospace;color:#9db9c4}.v5LightRow input[type=range]{width:100%;accent-color:#49d6dc}.v5LightVal{text-align:right;font:700 6.8px ui-monospace,SFMono-Regular,Menlo,monospace;color:#d8f6fb}.v5LightSelect{width:100%;background:#06151d;color:#d8f6fb;border:1px solid rgba(78,214,220,.28);border-radius:8px;padding:7px;font:700 7px ui-monospace,SFMono-Regular,Menlo,monospace}.v5LightColor{width:44px;height:28px;padding:1px;border:1px solid rgba(78,214,220,.3);border-radius:7px;background:#06151d}.v5LightNote{margin-top:7px;padding:7px 8px;border:1px solid rgba(78,214,220,.16);border-radius:8px;background:rgba(4,17,24,.55);font-size:7px;line-height:1.4;color:#8faeba}.v5LightWide{width:100%;margin-top:7px}.v5LightSub{margin:10px 0 5px;font:800 7px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;color:#82e7ed}@media(max-width:600px){.v5LightGrid{grid-template-columns:repeat(2,1fr)}.v5LightRow{grid-template-columns:78px 1fr 40px}}
`;document.head.appendChild(style);panel.appendChild(root);

function row(label,obj,key,min,max,step,fmt=v=>Number(v).toFixed(step<.1?2:1)){
  const wrap=document.createElement('div');wrap.className='v5LightRow';const l=document.createElement('label');l.textContent=label;const input=document.createElement('input');input.type='range';input.min=min;input.max=max;input.step=step;input.value=obj[key];const out=document.createElement('span');out.className='v5LightVal';out.textContent=fmt(obj[key]);input.oninput=()=>{obj[key]=Number(input.value);state.preset='custom';out.textContent=fmt(obj[key]);applyEngine()};wrap.append(l,input,out);return wrap;
}
function positionRows(host,r){
  const pos=r.position||(r.position=[.5,.8,.5]);host.append(row('POSITION X',pos,0,.03,.97,.01,v=>Number(v).toFixed(2)));host.append(row('HEIGHT',pos,1,.04,1.08,.01,v=>Number(v).toFixed(2)));host.append(row('POSITION Z',pos,2,.03,.97,.01,v=>Number(v).toFixed(2)));
}
function renderUI(){
  const P=packed(),r=state.rigs[state.activeType];root.innerHTML='';
  const head=document.createElement('div');head.className='v5LightHead';head.innerHTML=`<div class="v5LightTitle">MULTI-LIGHT LAB · M3.2</div><div class="v5LightBadge">${P.activeType.toUpperCase()}</div>`;root.appendChild(head);
  const desc=document.createElement('p');desc.className='v5LightDesc';desc.textContent='Each preset now changes the actual pool receiver lighting, beam geometry, color and caustic response—not only the environment background. Sun, spot and point can drive atomic caustics; underwater and skylight remain direct/ambient sources.';root.appendChild(desc);
  const types=document.createElement('div');types.className='v5LightGrid';for(const t of LIGHT_TYPES){const b=document.createElement('button');b.className='v5LightBtn'+(t===state.activeType?' active':'');b.textContent=t.toUpperCase();b.onclick=e=>{e.preventDefault();e.stopPropagation();setType(t)};types.appendChild(b)}root.appendChild(types);
  const sub1=document.createElement('div');sub1.className='v5LightSub';sub1.textContent='PRESET';root.appendChild(sub1);
  const sel=document.createElement('select');sel.className='v5LightSelect';const custom=document.createElement('option');custom.value='custom';custom.textContent='CUSTOM';sel.appendChild(custom);for(const [k,p] of Object.entries(LIGHT_PRESETS)){const o=document.createElement('option');o.value=k;o.textContent=p.label;sel.appendChild(o)}sel.value=LIGHT_PRESETS[state.preset]?state.preset:'custom';sel.onchange=()=>{if(sel.value!=='custom')applyPreset(sel.value)};root.appendChild(sel);
  const sub2=document.createElement('div');sub2.className='v5LightSub';sub2.textContent='LIGHT PARAMETERS';root.appendChild(sub2);
  root.append(row('INTENSITY',r,'intensity',0,2.5,.02,v=>Number(v).toFixed(2)));
  const colorWrap=document.createElement('div');colorWrap.className='v5LightRow';const cl=document.createElement('label');cl.textContent='COLOR';const ci=document.createElement('input');ci.type='color';ci.className='v5LightColor';ci.value=r.color||'#ffffff';const cv=document.createElement('span');cv.className='v5LightVal';cv.textContent=(r.color||'#ffffff').toUpperCase();ci.oninput=()=>{r.color=ci.value;cv.textContent=ci.value.toUpperCase();state.preset='custom';applyEngine()};colorWrap.append(cl,ci,cv);root.appendChild(colorWrap);
  if(state.activeType==='sun'){root.append(row('ELEVATION',r,'elevation',8,82,1,v=>`${Math.round(v)}°`));root.append(row('AZIMUTH',r,'azimuth',0,360,1,v=>`${Math.round(v)}°`));root.append(row('SOFTNESS',r,'softness',.01,.5,.01,v=>Number(v).toFixed(2)))}
  if(state.activeType==='spot'){positionRows(root,r);root.append(row('AIM AZIMUTH',r,'azimuth',0,360,1,v=>`${Math.round(v)}°`));root.append(row('AIM DOWN',r,'elevation',5,90,1,v=>`${Math.round(v)}°`));root.append(row('CONE',r,'cone',6,68,1,v=>`${Math.round(v)}°`));root.append(row('EDGE SOFT',r,'softness',.02,.8,.01,v=>Number(v).toFixed(2)));root.append(row('RANGE',r,'range',.6,6,.05,v=>Number(v).toFixed(2)))}
  if(state.activeType==='point'){positionRows(root,r);root.append(row('RANGE',r,'range',.6,6,.05,v=>Number(v).toFixed(2)))}
  if(state.activeType==='underwater'){positionRows(root,r);root.append(row('AIM AZIMUTH',r,'azimuth',0,360,1,v=>`${Math.round(v)}°`));root.append(row('AIM DOWN',r,'elevation',0,70,1,v=>`${Math.round(v)}°`));root.append(row('BEAM SPREAD',r,'cone',10,80,1,v=>`${Math.round(v)}°`));root.append(row('EDGE SOFT',r,'softness',.04,.9,.01,v=>Number(v).toFixed(2)));root.append(row('RANGE',r,'range',.6,6,.05,v=>Number(v).toFixed(2)));root.append(row('VOLUMETRIC',r,'volumetric',0,1.4,.02,v=>Number(v).toFixed(2)))}
  if(state.activeType==='skylight')root.append(row('SOFTNESS',r,'softness',.2,1,.01,v=>Number(v).toFixed(2)));
  const sub3=document.createElement('div');sub3.className='v5LightSub';sub3.textContent='ENVIRONMENT';root.appendChild(sub3);
  const envSel=document.createElement('select');envSel.className='v5LightSelect';for(const [k,e] of Object.entries(ENV_PRESETS)){const o=document.createElement('option');o.value=k;o.textContent=e.label;envSel.appendChild(o)}envSel.value=state.envPreset;envSel.onchange=()=>setEnv(envSel.value);root.appendChild(envSel);
  const ca=document.createElement('button');ca.className='v5LightBtn v5LightWide'+(P.causticType!=='none'?' active':'');ca.disabled=!supportedCaustic(state.activeType);ca.textContent=supportedCaustic(state.activeType)?`ATOMIC CAUSTIC SOURCE: ${state.causticEnabled?'ON':'OFF'}`:'ATOMIC CAUSTICS: NOT APPLICABLE';ca.onclick=e=>{e.preventDefault();state.causticEnabled=!state.causticEnabled;state.preset='custom';applyEngine();renderUI()};root.appendChild(ca);
  const note=document.createElement('div');note.className='v5LightNote';note.textContent=state.activeType==='sun'?'Directional sunlight now strongly changes the pool itself: Noon is hard/white, Afternoon is warm/slanted, Golden Hour is orange/grazing, and Moonlight is dim blue.':state.activeType==='spot'?'Spotlights now produce a visible beam cone and localized receiver pool. Spotlight is warm and overhead; Flashlight is cooler, narrower and strongly off-axis.':state.activeType==='point'?'The overhead bulb creates a warm radial pool of light with distance falloff and localized point-source caustics.':state.activeType==='underwater'?'Submerged fixtures now produce strong colored side-lighting and visible volumetric beams. Blue, aqua and red presets are intentionally very different night looks.':'Skylight is diffuse and non-caustic. Overcast is cool/flat; Indoor Pool is brighter cyan-white ambient illumination.';root.appendChild(note);
}

window.__v5LightLab={version:'M3.2',state,applyPreset,setType,setEnv,getPackedState:packed,apply:applyEngine,supportedCaustic};
applyEngine();renderUI();
console.info('[Fluid V5 M3.2] distinctive Multi-Light Lab enabled.');
