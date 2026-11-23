// Standalone Rift Water Lab 01. NO imports from Rift gameplay or renderer.
// The production game stays entirely untouched while new waves are evaluated.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js";

const canvas = document.getElementById("scene");
const status = document.getElementById("status");
// Display startup and render failures directly on phones.
function showLabFailure(error){
 const message=error?.message||String(error);
 if(status){
   status.style.display="block";
   status.style.position="absolute";
   status.style.top="27%";
   status.style.left="5%";
   status.style.right="5%";
   status.style.zIndex="100";
   status.style.whiteSpace="pre-wrap";
   status.textContent="Water Lab error: "+message;
 }
 console.error("[water-lab]",error);
}
window.addEventListener("error",e=>showLabFailure(e.error||e.message));
window.addEventListener("unhandledrejection",e=>showLabFailure(e.reason));

const fpsLabel = document.getElementById("fps");
const triLabel = document.getElementById("tri");
const params = {height:1, chop:1, sun:1, clarity:1, caustics:1, causticSpeed:1, causticCurvature:1, causticFocus:1, refraction:1, occlusion:1, ceilingDetail:1, ceilingLight:1, volume:1, shafts:1, glint:1, penetration:1, undersideWindow:1, undersideShimmer:1, physicalLight:1, surfaceDetail:1, swellComplexity:1, crestFoam:1, shallowLight:1, sceneReflections:0, depthRefraction:1, volumeScattering:1,simulation:1};
const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints>0;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({canvas, antialias:false, powerPreference:"high-performance", alpha:false});
  // Report GLSL compile/link failures on mobile (previously silent black
  // geometry while the ocean and FPS counter continued to run).
  renderer.debug.onShaderError=(gl,program,vs,fs)=>{
    const message=[
      gl.getProgramInfoLog(program),
      gl.getShaderInfoLog(vs),
      gl.getShaderInfoLog(fs)
    ].filter(Boolean).join(" | ");
    showLabFailure(new Error("GLSL compile/link: "+message.slice(0,550)));
  };
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile?1.25:1.75));
  renderer.setSize(window.innerWidth,window.innerHeight);
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.0;
} catch(e) {
  status.style.display="block";
  status.textContent="WebGL failed to start: "+e.message;
  throw e;
}
const scene=new THREE.Scene();
const camera=new THREE.PerspectiveCamera(65,innerWidth/innerHeight,.08,1000);
const clock=new THREE.Clock();
let yaw=0,pitch=-.055, view="surface";
const waterUniforms={
  uTime:{value:0},uHeight:{value:1},uChop:{value:1},uSwellComplexity:{value:1},
  uSun:{value:1},uClarity:{value:1},uEye:{value:camera.position},uSceneTex:{value:null},uViewport:{value:new THREE.Vector2(1,1)},uRefraction:{value:1},uCeilingDetail:{value:1},uCeilingLight:{value:1},uGlint:{value:1},uPenetration:{value:1},uUndersideWindow:{value:1},uUndersideShimmer:{value:1},uSurfaceDetail:{value:1},uCrestFoam:{value:1},uUnderwaterOptics:{value:1},uMirrorTex:{value:null},uMirrorVP:{value:new THREE.Matrix4()},uMirrorStrength:{value:0},uUnderside31:{value:1},uUnderside32:{value:1},uUnderside33:{value:1},uSceneDepthTex:{value:null},uDepthRefraction:{value:0},uCameraNear:{value:camera.near},uCameraFar:{value:camera.far},uVolumeScattering:{value:1},uSimTex:{value:null},uSimStrength:{value:1},uSimTexel:{value:1/128},uSimZero:{value:0},uSimDecode:{value:1}
};
const waterVert=`
precision highp float;
uniform float uTime,uHeight,uChop,uSwellComplexity,uSimStrength,uSimTexel,uSimZero,uSimDecode;
uniform sampler2D uSimTex;
varying vec3 vWorld,vWaveNormal;
varying float vCrest;
void wave(in vec2 p,in vec2 d,in float amp,in float freq,in float speed,inout vec3 displacement,inout vec2 gradient){
  float phase=dot(p,d)*freq-uTime*speed;
  float ss=sin(phase),cc=cos(phase);
  displacement.y+=amp*ss;
  displacement.xz+=d*(amp*.18*uChop*cc);
  gradient+=d*(amp*freq*cc);
}
void main(){
  vec3 pos=position;
  vec3 delta=vec3(0.);
  vec2 slope=vec2(0.);
  vec2 xz=pos.xz;
  wave(xz,normalize(vec2(.96,.28)),.68,.095,.70,delta,slope);
  wave(xz,normalize(vec2(.40,.91)),.40,.16,1.16,delta,slope);
  wave(xz,normalize(vec2(-.71,.70)),.24,.28,1.44,delta,slope);
  wave(xz,normalize(vec2(.90,-.44)),.12,.49,2.10,delta,slope);
  wave(xz,normalize(vec2(-.3,-.95)),.055,.88,3.45,delta,slope);
  // Two oblique, long-period swell trains create irregular wave groups
  // rather than only repeated small, equally spaced crests.
  float c=clamp(uSwellComplexity,0.,1.5);
  vec2 d6=normalize(vec2(-.83,.56)),d7=normalize(vec2(.14,-.99));
  float q6=dot(xz,d6)*.048-uTime*.47+1.3;
  float q7=dot(xz,d7)*.073-uTime*.63+2.7;
  float big=.53*c*sin(q6)+.32*c*sin(q7);
  vec2 bigSlope=d6*(.53*c*.048*cos(q6))+d7*(.32*c*.073*cos(q7));
  // Crest asymmetry conserves wave continuity: higher/sharper tops,
  // comparatively broad troughs; slope uses the derivative of the shape.
  float oldH=delta.y;
  float crest=max(oldH,0.);
  delta.y+=.19*c*crest*crest;
  slope*=1.+.38*c*crest;
  delta.y+=big;
  slope+=bigSlope;
  delta.xz+=(d6*.53*c*cos(q6)+d7*.32*c*cos(q7))*.12*uChop;
  // GPU numerical wave perturbation, sampled in the same field as lighting.
  vec2 uvSim=fract(xz/128.+.5),dxSim=vec2(uSimTexel,0.),dzSim=vec2(0.,uSimTexel);
  float hSim=(texture2D(uSimTex,uvSim).r-uSimZero)*uSimDecode*5.*uSimStrength;
  float gradX=(texture2D(uSimTex,uvSim+dxSim).r-texture2D(uSimTex,uvSim-dxSim).r)*uSimDecode*5.*uSimStrength/(256.*uSimTexel);
  float gradZ=(texture2D(uSimTex,uvSim+dzSim).r-texture2D(uSimTex,uvSim-dzSim).r)*uSimDecode*5.*uSimStrength/(256.*uSimTexel);
  delta.y+=hSim;
  slope+=vec2(gradX,gradZ);
  pos+=delta*uHeight;
  vec3 localNormal=normalize(vec3(-slope.x*uHeight,1.,-slope.y*uHeight));
  vWaveNormal=normalize(mat3(modelMatrix)*localNormal);
  vWorld=(modelMatrix*vec4(pos,1.)).xyz;
  // Surface 10.12: the earlier .68/1.28 height AND .15/.65 slope
  // thresholds almost never intersected at normal swell amplitude.
  // Use a gentler combined measure, taking the new long swells into
  // account while still rejecting flat troughs.
  float crestElevation=smoothstep(.12,.85,delta.y*uHeight);
  float crestSteepness=smoothstep(.065,.29,length(slope)*uHeight);
  vCrest=crestElevation*crestSteepness;
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`;
const waterFrag="\nprecision highp float;\nuniform float uHeight,uTime,uSun,uClarity,uRefraction,uCeilingDetail,uCeilingLight,uGlint,uPenetration,uUndersideWindow,uUndersideShimmer,uSurfaceDetail,uCrestFoam,uUnderwaterOptics;\nuniform vec3 uEye;\nuniform vec2 uViewport;\nuniform sampler2D uSceneTex,uMirrorTex,uSceneDepthTex;\nuniform mat4 uMirrorVP;\nuniform float uMirrorStrength,uDepthRefraction,uCameraNear,uCameraFar,uVolumeScattering,uUnderside31,uUnderside32,uUnderside33;\nvarying vec3 vWorld,vWaveNormal;\nvarying float vCrest;\n\nfloat cloudHash(vec2 p){\n return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);\n}\nfloat cloudNoise(vec2 p){\n vec2 i=floor(p),f=fract(p);\n vec2 u=f*f*(3.-2.*f);\n return mix(mix(cloudHash(i),cloudHash(i+vec2(1.,0.)),u.x),\n            mix(cloudHash(i+vec2(0.,1.)),cloudHash(i+vec2(1.,1.)),u.x),u.y);\n}\n// Project cloud layers on an overhead sky plane rather than repeating\n// sinusoids on the sphere (which made vertical white bands).\nfloat cloudCoverage(vec3 dir,float t){\n float altitude=max(dir.y,.025);\n vec2 q=dir.xz/(altitude+.25)*1.75+vec2(t*.004,-t*.0014);\n float low=cloudNoise(q*.73);\n float medium=cloudNoise(q*1.45+vec2(11.2,-7.9));\n float fine=cloudNoise(q*2.9+vec2(-6.1,4.7));\n float mass=low*.53+medium*.34+fine*.13;\n float cloud=smoothstep(.46,.64,mass);\n return cloud*smoothstep(-.015,.16,dir.y)*.65;\n}\nvec3 sky(vec3 dir){\n float h=clamp(dir.y*.8+.28,0.,1.);\n vec3 base=mix(vec3(.66,.80,.88),vec3(.075,.30,.60),pow(h,.82));\n float clouds=cloudCoverage(dir,uTime);\n base=mix(base,vec3(.91,.93,.95),clouds);\n float sunAngle=max(dot(dir,normalize(vec3(.37,.54,-.7))),0.);\n float solar=pow(sunAngle,140.);\n float halo=pow(sunAngle,13.);\n return base+vec3(1.,.84,.64)*(solar*2.15+halo*.26)*uSun;\n}\n\n// Coherent traveling capillary slopes are coupled to the existing wave\n// directions and time. They change the optical normals without adding mesh\n// vertices, textures or new simulation dispatches.\nvec2 fineWaveSlopes(vec2 p,float t){\n  // Two low-frequency displacements bend high-frequency phase fronts.\n  // They make the normals less like long, perfectly parallel straight\n  // ridges without adding vertices or diverging from surface motion.\n  vec2 q=p+vec2(\n    .39*sin(p.y*.17+p.x*.09-t*.27)+.21*cos(p.x*.23-p.y*.15+t*.31),\n    .34*cos(p.x*.14-p.y*.12+t*.24)+.20*sin(p.y*.26+p.x*.11-t*.34)\n  );\n  float a=dot(q,vec2(.93,.37))*1.20-t*1.91;\n  float b=dot(q,vec2(-.42,.91))*1.94+t*2.67;\n  float c=dot(q,vec2(.67,-.74))*3.26-t*3.83;\n  float d=dot(q,vec2(.19,.98))*5.18+t*5.11;\n  vec2 local=vec2(\n     cos(a)*.055+cos(b)*-.038+cos(c)*.021+cos(d)*.009,\n     cos(a)*.024+cos(b)*.073-cos(c)*.024+cos(d)*.012\n  );\n  float swell=sin(dot(p,vec2(.96,.28))*.16-t*.7);\n  return local*(.79+.21*swell);\n}\nfloat fresnelDielectric(float cosine,float etaI,float etaT){\n  float incident=clamp(cosine,0.,1.);\n  float sinT2=(etaI/etaT)*(etaI/etaT)*(1.-incident*incident);\n  if(sinT2>=1.)return 1.;\n  float transmitted=sqrt(max(0.,1.-sinT2));\n  float rs=(etaI*incident-etaT*transmitted)/\n    max(etaI*incident+etaT*transmitted,.0001);\n  float rp=(etaT*incident-etaI*transmitted)/\n    max(etaT*incident+etaI*transmitted,.0001);\n  return clamp(.5*(rs*rs+rp*rp),0.,1.);\n}\n// Positive perspective camera distance from the hardware depth value.\nfloat cameraDistanceFromDepth(float z,float nearPlane,float farPlane){\n  return (nearPlane*farPlane)/max(.0001,farPlane-z*(farPlane-nearPlane));\n}\nvec3 underwaterReflectedEnvironment(vec3 direction,vec3 position,float t){\n  // A moving approximation of reflection from the sub-surface environment.\n  // Unlike a flat blue constant, it varies with view angle and wave phase.\n  float below=clamp(-direction.y*.5+.5,0.,1.);\n  float pattern=sin(position.x*.47+position.z*.25+t*.64)*\n                sin(position.z*.61-position.x*.18-t*.81);\n  vec3 deep=mix(vec3(.010,.072,.107),vec3(.045,.25,.30),below);\n  return deep*(.81+.19*pattern);\n}\n\n// A broad solar lobe on the actual moving normal plus fine coherent\n// wave-line glints. Unlike the previous single high-exponent sparkle, this\n// remains visible across a meaningful range of sun/view directions.\nfloat surfaceSunGlint(vec3 normal,vec3 viewDir,vec2 pos,float time){\n  vec3 sunDir=normalize(vec3(.37,.54,-.7));\n  vec3 halfway=normalize(sunDir+viewDir);\n  float align=max(dot(normal,halfway),0.);\n  // A compact sun lobe with high-frequency microfacets broken into small,\n  // irregular sparkling clusters rather than one long white gloss stripe.\n  float broad=pow(align,62.);\n  float sharp=pow(align,270.);\n  float p1=sin(dot(pos,vec2(1.38,.41))*2.3-time*2.16);\n  float p2=sin(dot(pos,vec2(-.59,1.20))*3.1+time*2.91);\n  float p3=sin(dot(pos,vec2(.83,-1.57))*5.3-time*4.35);\n  float micro=pow(clamp(.5+.23*p1+.22*p2+.20*p3,0.,1.),5.0);\n  float glitter=(broad*.18+sharp*2.1)*(.20+.80*micro);\n  return glitter*uGlint*uSun;\n}\n// A surface-only set of fine crossing normals. The five long-wave\n// displacements remain unchanged, preserving wave-coupled caustics below.\nvec2 surfaceMicroSlopes(vec2 p,float t){\n  // A curved, slow-moving phase field, with two different crossing\n  // wave groups, avoids the straight-line interference pattern.\n  vec2 warp=vec2(\n    .50*sin(dot(p,vec2(.17,.12))-t*.33)\n      +.25*cos(dot(p,vec2(-.08,.26))+t*.24),\n    .42*cos(dot(p,vec2(.11,-.20))+t*.28)\n      +.27*sin(dot(p,vec2(.24,.10))-t*.37)\n  );\n  vec2 q=p+warp;\n  float group=.69+.31*(.5+.5*sin(dot(p,vec2(.14,-.11))-t*.32));\n  float a=dot(q,vec2(.81,.59))*1.48-t*2.23;\n  float b=dot(q,vec2(-.53,.85))*2.33+t*2.91;\n  float c=dot(q,vec2(.94,-.35))*3.91-t*4.27;\n  float d=dot(q,vec2(-.28,-.96))*6.34+t*5.96;\n  return group*vec2(\n    cos(a)*.069-cos(b)*.058+cos(c)*.030-cos(d)*.014,\n    cos(a)*.046+cos(b)*.091-cos(c)*.025-cos(d)*.039\n  );\n}\n\n// GGX microfacet sun BRDF, direct-light approximation with Smith masking.\n// Applied above the surface only; dielectric Fresnel elsewhere is untouched.\nfloat ggxSunBRDF(vec3 N,vec3 V,vec3 L,float rough){\n  vec3 H=normalize(V+L);\n  float ndl=max(dot(N,L),0.);\n  float ndv=max(dot(N,V),0.);\n  float ndh=max(dot(N,H),0.);\n  float vdh=max(dot(V,H),0.);\n  float alpha=max(.045,rough*rough),a2=alpha*alpha;\n  float denom=ndh*ndh*(a2-1.)+1.;\n  float D=a2/(3.14159265*denom*denom+.0001);\n  float k=(rough+1.)*(rough+1.)*.125;\n  float gv=ndv/(ndv*(1.-k)+k+.0001);\n  float gl=ndl/(ndl*(1.-k)+k+.0001);\n  float F=.0204+.9796*pow(1.-vdh,5.);\n  return min(2.8,D*gv*gl*F*ndl/(4.*max(ndv,.15)+.001));\n}\nvoid main(){\n vec3 n=normalize(vWaveNormal);\n vec3 V=normalize(uEye-vWorld);\n bool underwater=!gl_FrontFacing;\n if(underwater)n=-n;\n vec2 p=vWorld.xz;\n vec2 slopes=fineWaveSlopes(p,uTime);\n // Keep the actual displaced wave normal dominant; optical ripples are\n // strongest close to the eye and taper with distance to prevent aliasing.\n float opticalFade=mix(.42,1.,1.-smoothstep(32.,155.,length(uEye-vWorld)));\n float opticalAmount=underwater?uCeilingDetail:0.56;\n // Match the physical surface's short waves on both sides. The underwater\n // ripples are more subdued and diminish with depth to avoid aliasing.\n vec2 microRipples=surfaceMicroSlopes(p,uTime);\n float underwaterMicro=.32*clamp(uUnderside31,0.,1.)*\n   exp(-max(0.,-uEye.y)*.05/max(uClarity,.25));\n vec2 surfaceRipples=underwater?microRipples*underwaterMicro:microRipples;\n vec2 opticalSlopes=slopes*opticalAmount+\n   surfaceRipples*clamp(uSurfaceDetail,0.,2.)*.85;\n // Match optical slope orientation across both sides of the moving surface.\n float faceSign=underwater?1.:-1.;\n n=normalize(n+vec3(opticalSlopes.x*faceSign,0.,opticalSlopes.y*faceSign)*opticalFade);\n float cosTheta=clamp(dot(n,V),0.,1.);\n float etaI=underwater?1.333:1.0;\n float etaT=underwater?1.0:1.333;\n float fresnel=fresnelDielectric(cosTheta,etaI,etaT);\n float eta=etaI/etaT;\n vec3 exitRay=refract(-V,n,eta);\n bool totalInternalReflection=dot(exitRay,exitRay)<.00001;\n if(totalInternalReflection)fresnel=1.;\n float sunSpark=surfaceSunGlint(n,V,p,uTime);\n if(!underwater){\n  // Real scene-color sample contains seabed and rocks. Normal deflection\n  // refracts that scene image at reduced resolution; no recursive render.\n  vec2 uv=gl_FragCoord.xy/max(uViewport,vec2(1.));\n  // View-dependent wave refraction. A fine gradient adds rippling to the\n  // existing scene-color buffer; small spectral offsets approximate\n  // wavelength-dependent refraction without additional capture passes.\n  // Phase 1: depth is measured before distortion, preventing feedback and edge smearing.\n  float surfaceRange=length(uEye-vWorld);\n  float originalDepth=texture2D(uSceneDepthTex,uv).r;\n  float originalRange=cameraDistanceFromDepth(originalDepth,uCameraNear,uCameraFar);\n  float originalThickness=max(0.,originalRange-surfaceRange);\n  float validOriginal=1.-step(.9999,originalDepth);\n  float depthControl=clamp(uDepthRefraction,0.,1.);\n  float lensStrength=mix(1.,mix(.12,1.,1.-exp(-originalThickness*.20)),\n                         validOriginal*depthControl);\n  vec2 waveBend=vec2(n.x,n.z)*(.018+.025*(1.-cosTheta));\n  waveBend+=vec2(slopes.x,slopes.y)*.006;\n  vec2 distortion=waveBend*clamp(uRefraction,0.,1.8)*lensStrength;\n  vec2 warped=clamp(uv+distortion,vec2(.005),vec2(.995));\n  float sampledDepth=texture2D(uSceneDepthTex,warped).r;\n  float sceneRange=cameraDistanceFromDepth(sampledDepth,uCameraNear,uCameraFar);\n  float thickness=max(0.,sceneRange-surfaceRange);\n  float hasScene=1.-step(.9999,sampledDepth);\n  // Suppress foreground/background mixing at depth discontinuities.\n  float depthDiscontinuity=abs(sceneRange-originalRange);\n  float edgeGuard=validOriginal*hasScene*depthControl*\n    smoothstep(max(1.5,originalThickness*.22),max(3.,originalThickness*.65),depthDiscontinuity);\n  warped=mix(warped,uv,edgeGuard);\n  float spectralShift=.00035*clamp(uRefraction,0.,1.8)*lensStrength*(1.-edgeGuard);\n  float red=texture2D(uSceneTex,clamp(warped+vec2(spectralShift,0.),vec2(.005),vec2(.995))).r;\n  float green=texture2D(uSceneTex,warped).g;\n  float blue=texture2D(uSceneTex,clamp(warped-vec2(spectralShift,0.),vec2(.005),vec2(.995))).b;\n  float depthVisibility=mix(1.,clamp(1.-exp(-originalThickness*.28),.45,1.),\n                            validOriginal*depthControl);\n  vec3 behind=mix(vec3(.014,.20,.27),\n    vec3(red,green,blue),clamp(uRefraction,0.,1.));\n  float distanceToEye=surfaceRange;\n  float detail=clamp(uSurfaceDetail,0.,2.);\n  // Clear tropical shallows have a cyan transmitted base. The water\n  // gradually takes on darker ocean color at shallow grazing angles.\n  vec3 shallowTint=vec3(.018,.36,.40);\n  vec3 deeperTint=vec3(.012,.14,.24);\n  float depthColor=smoothstep(18.,180.,distanceToEye);\n  vec3 waterBody=mix(shallowTint,deeperTint,depthColor);\n  vec3 spectral=exp(vec3(-.18,-.078,-.037)*max(1.,2.1/uClarity));\n  // Seabed and rocks remain visible nearby; longer paths take on ocean\n  // absorption and scattering. This is still a screen-space approximation.\n  float nearScene=1.-smoothstep(25.,130.,distanceToEye);\n  // Nearby water should transmit the captured seabed and rocks,\n  // whereas the distant horizon remains appropriately attenuated.\n  // Use a finite shallow-water path rather than a full-screen tint.\n  float shallowVisibility=clamp(uClarity*.65,.25,1.20);\n  float sceneMix=mix(.29,.94,nearScene)*shallowVisibility;\n  // Height and steepness modulate path length through the shallow wave\n  // lens: thin high crests transmit clearer turquoise light, whereas\n  // troughs collect more depth color. Nearby scene color stays visible.\n  float waveHeight=vWorld.y/max(uHeight,.2);\n  float crestLens=smoothstep(-.40,.85,waveHeight);\n  float faceSlope=clamp(length(vWaveNormal.xz),0.,.8);\n  float localOpticalDepth=mix(1.20,.76,crestLens)+faceSlope*.24;\n  vec3 transmitted=mix(waterBody,\n    behind*pow(spectral,vec3(localOpticalDepth))+waterBody*.09,\n    clamp(sceneMix*depthVisibility,0.,.96));\n  // Preserve the true angle-based reflection ratio; the additional\n  // roughness is carried by the animated normal, not a flat gloss overlay.\n  // Angular reflection from the wave face plus a slightly broadened\n  // lobe from nearby capillary facets. This reveals structured sky/clouds\n  // without inventing a mirrored environment or introducing another pass.\n  vec3 reflectedDir=reflect(-V,n);\n  vec3 reflection=sky(reflectedDir);\n  vec3 broadDir=normalize(reflectedDir+vec3(slopes.x*.06,0.,slopes.y*.06));\n  vec3 broadReflection=sky(broadDir);\n  // Roughness follows wave energy: crests show tighter broken sky\n  // reflections and choppy troughs slightly broaden them.\n  float localTilt=clamp(length(vWaveNormal.xz),0.,1.);\n  float microEnergy=clamp(length(surfaceRipples)*3.0+\n     length(slopes)*1.35,0.,1.);\n  float crestSmooth=smoothstep(-.20,.95,vWorld.y/max(uHeight,.2));\n  float microRoughness=clamp(.12+.25*microEnergy-.065*crestSmooth,.06,.35);\n  reflection=mix(reflection,broadReflection,microRoughness);\n  // Low-resolution scene capture projected from a planar reflection camera.\n  // The procedural sky stays available outside the captured frustum.\n  if(uMirrorStrength>.001){\n    vec4 reflectionClip=uMirrorVP*vec4(vWorld,1.);\n    vec2 mirrorUV=reflectionClip.xy/max(abs(reflectionClip.w),.001)*.5+.5;\n    vec2 mirrorWarp=mirrorUV+vec2(n.x,n.z)*.007;\n    float within=step(0.,mirrorWarp.x)*step(mirrorWarp.x,1.)*\n       step(0.,mirrorWarp.y)*step(mirrorWarp.y,1.)*\n       step(.001,reflectionClip.w);\n    float environmentWeight=within*clamp(uMirrorStrength,0.,1.);\n    vec3 sceneReflection=texture2D(uMirrorTex,clamp(mirrorWarp,.003,.997)).rgb;\n    reflection=mix(reflection,sceneReflection,environmentWeight);\n  }\n  // True Fresnel remains the dominant term; local normals create its\n  // natural moving variation rather than a fixed additive gloss.\n  float diffuseRippleFill=.008+.025*localTilt+\n    .012*microEnergy*(1.-crestSmooth);\n  float skyShare=clamp(fresnel+(1.-fresnel)*diffuseRippleFill,0.,.96);\n  vec3 outColor=mix(transmitted,reflection,skyShare);\n  // Crest-to-trough shading: locally tilted leeward facets receive less\n  // direct sky and retain dark blue-green water, while crests stay bright.\n  vec3 sunDir=normalize(vec3(.37,.54,-.7));\n  float litFace=clamp(dot(n,sunDir)*.95+.24,.0,1.);\n  float trough=1.-smoothstep(-.90,.40,vWorld.y/max(uHeight,.25));\n  // Blend shaded wave-face contrast continuously; smooth crest regions\n  // keep their water color while troughs look optically deeper.\n  float faceOcclusion=(1.-litFace)*.25+trough*.24;\n  float waveContrast=clamp(uSurfaceDetail,0.,2.);\n  vec3 troughColor=mix(vec3(.008,.085,.13),vec3(.024,.23,.27),litFace);\n  outColor=mix(outColor,mix(outColor*.68,troughColor,.42),\n               clamp(faceOcclusion*waveContrast,0.,.47));\n  // Small intermittent foam patches on high, steep crests. Foam is\n  // advected by the same wave time; noise already exists in this shader.\n  float crestSlope=length(vWaveNormal.xz);\n  float streak=cloudNoise(p*1.07+vec2(-uTime*.32,uTime*.19));\n  float flecks=cloudNoise(p*3.1+vec2(uTime*.18,-uTime*.28));\n  // Broken spatial coverage: large patches with much smaller bubbles.\n  float coverage=smoothstep(.38,.59,streak*.68+flecks*.32);\n  float crestMask=smoothstep(.06,.23,crestSlope);\n  float foamControl=clamp(uCrestFoam,0.,2.);\n  // Light foam starts on the leading face, then concentrates at high crests.\n  // Wave-face variation modulates breaking froth instead of placing\n  // identical foam on every crest.\n  float crestGrouping=.72+.28*sin(p.x*.17-p.y*.11-uTime*.36);\n  float foamEnergy=vCrest*(.44+.56*crestMask)*crestGrouping;\n  float foam=foamEnergy*coverage*foamControl;\n  float fleckMask=smoothstep(.57,.78,flecks*.66+streak*.34);\n  vec3 foamTint=mix(vec3(.66,.84,.84),vec3(.87,.95,.92),fleckMask);\n  float foamOpacity=clamp(foam*(.48+.44*fleckMask),0.,.82);\n  outColor=mix(outColor,foamTint,foamOpacity);\n  // Sporadic detached froth immediately downwind of steep crests.\n  float stray=smoothstep(.74,.88,flecks)*crestMask*vCrest*.24*foamControl;\n  outColor=mix(outColor,vec3(.79,.91,.91),min(stray,.23));\n  // Restore small individual sun facets at near/far distances while\n  // limiting the blown-out white streaks of earlier builds.\n  // Sun glitter combines the physically bounded microfacet lobe with\n  // sparse moving sparkles. Avoid the saturated continuous white ribbon.\n  float rough=clamp(.18+.12*microEnergy-.045*crestSmooth,.14,.31);\n  float microfacet=ggxSunBRDF(n,V,sunDir,rough);\n  float speckle=cloudNoise(p*3.8+vec2(uTime*.44,-uTime*.26));\n  float fleck=smoothstep(.58,.86,speckle);\n  vec3 solar=vec3(1.0,.92,.77)*\n    (microfacet*.67+sunSpark*.22*fleck)*\n    clamp(uGlint,0.,2.5)*mix(1.,.72,depthColor);\n  outColor+=solar;\n  // Gentle horizon aerial perspective. Keep nearby water sufficiently\n  // saturated to show the wave material's actual optical structure.\n  float atmospheric=1.-exp(-distanceToEye*.0009);\n  outColor=mix(outColor,vec3(.37,.57,.68),atmospheric);\n  gl_FragColor=vec4(outColor,1.);\n }else{\n  // Lab 10.2: render the *underside* with the moving Snell aperture.\n  // Fresnel and total internal reflection still define the physical edge;\n  // the artistic controls only affect permitted transmitted light.\n  float depth=max(0.,-uEye.y);\n  float clarity=max(uClarity,.25);\n  float penetration=clamp(uPenetration,0.,2.);\n  float windowGain=clamp(uUndersideWindow,0.,2.);\n  float shimmerGain=clamp(uUndersideShimmer,0.,2.);\n  vec3 skyDir=normalize(exitRay+vec3(0.,.0001,0.));\n  vec3 sunDir=normalize(vec3(.37,.54,-.7));\n  float transmittance=totalInternalReflection?0.:(1.-fresnel);\n  // Visibility from below is an optical cone, not an unrestricted top light:\n  // the surface normal's local wave tilt animates its contour.\n  float upward=clamp(skyDir.y,0.,1.);\n  // Transmission is determined by Snell and Fresnel, not an additional\n  // narrow cone that suppresses almost all visible skylight.\n  // Only fade rays grazing the refracted sky horizon.\n  float skyVisibility=smoothstep(.0,.11,upward);\n  float aperture=skyVisibility*transmittance;\n  vec3 skyRadiance=sky(skyDir);\n  // In shallow water the underside sees the whole upper sky through\n  // Snell's window. Compress excessively bright cloud lobes, preserving\n  // the moving refraction boundary and a soft blue/turquoise hue.\n  vec3 balancedSky=min(skyRadiance,vec3(.38,.58,.68));\n  skyRadiance=mix(skyRadiance,balancedSky,clamp(uUnderside33,0.,1.));\n  // Capture the above-water scene through the moving underside.\n  // Screen-space ray bending is a lightweight approximation; source depth\n  // prevents foreground objects being distorted as if infinitely distant.\n  if(uDepthRefraction>.001){\n    vec2 screenUV=gl_FragCoord.xy/max(uViewport,vec2(1.));\n    vec2 bend=vec2(n.x,n.z)*(.018+.022*(1.-abs(dot(n,V))));\n    vec2 captureUV=clamp(screenUV+bend*clamp(uRefraction,0.,1.8),\n                         vec2(.003),vec2(.997));\n    float capturedZ=texture2D(uSceneDepthTex,captureUV).r;\n    float hitRange=cameraDistanceFromDepth(capturedZ,uCameraNear,uCameraFar);\n    float distanceAboveSurface=max(0.,hitRange-length(uEye-vWorld));\n    float objectMask=1.-step(.9998,capturedZ);\n    vec3 capturedSky=texture2D(uSceneTex,captureUV).rgb;\n    // Actual objects above the water override the procedural sky where\n    // depth says geometry was captured; elsewhere retain sky with clouds.\n    // The scene-color background is not a valid refracted sky sample:\n    // from an underwater camera it can be an unlit background hemisphere.\n    // Only replace sky radiance when depth confirms real geometry.\n    float legacyWeight=mix(.28,.89,objectMask);\n    float physicalWeight=.92*objectMask;\n    float sceneWeight=clamp(uDepthRefraction,0.,1.)*\n      mix(legacyWeight,physicalWeight,clamp(uUnderside32,0.,1.))*\n      (.65+.35*exp(-distanceAboveSurface*.03));\n    skyRadiance=mix(skyRadiance,capturedSky,sceneWeight);\n  }\n  vec3 spectral=exp(-vec3(.135,.061,.030)*depth/clarity);\n  float solarView=max(dot(skyDir,sunDir),0.);\n  float sunHalo=pow(solarView,10.);\n  float sunCore=pow(solarView,62.);\n  vec3 sunTransmission=vec3(1.0,.90,.68)*\n     (sunCore*1.85+sunHalo*.50)*uSun;\n  float waveLensing=.5+.5*sin(dot(p,vec2(.76,.36))*1.24-uTime*1.35\n      +.48*sin(p.y*.84+uTime*.71));\n  waveLensing*=.56+.44*(.5+.5*sin(dot(p,vec2(-.39,.92))*2.12+uTime*2.37));\n  // Small-slope variations create broken glints rather than an\n  // uninterrupted periodic stripe. Preserve the older pattern at 0.\n  float microLens=.5+.5*sin(dot(p+microRipples*1.7,\n      vec2(.41,-.68))*2.31-uTime*1.83);\n  waveLensing=mix(waveLensing,\n    waveLensing*(.64+.36*microLens),clamp(uUnderside31,0.,1.));\n  // Smooth narrow bands and soft luminous streaks follow displaced normals,\n  // with a sun-dependent focus rather than arbitrary full-screen stripes.\n  float refractionGlint=pow(clamp(waveLensing,0.,1.),3.3)*\n      (.32+.68*pow(solarView,3.));\n  // A compact, view-dependent approximation to participating-media\n  // scattering just below the surface. Extinction remains depth-driven.\n  float shallowVolume=exp(-depth*.24/clarity);\n  float forwardScatter=pow(max(dot(skyDir,sunDir),0.),4.);\n  // Surface-dependent scattering adds a moving light field, strongest\n  // in the sun direction and quickly extinguished with depth. This is\n  // deliberately bounded so distant backgrounds remain dark.\n  float waveTransmission=.50+.50*sin(dot(p,vec2(.39,.74))*.47-\n    uTime*.79+.33*sin(dot(p,vec2(-.64,.27))*.31+uTime*.43));\n  float shaftConcentration=pow(waveTransmission,3.);\n  vec3 scatteredSky=vec3(.045,.14,.17)*shallowVolume*\n     (.40+.60*forwardScatter)*clamp(uVolumeScattering,0.,1.);\n  scatteredSky+=vec3(.025,.078,.070)*shaftConcentration*\n     shallowVolume*(.25+.75*forwardScatter)*\n     clamp(uVolumeScattering,0.,1.);\n  vec3 refracted=(skyRadiance*(.75+.25*upward)+sunTransmission)\n       *spectral*uSun*mix(.83,1.36,windowGain*.5)\n       +scatteredSky*skyVisibility*uSun;\n  // Refracted background is bright only inside the Snell cone, not a\n  // full-screen white/cyan patch. Tonemap transmitted radiance gently,\n  // without modifying the above-water surface or the reef materials.\n  vec3 softRefracted=refracted/(vec3(1.)+refracted*.65);\n  refracted=mix(refracted,softRefracted,clamp(uUnderside33,0.,1.));\n  // Give transmitted upper-hemisphere light a physically decreasing\n  // contribution along the actual water depth, but do not brighten\n  // totally internally reflected regions.\n  float shallowTransmission=exp(-depth*.12/clarity);\n  vec3 directSkyFill=vec3(.11,.235,.26)*shallowTransmission*\n    (.55+.45*upward)*uSun*clamp(uUnderside32,0.,1.);\n  refracted+=directSkyFill*skyVisibility;\n  // Highlight paths are transmitted once in the final Fresnel mix.\n  // Do not multiply these by transmittance a second time.\n  refracted+=vec3(.40,.74,.79)*refractionGlint*\n     shimmerGain*skyVisibility*.55*uSun*spectral;\n  // Under total internal reflection, reflect light from water below.\n  // A subtle rippling lower hemisphere is visible without flooding the rim.\n  vec3 reflectedDir=reflect(-V,n);\n  vec3 inner=underwaterReflectedEnvironment(reflectedDir,vWorld,uTime);\n  // A wave underside reflects the illuminated water volume and seabed,\n  // rather than an entirely black hemisphere when the ray is outside\n  // the Snell window. This diffuse reflected contribution drops with\n  // depth and is strongest on upward-facing wave pockets.\n  float submergedDaylight=exp(-depth*.16/clarity)*uSun;\n  float pocket=max(dot(n,vec3(0.,-1.,0.)),0.);\n  vec3 reflectedWater=vec3(.045,.145,.156)*submergedDaylight*\n    (.42+.58*pocket);\n  inner+=reflectedWater*clamp(uUnderwaterOptics,0.,1.);\n  // Reflect the *underwater environment* seen by the mirrored camera.\n  // Captured rock and seabed geometry is blended with the stable water\n  // reflection only where the mirrored camera covers the fragment.\n  if(uMirrorStrength>.001){\n    vec4 mirrorClip=uMirrorVP*vec4(vWorld,1.);\n    vec2 mirrorUV=mirrorClip.xy/max(abs(mirrorClip.w),.001)*.5+.5;\n    vec2 mirrorWarp=mirrorUV+vec2(n.x,n.z)*.006;\n    float inView=step(.01,mirrorWarp.x)*step(mirrorWarp.x,.99)*\n      step(.01,mirrorWarp.y)*step(mirrorWarp.y,.99)*\n      step(.001,mirrorClip.w);\n    vec3 reflectedScene=texture2D(uMirrorTex,clamp(mirrorWarp,.003,.997)).rgb;\n    float reflectionDepth=exp(-depth*.075/clarity);\n    inner=mix(inner,reflectedScene,\n      clamp(uMirrorStrength,0.,1.)*inView*reflectionDepth*.80);\n  }\n  // Broad daylight entering from above scatters through the upper water\n  // column. It is not a screen-space bright overlay: incidence, the\n  // underside orientation and the camera's depth govern its intensity.\n  // Suppress this fill as the light path approaches total internal\n  // reflection; retain the reflected wave texture below the critical angle.\n  float sunOnSurface=max(dot(-n,sunDir),0.);\n  float skyOnSurface=.36+.64*sunOnSurface;\n  float skylightPath=exp(-depth*.18/clarity);\n  float lensExposure=skyVisibility*(.40+.60*transmittance);\n  vec3 waterSkylight=vec3(.065,.19,.205)*skylightPath*\n    skyOnSurface*lensExposure*uSun;\n  inner+=waterSkylight*clamp(uUnderwaterOptics,0.,1.);\n  float reflectedWave=.5+.5*sin(p.x*1.56+p.y*.61+uTime*1.35)*\n                            sin(p.y*1.90-p.x*.37-uTime*1.71);\n  inner+=vec3(.035,.10,.12)*pow(reflectedWave,2.)*.35*uSun;\n  // Refracted sky is limited to the Snell aperture. Total internal\n  // reflection remains entirely the underwater reflected environment.\n  // The Snell window is tied to locally perturbed wave normals.\n  // Preserve total internal reflection at the critical angle.\n  vec3 resultColor=mix(inner,refracted,transmittance*skyVisibility);\n  // Backscattered daylight peaks just below the ceiling, then decays\n  // smoothly with vertical water depth rather than uniformly tinting it.\n  float surfaceHalo=exp(-depth*.21/clarity);\n  resultColor+=vec3(.028,.105,.132)*skyVisibility*\n    surfaceHalo*penetration*windowGain*uSun*\n    (.35+.65*transmittance);\n  // Sun-facing crest pockets carry subtle warm highlights; their shape\n  // follows the animated displaced normal rather than a static texture.\n  float undersideCrest=smoothstep(-.12,.80,\n    vWorld.y/max(uHeight,.2));\n  float lightPocket=pow(max(dot(-n,sunDir),0.),4.);\n  vec3 undersideGlint=vec3(.18,.24,.20)*lightPocket*\n    undersideCrest*surfaceHalo*uSun*transmittance;\n  resultColor+=undersideGlint*clamp(uUnderwaterOptics,0.,1.);\n  // Thin, refracted light filaments track surface curvature. Color is\n  // absorbed along the camera-to-surface path; this is not a flat glow.\n  float curvatureSignal=length(microRipples)*3.1+\n     length(slopes)*1.25;\n  float focusBand=smoothstep(.18,.56,curvatureSignal)*\n     (1.-smoothstep(.68,1.1,curvatureSignal));\n  float skylightTransmission=transmittance*skyVisibility*\n     exp(-depth*.19/clarity);\n  vec3 subSurfaceFocus=vec3(.075,.16,.13)*focusBand*\n     skylightTransmission*uSun*clamp(uUnderside31,0.,1.);\n  resultColor+=subSurfaceFocus;\n  // Preserve contrast between refracted skylight and reflected water;\n  // the extra illumination is strictly confined to the Snell window.\n  resultColor*=uCeilingLight;\n  // Prevent a few concentrated highlights from saturating into flat\n  // white while keeping physically motivated Fresnel/TIR contrast.\n  vec3 compressed=resultColor/(vec3(1.)+resultColor*.32);\n  resultColor=mix(resultColor,compressed,clamp(uUnderside33,0.,1.));\n  gl_FragColor=vec4(resultColor,1.);\n }\n}";

