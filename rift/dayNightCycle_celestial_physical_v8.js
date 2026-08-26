import * as THREE from "three";
import * as v13 from "./dayNightCycle_celestial_physical_v13.js";
import * as v12 from "./dayNightCycle_celestial_physical_v12.js";
import * as legacy from "./dayNightCycle_celestial_physical_v10.js";
export * from "./dayNightCycle_celestial_physical_v13.js";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
let fallback = null;
if (params?.has("atmosphereV13")) fallback = v13;
else if (params?.has("atmosphereV12")) fallback = v12;
else if (params?.has("atmosphereLegacy")) fallback = legacy;

// Model 3.4: dramatic directional sunset + true-scale Sun/Moon. This stays on
// the proven single atmosphere dome and adds no full-screen pass.
const SUN_DEG = 0.53, MOON_DEG = 0.52;
const C = {
  sunDay: new THREE.Color(0xfffbef), sunGold: new THREE.Color(0xffc27a), sunFire: new THREE.Color(0xff7138),
  halo: new THREE.Color(0xffa45c), gold: new THREE.Color(0xffb06c), orange: new THREE.Color(0xf47b43),
  fire: new THREE.Color(0xdd4d31), rose: new THREE.Color(0xd88a91), violet: new THREE.Color(0x866f9f), blue: new THREE.Color(0x31568f),
  moon: new THREE.Color(0xe8e5dc), moonHorizon: new THREE.Color(0xe2bea0), earth: new THREE.Color(0x667b96),
  moonGlow: new THREE.Color(0xc8d5e4), moonLight: new THREE.Color(0xb9c8dc),
  cloudSun: new THREE.Color(0xffb27d), cloudShadow: new THREE.Color(0x6c718b),
};
const D = new THREE.Vector3(), M = new THREE.Vector3(), T = new THREE.Color();
const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
const smooth = (a,b,x) => { const t=clamp((x-a)/Math.max(1e-6,b-a)); return t*t*(3-2*t); };
const diameter = (r,deg) => 2*Math.max(1,r)*Math.tan(THREE.MathUtils.degToRad(deg*0.5));
const altitude = (g) => { const p=g?.position; if(!p?.isVector3||p.lengthSq()<1e-6)return -90; D.copy(p).normalize(); return THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(D.y,-1,1))); };
const cloudT = () => { const t=Number(globalThis.__riftCloudShadowState?.averageTransmittance); return Number.isFinite(t)?clamp(t):1-clamp(globalThis.__riftProceduralCloudOcclusion||0); };

function earthshine(cycle) {
  if (cycle.__riftMoonEarthshineV14) return cycle.__riftMoonEarthshineV14;
  const moon=cycle?.moonBody, core=moon?.core?.material; if(!moon?.group||!core)return null;
  const material=new THREE.SpriteMaterial({map:core.map||null,color:C.earth.clone(),transparent:true,opacity:0,depthTest:true,depthWrite:false,fog:false,toneMapped:false,alphaTest:0.004});
  const sprite=new THREE.Sprite(material); sprite.name="rift-moon-earthshine-v14"; sprite.renderOrder=-101.2; moon.group.add(sprite);
  return cycle.__riftMoonEarthshineV14={sprite,material};
}

function dramaticDome(atmos,state,sunset,fire) {
  const pos=atmos?.dome?.position, attr=atmos?.dome?.color, sun=state?.sunDirection; if(!pos||!attr||!sun||sunset<0.001)return;
  const a=attr.array, clear=1-clamp(state.storm);
  for(let i=0;i<pos.count;i++){
    D.set(pos.getX(i),pos.getY(i),pos.getZ(i)).normalize();
    const h=clamp((D.y+0.035)/1.035), dot=THREE.MathUtils.clamp(D.dot(sun),-1,1), toward=Math.pow(clamp((dot+0.08)/1.08),2.2), tight=Math.pow(clamp(dot),12);
    const j=i*3; T.setRGB(a[j],a[j+1],a[j+2]);
    const warm=Math.pow(1-h,3.6)*sunset*(0.10+0.90*toward); T.lerp(C.orange,clamp(warm*0.58));
    const band=smooth(0.035,0.15,h)*(1-smooth(0.34,0.58,h))*sunset; T.lerp(C.rose,clamp(band*(0.02+0.18*toward))); T.lerp(C.violet,clamp(band*0.035));
    const f=Math.pow(1-h,5.6)*fire*clear*(0.12+0.88*Math.pow(clamp(dot),3.2)); T.lerp(C.fire,clamp(f*0.58)); T.lerp(C.gold,clamp(tight*sunset*(0.08+fire*0.14)));
    a[j]=T.r; a[j+1]=T.g; a[j+2]=T.b;
  }
  attr.needsUpdate=true;
}

