// Fluid V5 M3.4 true night-pool lighting.
// Adds six independent underwater wall fixtures, localized colored receiver pools, visible lamp
// halos, volumetric beams and moving caustic-like shimmer. The core pass intentionally uses only
// the existing composite uniform + one tiny light uniform so it stays conservative on iPhone WebGPU.

const ssfr = window.__ssfr;
const sim = window.__sim;
const lab = window.__v5LightLab;
if (!ssfr?.dev || !sim || !lab?.getPackedState) throw new Error('Fluid V5 M3.4 night pool: runtime unavailable.');

const dev = ssfr.dev;
const clamp = (v,a,b)=>Math.min(b,Math.max(a,Number(v)));
const palettes = {
  blue:    { base:[0.035,0.34,1.00], accent:[0.46,0.08,1.00], transmit:[0.055,0.25,1.00] },
  aqua:    { base:[0.04,1.00,0.74], accent:[0.10,1.00,0.26], transmit:[0.055,1.00,0.68] },
  red:     { base:[1.00,0.055,0.035], accent:[1.00,0.03,0.58], transmit:[1.00,0.055,0.04] },
  rainbow: { base:[1.00,1.00,1.00], accent:[1.00,1.00,1.00], transmit:[0.42,0.48,0.72] },
};

window.__v5NightPoolStatus={online:false,stage:'shader',backend:'six-fixture-m34',error:''};
const uni=dev.createBuffer({label:'fluidV5NightPoolM34Uniform',size:64,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const F=new Float32Array(16);
const shader=`
struct Comp {
 invViewProj:mat4x4f, invView:mat4x4f, eye:vec4f,
 boxMin:vec3f, proj00:f32, boxMax:vec3f, proj11:f32,
 absorb:vec3f, ior:f32, sunDir:vec3f, sunIntensity:f32,
 roughness:f32, exposure:f32, groundReflection:f32, thicknessScale:f32,
 bodyCount:i32, floorPlane:i32, debug:i32, hasEnvMap:i32,
 envIntensity:f32, envYaw:f32, mapScale:vec2f,
}
struct Night { meta:vec4f, base:vec4f, accent:vec4f, extra:vec4f }
@group(0) @binding(0) var<uniform> C:Comp;
@group(0) @binding(1) var<uniform> N:Night;
struct V{@builtin(position)pos:vec4f,@location(0)ndc:vec2f}
struct Hit{t:f32,n:vec3f,p:vec3f}
@vertex fn vs(@builtin(vertex_index)i:u32)->V{
 let p=vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0;var o:V;o.pos=vec4f(p,0,1);o.ndc=p;return o;
}
fn hue(h:f32)->vec3f{
 let x=fract(h)*6.0;
 return vec3f(clamp(abs(x-3.0)-1.0,0.0,1.0),clamp(2.0-abs(x-2.0),0.0,1.0),clamp(2.0-abs(x-4.0),0.0,1.0));
}
fn poolHit(o:vec3f,d:vec3f)->Hit{
 var h:Hit;h.t=1e30;h.n=vec3f(0,1,0);h.p=vec3f(0);let lo=C.boxMin;let hi=C.boxMax;let pad=.025;
 if(abs(d.y)>1e-5){let t=(lo.y-o.y)/d.y;if(t>1e-4){let p=o+d*t;if(p.x>=lo.x-pad&&p.x<=hi.x+pad&&p.z>=lo.z-pad&&p.z<=hi.z+pad){h.t=t;h.n=vec3f(0,1,0);h.p=p;}}}
 if(abs(d.x)>1e-5){var t=(lo.x-o.x)/d.x;var p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.z>=lo.z-pad&&p.z<=hi.z+pad){h.t=t;h.n=vec3f(1,0,0);h.p=p;}t=(hi.x-o.x)/d.x;p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.z>=lo.z-pad&&p.z<=hi.z+pad){h.t=t;h.n=vec3f(-1,0,0);h.p=p;}}
 if(abs(d.z)>1e-5){var t=(lo.z-o.z)/d.z;var p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.x>=lo.x-pad&&p.x<=hi.x+pad){h.t=t;h.n=vec3f(0,0,1);h.p=p;}t=(hi.z-o.z)/d.z;p=o+d*t;if(t>1e-4&&t<h.t&&p.y>=lo.y-pad&&p.y<=hi.y&&p.x>=lo.x-pad&&p.x<=hi.x+pad){h.t=t;h.n=vec3f(0,0,-1);h.p=p;}}
 return h;
}
fn fixtureColor(i:f32)->vec3f{
 if(N.meta.z>2.5){return hue(N.meta.w+i*.153);}
 let parity=i-2.0*floor(i*.5);return mix(N.base.rgb,N.accent.rgb,vec3f(parity*.58));
}
fn shimmer(p:vec3f,i:f32)->f32{
 let t=N.meta.w;
 let a=sin(p.x*15.7+p.z*11.3+t*2.15+i*1.37);
 let b=sin(p.x*27.1-p.z*18.6-t*1.62+i*2.11);
 let c=sin((p.x+p.z)*38.0+t*2.72-i*.83);
 let web=abs(a*.52+b*.31+c*.17);
 let line=pow(clamp(1.0-web*.78,0.0,1.0),4.0);
 return .72+line*.72;
}
fn fixture(lp:vec3f,axis:vec3f,p:vec3f,n:vec3f,i:f32)->vec3f{
 let toL=lp-p;let dist=length(toL);if(dist<1e-4||dist>N.extra.x){return vec3f(0);}
 let ld=toL/dist;let fromLamp=-ld;let cone=max(dot(fromLamp,axis),0.0);let facing=max(dot(n,ld),0.0);
 let x=dist/max(N.extra.x,1e-3);let atten=(1.0-smoothstep(.70,1.0,x))/(1.0+1.05*x*x);
 let spread=smoothstep(.08,.76,cone);let pool=pow(spread,.72)*(.17+.83*pow(facing,.68));
 let caustic=shimmer(p,i);return fixtureColor(i)*N.meta.y*atten*pool*caustic*.86;
}
fn sixLights(p:vec3f,n:vec3f)->vec3f{
 let lo=C.boxMin;let hi=C.boxMax;let y=lo.y+(hi.y-lo.y)*.17;
 let z0=mix(lo.z,hi.z,.17);let z1=mix(lo.z,hi.z,.50);let z2=mix(lo.z,hi.z,.83);var c=vec3f(0);
 c+=fixture(vec3f(lo.x+.022,y,z0),vec3f(1,0,0),p,n,0.0);c+=fixture(vec3f(lo.x+.022,y,z1),vec3f(1,0,0),p,n,1.0);c+=fixture(vec3f(lo.x+.022,y,z2),vec3f(1,0,0),p,n,2.0);
 c+=fixture(vec3f(hi.x-.022,y,z0),vec3f(-1,0,0),p,n,3.0);c+=fixture(vec3f(hi.x-.022,y,z1),vec3f(-1,0,0),p,n,4.0);c+=fixture(vec3f(hi.x-.022,y,z2),vec3f(-1,0,0),p,n,5.0);return c;
}
fn beam(ro:vec3f,rd:vec3f,lp:vec3f,axis:vec3f,i:f32)->vec3f{
 let toO=ro-lp;let a=dot(rd,rd);let b=dot(rd,axis);let cc=dot(axis,axis);let e=dot(rd,toO);let f=dot(axis,toO);let den=max(a*cc-b*b,1e-4);
 let t=max(0.0,(b*f-cc*e)/den);let s=max(0.0,(a*f-b*e)/den);if(s>N.extra.x){return vec3f(0);}
 let q=ro+rd*t;let lo=C.boxMin;let hi=C.boxMax;let waterTop=lo.y+(hi.y-lo.y)*.39;
 if(q.x<lo.x||q.x>hi.x||q.z<lo.z||q.z>hi.z||q.y<lo.y||q.y>waterTop){return vec3f(0);}
 let r=lp+axis*s;let d=length(q-r);let width=.045+s*.145;let core=exp(-d*d/max(width*width,1e-4));let halo=exp(-d*d/max(width*width*5.5,1e-4))*.24;
 return fixtureColor(i)*(core+halo)*(1.0-s/N.extra.x)*N.extra.y*N.meta.y*.15;
}
fn beams(ro:vec3f,rd:vec3f)->vec3f{
 let lo=C.boxMin;let hi=C.boxMax;let y=lo.y+(hi.y-lo.y)*.17;let z0=mix(lo.z,hi.z,.17);let z1=mix(lo.z,hi.z,.50);let z2=mix(lo.z,hi.z,.83);var c=vec3f(0);
 c+=beam(ro,rd,vec3f(lo.x+.022,y,z0),vec3f(1,0,0),0.0);c+=beam(ro,rd,vec3f(lo.x+.022,y,z1),vec3f(1,0,0),1.0);c+=beam(ro,rd,vec3f(lo.x+.022,y,z2),vec3f(1,0,0),2.0);
 c+=beam(ro,rd,vec3f(hi.x-.022,y,z0),vec3f(-1,0,0),3.0);c+=beam(ro,rd,vec3f(hi.x-.022,y,z1),vec3f(-1,0,0),4.0);c+=beam(ro,rd,vec3f(hi.x-.022,y,z2),vec3f(-1,0,0),5.0);return c;
}
fn sprite(ro:vec3f,rd:vec3f,lp:vec3f,i:f32)->vec3f{
 let v=lp-ro;let t=dot(v,rd);if(t<=0.0){return vec3f(0);}let q=ro+rd*t;let d=length(q-lp);
 let core=exp(-d*d/.00032);let halo=exp(-d*d/.0065)*.32;return fixtureColor(i)*(core*2.4+halo)*N.meta.y;
}
fn sprites(ro:vec3f,rd:vec3f)->vec3f{
 let lo=C.boxMin;let hi=C.boxMax;let y=lo.y+(hi.y-lo.y)*.17;let z0=mix(lo.z,hi.z,.17);let z1=mix(lo.z,hi.z,.50);let z2=mix(lo.z,hi.z,.83);var c=vec3f(0);
 c+=sprite(ro,rd,vec3f(lo.x+.022,y,z0),0.0);c+=sprite(ro,rd,vec3f(lo.x+.022,y,z1),1.0);c+=sprite(ro,rd,vec3f(lo.x+.022,y,z2),2.0);
 c+=sprite(ro,rd,vec3f(hi.x-.022,y,z0),3.0);c+=sprite(ro,rd,vec3f(hi.x-.022,y,z1),4.0);c+=sprite(ro,rd,vec3f(hi.x-.022,y,z2),5.0);return c;
}
@fragment fn fs(v:V)->@location(0)vec4f{
 if(N.meta.x<.5){return vec4f(0);}
 let a=C.invViewProj*vec4f(v.ndc,-1,1);let b=C.invViewProj*vec4f(v.ndc,1,1);let ro=a.xyz/a.w;let rd=normalize(b.xyz/b.w-ro);
 var c=beams(ro,rd)+sprites(ro,rd);let h=poolHit(ro,rd);
 if(h.t<1e29){c+=sixLights(h.p,h.n);let depthGlow=1.0-exp(-min(h.t,5.0)*.18);c+=N.base.rgb*N.meta.y*depthGlow*.028;}
 return vec4f(c,0);
}`;

try{
  const mod=dev.createShaderModule({code:shader,label:'fluidV5TrueNightPoolM34WGSL'});
  if(typeof mod.getCompilationInfo==='function'){
    const info=await mod.getCompilationInfo();const bad=(info.messages||[]).filter(m=>m.type==='error');
    if(bad.length)throw new Error(bad.map(m=>`${m.lineNum||'?'}:${m.linePos||'?'} ${m.message}`).join(' | '));
  }
  window.__v5NightPoolStatus.stage='pipeline';
  const pipe=await dev.createRenderPipelineAsync({label:'fluidV5TrueNightPoolM34',layout:'auto',vertex:{module:mod,entryPoint:'vs'},fragment:{module:mod,entryPoint:'fs',targets:[{format:ssfr.format,blend:{color:{srcFactor:'one',dstFactor:'one',operation:'add'},alpha:{srcFactor:'zero',dstFactor:'one',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
  let cache=null;
  function bg(){if(cache?.comp===ssfr.compUni)return cache.bg;const g=dev.createBindGroup({layout:pipe.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:ssfr.compUni}},{binding:1,resource:{buffer:uni}}]});cache={comp:ssfr.compUni,bg:g};return g;}
  const baseRender=ssfr.render;
  ssfr.render=function(...args){
    const night=lab.state?.time==='night';const mode=lab.state?.poolLight||'blue';const P=lab.getPackedState(performance.now());const pal=palettes[mode]||palettes.blue;
    if(night){
      if(mode==='rainbow'){
        const c=P.color||[.2,.5,1];this.transmit=[.055+.945*c[0],.055+.945*c[1],.055+.945*c[2]];
      }else this.transmit=pal.transmit.slice();
      this.exposure=Math.min(this.exposure,0.98);if(this.env)this.env.intensity=Math.min(this.env.intensity,0.018);
    }
    const out=baseRender.apply(this,args);const enc=args[0],target=args[1];
    F[0]=night?1:0;F[1]=clamp(P.intensity||1,0,3.0);F[2]=['blue','aqua','red','rainbow'].indexOf(mode);F[3]=(P.cycle||performance.now()*.00016);
    F[4]=pal.base[0];F[5]=pal.base[1];F[6]=pal.base[2];F[7]=1;
    F[8]=pal.accent[0];F[9]=pal.accent[1];F[10]=pal.accent[2];F[11]=1;
    F[12]=3.45;F[13]=clamp(P.volumetric||1,0,2);F[14]=1;F[15]=0;dev.queue.writeBuffer(uni,0,F);
    if(night){try{const pass=enc.beginRenderPass({colorAttachments:[{view:target,loadOp:'load',storeOp:'store'}]});pass.setPipeline(pipe);pass.setBindGroup(0,bg());pass.draw(3);pass.end();}catch(err){window.__v5NightPoolStatus.stage='frame-error';window.__v5NightPoolStatus.error=String(err?.message||err)}}
    return out;
  };
  window.__v5NightPoolStatus={online:true,stage:'online',backend:'six-fixture-m34',fixtures:6,error:''};
}catch(err){window.__v5NightPoolStatus={online:false,stage:'rejected',backend:'six-fixture-m34',error:String(err?.message||err)};console.warn('[Fluid V5 M3.4] true night-pool pass rejected; M3.3 mood system remains active.',err)}

function decorate(){
  const root=document.getElementById('v5LightLab');if(!root)return;
  const title=root.querySelector('.v5MoodTitle');if(title)title.textContent='TIME OF DAY · M3.4';
  const old=document.getElementById('v5NightPoolM34');if(old)old.remove();
  if(lab.state?.time==='night'){
    const note=document.createElement('div');note.id='v5NightPoolM34';note.className='v5MoodNote';
    const s=window.__v5NightPoolStatus;note.textContent=s?.online?'TRUE NIGHT POOL · 6 submerged wall fixtures · localized colored floor/wall pools · volumetric beams · moving shimmer':'NIGHT POOL FALLBACK · '+String(s?.stage||'offline').toUpperCase()+(s?.error?' · '+s.error:'');
    root.appendChild(note);
  }
}
window.addEventListener('fluid-v5-light-change',()=>setTimeout(decorate,0));setTimeout(decorate,80);setTimeout(decorate,450);
lab.version='M3.4';window.__v5LightState=lab.getPackedState();
console.info('[Fluid V5 M3.4] true six-fixture night pool lighting enabled.');