// Water Lab 11.1: stable GPU wave-equation integration.
// Half-float preserves subpixel water height and velocity, avoiding the
// 8-bit round-trip quantization that caused standing jitter in 11.0.
const simResolution=128;
const simHalfFloat=renderer.extensions.has("EXT_color_buffer_float")||
 renderer.extensions.has("EXT_color_buffer_half_float");
const simPacked=!simHalfFloat;
const simZero=simPacked?128/255:0;
const simDecode=simPacked?2:1;
waterUniforms.uSimZero.value=simZero;
waterUniforms.uSimDecode.value=simDecode;
const simUniforms={uState:{value:null},uTexel:{value:1/simResolution},
 uImpulse:{value:new THREE.Vector2(.5,.5)},uKick:{value:0},
 uReset:{value:1},uPacked:{value:simPacked?1:0}};
const simScene=new THREE.Scene();
const simCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
const simMaterial=new THREE.ShaderMaterial({
 uniforms:simUniforms,depthTest:false,depthWrite:false,
 vertexShader:"varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}",
 fragmentShader:`precision highp float;
 varying vec2 vUv;uniform sampler2D uState;
 uniform float uTexel,uKick,uReset,uPacked;uniform vec2 uImpulse;
 float decode(float s){return uPacked>.5?(s-128./255.)*2.:s;}
 float encode(float s){return uPacked>.5?128./255.+s*.5:s;}
 void main(){
  if(uReset>.5){gl_FragColor=vec4(encode(0.),encode(0.),0.,1.);return;}
  vec2 dx=vec2(uTexel,0.),dy=vec2(0.,uTexel);
  vec4 s=texture2D(uState,vUv);
  float h=decode(s.r),prev=decode(s.g);
  float lap=decode(texture2D(uState,vUv+dx).r)+
            decode(texture2D(uState,vUv-dx).r)+
            decode(texture2D(uState,vUv+dy).r)+
            decode(texture2D(uState,vUv-dy).r)-4.*h;
  // Two-dimensional CFL-stable finite difference integration.
  float next=1.978*h-.978*prev+.18*lap;
  vec2 dist=abs(vUv-uImpulse);dist=min(dist,1.-dist);
  next+=uKick*exp(-dot(dist,dist)/.00050);
  next=clamp(next,-.32,.32);
  // Quantized fallback: snap truly tiny oscillations to neutral.
  if(uPacked>.5 && abs(next)<.006 && abs(h)<.006){
    next=0.;h=0.;
  }
  gl_FragColor=vec4(encode(next),encode(h),0.,1.);
 }`
});
simScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2,2),simMaterial));
function newSimTarget(){return new THREE.WebGLRenderTarget(simResolution,simResolution,{
 minFilter:simHalfFloat?THREE.LinearFilter:THREE.NearestFilter,
 magFilter:simHalfFloat?THREE.LinearFilter:THREE.NearestFilter,
 wrapS:THREE.RepeatWrapping,wrapT:THREE.RepeatWrapping,
 type:simHalfFloat?THREE.HalfFloatType:THREE.UnsignedByteType,
 format:THREE.RGBAFormat,depthBuffer:false,stencilBuffer:false,
 generateMipmaps:false
});}
const simTargets=[newSimTarget(),newSimTarget()];
let simIndex=0,simAccumulator=0,simLastTime=0,pendingSplash=null;
function stepSimulation(splash=null,reset=false){
 const next=1-simIndex;
 simUniforms.uState.value=simTargets[simIndex].texture;
 simUniforms.uKick.value=splash?.power||0;
 simUniforms.uReset.value=reset?1:0;
 if(splash)simUniforms.uImpulse.value.copy(splash.uv);
 const previousTarget=renderer.getRenderTarget();
 try{renderer.setRenderTarget(simTargets[next]);renderer.render(simScene,simCamera);simIndex=next;}
 finally{renderer.setRenderTarget(previousTarget);}
 waterUniforms.uSimTex.value=simTargets[simIndex].texture;
}
stepSimulation(null,true);
function splashAt(x,z,power=.12){pendingSplash={uv:new THREE.Vector2(
 ((x/128+.5)%1+1)%1,((z/128+.5)%1+1)%1),power};}