function tuneSun(cycle,state,sunset,fire,daylight){
  const v=cycle?.__riftRealSun,g=cycle?.sunBody?.group; if(!v||!g?.position)return 0;
  const d=diameter(g.position.length(),SUN_DEG), alt=Number.isFinite(Number(state.altitudeDeg))?Number(state.altitudeDeg):altitude(g), high=smooth(12,42,alt), beam=THREE.MathUtils.lerp(0.42,1,Math.pow(cloudT(),0.44)), visible=smooth(-1.2,0.5,alt)*daylight;
  T.copy(C.sunFire).lerp(C.sunGold,smooth(-1,7,alt)).lerp(C.sunDay,high);
  v.disc?.scale?.set(d,d,1); if(v.discMaterial){v.discMaterial.blending=THREE.NormalBlending;v.discMaterial.color.copy(T);v.discMaterial.opacity=visible*THREE.MathUtils.lerp(0.82,1,beam);v.discMaterial.toneMapped=false;v.discMaterial.needsUpdate=true;}
  const hs=d*THREE.MathUtils.lerp(12,19,sunset), as=d*THREE.MathUtils.lerp(28,42,sunset); v.halo?.scale?.set(hs,hs,1);v.aureole?.scale?.set(as,as,1);v.horizonGlow?.scale?.set(d*THREE.MathUtils.lerp(46,76,fire),d*THREE.MathUtils.lerp(14,23,fire),1);
  if(v.haloMaterial){v.haloMaterial.color.copy(C.halo).lerp(C.sunDay,high*0.72);v.haloMaterial.opacity=visible*THREE.MathUtils.lerp(0.075,0.15,sunset)*beam;}
  if(v.aureoleMaterial){v.aureoleMaterial.color.copy(C.halo);v.aureoleMaterial.opacity=visible*THREE.MathUtils.lerp(0.018,0.055,sunset)*beam;}
  if(v.horizonGlowMaterial){v.horizonGlowMaterial.color.copy(C.orange);v.horizonGlowMaterial.opacity=visible*fire*0.16*beam;}
  const p=cycle.__riftPhotometricSunV7; if(p){p.hotCore?.scale?.set(d*0.84,d*0.84,1);if(p.hotCoreMaterial){p.hotCoreMaterial.color.copy(C.sunDay).multiplyScalar(THREE.MathUtils.lerp(1.4,1.8,high));p.hotCoreMaterial.opacity=visible*THREE.MathUtils.lerp(0.24,0.42,high)*beam;}p.bloom?.scale?.set(hs*0.86,hs*0.86,1);if(p.bloomMaterial)p.bloomMaterial.opacity=visible*THREE.MathUtils.lerp(0.035,0.07,sunset)*beam;}
  const v9=cycle.__riftSunV9;if(v9){v9.core?.scale?.set(d*0.54,d*0.54,1);if(v9.coreMaterial)v9.coreMaterial.opacity=visible*0.23*beam;}
  cycle.sun?.color?.copy?.(T); return d;
}

function tuneMoon(cycle,daylight){
  const moon=cycle?.moonBody,g=moon?.group,mat=moon?.core?.material;if(!g?.position||!mat)return {d:0,illum:0,alt:-90,earth:0};
  const d=diameter(g.position.length(),MOON_DEG), alt=altitude(g), illum=clamp(cycle.moonIllumination??1), night=1-daylight, visible=night*smooth(-3,6,alt)*smooth(0.003,0.06,illum), warm=1-smooth(4,18,alt);
  moon.core.scale.set(d,d,1); mat.color.copy(C.moon).lerp(C.moonHorizon,warm*0.42); mat.opacity=visible*THREE.MathUtils.lerp(0.70,1,Math.sqrt(illum));mat.toneMapped=false;
  const gs=d*THREE.MathUtils.lerp(7,11.5,Math.sqrt(illum));moon.glow?.scale?.set(gs,gs,1);if(moon.glow?.material){moon.glow.material.color.copy(C.moonGlow);moon.glow.material.opacity=visible*THREE.MathUtils.lerp(0.025,0.095,Math.pow(illum,0.65));}
  const e=earthshine(cycle), ev=visible*(1-illum)*Math.sqrt(Math.max(0,illum))*0.19;if(e){e.sprite.scale.set(d,d,1);e.material.opacity=ev;e.sprite.visible=ev>0.001;}
  if(cycle.moonLight){cycle.moonLight.color.copy(C.moonLight);cycle.moonLight.intensity=Math.min(0.24,Math.max(Number(cycle.moonLight.intensity)||0,0.16*night*smooth(-3,6,alt)*Math.pow(illum,0.78)));}
  return {d,illum,alt,earth:ev};
}

