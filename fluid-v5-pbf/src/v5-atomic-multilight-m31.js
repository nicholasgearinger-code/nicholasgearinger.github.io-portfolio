// Fluid V5 M3.1: multi-light atomic caustics.
// Patches the validated full-surface particle projector so Sun, Spot and Point lights can each
// provide the incoming photon ray. The mobile-safe atomic<u32> -> r32uint sampled-texture path
// remains unchanged. Underwater/Skylight correctly contribute no air-to-water surface caustics.

const srcUrl=new URL('./v5-atomic-fullsurface.js',import.meta.url);
const response=await fetch(srcUrl,{cache:'no-store'});
if(!response.ok)throw new Error(`Fluid V5 M3.1: unable to load atomic source (${response.status}).`);
let src=await response.text();
const swap=(a,b,label)=>{if(!src.includes(a))throw new Error(`Fluid V5 M3.1: ${label} signature changed.`);src=src.replace(a,b)};

swap("label:'fluidV5FullSurfaceAtomicTuning',size:32","label:'fluidV5FullSurfaceAtomicTuning',size:80",'uniform size');
swap("const projectF=new Float32Array(8);\nconst projectU=new Uint32Array(projectF.buffer);","const projectBytes=new ArrayBuffer(80);\nconst projectF=new Float32Array(projectBytes);\nconst projectU=new Uint32Array(projectBytes);",'uniform view');
swap('struct Tuning { dims:vec4u, values:vec4f }','struct Tuning { dims:vec4u, pos:vec4f, dir:vec4f, color:vec4f, params:vec4f }','tuning struct');

const sunNeedle=` let sun=normalize(C.sunDir);
 let incidence=max(dot(n,sun),0.0);
 if(incidence<0.003){return;}
 let ray=refract(-sun,n,1.0/C.ior);`;
const lightPatch=` let lightType=U.dims.w;
 // 0=sun, 1=spot, 2=point. Underwater/skylight do not cross the air-water interface toward floor.
 if(lightType>=3u){return;}
 var incident=normalize(U.dir.xyz);
 var lightGain=max(U.color.w,0.0);
 if(lightType==1u||lightType==2u){
   let toP=p-U.pos.xyz;
   let dist=length(toP);
   if(dist<1.0e-4||dist>U.pos.w){return;}
   incident=toP/dist;
   let rangeFade=1.0-smoothstep(U.pos.w*0.72,U.pos.w,dist);
   lightGain*=rangeFade/(1.0+0.34*dist*dist);
   if(lightType==1u){
     let cone=dot(incident,normalize(U.dir.xyz));
     lightGain*=smoothstep(U.params.x,U.dir.w,cone);
   }
 }
 let incidence=max(dot(n,-incident),0.0);
 if(incidence<0.003||lightGain<1.0e-4){return;}
 let ray=refract(incident,n,1.0/C.ior);`;
swap(sunNeedle,lightPatch,'incoming light');
swap(' let w=U.values.x*(0.17+0.83*incidence)*(0.80+0.72*slope)*0.23;',' let w=lightGain*(0.17+0.83*incidence)*(0.80+0.72*slope)*0.23;','photon weight');

const encodeNeedle=` projectU[0]=CW;projectU[1]=CH;projectU[2]=n;projectU[3]=0;
 projectF[4]=Math.min(2.4,Math.max(.18,ssfr.sunIntensity/4.5));
 projectF[5]=state.projected;projectF[6]=0;projectF[7]=0;`;
const encodePatch=` const L=window.__v5LightLab?.getPackedState?.()||window.__v5LightState||{};
 const lp=L.position||[0,0,0],ld=L.direction||[0,-1,0],lc=L.color||[1,1,1];
 projectU[0]=CW;projectU[1]=CH;projectU[2]=n;projectU[3]=Number.isFinite(L.causticCode)?L.causticCode:4;
 projectF[4]=lp[0]||0;projectF[5]=lp[1]||0;projectF[6]=lp[2]||0;projectF[7]=Math.max(.25,L.range||3.0);
 projectF[8]=ld[0]||0;projectF[9]=ld[1]??-1;projectF[10]=ld[2]||0;projectF[11]=L.coneInnerCos??0.94;
 projectF[12]=lc[0]??1;projectF[13]=lc[1]??1;projectF[14]=lc[2]??1;projectF[15]=Math.max(0,L.intensity??1);
 projectF[16]=L.coneOuterCos??0.88;projectF[17]=state.projected;projectF[18]=0;projectF[19]=0;`;