function advanceSimulation(t){
 simAccumulator+=Math.max(0,Math.min(.05,t-simLastTime));
 simLastTime=t;
 let steps=0;
 while(simAccumulator>=1/60&&steps<2){
  simAccumulator-=1/60;
  stepSimulation(pendingSplash);
  pendingSplash=null;
  steps++;
 }
 if(steps===2)simAccumulator=Math.min(simAccumulator,1/60);
 waterUniforms.uSimStrength.value=params.simulation;
}

const geom=new THREE.PlaneGeometry(560,560,mobile?170:244,mobile?170:244);
geom.rotateX(-Math.PI/2);
const ocean=new THREE.Mesh(geom,new THREE.ShaderMaterial({
 uniforms:waterUniforms,vertexShader:waterVert,fragmentShader:waterFrag,side:THREE.DoubleSide
}));
ocean.frustumCulled=false;
scene.add(ocean);
// Render a lower-resolution scene color without the water, once per visible
// above-water frame, and refract it with the moving wave normal.
const refractionTarget=new THREE.WebGLRenderTarget(16,16,{
 minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
 depthBuffer:true,stencilBuffer:false
});
// Reuse the existing scene-color pass, adding actual scene depth for
// thickness-aware transmission. Leave the old non-depth path selectable.
refractionTarget.depthTexture=new THREE.DepthTexture(16,16,THREE.UnsignedIntType);
refractionTarget.depthTexture.minFilter=THREE.NearestFilter;
refractionTarget.depthTexture.magFilter=THREE.NearestFilter;
const reflectionTarget=new THREE.WebGLRenderTarget(16,16,{
 minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
 depthBuffer:true,stencilBuffer:false
});
const mirrorCamera=camera.clone();
const mirrorDirection=new THREE.Vector3();
const mirrorPoint=new THREE.Vector3();
const sceneReflectVP=new THREE.Matrix4();
waterUniforms.uSceneDepthTex.value=refractionTarget.depthTexture;
waterUniforms.uMirrorTex.value=reflectionTarget.texture;
const viewportPx=new THREE.Vector2();
function resizeRefraction(){
 renderer.getDrawingBufferSize(viewportPx);
 refractionTarget.setSize(Math.max(8,Math.floor(viewportPx.x*(mobile?.48:.67))),
                          Math.max(8,Math.floor(viewportPx.y*(mobile?.48:.67))));
 waterUniforms.uViewport.value.copy(viewportPx);
 waterUniforms.uSceneTex.value=refractionTarget.texture;
 reflectionTarget.setSize(Math.max(8,Math.floor(viewportPx.x*(mobile?.32:.50))),Math.max(8,Math.floor(viewportPx.y*(mobile?.32:.50))));
}
resizeRefraction();
const backdrop=new THREE.Mesh(new THREE.SphereGeometry(700,24,16),new THREE.ShaderMaterial({
 uniforms:{uUnder:{value:0},uTime:waterUniforms.uTime,uSun:waterUniforms.uSun,uClarity:waterUniforms.uClarity,uDepth:{value:0},uVolume:{value:1},uShafts:{value:1},uPenetration:waterUniforms.uPenetration,uUndersideWindow:waterUniforms.uUndersideWindow},
 side:THREE.BackSide,depthWrite:false,
 vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:"precision highp float;\nvarying vec3 vDir;\nuniform float uUnder,uTime,uSun,uClarity,uDepth,uVolume,uShafts,uPenetration,uUndersideWindow;\nfloat cloudHash(vec2 p){\n return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);\n}\nfloat cloudNoise(vec2 p){\n vec2 i=floor(p),f=fract(p);\n vec2 u=f*f*(3.-2.*f);\n return mix(mix(cloudHash(i),cloudHash(i+vec2(1.,0.)),u.x),\n            mix(cloudHash(i+vec2(0.,1.)),cloudHash(i+vec2(1.,1.)),u.x),u.y);\n}\n// Project cloud layers on an overhead sky plane rather than repeating\n// sinusoids on the sphere (which made vertical white bands).\nfloat cloudCoverage(vec3 dir,float t){\n float altitude=max(dir.y,.025);\n vec2 q=dir.xz/(altitude+.25)*1.75+vec2(t*.004,-t*.0014);\n float low=cloudNoise(q*.73);\n float medium=cloudNoise(q*1.45+vec2(11.2,-7.9));\n float fine=cloudNoise(q*2.9+vec2(-6.1,4.7));\n float mass=low*.53+medium*.34+fine*.13;\n float cloud=smoothstep(.46,.64,mass);\n return cloud*smoothstep(-.015,.16,dir.y)*.65;\n}\nvoid main(){\n vec3 d=normalize(vDir);\n float h=clamp(d.y*.5+.5,0.,1.);\n vec3 air=mix(vec3(.67,.84,.93),vec3(.12,.40,.75),pow(h,.75));\n \nfloat cloud=cloudCoverage(d,uTime);\n air=mix(air,vec3(.91,.93,.95),cloud);\n float up=smoothstep(-.18,.88,d.y);\n vec3 sigma=vec3(.115,.056,.027)/max(uClarity,.25);\n vec3 sunlight=exp(-sigma*uDepth);\n // Shallow water receives diffuse sunlight from the whole upper\n // hemisphere, including horizontal sightlines, not only straight up.\n // Retain exponential extinction, so deep water remains dark.\n float nearSurface=exp(-uDepth*.065/max(uClarity,.25));\n float skyHemisphere=.42+.58*up;\n vec3 base=vec3(.024,.11,.15)*nearSurface*uSun;\n vec3 upwardSky=vec3(.15,.42,.46)*sunlight*skyHemisphere*uSun*\n   mix(.75,1.20,clamp(uPenetration,0.,2.)*.5);\n vec3 scattered=vec3(.026,.145,.175)*(1.-exp(-uDepth*.095/\n   max(uClarity,.25)))*uSun;\n float a=sin(d.x*14.+d.z*9.+uTime*.43);\n float b=sin(d.z*16.-d.x*6.-uTime*.51);\n float beam=pow(clamp(.5+.5*a*b,0.,1.),3.);\n float shaftDepth=exp(-uDepth*.072/max(uClarity,.25));\n vec3 shafts=vec3(.065,.15,.14)*beam*up*shaftDepth*uShafts*uSun*uPenetration;\n float surfaceGlow=exp(-uDepth*.24/max(uClarity,.25))*up;\n vec3 windowScatter=vec3(.040,.16,.19)*surfaceGlow*uSun*\n   clamp(uUndersideWindow,0.,2.)*\n   clamp(uPenetration,0.,2.);\n vec3 volumetric=base+upwardSky+scattered+shafts+windowScatter;\n vec3 legacy=vec3(.009,.070,.114)+vec3(.075,.40,.47)*up*\n   exp(-uDepth*.066/max(uClarity,.25))*uSun;\n vec3 sea=mix(legacy,volumetric,clamp(uVolume,0.,1.));\n // A distant horizontal sightline spans a long water path even when\n // the camera is shallow. Use a consistent dim blue-green water column,\n // rather than showing near-surface skylight at infinite distance.\n float horizontal=1.-smoothstep(-.10,.24,d.y);\n float farWater=horizontal*(1.-exp(-uDepth*.20/max(uClarity,.25)));\n vec3 horizonColor=vec3(.012,.065,.082)*uSun;\n sea=mix(sea,horizonColor,max(horizontal*.66,farWater*.78));\n sea=mix(sea,vec3(.003,.019,.04),smoothstep(35.,130.,uDepth));\n gl_FragColor=vec4(mix(air,sea,uUnder),1.);\n}"
}));
backdrop.renderOrder=-100;
scene.add(backdrop);
// Water Lab 04: both seabed and rock faces use exactly the same moving
// world-space caustic functions, light extinction and optical projection.
const bottomMat=new THREE.ShaderMaterial({
 uniforms:{uTime:waterUniforms.uTime,uClarity:waterUniforms.uClarity,uHeight:waterUniforms.uHeight,uChop:waterUniforms.uChop,uSwellComplexity:waterUniforms.uSwellComplexity,uSun:waterUniforms.uSun,uCaustics:{value:1},uCausticSpeed:{value:1},uCausticCurvature:{value:1},uCausticFocus:{value:1},uVolume:{value:1},uShafts:{value:1},uPenetration:waterUniforms.uPenetration,uPhysicalLight:{value:1},uSimTex:waterUniforms.uSimTex,uSimStrength:waterUniforms.uSimStrength,uSimTexel:waterUniforms.uSimTexel,uSimZero:waterUniforms.uSimZero,uSimDecode:waterUniforms.uSimDecode,uShadowMap:{value:null},uLightVP:{value:new THREE.Matrix4()},uOcclusion:{value:1},uEye:waterUniforms.uEye},
 vertexShader:"varying vec3 vWorld;\nvoid main(){\n vec4 w=modelMatrix*vec4(position,1.0);\n vWorld=w.xyz;\n gl_Position=projectionMatrix*viewMatrix*w;\n}",
 fragmentShader:"precision highp float;\nuniform float uTime,uClarity,uHeight,uChop,uSun,uCaustics,uCausticSpeed,uCausticCurvature,uCausticFocus;\nuniform float uSwellComplexity,uSimStrength,uSimTexel,uSimZero,uSimDecode;\nuniform sampler2D uSimTex;\nuniform float uPenetration,uPhysicalLight;\nuniform vec3 uEye;\nvarying vec3 vWorld;\nvec2 cellHash(vec2 p){\n  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));\n  return fract(sin(p)*43758.5453);\n}\n// Continuous network of focused lines between neighboring wave lenslets.\nvec2 refractedFootprint(vec2 p,float t){\n  float a=dot(p,vec2(.96,.28))*.095-t*.70;\n  float b=dot(p,vec2(.40,.91))*.16-t*1.16;\n  float c=dot(p,vec2(-.71,.70))*.28-t*1.44;\n  float d=dot(p,vec2(.90,-.44))*.49-t*2.10;\n  float e=dot(p,vec2(-.30,-.95))*.88-t*3.45;\n  // Approximate surface slopes of the very same five waves rendered above.\n  vec2 slope=vec2(.96,.28)*(.68*.095*cos(a))\n    +vec2(.40,.91)*(.40*.16*cos(b))\n    +vec2(-.71,.70)*(.24*.28*cos(c))\n    +vec2(.90,-.44)*(.12*.49*cos(d))\n    +vec2(-.30,-.95)*(.055*.88*cos(e));\n  // Additional crossing capillary lenslets produce fast, fine changes.\n  vec2 micro=vec2(\n    sin(p.y*.43+p.x*.15-t*.93)+.48*sin(p.x*.63-p.y*.27+t*1.12),\n    cos(p.x*.39-p.y*.23+t*.84)+.43*cos(p.y*.71+p.x*.13-t*1.32)\n  );\n  return p+clamp(slope*17.0*uHeight,-vec2(2.3),vec2(2.3))\n     +micro*(.30+.13*uChop);\n}\n\n\n// Water Lab 05: low-frequency noise warps the caustic contours into locally\n// rotating, fluid-like ribbons, not straight cells. Derivatives are avoided.\nfloat causticNoise(vec2 p) {\n  vec2 i=floor(p),f=fract(p);\n  vec2 u=f*f*(3.0-2.0*f);\n  float a=cellHash(i).x;\n  float b=cellHash(i+vec2(1.0,0.0)).x;\n  float c=cellHash(i+vec2(0.0,1.0)).x;\n  float d=cellHash(i+vec2(1.0,1.0)).x;\n  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);\n}\nmat2 causticRotation(float a){\n  float c=cos(a),s=sin(a);\n  return mat2(c,-s,s,c);\n}\nvec2 causticFlow(vec2 p,float t){\n  float a=causticNoise(p*.11+vec2(t*.028,-t*.017));\n  float b=causticNoise(p*.13+vec2(11.8,-4.7)+vec2(-t*.023,t*.020));\n  vec2 slow=vec2(a-.5,b-.5)*(2.9*uCausticCurvature);\n  vec2 flowing=vec2(\n    sin(p.y*.17+t*.21)+.42*sin(p.x*.29-p.y*.12-t*.18),\n    cos(p.x*.16-t*.17)+.45*cos(p.y*.32+p.x*.13+t*.24)\n  )*(.68*uCausticCurvature);\n  return p+slow+flowing;\n}\nvec2 curvedRidges(vec2 p,float t){\n  vec2 q=causticFlow(p,t);\n  // Local turning breaks the visual lattice and allows lines to curve in\n  // different directions in different areas of the same rock or sand patch.\n  float theta=(causticNoise(q*.10+vec2(5.1,7.3))-.5)*4.5*uCausticCurvature;\n  vec2 r=causticRotation(theta)*q;\n  float phaseA=r.x*1.24+.76*sin(r.y*.57+t*.32)-t*.63;\n  float phaseB=r.y*1.48+.65*sin(r.x*.62-t*.27)+t*.47;\n  float phaseC=dot(r,vec2(.72,-.69))*1.93+.45*sin(r.y*.82+t*.36)-t*.83;\n  // Multiple crossing contours change topology as the underlying waves\n  // move, but do not form identical square cells or parallel straight rows.\n  float contour=sin(phaseA)*.74+sin(phaseB)*.62+sin(phaseC)*.32;\n  float width=mix(.15,.055,clamp(uCausticFocus*.55,0.0,1.0));\n  float fine=1.0-smoothstep(width*.36,width*1.65,abs(contour));\n  float halo=1.0-smoothstep(width*.8,width*4.4,abs(contour));\n  float clusters=causticNoise(q*.17+vec2(-8.3,9.7));\n  float irregular=mix(.53,1.2,smoothstep(.12,.83,clusters));\n  return vec2(fine,halo)*irregular;\n}\n\nvec3 oceanWaveDerivatives(vec2 p){\n vec2 a=normalize(vec2(.96,.28)),b=normalize(vec2(.40,.91)),c=normalize(vec2(-.71,.70));\n vec2 d=normalize(vec2(.90,-.44)),e=normalize(vec2(-.30,-.95));\n float t=uTime;\n float p1=dot(a,p)*.095-t*.70,p2=dot(b,p)*.16-t*1.16,p3=dot(c,p)*.28-t*1.44;\n float p4=dot(d,p)*.49-t*2.10,p5=dot(e,p)*.88-t*3.45;\n float height=.68*sin(p1)+.40*sin(p2)+.24*sin(p3)+.12*sin(p4)+.055*sin(p5);\n vec2 slope=a*(.68*.095*cos(p1))+b*(.40*.16*cos(p2))+c*(.24*.28*cos(p3))\n  +d*(.12*.49*cos(p4))+e*(.055*.88*cos(p5));\n float complexity=clamp(uSwellComplexity,0.,1.5);\n float crest=max(height,0.);\n slope*=1.+.38*complexity*crest;\n height+=.19*complexity*crest*crest;\n vec2 f=normalize(vec2(-.83,.56)),g=normalize(vec2(.14,-.99));\n float q6=dot(f,p)*.048-uTime*.47+1.3;\n float q7=dot(g,p)*.073-uTime*.63+2.7;\n height+=.53*complexity*sin(q6)+.32*complexity*sin(q7);\n slope+=f*(.53*complexity*.048*cos(q6))+g*(.32*complexity*.073*cos(q7));\n // Perturb the refracted sunlight with the same numerical wave lens.\n vec2 su=fract(p/128.+.5),sx=vec2(uSimTexel,0.),sy=vec2(0.,uSimTexel);\n float sh=(texture2D(uSimTex,su).r-uSimZero)*uSimDecode*5.*uSimStrength;\n float sdx=(texture2D(uSimTex,su+sx).r-texture2D(uSimTex,su-sx).r)*uSimDecode*5.*uSimStrength/(256.*uSimTexel);\n float sdy=(texture2D(uSimTex,su+sy).r-texture2D(uSimTex,su-sy).r)*uSimDecode*5.*uSimStrength/(256.*uSimTexel);\n height+=sh;slope+=vec2(sdx,sdy);\n return vec3(height,slope);\n}\nvec3 oceanHessian(vec2 p){\n vec2 a=normalize(vec2(.96,.28)),b=normalize(vec2(.40,.91)),c=normalize(vec2(-.71,.70));\n vec2 d=normalize(vec2(.90,-.44)),e=normalize(vec2(-.30,-.95));\n float t=uTime;\n float k1=-.68*.095*.095*sin(dot(a,p)*.095-t*.70);\n float k2=-.40*.16*.16*sin(dot(b,p)*.16-t*1.16);\n float k3=-.24*.28*.28*sin(dot(c,p)*.28-t*1.44);\n float k4=-.12*.49*.49*sin(dot(d,p)*.49-t*2.10);\n float k5=-.055*.88*.88*sin(dot(e,p)*.88-t*3.45);\n float complexity=clamp(uSwellComplexity,0.,1.5);\n vec2 f=normalize(vec2(-.83,.56)),g=normalize(vec2(.14,-.99));\n float p6=dot(f,p)*.048-uTime*.47+1.3,p7=dot(g,p)*.073-uTime*.63+2.7;\n float k6=-.53*complexity*.048*.048*sin(p6);\n float k7=-.32*complexity*.073*.073*sin(p7);\n // The asymmetric crest's leading curvature term follows the first five\n // waves; ray focusing remains approximate near strongly sharpened crests.\n return vec3(\n  k6*f.x*f.x+k7*g.x*g.x,\n  k6*f.x*f.y+k7*g.x*g.y,\n  k6*f.y*f.y+k7*g.y*g.y\n )+vec3(\n  k1*a.x*a.x+k2*b.x*b.x+k3*c.x*c.x+k4*d.x*d.x+k5*e.x*e.x,\n  k1*a.x*a.y+k2*b.x*b.y+k3*c.x*c.y+k4*d.x*d.y+k5*e.x*e.y,\n  k1*a.y*a.y+k2*b.y*b.y+k3*c.y*c.y+k4*d.y*d.y+k5*e.y*e.y\n );\n}\n// Surface-coherent approximate sun ray tracing and ray-bundle concentration.\n// Source ray, surface slopes and Hessian follow EXACT ocean wave phase/speed.\nfloat focusedSunAt(vec3 point){\n float depth=max(0.,-point.y);\n if(depth<.001)return 0.;\n vec3 sun=-normalize(vec3(.37,.54,-.7));\n vec3 flat=refract(sun,vec3(0.,1.,0.),1./1.333);\n vec2 origin=point.xz-depth*flat.xz/max(-flat.y,.25);\n vec3 sampleWave=oceanWaveDerivatives(origin);\n vec3 normal=normalize(vec3(-sampleWave.y*uHeight,1.,-sampleWave.z*uHeight));\n vec3 ray=refract(sun,normal,1./1.333);\n float travel=max(.2,depth+sampleWave.x*uHeight);\n origin-=(origin+travel*ray.xz/max(-ray.y,.25)-point.xz)*.65;\n vec3 H=oceanHessian(origin)*uHeight;\n float f=travel*(1.-1./1.333);\n float xx=1.-f*H.x,xy=-f*H.y,yy=1.-f*H.z;\n float area=max(abs(xx*yy-xy*xy),.16);\n float brightness=clamp((1./area-.73)*1.45,0.,2.5);\n return brightness*exp(-travel*.067/max(uClarity,.25))*uSun*clamp(uPenetration,0.,2.);\n}\n\nfloat causticLightAt(vec3 worldPos) {\n  // The projection stays in WORLD space, shared by seabed and object faces.\n  // Propagation shifts the light footprint slightly as it travels downward.\n  float depth=max(0.0,-worldPos.y);\n  vec2 p=worldPos.xz+vec2(.11,-.075)*depth;\n  float t=uTime*uCausticSpeed;\n  vec2 footprint=refractedFootprint(p,t);\n  vec2 base=curvedRidges(footprint*.42,t);\n  vec2 detail=curvedRidges((footprint+vec2(11.7,-8.2))*.72,-t*.81);\n  float crossing=base.x*detail.x;\n  float filaments=clamp(base.x*.78+detail.x*.29+crossing*.32,0.0,1.75);\n  float broad=clamp(base.y*.55+detail.y*.25,0.0,1.0);\n  float focus=clamp(1.12-.12*max(uChop-1.0,0.0),.72,1.12);\n  // At depth, defocused ribbons become broader and dimmer, never brighter.\n  float clarity=max(uClarity,.25);\n  float transport=exp(-depth*.053/clarity);\n  float detailFade=exp(-depth*.024/clarity);\n  float lighting=filaments*detailFade+(.12+(1.0-detailFade)*.24)*broad;\n  float legacy=lighting*uCaustics*uSun*focus*(.64+.26*uHeight)*transport;\n  // Preserve the visible animated caustic filaments. Surface-wave ray\n  // focusing changes their ENERGY rather than replacing the pattern.\n  // A nonzero floor keeps defocused rays visible without flattening them.\n  float waveFocus=focusedSunAt(worldPos);\n  float focusMask=smoothstep(.08,1.12,waveFocus);\n  float waveGain=mix(.72,1.85,focusMask);\n  return legacy*mix(1.0,waveGain,clamp(uPhysicalLight,0.,1.));\n}\n\nuniform float uVolume,uShafts;\n// Reusable spectral transmittance; red light attenuates faster than blue.\n// The density slider applies to the optical *water column*, not object albedo.\nvec3 waterTransmittance(float distance){\n  // Reduce extinction over short sight distances. Light from the\n  // seabed should remain legible several metres below a sunny surface.\n  vec3 sigma=vec3(.067,.036,.020)/max(uClarity,.25);\n  return exp(-sigma*max(distance,0.));\n}\n// Lightweight approximated light shafts. Three samples along the view ray\n// measure time-varying focusing from the moving wave field. This is not\n// full volumetric raytracing and intentionally avoids additional passes.\nfloat sunbeamAt(vec3 position,float t){\n  vec2 p=position.xz+vec2(-.28,.12)*max(0.,-position.y);\n  float a=sin(dot(p,vec2(.27,.41))-t*.58\n    +.55*sin(p.y*.29+t*.25));\n  float b=sin(dot(p,vec2(-.43,.19))+t*.79\n    +.38*sin(p.x*.36-t*.31));\n  float beam=pow(clamp(.5+.5*a*b,0.,1.),3.5);\n  return .24+.76*beam;\n}\nvec3 waterVolumeTransport(vec3 lit,vec3 worldPos){\n  float range=length(worldPos-uEye);\n  float depth=max(0.,-worldPos.y);\n  float eyeDepth=max(0.,-uEye.y);\n  vec3 trans=waterTransmittance(range);\n  float sunlight=exp(-min(depth,eyeDepth)*.072/max(uClarity,.25));\n  float litColumn=exp(-depth*.095/max(uClarity,.25));\n  float penetration=clamp(uPenetration,0.,2.);\n  // Scatter visible blue/cyan illumination into the sight ray as direct\n  // object radiance diminishes. It is not a constant fog-colored overlay.\n  vec3 scatterColor=vec3(.045,.23,.255)*uSun*sunlight;\n  vec3 scattered=scatterColor*(vec3(1.)-trans)*\n    mix(.65,1.28,penetration*.5);\n  vec3 ray=worldPos-uEye;\n  vec3 m1=uEye+ray*.25, m2=uEye+ray*.55, m3=uEye+ray*.83;\n  float oldBeams=(sunbeamAt(m1,uTime)+sunbeamAt(m2,uTime)+sunbeamAt(m3,uTime))/3.;\n  float beams=mix(oldBeams,clamp(focusedSunAt(m2)*.72,.06,1.4),clamp(uPhysicalLight,0.,1.));\n  float column=1.-exp(-range*.035/max(uClarity,.25));\n  // Beam light is strongest near the bright surface and gradually\n  // vanishes in deep water, without illuminating surfaces from below.\n  float shaftDepth=exp(-eyeDepth*.085/max(uClarity,.25));\n  vec3 shafts=vec3(.065,.15,.135)*beams*column*shaftDepth\n    *litColumn*uShafts*uSun*penetration;\n  // Indirect light enters the upper water column from the sky.\n  // It lifts material shading at shallow depths without creating new\n  // caustic patterns, and diminishes naturally with depth.\n  float ambientDepth=exp(-depth*.12/max(uClarity,.25));\n  vec3 skylightBounce=vec3(.078,.18,.17)*ambientDepth*uSun*\n    (1.-exp(-range*.12));\n  vec3 physical=lit*trans+scattered+shafts+skylightBounce;\n  return mix(lit,physical,clamp(uVolume,0.,1.));\n}\n\nvec3 waterAttenuate(vec3 lit,vec3 worldPos){\n return waterVolumeTransport(lit,worldPos);\n}\n\n\nuniform sampler2D uShadowMap;\nuniform mat4 uLightVP;\nuniform float uOcclusion;\n// Shadow occlusion from rock depth capture, with four stable PCF taps.\n// The light camera matches the downward sunlight used for caustics.\nfloat shadowVisibility(vec3 worldPoint){\n  vec4 clip=uLightVP*vec4(worldPoint,1.0);\n  vec3 ndc=clip.xyz/max(clip.w,0.0001);\n  vec3 uvz=ndc*.5+.5;\n  if(uvz.x<.002||uvz.y<.002||uvz.x>.998||uvz.y>.998\n      ||uvz.z<0.0||uvz.z>1.0)return 1.0;\n  float visibility=0.0;\n  vec2 texel=vec2(1.0/float(512.0));\n  float bias=.0018;\n  for(int y=0;y<2;y++){\n    for(int x=0;x<2;x++){\n      vec2 o=(vec2(float(x),float(y))-.5)*texel*1.8;\n      float receiver=texture2D(uShadowMap,uvz.xy+o).r;\n      visibility+=step(uvz.z-bias,receiver);\n    }\n  }\n  return mix(1.0,.16+.84*(visibility*.25),clamp(uOcclusion,0.,1.));\n}\n\nvoid main(){\n  vec2 p=vWorld.xz;\n  float grit=sin(p.x*1.7+sin(p.y*.28)*1.3)\n    *sin(p.y*1.4-p.x*.27)*.008;\n  vec3 sand=(vec3(.31,.43,.39)+grit)*\n    (.77+.23*exp(-max(0.,-vWorld.y)*.06/max(uClarity,.25)));\n  sand+=vec3(.75,.91,.82)*causticLightAt(vWorld)*shadowVisibility(vWorld+vec3(0.,.09,0.));\n  gl_FragColor=vec4(waterAttenuate(sand,vWorld),1.0);\n}"
});
const bottom=new THREE.Mesh(new THREE.PlaneGeometry(1100,1100,4,4),bottomMat);
bottom.rotation.x=-Math.PI/2;bottom.position.y=-9.5;scene.add(bottom);
const rockMat=new THREE.ShaderMaterial({
 uniforms:{
  uTime:waterUniforms.uTime,uClarity:waterUniforms.uClarity,
  uHeight:waterUniforms.uHeight,uChop:waterUniforms.uChop,uSwellComplexity:waterUniforms.uSwellComplexity,
  uSun:waterUniforms.uSun,uCaustics:bottomMat.uniforms.uCaustics,
  uCausticSpeed:bottomMat.uniforms.uCausticSpeed,uCausticCurvature:bottomMat.uniforms.uCausticCurvature,uCausticFocus:bottomMat.uniforms.uCausticFocus,uVolume:bottomMat.uniforms.uVolume,uShafts:bottomMat.uniforms.uShafts,uPenetration:waterUniforms.uPenetration,uPhysicalLight:bottomMat.uniforms.uPhysicalLight,uShadowMap:bottomMat.uniforms.uShadowMap,uLightVP:bottomMat.uniforms.uLightVP,uOcclusion:bottomMat.uniforms.uOcclusion,uEye:waterUniforms.uEye
 },
 vertexShader:"\nvarying vec3 vWorld;\nvarying vec3 vWorldNormal;\nvoid main(){\n  vec4 local=vec4(position,1.0);\n  vec3 n=normal;\n  #ifdef USE_INSTANCING\n    local=instanceMatrix*local;\n    // Correct normal orientation for nonuniform rock-instance scaling.\n    vec3 sx=vec3(instanceMatrix[0].xyz);\n    vec3 sy=vec3(instanceMatrix[1].xyz);\n    vec3 sz=vec3(instanceMatrix[2].xyz);\n    n=mat3(instanceMatrix)*(n/vec3(\n      max(dot(sx,sx),.0001),\n      max(dot(sy,sy),.0001),\n      max(dot(sz,sz),.0001)\n    ));\n  #endif\n  vec4 world=modelMatrix*local;\n  vWorld=world.xyz;\n  vWorldNormal=normalize(mat3(modelMatrix)*n);\n  gl_Position=projectionMatrix*viewMatrix*world;\n}",
 fragmentShader:"precision highp float;\nuniform float uTime,uClarity,uHeight,uChop,uSun,uCaustics,uCausticSpeed,uCausticCurvature,uCausticFocus;\nuniform float uSwellComplexity;\nuniform float uPenetration,uPhysicalLight;\nuniform vec3 uEye;\nvarying vec3 vWorld;\nvarying vec3 vWorldNormal;\nvec2 cellHash(vec2 p){\n  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));\n  return fract(sin(p)*43758.5453);\n}\n// Continuous network of focused lines between neighboring wave lenslets.\nvec2 refractedFootprint(vec2 p,float t){\n  float a=dot(p,vec2(.96,.28))*.095-t*.70;\n  float b=dot(p,vec2(.40,.91))*.16-t*1.16;\n  float c=dot(p,vec2(-.71,.70))*.28-t*1.44;\n  float d=dot(p,vec2(.90,-.44))*.49-t*2.10;\n  float e=dot(p,vec2(-.30,-.95))*.88-t*3.45;\n  // Approximate surface slopes of the very same five waves rendered above.\n  vec2 slope=vec2(.96,.28)*(.68*.095*cos(a))\n    +vec2(.40,.91)*(.40*.16*cos(b))\n    +vec2(-.71,.70)*(.24*.28*cos(c))\n    +vec2(.90,-.44)*(.12*.49*cos(d))\n    +vec2(-.30,-.95)*(.055*.88*cos(e));\n  // Additional crossing capillary lenslets produce fast, fine changes.\n  vec2 micro=vec2(\n    sin(p.y*.43+p.x*.15-t*.93)+.48*sin(p.x*.63-p.y*.27+t*1.12),\n    cos(p.x*.39-p.y*.23+t*.84)+.43*cos(p.y*.71+p.x*.13-t*1.32)\n  );\n  return p+clamp(slope*17.0*uHeight,-vec2(2.3),vec2(2.3))\n     +micro*(.30+.13*uChop);\n}\n\n\n// Water Lab 05: low-frequency noise warps the caustic contours into locally\n// rotating, fluid-like ribbons, not straight cells. Derivatives are avoided.\nfloat causticNoise(vec2 p) {\n  vec2 i=floor(p),f=fract(p);\n  vec2 u=f*f*(3.0-2.0*f);\n  float a=cellHash(i).x;\n  float b=cellHash(i+vec2(1.0,0.0)).x;\n  float c=cellHash(i+vec2(0.0,1.0)).x;\n  float d=cellHash(i+vec2(1.0,1.0)).x;\n  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);\n}\nmat2 causticRotation(float a){\n  float c=cos(a),s=sin(a);\n  return mat2(c,-s,s,c);\n}\nvec2 causticFlow(vec2 p,float t){\n  float a=causticNoise(p*.11+vec2(t*.028,-t*.017));\n  float b=causticNoise(p*.13+vec2(11.8,-4.7)+vec2(-t*.023,t*.020));\n  vec2 slow=vec2(a-.5,b-.5)*(2.9*uCausticCurvature);\n  vec2 flowing=vec2(\n    sin(p.y*.17+t*.21)+.42*sin(p.x*.29-p.y*.12-t*.18),\n    cos(p.x*.16-t*.17)+.45*cos(p.y*.32+p.x*.13+t*.24)\n  )*(.68*uCausticCurvature);\n  return p+slow+flowing;\n}\nvec2 curvedRidges(vec2 p,float t){\n  vec2 q=causticFlow(p,t);\n  // Local turning breaks the visual lattice and allows lines to curve in\n  // different directions in different areas of the same rock or sand patch.\n  float theta=(causticNoise(q*.10+vec2(5.1,7.3))-.5)*4.5*uCausticCurvature;\n  vec2 r=causticRotation(theta)*q;\n  float phaseA=r.x*1.24+.76*sin(r.y*.57+t*.32)-t*.63;\n  float phaseB=r.y*1.48+.65*sin(r.x*.62-t*.27)+t*.47;\n  float phaseC=dot(r,vec2(.72,-.69))*1.93+.45*sin(r.y*.82+t*.36)-t*.83;\n  // Multiple crossing contours change topology as the underlying waves\n  // move, but do not form identical square cells or parallel straight rows.\n  float contour=sin(phaseA)*.74+sin(phaseB)*.62+sin(phaseC)*.32;\n  float width=mix(.15,.055,clamp(uCausticFocus*.55,0.0,1.0));\n  float fine=1.0-smoothstep(width*.36,width*1.65,abs(contour));\n  float halo=1.0-smoothstep(width*.8,width*4.4,abs(contour));\n  float clusters=causticNoise(q*.17+vec2(-8.3,9.7));\n  float irregular=mix(.53,1.2,smoothstep(.12,.83,clusters));\n  return vec2(fine,halo)*irregular;\n}\n\nvec3 oceanWaveDerivatives(vec2 p){\n vec2 a=normalize(vec2(.96,.28)),b=normalize(vec2(.40,.91)),c=normalize(vec2(-.71,.70));\n vec2 d=normalize(vec2(.90,-.44)),e=normalize(vec2(-.30,-.95));\n float t=uTime;\n float p1=dot(a,p)*.095-t*.70,p2=dot(b,p)*.16-t*1.16,p3=dot(c,p)*.28-t*1.44;\n float p4=dot(d,p)*.49-t*2.10,p5=dot(e,p)*.88-t*3.45;\n float height=.68*sin(p1)+.40*sin(p2)+.24*sin(p3)+.12*sin(p4)+.055*sin(p5);\n vec2 slope=a*(.68*.095*cos(p1))+b*(.40*.16*cos(p2))+c*(.24*.28*cos(p3))\n  +d*(.12*.49*cos(p4))+e*(.055*.88*cos(p5));\n float complexity=clamp(uSwellComplexity,0.,1.5);\n float crest=max(height,0.);\n slope*=1.+.38*complexity*crest;\n height+=.19*complexity*crest*crest;\n vec2 f=normalize(vec2(-.83,.56)),g=normalize(vec2(.14,-.99));\n float q6=dot(f,p)*.048-uTime*.47+1.3;\n float q7=dot(g,p)*.073-uTime*.63+2.7;\n height+=.53*complexity*sin(q6)+.32*complexity*sin(q7);\n slope+=f*(.53*complexity*.048*cos(q6))+g*(.32*complexity*.073*cos(q7));\n return vec3(height,slope);\n}\nvec3 oceanHessian(vec2 p){\n vec2 a=normalize(vec2(.96,.28)),b=normalize(vec2(.40,.91)),c=normalize(vec2(-.71,.70));\n vec2 d=normalize(vec2(.90,-.44)),e=normalize(vec2(-.30,-.95));\n float t=uTime;\n float k1=-.68*.095*.095*sin(dot(a,p)*.095-t*.70);\n float k2=-.40*.16*.16*sin(dot(b,p)*.16-t*1.16);\n float k3=-.24*.28*.28*sin(dot(c,p)*.28-t*1.44);\n float k4=-.12*.49*.49*sin(dot(d,p)*.49-t*2.10);\n float k5=-.055*.88*.88*sin(dot(e,p)*.88-t*3.45);\n float complexity=clamp(uSwellComplexity,0.,1.5);\n vec2 f=normalize(vec2(-.83,.56)),g=normalize(vec2(.14,-.99));\n float p6=dot(f,p)*.048-uTime*.47+1.3,p7=dot(g,p)*.073-uTime*.63+2.7;\n float k6=-.53*complexity*.048*.048*sin(p6);\n float k7=-.32*complexity*.073*.073*sin(p7);\n // The asymmetric crest's leading curvature term follows the first five\n // waves; ray focusing remains approximate near strongly sharpened crests.\n return vec3(\n  k6*f.x*f.x+k7*g.x*g.x,\n  k6*f.x*f.y+k7*g.x*g.y,\n  k6*f.y*f.y+k7*g.y*g.y\n )+vec3(\n  k1*a.x*a.x+k2*b.x*b.x+k3*c.x*c.x+k4*d.x*d.x+k5*e.x*e.x,\n  k1*a.x*a.y+k2*b.x*b.y+k3*c.x*c.y+k4*d.x*d.y+k5*e.x*e.y,\n  k1*a.y*a.y+k2*b.y*b.y+k3*c.y*c.y+k4*d.y*d.y+k5*e.y*e.y\n );\n}\n// Surface-coherent approximate sun ray tracing and ray-bundle concentration.\n// Source ray, surface slopes and Hessian follow EXACT ocean wave phase/speed.\nfloat focusedSunAt(vec3 point){\n float depth=max(0.,-point.y);\n if(depth<.001)return 0.;\n vec3 sun=-normalize(vec3(.37,.54,-.7));\n vec3 flat=refract(sun,vec3(0.,1.,0.),1./1.333);\n vec2 origin=point.xz-depth*flat.xz/max(-flat.y,.25);\n vec3 sampleWave=oceanWaveDerivatives(origin);\n vec3 normal=normalize(vec3(-sampleWave.y*uHeight,1.,-sampleWave.z*uHeight));\n vec3 ray=refract(sun,normal,1./1.333);\n float travel=max(.2,depth+sampleWave.x*uHeight);\n origin-=(origin+travel*ray.xz/max(-ray.y,.25)-point.xz)*.65;\n vec3 H=oceanHessian(origin)*uHeight;\n float f=travel*(1.-1./1.333);\n float xx=1.-f*H.x,xy=-f*H.y,yy=1.-f*H.z;\n float area=max(abs(xx*yy-xy*xy),.16);\n float brightness=clamp((1./area-.73)*1.45,0.,2.5);\n return brightness*exp(-travel*.067/max(uClarity,.25))*uSun*clamp(uPenetration,0.,2.);\n}\n\nfloat causticLightAt(vec3 worldPos) {\n  // The projection stays in WORLD space, shared by seabed and object faces.\n  // Propagation shifts the light footprint slightly as it travels downward.\n  float depth=max(0.0,-worldPos.y);\n  vec2 p=worldPos.xz+vec2(.11,-.075)*depth;\n  float t=uTime*uCausticSpeed;\n  vec2 footprint=refractedFootprint(p,t);\n  vec2 base=curvedRidges(footprint*.42,t);\n  vec2 detail=curvedRidges((footprint+vec2(11.7,-8.2))*.72,-t*.81);\n  float crossing=base.x*detail.x;\n  float filaments=clamp(base.x*.78+detail.x*.29+crossing*.32,0.0,1.75);\n  float broad=clamp(base.y*.55+detail.y*.25,0.0,1.0);\n  float focus=clamp(1.12-.12*max(uChop-1.0,0.0),.72,1.12);\n  // At depth, defocused ribbons become broader and dimmer, never brighter.\n  float clarity=max(uClarity,.25);\n  float transport=exp(-depth*.053/clarity);\n  float detailFade=exp(-depth*.024/clarity);\n  float lighting=filaments*detailFade+(.12+(1.0-detailFade)*.24)*broad;\n  float legacy=lighting*uCaustics*uSun*focus*(.64+.26*uHeight)*transport;\n  // Preserve the visible animated caustic filaments. Surface-wave ray\n  // focusing changes their ENERGY rather than replacing the pattern.\n  // A nonzero floor keeps defocused rays visible without flattening them.\n  float waveFocus=focusedSunAt(worldPos);\n  float focusMask=smoothstep(.08,1.12,waveFocus);\n  float waveGain=mix(.72,1.85,focusMask);\n  return legacy*mix(1.0,waveGain,clamp(uPhysicalLight,0.,1.));\n}\n\nuniform float uVolume,uShafts;\n// Reusable spectral transmittance; red light attenuates faster than blue.\n// The density slider applies to the optical *water column*, not object albedo.\nvec3 waterTransmittance(float distance){\n  // Reduce extinction over short sight distances. Light from the\n  // seabed should remain legible several metres below a sunny surface.\n  vec3 sigma=vec3(.067,.036,.020)/max(uClarity,.25);\n  return exp(-sigma*max(distance,0.));\n}\n// Lightweight approximated light shafts. Three samples along the view ray\n// measure time-varying focusing from the moving wave field. This is not\n// full volumetric raytracing and intentionally avoids additional passes.\nfloat sunbeamAt(vec3 position,float t){\n  vec2 p=position.xz+vec2(-.28,.12)*max(0.,-position.y);\n  float a=sin(dot(p,vec2(.27,.41))-t*.58\n    +.55*sin(p.y*.29+t*.25));\n  float b=sin(dot(p,vec2(-.43,.19))+t*.79\n    +.38*sin(p.x*.36-t*.31));\n  float beam=pow(clamp(.5+.5*a*b,0.,1.),3.5);\n  return .24+.76*beam;\n}\nvec3 waterVolumeTransport(vec3 lit,vec3 worldPos){\n  float range=length(worldPos-uEye);\n  float depth=max(0.,-worldPos.y);\n  float eyeDepth=max(0.,-uEye.y);\n  vec3 trans=waterTransmittance(range);\n  float sunlight=exp(-min(depth,eyeDepth)*.072/max(uClarity,.25));\n  float litColumn=exp(-depth*.095/max(uClarity,.25));\n  float penetration=clamp(uPenetration,0.,2.);\n  // Scatter visible blue/cyan illumination into the sight ray as direct\n  // object radiance diminishes. It is not a constant fog-colored overlay.\n  vec3 scatterColor=vec3(.045,.23,.255)*uSun*sunlight;\n  vec3 scattered=scatterColor*(vec3(1.)-trans)*\n    mix(.65,1.28,penetration*.5);\n  vec3 ray=worldPos-uEye;\n  vec3 m1=uEye+ray*.25, m2=uEye+ray*.55, m3=uEye+ray*.83;\n  float oldBeams=(sunbeamAt(m1,uTime)+sunbeamAt(m2,uTime)+sunbeamAt(m3,uTime))/3.;\n  float beams=mix(oldBeams,clamp(focusedSunAt(m2)*.72,.06,1.4),clamp(uPhysicalLight,0.,1.));\n  float column=1.-exp(-range*.035/max(uClarity,.25));\n  // Beam light is strongest near the bright surface and gradually\n  // vanishes in deep water, without illuminating surfaces from below.\n  float shaftDepth=exp(-eyeDepth*.085/max(uClarity,.25));\n  vec3 shafts=vec3(.065,.15,.135)*beams*column*shaftDepth\n    *litColumn*uShafts*uSun*penetration;\n  // Indirect light enters the upper water column from the sky.\n  // It lifts material shading at shallow depths without creating new\n  // caustic patterns, and diminishes naturally with depth.\n  float ambientDepth=exp(-depth*.12/max(uClarity,.25));\n  vec3 skylightBounce=vec3(.078,.18,.17)*ambientDepth*uSun*\n    (1.-exp(-range*.12));\n  vec3 physical=lit*trans+scattered+shafts+skylightBounce;\n  return mix(lit,physical,clamp(uVolume,0.,1.));\n}\n\nvec3 waterAttenuate(vec3 lit,vec3 worldPos){\n return waterVolumeTransport(lit,worldPos);\n}\n\n\nuniform sampler2D uShadowMap;\nuniform mat4 uLightVP;\nuniform float uOcclusion;\n// Shadow occlusion from rock depth capture, with four stable PCF taps.\n// The light camera matches the downward sunlight used for caustics.\nfloat shadowVisibility(vec3 worldPoint){\n  vec4 clip=uLightVP*vec4(worldPoint,1.0);\n  vec3 ndc=clip.xyz/max(clip.w,0.0001);\n  vec3 uvz=ndc*.5+.5;\n  if(uvz.x<.002||uvz.y<.002||uvz.x>.998||uvz.y>.998\n      ||uvz.z<0.0||uvz.z>1.0)return 1.0;\n  float visibility=0.0;\n  vec2 texel=vec2(1.0/float(512.0));\n  float bias=.0018;\n  for(int y=0;y<2;y++){\n    for(int x=0;x<2;x++){\n      vec2 o=(vec2(float(x),float(y))-.5)*texel*1.8;\n      float receiver=texture2D(uShadowMap,uvz.xy+o).r;\n      visibility+=step(uvz.z-bias,receiver);\n    }\n  }\n  return mix(1.0,.16+.84*(visibility*.25),clamp(uOcclusion,0.,1.));\n}\n\nvoid main(){\n  vec3 n=normalize(vWorldNormal);\n  vec3 sunDir=normalize(vec3(.37,.54,-.7));\n  float upward=max(dot(n,sunDir),0.0);\n  // Near-vertical faces still receive scattered underwater light;\n  // overhangs and sheltered faces stay mostly dim.\n  float exposure=pow(upward,.65);\n  float skyBounce=.19+.23*max(n.y,0.0);\n  // Diffuse marine ambient remains, but downward/overhanging faces receive\n  // very little focused light; this is an approximation, not raytraced shadow.\n  float shelter=mix(.17,1.0,smoothstep(-.35,.50,n.y));\n  float shadow=shadowVisibility(vWorld+n*.11);\n  float caustics=causticLightAt(vWorld)*exposure*shelter*shadow;\n  // Nonuniform rock albedo, without repeating UV textures or extra draws.\n  float roughPattern=sin(vWorld.x*2.3+vWorld.y*1.5)\n    *sin(vWorld.z*2.7-vWorld.x*.41)*.035;\n  vec3 rock=vec3(.17,.27,.265)+vec3(roughPattern);\n  rock*=(.22+skyBounce+.38*exposure)*mix(.72,1.0,shadow);\n  rock+=vec3(.78,.95,.82)*caustics;\n  gl_FragColor=vec4(waterAttenuate(rock,vWorld),1.0);\n}"
});
const rocks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),rockMat,46);
const dummy=new THREE.Object3D();
for(let i=0;i<46;i++){
 // Keep a meaningful fraction of the rock samples inside the underwater
 // camera frustum for an immediate A/B of sand-to-rock illumination.
 const x=(Math.sin(i*71.1)*.5+.5)*38-19;
 const z=8-(Math.sin(i*17.71)*.5+.5)*77;
 dummy.position.set(x,-9.05,z);
 dummy.rotation.set(i*.3,i*.9,i*.14);
 dummy.scale.set(.65+(i%4)*.35,.40+(i%3)*.28,.75+(i%6)*.38);
 dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
}scene.add(rocks);
// Mobile-friendly surface-driven shallow-water lighting. Keep the original
// complex materials intact for explicit ?labDetailedMaterials=1 comparisons.
// Two world-space crossing wave fields produce drifting focused caustic bands;
// spectral attenuation comes from actual light travel distance and depth.
const lightMaterialVertex=`
precision highp float;
varying vec3 vWorld;
varying vec3 vNormal;
void main(){
 vec4 local=vec4(position,1.);
 vec3 n=normal;
 #ifdef USE_INSTANCING
 local=instanceMatrix*local;
 n=mat3(instanceMatrix)*n;
 #endif
 vec4 world=modelMatrix*local;
 vWorld=world.xyz;
 vNormal=normalize(mat3(modelMatrix)*n);
 gl_Position=projectionMatrix*viewMatrix*world;
}`;
const lightMaterialFragment=`
precision highp float;
uniform float uTime,uSun,uClarity,uCaustics,uHeight,uPhysicalLight;
uniform float uCausticSpeed,uCausticCurvature,uCausticFocus;
uniform float uShallowLight,uUnderwaterOptics;
uniform vec3 uEye;
uniform float uIsRock;
varying vec3 vWorld;
varying vec3 vNormal;

// 10.18: coherent wave-bent focusing, not three independent cosine bands.
// Jittered Voronoi cell boundaries act as refractive caustic envelopes;
// crossing wave directions warp and animate the line network smoothly.
// Project in world space so the sand and instanced rocks share the same light.
vec2 lightCellHash(vec2 cell){
  return fract(sin(vec2(dot(cell,vec2(127.1,311.7)),
                        dot(cell,vec2(269.5,183.3))))*43758.5453);
}
float focusedCellBoundaries(vec2 pos,float time){
  vec2 tile=floor(pos),uv=fract(pos);
  float first=12.,second=12.;
  for(int y=-1;y<=1;y++){
    for(int x=-1;x<=1;x++){
      vec2 offset=vec2(float(x),float(y));
      vec2 hash=lightCellHash(tile+offset);
      vec2 motion=.5+.34*sin(time*.38+6.28318*hash+
                        vec2(1.9,3.7));
      vec2 delta=offset+motion-uv;
      float d=dot(delta,delta);
      if(d<first){second=first;first=d;}
      else if(d<second){second=d;}
    }
  }
  // Small difference between two closest wave-lens regions indicates
  // a focused network boundary. Smooth widths avoid hard pixel grids.
  float distanceToLine=max(0.,sqrt(second)-sqrt(first));
  float line=1.-smoothstep(.012,.16,distanceToLine);
  return line;
}
float waveSunCaustics(vec2 position,float t){
  float depth=max(0.,-vWorld.y);
  float clarity=max(uClarity,.35);
  float speed=max(.05,uCausticSpeed);
  float phase=t*speed;
  vec2 downSun=normalize(vec2(-.37,.70));
  vec2 q=position+downSun*depth*.48;
  // The broad surface swells bend the caustic-cell coordinates;
  // two oblique, unequal frequency terms avoid a uniform square grid.
  float a=dot(q,normalize(vec2(.96,.28)))*.12-phase*.62;
  float b=dot(q,normalize(vec2(.40,.91)))*.17-phase*.94;
  float c=dot(q,normalize(vec2(-.71,.70)))*.25+phase*.74;
  float warpAmount=clamp(uCausticCurvature,0.,2.);
  q+=vec2(
     .85*sin(a)+.53*sin(b+.35*sin(c)),
     .72*cos(b)+.41*sin(c+.24*cos(a))
  )*warpAmount;
  // The existing cell network is a useful focusing scaffold, but
  // uniformly bright cell borders make a tiled grid. Introduce a second,
  // wave-advected field that locally stretches, dims and fragments ridges.
  // Both patterns remain in world coordinates so rocks and sand agree.
  vec2 opticalWarp=vec2(
    .44*sin(dot(q,vec2(.29,.12))-phase*.61)+
       .21*cos(dot(q,vec2(-.12,.37))+phase*.43),
    .41*cos(dot(q,vec2(.17,-.31))+phase*.52)+
       .24*sin(dot(q,vec2(.35,.09))-phase*.36)
  )*warpAmount;
  float line=focusedCellBoundaries((q+opticalWarp)*.66,phase);
  float fine=pow(.5+.5*cos(dot(q,vec2(.83,-.45))*1.70-phase*1.13
                +.63*sin(b)),14.);
  float waveFocus=.58+.42*sin(a)*sin(b);
  float packet=.5+.5*sin(dot(q,vec2(.15,-.11))-phase*.43+
                .53*sin(dot(q,vec2(-.07,.18))+phase*.31));
  float lineEnergy=smoothstep(.17,.79,packet);
  float focused=pow(clamp(line,0.,1.),
                mix(1.60,.90,clamp(uCausticFocus*.5,0.,1.)));
  float intensity=focused*(.14+.95*lineEnergy)*(.72+.35*waveFocus)
                  +fine*line*.10;
  // Physical light loss from water column, without darkening albedo itself.
  return clamp(intensity,0.,1.35)*exp(-depth*.052/clarity);
}
void main(){
 float depth=max(0.,-vWorld.y),clarity=max(uClarity,.35);
 float range=length(vWorld-uEye);
 vec3 sunDir=normalize(vec3(.37,.54,-.7));
 vec3 normal=normalize(vNormal);
 float exposed=.42+.58*max(dot(normal,sunDir),0.);
 float mineral=sin(vWorld.x*1.17+vWorld.z*.42)*
               cos(vWorld.z*1.43-vWorld.x*.30)*.026;
 vec3 base=mix(vec3(.32,.42,.35),vec3(.20,.29,.29),uIsRock);
 base+=vec3(mineral);
 float sunThrough=exp(-depth*.080/clarity);
 float focus=waveSunCaustics(vWorld.xz,uTime);
 // Use existing caustic intensity, not unbounded glow.
 // The caustic field is light traveling down from the surface and
 // back through the water to the viewer; distant caustic contrast fades
 // well before the seabed itself disappears.
 float causticDistance=exp(-max(0.,range-9.)*.085/clarity);
 float caustic=focus*uCaustics*sunThrough*causticDistance*
   clamp(uPhysicalLight,.3,1.);
 // Sun and skylight both reach shallow receivers. A Lambert diffuse
 // response is retained; indirect skylight prevents black shaded rocks.
 float solarIrradiance=exp(-depth*.095/clarity)*uSun;
 float skyIrradiance=exp(-depth*.115/clarity)*uSun;
 vec3 ambientSky=vec3(.16,.34,.33)*skyIrradiance;
 vec3 directSun=vec3(.59,.68,.49)*solarIrradiance*max(dot(normal,sunDir),0.);
 // Direct and diffuse irradiance depend on vertical travel from
 // the surface, not distance to the camera. Let sun-facing sand and rocks
 // be illuminated together by a single bounded daylight response.
 float lightGain=clamp(uShallowLight,0.,2.);
 float shallowDaylight=exp(-depth*.085/clarity);
 vec3 solar=vec3(.62,.74,.60)*shallowDaylight*uSun;
 vec3 diffuse=vec3(.33,.43,.42)*skyIrradiance;
 vec3 radiance=vec3(.42,.47,.44)+diffuse+
               solar*(.30+.70*max(dot(normal,sunDir),0.));
 vec3 lit=base*radiance*mix(.88,1.42,lightGain*.5);
 lit+=vec3(.80,.95,.83)*caustic*(.65+.55*lightGain)*uSun*exposed;
 // Beer-Lambert extinction over CAMERA-TO-OBJECT travel distance.
 // Nonzero blue/green extinction prevents a bright turquoise horizon.
 // Two-scale optical path: clear, nearby shallow water and a
 // denser far field. The transition is continuous, without a hard cutoff.
 // At 0 the control preserves the original extinction law.
 float nearMeters=min(range,24.);
 float farMeters=max(0.,range-24.);
 float nearOpticalFactor=mix(1.,.59,clamp(lightGain*.5,0.,1.));
 float opticalLength=nearMeters*nearOpticalFactor+farMeters*1.20;
 vec3 extinction=vec3(.115,.078,.063)/clarity;
 vec3 transmission=exp(-extinction*opticalLength);
 // The water column scatters a bounded amount of ambient daylight.
 // It does not add constant bright color for every distant fragment.
 float nearbyLight=exp(-depth*.11/clarity);
 // Sunlit upper-water haze, bounded and shared with distant fog.
 // Keep far water blue-green rather than adding a bright white horizon.
 vec3 waterColumn=vec3(.021,.094,.111)*(.64+.36*nearbyLight)*uSun;
 vec3 outputColor=lit*transmission+waterColumn*(vec3(1.)-transmission);
 // Correct shallow exposure after scattering. Fade this enhancement to
 // zero BEFORE the far-distance extinction, preserving a dark horizon.
 // Only nearby surfaces are exposed; nothing is added to the background.
 // Lift only the near visible scene, allowing the foreground reef
 // to be evaluated without flattening the far water. No contribution
 // is added to the environment background or horizon.
 float localVisibility=1.-smoothstep(15.,42.,range);
 float surfaceLight=exp(-depth*.095/clarity)*uSun;
 vec3 lifted=lit*(vec3(.13,.16,.15)*localVisibility*surfaceLight*
                  clamp(lightGain,0.,2.));
 outputColor+=lifted;
 // Distant geometry still loses contrast to the water-column color.
 float visibilityFog=1.-exp(-pow(max(0.,range-5.)*.027/clarity,1.15));
 outputColor=mix(outputColor,waterColumn,visibilityFog*.52);
 // Shallow reef irradiance is received at the object then absorbed along
 // the camera path. Keep the first few metres visibly sunlit, while
 // allowing the far field to remain governed by water extinction.
 float reefNear=1.-smoothstep(9.,30.,range);
 float daylightAtReceiver=exp(-depth*.085/clarity)*uSun;
 vec3 reefIllumination=lit*vec3(.55,.62,.56)*reefNear*
   daylightAtReceiver*clamp(uShallowLight*.75,0.,1.5);
 outputColor+=reefIllumination*clamp(uUnderwaterOptics,0.,1.);
 outputColor=clamp(outputColor,0.,1.);
 gl_FragColor=vec4(outputColor,1.);
}`;
const improvedUnderwaterOptics=new URLSearchParams(location.search).get("labUnderwaterOptics")!=="0";
const undersideDetail31=new URLSearchParams(location.search).get("labUnderside31")!=="0";
const undersideRepair32=new URLSearchParams(location.search).get("labUnderside32")!=="0";
// v10.33: screen-aligned underwater scene captures are not refracted-ray captures.
// Keep the 10.32 experimental path behind an explicit opt-in until it is correct.
const unsafeUnderwaterCapture=new URLSearchParams(location.search).get("labUnderCapture")==="1";
const undersideBalance33=new URLSearchParams(location.search).get("labUnderside33")!=="0";
const detailedMaterialsRequested=new URLSearchParams(location.search)
  .get("labDetailedMaterials")==="1";