function apply(cycle,result){
  const state=globalThis.__riftSkyPhysicalV13||globalThis.__riftSkyPhysicalV12, atmos=globalThis.__riftReferenceAtmosphere;if(!cycle||!state||!atmos)return result;
  const alt=Number(state.altitudeDeg)||-90, storm=clamp(state.storm), clear=1-storm, daylight=clamp(state.daylight);
  const golden=smooth(-6,2,alt)*(1-smooth(13,25,alt)), after=smooth(-8,-2,alt)*(1-smooth(5,13,alt)), sunset=clamp(Math.max(golden,after*0.72))*clear, fire=smooth(-3.5,-0.2,alt)*(1-smooth(3.5,9.5,alt))*clear;
  atmos.zenithColor.lerp(C.blue,sunset*0.16);atmos.horizonColor.lerp(C.orange,sunset*0.52).lerp(C.fire,fire*0.38);atmos.hazeColor.lerp(C.gold,sunset*0.34);dramaticDome(atmos,state,sunset,fire);
  atmos.exposure=THREE.MathUtils.clamp((Number(atmos.exposure)||0.86)*THREE.MathUtils.lerp(1,0.91,sunset),0.70,0.92);
  const sd=tuneSun(cycle,state,sunset,fire,daylight), mi=tuneMoon(cycle,daylight);atmos.ambientColor.lerp(C.cloudShadow,sunset*0.10);atmos.sunColor.copy(cycle.sun?.color||state.sunTint||C.sunDay);
  const p11=globalThis.__riftSkyPhysicalV11;if(p11){(p11.sunColor||(p11.sunColor=new THREE.Color())).copy(atmos.sunColor);(p11.skyDiffuseColor||(p11.skyDiffuseColor=new THREE.Color())).copy(atmos.ambientColor);}
  const shared=globalThis.__riftSunsetAtmosphereV9;if(shared){shared.sunsetStrength=sunset;shared.horizonFire=fire;shared.solarDiscColor?.copy?.(atmos.sunColor);shared.solarHaloColor?.copy?.(C.halo);shared.cloudLightTint?.copy?.(C.cloudSun);shared.cloudShadowTint?.copy?.(C.cloudShadow);shared.waterSunTint?.copy?.(atmos.sunColor);}
  result?.skyZenith?.copy?.(atmos.zenithColor);result?.skyHorizon?.copy?.(atmos.horizonColor);result?.sunColor?.copy?.(atmos.sunColor);result?.ambientColor?.copy?.(atmos.ambientColor);
  globalThis.__riftCelestialModel34={active:true,version:"3.4-dramatic-atmosphere-true-celestials",altitudeDeg:alt,daylight,night:1-daylight,storm,sunsetStrength:sunset,horizonFire:fire,sunDirection:state.sunDirection,sunColor:cycle.sun?.color,sunDiscWorld:sd,sunAngularDiameterDeg:SUN_DEG,moonDirection:M.copy(cycle.moonBody?.group?.position||D.set(0,-1,0)).normalize(),moonDiscWorld:mi.d,moonAngularDiameterDeg:MOON_DEG,moonAltitudeDeg:mi.alt,moonPhase:Number(cycle.moonPhase)||0,moonIllumination:mi.illum,moonEarthshine:mi.earth,exposure:atmos.exposure,cloudSunsetTint:C.cloudSun,cloudShadowTint:C.cloudShadow,threeRevision:THREE.REVISION};
  globalThis.__riftAtmosphereDebug={...(globalThis.__riftAtmosphereDebug||{}),version:"14-model34-dramatic-celestials",sunsetStrength:sunset,horizonFire:fire,sunAngularDiameterDeg:SUN_DEG,moonAngularDiameterDeg:MOON_DEG,moonIllumination:mi.illum,exposure:atmos.exposure};
  return result;
}

export function createDayNightCycle(scene,sun,ambient,starfield,biome,moonLight){
  if (fallback) return fallback.createDayNightCycle(scene,sun,ambient,starfield,biome,moonLight);
  const c=v13.createDayNightCycle(scene,sun,ambient,starfield,biome,moonLight); apply(c,null); return c;
}
export function updateDayNightCycle(cycle,dt){
  if (fallback) return fallback.updateDayNightCycle(cycle,dt);
  return apply(cycle,v13.updateDayNightCycle(cycle,dt));
}