swap(encodeNeedle,encodePatch,'per-frame light upload');

// Retain the M3.0 high-pass caustic presentation: remove spatially uniform light and show only
// photon concentration above the local neighborhood.
const sampleNeedle=`fn sampleEnergy(uv:vec2f)->f32{
 let d=vec2f(textureDimensions(densityTex));let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*d;
 let x=i32(floor(p.x));let z=i32(floor(p.y));
 var s=e(x,z)*4.0;
 s+=(e(x-1,z)+e(x+1,z)+e(x,z-1)+e(x,z+1))*2.0;
 s+=e(x-1,z-1)+e(x+1,z-1)+e(x-1,z+1)+e(x+1,z+1);
 return s/16.0;
}`;
const samplePatch=`fn sampleFine(uv:vec2f)->f32{
 let d=vec2f(textureDimensions(densityTex));let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*d;
 let x=i32(floor(p.x));let z=i32(floor(p.y));
 var s=e(x,z)*4.0;
 s+=(e(x-1,z)+e(x+1,z)+e(x,z-1)+e(x,z+1))*2.0;
 s+=e(x-1,z-1)+e(x+1,z-1)+e(x-1,z+1)+e(x+1,z+1);
 return s/16.0;
}
fn sampleBroad(uv:vec2f)->f32{
 let d=vec2f(textureDimensions(densityTex));let p=clamp(uv,vec2f(0.0),vec2f(0.99999))*d;
 let x=i32(floor(p.x));let z=i32(floor(p.y));var s=0.0;
 s+=(e(x-2,z)+e(x+2,z)+e(x,z-2)+e(x,z+2));
 s+=(e(x-2,z-2)+e(x+2,z-2)+e(x-2,z+2)+e(x+2,z+2))*0.72;
 s+=(e(x-3,z)+e(x+3,z)+e(x,z-3)+e(x,z+3))*0.44;
 return s/8.64;
}
fn causticFocus(uv:vec2f)->f32{return max(sampleFine(uv)-sampleBroad(uv),0.0);}`;
swap(sampleNeedle,samplePatch,'high-pass sampling');

const curveNeedle=`fn light(v:f32)->vec3f{
 let focused=max(v-0.010,0.0);
 let c=1.0-exp(-focused*1.12*U.gain);
 let h=smoothstep(0.004,0.68,c);
 return vec3f(h,h*.955,h*.84);
}`;
const curvePatch=`fn light(v:f32)->vec3f{
 let focused=max(v-0.0015,0.0);
 let c=1.0-exp(-focused*3.35*U.gain);
 let h=smoothstep(0.002,0.56,c);
 return vec3f(h,h*.965,h*.86);
}`;
swap(curveNeedle,curvePatch,'focus curve');
swap(' if(U.debug>.5){return vec4f(light(sampleEnergy(screenUV)),1.0);}',' if(U.debug>.5){return vec4f(light(causticFocus(screenUV)),1.0);}','atomic debug');
const receiverNeedle=` let uv=(p.xz-C.boxMin.xz)/max(C.boxMax.xz-C.boxMin.xz,vec2f(1.0e-4));
 let c=light(sampleEnergy(uv));let peak=max(max(c.r,c.g),c.b);
 let alpha=clamp(peak*U.strength*.23,0.0,.44);
 return vec4f(c*(.72+U.strength*.25),alpha);`;
const receiverPatch=` let uv=(p.xz-C.boxMin.xz)/max(C.boxMax.xz-C.boxMin.xz,vec2f(1.0e-4));
 let focus=causticFocus(uv);let c=light(focus);let peak=max(max(c.r,c.g),c.b);
 let alpha=clamp(peak*U.strength*.17,0.0,.30);
 return vec4f(c*(.54+U.strength*.42),alpha);`;
swap(receiverNeedle,receiverPatch,'receiver focus');

src=src.replaceAll("backend:'particle-full'","backend:'particle-multilight'");
src=src.replaceAll('full-surface particle caustics online','multi-light full-surface caustics online');
const blobUrl=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(blobUrl)}finally{URL.revokeObjectURL(blobUrl)}
if(window.__v5ProjectedCaustics)window.__v5ProjectedCaustics.backend='particle-multilight';
if(window.__v5AtomicStatus)window.__v5AtomicStatus.backend='particle-multilight';
console.info('[Fluid V5 M3.1] multi-light atomic caustic routing enabled.');