const useSimpleUnderwaterMaterials=!detailedMaterialsRequested;
if(useSimpleUnderwaterMaterials){
 const common={
  uTime:waterUniforms.uTime,uSun:waterUniforms.uSun,
  uClarity:waterUniforms.uClarity,uCaustics:bottomMat.uniforms.uCaustics,
  uHeight:waterUniforms.uHeight,uPhysicalLight:bottomMat.uniforms.uPhysicalLight,
  uCausticSpeed:bottomMat.uniforms.uCausticSpeed,
  uCausticCurvature:bottomMat.uniforms.uCausticCurvature,
  uCausticFocus:bottomMat.uniforms.uCausticFocus,
  uEye:waterUniforms.uEye,uShallowLight:{value:1},uUnderwaterOptics:{value:improvedUnderwaterOptics?1:0}
 };
 bottom.material=new THREE.ShaderMaterial({
   uniforms:{...common,uIsRock:{value:0}},
   vertexShader:lightMaterialVertex,fragmentShader:lightMaterialFragment,
   side:THREE.DoubleSide
 });
 rocks.material=new THREE.ShaderMaterial({
   uniforms:{...common,uIsRock:{value:1}},
   vertexShader:lightMaterialVertex,fragmentShader:lightMaterialFragment
 });
}

