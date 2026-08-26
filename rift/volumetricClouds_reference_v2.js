// Rift Cloud Model 3.4 review entry. The default keeps Model 3.3's reference
// families and adds celestial-coupled sunset/moon lighting with zero additional
// raymarch samples. Rollbacks remain query-selectable for A/B review.
import * as THREE from "three";
import * as model33 from "./volumetricClouds_r185_model33.js";
import * as model32 from "./volumetricClouds_r185_model32.js";
import * as model31 from "./volumetricClouds_r185_model31.js";
import * as model30 from "./volumetricClouds_r185_model30.js";
import * as model26 from "./volumetricClouds_r185_model26.js";
import * as model25 from "./volumetricClouds_r185_model25.js";
import * as model24 from "./volumetricClouds_r185_model24.js";
import * as model22 from "./volumetricClouds_r185_model22.js";
import * as fallback from "./volumetricClouds_r185_v17.js";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : null;
let active = model33;
let model34 = true;
if (params?.has("cloudModel33")) { active=model33; model34=false; }
else if (params?.has("cloudModel32")) { active=model32; model34=false; }
else if (params?.has("cloudModel31")) { active=model31; model34=false; }
else if (params?.has("cloudModel30")) { active=model30; model34=false; }
else if (params?.has("cloudModel26")) { active=model26; model34=false; }
else if (params?.has("cloudModel25")) { active=model25; model34=false; }
else if (params?.has("cloudModel24")) { active=model24; model34=false; }
else if (params?.has("cloudModel22")) { active=model22; model34=false; }
else if (params?.has("cloudFallback")) { active=fallback; model34=false; }

const SUNSET_EDGE=new THREE.Color(0xffb27d), SUNSET_CORE=new THREE.Color(0x6d718a);
const MOON_EDGE=new THREE.Color(0xc5d2e3), MOON_CORE=new THREE.Color(0x3f4d65), T=new THREE.Color();
const clamp=v=>Math.max(0,Math.min(1,Number(v)||0));

function apply34(handle){
  const u=handle?.uniforms, c=globalThis.__riftCelestialModel34; if(!u||!c)return;
  const sunset=clamp(c.sunsetStrength), fire=clamp(c.horizonFire), night=clamp(c.night), moon=clamp(c.moonIllumination)*night, storm=clamp(c.storm), clear=1-storm;
  if(u.sunColor?.value?.isColor){
    if(night>0.55){T.copy(MOON_EDGE).multiplyScalar(0.72+moon*0.42);u.sunColor.value.lerp(T,moon*0.46);}
    else {T.copy(c.sunColor||SUNSET_EDGE).lerp(SUNSET_EDGE,sunset*0.58);u.sunColor.value.lerp(T,sunset*clear*0.52);}
  }
  if(u.ambientColor?.value?.isColor) u.ambientColor.value.lerp(night>0.45?MOON_CORE:SUNSET_CORE,(night>0.45?moon*0.34:sunset*clear*0.20));
  if(u.m2SilverStrength)u.m2SilverStrength.value=THREE.MathUtils.clamp(u.m2SilverStrength.value+sunset*clear*0.17+moon*0.055,0.08,0.82);
  if(u.m31CrownLightBoost)u.m31CrownLightBoost.value=THREE.MathUtils.clamp(u.m31CrownLightBoost.value+sunset*clear*0.12+fire*0.08+moon*0.045,0.68,1.55);
  if(u.m31SelfShadow)u.m31SelfShadow.value=THREE.MathUtils.clamp(u.m31SelfShadow.value+sunset*0.08+night*0.04,0.72,1.45);
  if(u.m31BaseDarkening)u.m31BaseDarkening.value=THREE.MathUtils.clamp(u.m31BaseDarkening.value+sunset*0.09+night*0.055,0.30,0.92);
  if(u.m2MultiScatter)u.m2MultiScatter.value=THREE.MathUtils.clamp(u.m2MultiScatter.value+sunset*clear*0.028+moon*0.012,0.12,0.38);
  globalThis.__riftCloudModel34Debug={active:true,version:"3.4-celestial-coupled-lighting",sunset,horizonFire:fire,night,moonIllumination:moon,storm,silverStrength:u.m2SilverStrength?.value,crownLightBoost:u.m31CrownLightBoost?.value,selfShadow:u.m31SelfShadow?.value,baseDarkening:u.m31BaseDarkening?.value,threeRevision:THREE.REVISION};
}

export function createVolumetricClouds(scene){const h=active.createVolumetricClouds(scene);if(h&&model34)h.__riftModel34=true;return h;}
export function updateVolumetricClouds(...args){const r=active.updateVolumetricClouds(...args);if(model34)apply34(args[0]);return r;}
export function disposeVolumetricClouds(handle){delete globalThis.__riftCloudModel34Debug;return active.disposeVolumetricClouds(handle);}