// Scene isolation probe: no shader uniforms, caustics or shadow sampling.
// This is opt-in and never modifies the normal Water Lab materials.
const sceneProbe=new URLSearchParams(location.search).get("labSceneProbe")==="1";
if(sceneProbe){
  bottom.material=new THREE.MeshBasicMaterial({color:0xf5e7a3,side:THREE.DoubleSide});
  rocks.material=new THREE.MeshBasicMaterial({color:0xff637d});
  const marker=new THREE.Mesh(
    new THREE.SphereGeometry(1.2,12,8),
    new THREE.MeshBasicMaterial({color:0x8aff55})
  );
  marker.position.set(0,-5.5,-8);
  scene.add(marker);
  const label=document.createElement("div");
  label.textContent="SCENE PROBE: yellow sand / pink rocks / green marker";
  label.style.cssText="position:absolute;top:12px;left:8px;right:8px;z-index:100;color:#fff;background:#122f45e8;padding:8px 10px;border-radius:8px;font:12px monospace;pointer-events:none";
  document.body.appendChild(label);
}
// Light-space rock shadow capture: reuses the existing instanced geometry,
// no additional CPU ray tests or per-object shadow meshes.
const shadowResolution=512;
const shadowTarget=new THREE.WebGLRenderTarget(shadowResolution,shadowResolution,{
 minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
 depthBuffer:true,stencilBuffer:false
});
shadowTarget.depthTexture=new THREE.DepthTexture(shadowResolution,shadowResolution,THREE.UnsignedIntType);
shadowTarget.depthTexture.minFilter=THREE.NearestFilter;
shadowTarget.depthTexture.magFilter=THREE.NearestFilter;
const shadowScene=new THREE.Scene();
const shadowRocks=new THREE.InstancedMesh(rocks.geometry,new THREE.MeshDepthMaterial({depthPacking:THREE.BasicDepthPacking}),rocks.count);
shadowRocks.instanceMatrix=rocks.instanceMatrix;
shadowScene.add(shadowRocks);
const sunDir=new THREE.Vector3(.37,.54,-.7).normalize();
const sunCenter=new THREE.Vector3(0,-8.5,-26);
const shadowCamera=new THREE.OrthographicCamera(-47,47,47,-47,.1,180);
shadowCamera.position.copy(sunCenter).addScaledVector(sunDir,90);
shadowCamera.lookAt(sunCenter);
shadowCamera.updateMatrixWorld(true);
bottomMat.uniforms.uLightVP.value.multiplyMatrices(shadowCamera.projectionMatrix,shadowCamera.matrixWorldInverse);
bottomMat.uniforms.uShadowMap.value=shadowTarget.depthTexture;
let shadowFrame=0;
const ambient=new THREE.HemisphereLight(0x9beaff,0x184250,1.4);
scene.add(ambient);const sun=new THREE.DirectionalLight(0xf5fbff,2.0);
sun.position.set(50,80,-90);scene.add(sun);
function setView(v){
 view=v;
 for(const b of document.querySelectorAll("[data-view]"))b.setAttribute("aria-pressed",String(b.dataset.view===v));
 if(v==="surface"){camera.position.set(0,4.6,14);pitch=-.07;}
 if(v==="waterline"){camera.position.set(0,.23,14);pitch=-.015;}
 if(v==="underwater"){camera.position.set(0,improvedUnderwaterOptics?-4.65:-3.0,14);pitch=improvedUnderwaterOptics?-.29:-.22;}
 yaw=0;rotate();backdrop.material.uniforms.uUnder.value=v==="underwater"?1:0;
}
function rotate(){camera.rotation.order="YXZ";camera.rotation.y=yaw;camera.rotation.x=pitch;}
document.querySelectorAll("[data-view]").forEach(b=>b.addEventListener("click",()=>setView(b.dataset.view)));
for(const k of Object.keys(params)){
 const input=document.getElementById(k),out=document.getElementById(k+"Out");
 input.addEventListener("input",()=>{params[k]=Number(input.value);out.textContent=params[k].toFixed(2)});
}
let dragging=false,lastX=0,lastY=0;
canvas.addEventListener("pointerdown",e=>{dragging=true;lastX=e.clientX;lastY=e.clientY;canvas.setPointerCapture(e.pointerId)});
canvas.addEventListener("pointermove",e=>{if(!dragging)return;yaw-=(e.clientX-lastX)*.004;pitch=Math.max(-1.35,Math.min(1.35,pitch-(e.clientY-lastY)*.004));lastX=e.clientX;lastY=e.clientY;rotate()});
canvas.addEventListener("pointerup",e=>{
 if(dragging){
  const point=new THREE.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2);
  const ray=new THREE.Raycaster();ray.setFromCamera(point,camera);
  const hit=new THREE.Vector3();
  if(ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0,1,0),0),hit))splashAt(hit.x,hit.z);
 }
 dragging=false;
});
canvas.addEventListener("pointercancel",()=>dragging=false);
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);resizeRefraction()}
window.addEventListener("resize",resize);
setView(sceneProbe?"underwater":"surface");
let last=performance.now(),count=0,smoothed=60;
// Optional reference object above water: verifies that scene capture actually
// reflects geometry, not just a procedural sky. The prototype stays isolated.
const opticalReference=new THREE.Group();
const markerHull=new THREE.Mesh(new THREE.CylinderGeometry(.55,.75,.8,12),
 new THREE.MeshStandardMaterial({color:0xe46c3d,roughness:.7}));
markerHull.position.y=.55;
opticalReference.add(markerHull);
const markerTop=new THREE.Mesh(new THREE.SphereGeometry(.36,12,8),
 new THREE.MeshStandardMaterial({color:0xf6d9aa,roughness:.55}));
markerTop.position.y=1.18;
opticalReference.add(markerTop);
opticalReference.position.set(-5,0,-16);
scene.add(opticalReference);
const sceneSun=new THREE.DirectionalLight(0xffffff,2.0);
sceneSun.position.set(18,35,12);scene.add(sceneSun);
scene.add(new THREE.AmbientLight(0xb7daee,.75));
let reflectionSupported=true;

function animate(){
 requestAnimationFrame(animate);
 const t=clock.getElapsedTime(),now=performance.now();
 advanceSimulation(t);
 waterUniforms.uTime.value=t;waterUniforms.uHeight.value=params.height;
 waterUniforms.uChop.value=params.chop;
 waterUniforms.uSwellComplexity.value=params.swellComplexity;waterUniforms.uSun.value=params.sun;
 waterUniforms.uClarity.value=params.clarity;
 bottomMat.uniforms.uCaustics.value=params.caustics;
 if(useSimpleUnderwaterMaterials){bottom.material.uniforms.uShallowLight.value=params.shallowLight;rocks.material.uniforms.uShallowLight.value=params.shallowLight;}
 bottomMat.uniforms.uCausticSpeed.value=params.causticSpeed;
 bottomMat.uniforms.uCausticCurvature.value=params.causticCurvature;
 bottomMat.uniforms.uCausticFocus.value=params.causticFocus;
 bottomMat.uniforms.uVolume.value=params.volume;
 bottomMat.uniforms.uPhysicalLight.value=params.physicalLight;
 bottomMat.uniforms.uShafts.value=params.shafts;
 bottomMat.uniforms.uOcclusion.value=params.occlusion;
 if(!useSimpleUnderwaterMaterials&&!sceneProbe&&(shadowFrame++ % (mobile?3:2))===0&&params.occlusion>.001){
   renderer.setRenderTarget(shadowTarget);
   renderer.clear();
   renderer.render(shadowScene,shadowCamera);
   renderer.setRenderTarget(null);
 }
 ocean.position.x=camera.position.x;ocean.position.z=camera.position.z;
 backdrop.position.copy(camera.position);
 backdrop.material.uniforms.uDepth.value=Math.max(0,-camera.position.y);
 backdrop.material.uniforms.uVolume.value=params.volume;
 backdrop.material.uniforms.uShafts.value=params.shafts;
 waterUniforms.uRefraction.value=params.refraction;
 waterUniforms.uCeilingDetail.value=params.ceilingDetail;
 waterUniforms.uCeilingLight.value=params.ceilingLight;
 waterUniforms.uGlint.value=params.glint;
 waterUniforms.uPenetration.value=params.penetration;
 waterUniforms.uUndersideWindow.value=params.undersideWindow;
 waterUniforms.uUndersideShimmer.value=params.undersideShimmer;
 waterUniforms.uSurfaceDetail.value=params.surfaceDetail;
 waterUniforms.uCrestFoam.value=params.crestFoam;
 waterUniforms.uUnderwaterOptics.value=improvedUnderwaterOptics?1:0;
 waterUniforms.uUnderside31.value=undersideDetail31?1:0;
 waterUniforms.uUnderside32.value=undersideRepair32?1:0;
 waterUniforms.uUnderside33.value=undersideBalance33?1:0;
 // Source depth is used only for an above-water refraction test.
 // The underwater material pipeline does not rely on a scene capture.
 waterUniforms.uVolumeScattering.value=params.volumeScattering;
 waterUniforms.uDepthRefraction.value=params.refraction>.001 &&
   (view!=="underwater" || unsafeUnderwaterCapture)?params.depthRefraction:0;
 waterUniforms.uMirrorStrength.value=0;
 // Both sides use the existing scene-color and depth capture. Underwater
 // it captures the sky and objects above the surface, leaving the seafloor
 // out of this *transmitted* scene. Always restore scene visibility.
 if(params.refraction>.001 && (view!=="underwater" || unsafeUnderwaterCapture && params.depthRefraction>.001)){
   const underwaterCapture=view==="underwater";
   const previousUnder=backdrop.material.uniforms.uUnder.value;
   try {
     ocean.visible=false;
     if(underwaterCapture){
       bottom.visible=false;rocks.visible=false;
       backdrop.material.uniforms.uUnder.value=0;
     }
     renderer.setRenderTarget(refractionTarget);
     renderer.clear();
     renderer.render(scene,camera);
   }catch(error){
     waterUniforms.uDepthRefraction.value=0;
     console.warn("[water-lab] Scene transmission capture unavailable",error);
   }finally{
     renderer.setRenderTarget(null);
     ocean.visible=true;bottom.visible=true;rocks.visible=true;
     backdrop.material.uniforms.uUnder.value=previousUnder;
   }
 }
 if(params.sceneReflections>.001&&reflectionSupported){
   const below=view==="underwater";
   const previousAbove=opticalReference.visible;
   const previousUnder=backdrop.material.uniforms.uUnder.value;
   try {
     camera.getWorldDirection(mirrorDirection);
     mirrorCamera.position.copy(camera.position);
     mirrorCamera.position.y=-camera.position.y;
     mirrorPoint.copy(camera.position).add(mirrorDirection);
     mirrorPoint.y=-mirrorPoint.y;
     mirrorCamera.up.set(0,-1,0);
     mirrorCamera.lookAt(mirrorPoint);
     mirrorCamera.updateProjectionMatrix();
     mirrorCamera.updateMatrixWorld(true);
     sceneReflectVP.multiplyMatrices(mirrorCamera.projectionMatrix,
       mirrorCamera.matrixWorldInverse);
     waterUniforms.uMirrorVP.value.copy(sceneReflectVP);
     ocean.visible=false;
     // Above-water reflection captures the sky and reference object;
     // below-water reflection captures the *submerged* seabed and rocks.
     bottom.visible=below;rocks.visible=below;
     opticalReference.visible=!below&&previousAbove;
     backdrop.material.uniforms.uUnder.value=below?1:0;
     backdrop.position.copy(mirrorCamera.position);
     renderer.setRenderTarget(reflectionTarget);
     renderer.clear();
     renderer.render(scene,mirrorCamera);
     waterUniforms.uMirrorStrength.value=params.sceneReflections;
   }catch(error){
     reflectionSupported=false;
     waterUniforms.uMirrorStrength.value=0;
     console.warn("[water-lab] Reflection capture unavailable; using stable water",error);
   }finally{
     renderer.setRenderTarget(null);
     bottom.visible=true;rocks.visible=true;ocean.visible=true;
     opticalReference.visible=previousAbove;
     backdrop.position.copy(camera.position);
     backdrop.material.uniforms.uUnder.value=previousUnder;
   }
 }
 try {
   renderer.render(scene,camera);
 } catch(error){
   showLabFailure(error);
   return;
 }
 count++;
 if(now-last>800){
  smoothed=count*1000/(now-last);
  fpsLabel.textContent="FPS "+smoothed.toFixed(0);
  triLabel.textContent="Triangles "+(renderer.info.render.triangles/1000).toFixed(0)+"k";
  count=0;last=now;
 }
}
animate();
