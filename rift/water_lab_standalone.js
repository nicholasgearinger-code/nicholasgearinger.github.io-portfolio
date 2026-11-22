// Standalone Rift Water Lab 01. NO imports from Rift gameplay or renderer.
// The production game stays entirely untouched while new waves are evaluated.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js";

const canvas = document.getElementById("scene");
const status = document.getElementById("status");
const fpsLabel = document.getElementById("fps");
const triLabel = document.getElementById("tri");
const params = {height:1, chop:1, sun:1, clarity:1, caustics:1, causticSpeed:1, causticCurvature:1, causticFocus:1, refraction:1, occlusion:1};
const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || navigator.maxTouchPoints>0;
let renderer;
try {
  renderer = new THREE.WebGLRenderer({canvas, antialias:false, powerPreference:"high-performance", alpha:false});
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
  uTime:{value:0},uHeight:{value:1},uChop:{value:1},
  uSun:{value:1},uClarity:{value:1},uEye:{value:camera.position},uSceneTex:{value:null},uViewport:{value:new THREE.Vector2(1,1)},uRefraction:{value:1}
};
const waterVert=`
precision highp float;
uniform float uTime,uHeight,uChop;
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
  pos+=delta*uHeight;
  vec3 localNormal=normalize(vec3(-slope.x*uHeight,1.,-slope.y*uHeight));
  vWaveNormal=normalize(mat3(modelMatrix)*localNormal);
  vWorld=(modelMatrix*vec4(pos,1.)).xyz;
  vCrest=smoothstep(.68,1.28,delta.y)*smoothstep(.15,.65,length(slope));
  gl_Position=projectionMatrix*viewMatrix*vec4(vWorld,1.);
}`;
const waterFrag="\nprecision highp float;\nuniform float uTime,uSun,uClarity,uRefraction;\nuniform vec3 uEye;\nuniform vec2 uViewport;\nuniform sampler2D uSceneTex;\nvarying vec3 vWorld,vWaveNormal;\nvarying float vCrest;\nvec3 sky(vec3 dir){\n float h=clamp(dir.y*.8+.28,0.,1.);\n vec3 base=mix(vec3(.65,.81,.91),vec3(.10,.36,.68),pow(h,.64));\n float clouds=sin(dir.x*21.+uTime*.002)*sin(dir.z*24.-dir.x*11.);\n clouds=smoothstep(.30,.76,clouds)*(.35+.65*smoothstep(.1,.65,dir.y));\n base=mix(base,vec3(.95,.98,1.),clouds*.58);\n float solar=pow(max(dot(dir,normalize(vec3(.37,.54,-.7))),0.),240.);\n return base+vec3(1.,.81,.54)*solar*2.2*uSun;\n}\nvoid main(){\n vec3 n=normalize(vWaveNormal);\n vec3 V=normalize(uEye-vWorld);\n bool underwater=!gl_FrontFacing;\n if(underwater)n=-n;\n vec2 p=vWorld.xz;\n vec2 mini=vec2(sin(p.x*2.3+p.y*.65+uTime*1.7),cos(p.y*2.8-p.x*.45+uTime*1.5));\n n=normalize(n+vec3(mini.x,0.,mini.y)*.036);\n float cosTheta=clamp(dot(n,V),0.,1.);\n float f0=pow((1.333-1.)/(1.333+1.),2.);\n float fresnel=f0+(1.-f0)*pow(1.-cosTheta,5.);\n float eta=underwater?1.333:1./1.333;\n vec3 exitRay=refract(-V,n,eta);\n bool totalInternalReflection=dot(exitRay,exitRay)<.00001;\n if(totalInternalReflection)fresnel=1.;\n float sunSpark=pow(max(dot(reflect(-normalize(vec3(.37,.54,-.7)),n),V),0.),90.);\n if(!underwater){\n  // Real scene-color sample contains seabed and rocks. Normal deflection\n  // refracts that scene image at reduced resolution; no recursive render.\n  vec2 uv=gl_FragCoord.xy/max(uViewport,vec2(1.));\n  vec2 lens=vec2(n.x,n.z)*(.020+.025*(1.-cosTheta));\n  vec2 warped=clamp(uv+lens*uRefraction,vec2(.005),vec2(.995));\n  vec3 behind=mix(vec3(.014,.20,.27),texture2D(uSceneTex,warped).rgb,clamp(uRefraction,0.,1.));\n  vec3 body=vec3(.014,.20,.27);\n  vec3 absorption=exp(vec3(-.18,-.075,-.035)*max(1.,3.0/uClarity));\n  vec3 transmitted=mix(behind*absorption+vec3(.018,.064,.077),body,.22);\n  vec3 reflection=sky(reflect(-V,n));\n  vec3 outColor=mix(transmitted,reflection,fresnel);\n  float slope=1.-clamp(abs(n.y),0.,1.);\n  float foam=vCrest*smoothstep(.40,.78,slope);\n  outColor=mix(outColor,vec3(.80,.95,.93),foam*.45);\n  outColor+=vec3(1.,.87,.62)*sunSpark*.69*uSun;\n  float distanceToEye=length(uEye-vWorld);\n  outColor=mix(outColor,vec3(.53,.72,.80),1.-exp(-distanceToEye*.0027));\n  gl_FragColor=vec4(outColor,1.);\n }else{\n  // Underwater-to-air transmission obeys Snell and total internal reflection.\n  vec3 transmitted=sky(normalize(exitRay+vec3(0.,.0001,0.)));\n  float depth=max(0.,-uEye.y);\n  float transmission=exp(-depth*.048/max(uClarity,.25));\n  // A physically constrained Snell window: skylight only penetrates where\n  // the water-to-air ray exists. The critical angle is ~48.6 degrees from\n  // the surface normal; rays nearer the horizon reflect the water below.\n  float upward=clamp(exitRay.y,0.,1.);\n  vec3 skyTransmission=transmitted*transmission*(.90+.22*upward)*uSun;\n  // TIR reflects the darker underwater hemisphere, but wave slopes and\n  // reflected sub-surface light keep it from becoming a featureless slab.\n  vec3 internalRay=reflect(-V,n);\n  float reflectedUp=clamp(internalRay.y*.5+.5,0.,1.);\n  vec3 waterReflection=mix(vec3(.008,.070,.104),vec3(.055,.27,.32),reflectedUp);\n  float waveShimmer=.5+.5*sin(vWorld.x*1.7+vWorld.z*.81+uTime*.76)\n    *sin(vWorld.z*1.3-vWorld.x*.36-uTime*.93);\n  waterReflection+=vec3(.025,.082,.083)*waveShimmer*.42*uSun;\n  vec3 outColor=mix(skyTransmission,waterReflection,fresnel);\n  outColor+=vec3(.018,.083,.105)*(1.-transmission)*uSun;\n  gl_FragColor=vec4(outColor,1.);\n }\n}";
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
const viewportPx=new THREE.Vector2();
function resizeRefraction(){
 renderer.getDrawingBufferSize(viewportPx);
 refractionTarget.setSize(Math.max(8,Math.floor(viewportPx.x*(mobile?.48:.67))),
                          Math.max(8,Math.floor(viewportPx.y*(mobile?.48:.67))));
 waterUniforms.uViewport.value.copy(viewportPx);
 waterUniforms.uSceneTex.value=refractionTarget.texture;
}
resizeRefraction();
const backdrop=new THREE.Mesh(new THREE.SphereGeometry(700,24,16),new THREE.ShaderMaterial({
 uniforms:{uUnder:{value:0},uTime:waterUniforms.uTime,uSun:waterUniforms.uSun,uClarity:waterUniforms.uClarity,uDepth:{value:0}},
 side:THREE.BackSide,depthWrite:false,
 vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`precision highp float;
 varying vec3 vDir;
 uniform float uUnder,uTime,uSun,uClarity,uDepth;
 void main(){
   vec3 d=normalize(vDir);
   float h=clamp(d.y*.5+.5,0.,1.);
   vec3 air=mix(vec3(.67,.84,.93),vec3(.12,.40,.75),pow(h,.75));
   float cloud=sin(d.x*28.+d.z*13.+uTime*.004)*sin(d.z*31.-d.x*17.);
   air=mix(air,vec3(.94,.96,.97),smoothstep(.25,.85,cloud)*.38);
   // Underwater: an upward-directed sky light field attenuated by the
   // vertical water column. This fills missing distant surface pixels,
   // without replacing the actual refracting 3D ceiling.
   float up=smoothstep(-.18,.88,d.y);
   float depthFade=exp(-uDepth*.066/max(uClarity,.25));
   vec3 water=vec3(.009,.070,.114);
   vec3 skylight=vec3(.075,.40,.47)*up*depthFade*uSun;
   vec3 skyWindow=vec3(.026,.11,.16)*pow(max(d.y,0.),1.5);
   float ripple=sin(d.x*18.+uTime*.41)*sin(d.z*21.-uTime*.53);
   vec3 sea=water+skylight+skyWindow+vec3(.009,.032,.038)*ripple*up;
   sea=mix(sea,vec3(.005,.028,.052),smoothstep(26.,100.,uDepth));
   gl_FragColor=vec4(mix(air,sea,uUnder),1.);
 }`
}));
backdrop.renderOrder=-100;
scene.add(backdrop);
// Water Lab 04: both seabed and rock faces use exactly the same moving
// world-space caustic functions, light extinction and optical projection.
const bottomMat=new THREE.ShaderMaterial({
 uniforms:{uTime:waterUniforms.uTime,uClarity:waterUniforms.uClarity,uHeight:waterUniforms.uHeight,uChop:waterUniforms.uChop,uSun:waterUniforms.uSun,uCaustics:{value:1},uCausticSpeed:{value:1},uCausticCurvature:{value:1},uCausticFocus:{value:1},uShadowMap:{value:null},uLightVP:{value:new THREE.Matrix4()},uOcclusion:{value:1},uEye:waterUniforms.uEye},
 vertexShader:"varying vec3 vWorld;\nvoid main(){\n vec4 w=modelMatrix*vec4(position,1.0);\n vWorld=w.xyz;\n gl_Position=projectionMatrix*viewMatrix*w;\n}",
 fragmentShader:"precision highp float;\nuniform float uTime,uClarity,uHeight,uChop,uSun,uCaustics,uCausticSpeed,uCausticCurvature,uCausticFocus;\nuniform vec3 uEye;\nvarying vec3 vWorld;\nvec2 cellHash(vec2 p){\n  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));\n  return fract(sin(p)*43758.5453);\n}\n// Continuous network of focused lines between neighboring wave lenslets.\nvec2 refractedFootprint(vec2 p,float t){\n  float a=dot(p,vec2(.96,.28))*.095-t*.70;\n  float b=dot(p,vec2(.40,.91))*.16-t*1.16;\n  float c=dot(p,vec2(-.71,.70))*.28-t*1.44;\n  float d=dot(p,vec2(.90,-.44))*.49-t*2.10;\n  float e=dot(p,vec2(-.30,-.95))*.88-t*3.45;\n  // Approximate surface slopes of the very same five waves rendered above.\n  vec2 slope=vec2(.96,.28)*(.68*.095*cos(a))\n    +vec2(.40,.91)*(.40*.16*cos(b))\n    +vec2(-.71,.70)*(.24*.28*cos(c))\n    +vec2(.90,-.44)*(.12*.49*cos(d))\n    +vec2(-.30,-.95)*(.055*.88*cos(e));\n  // Additional crossing capillary lenslets produce fast, fine changes.\n  vec2 micro=vec2(\n    sin(p.y*.43+p.x*.15-t*.93)+.48*sin(p.x*.63-p.y*.27+t*1.12),\n    cos(p.x*.39-p.y*.23+t*.84)+.43*cos(p.y*.71+p.x*.13-t*1.32)\n  );\n  return p+clamp(slope*17.0*uHeight,-vec2(2.3),vec2(2.3))\n     +micro*(.30+.13*uChop);\n}\n\n\n// Water Lab 05: low-frequency noise warps the caustic contours into locally\n// rotating, fluid-like ribbons, not straight cells. Derivatives are avoided.\nfloat causticNoise(vec2 p) {\n  vec2 i=floor(p),f=fract(p);\n  vec2 u=f*f*(3.0-2.0*f);\n  float a=cellHash(i).x;\n  float b=cellHash(i+vec2(1.0,0.0)).x;\n  float c=cellHash(i+vec2(0.0,1.0)).x;\n  float d=cellHash(i+vec2(1.0,1.0)).x;\n  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);\n}\nmat2 causticRotation(float a){\n  float c=cos(a),s=sin(a);\n  return mat2(c,-s,s,c);\n}\nvec2 causticFlow(vec2 p,float t){\n  float a=causticNoise(p*.11+vec2(t*.028,-t*.017));\n  float b=causticNoise(p*.13+vec2(11.8,-4.7)+vec2(-t*.023,t*.020));\n  vec2 slow=vec2(a-.5,b-.5)*(2.9*uCausticCurvature);\n  vec2 flowing=vec2(\n    sin(p.y*.17+t*.21)+.42*sin(p.x*.29-p.y*.12-t*.18),\n    cos(p.x*.16-t*.17)+.45*cos(p.y*.32+p.x*.13+t*.24)\n  )*(.68*uCausticCurvature);\n  return p+slow+flowing;\n}\nvec2 curvedRidges(vec2 p,float t){\n  vec2 q=causticFlow(p,t);\n  // Local turning breaks the visual lattice and allows lines to curve in\n  // different directions in different areas of the same rock or sand patch.\n  float theta=(causticNoise(q*.10+vec2(5.1,7.3))-.5)*4.5*uCausticCurvature;\n  vec2 r=causticRotation(theta)*q;\n  float phaseA=r.x*1.24+.76*sin(r.y*.57+t*.32)-t*.63;\n  float phaseB=r.y*1.48+.65*sin(r.x*.62-t*.27)+t*.47;\n  float phaseC=dot(r,vec2(.72,-.69))*1.93+.45*sin(r.y*.82+t*.36)-t*.83;\n  // Multiple crossing contours change topology as the underlying waves\n  // move, but do not form identical square cells or parallel straight rows.\n  float contour=sin(phaseA)*.74+sin(phaseB)*.62+sin(phaseC)*.32;\n  float width=mix(.15,.055,clamp(uCausticFocus*.55,0.0,1.0));\n  float fine=1.0-smoothstep(width*.36,width*1.65,abs(contour));\n  float halo=1.0-smoothstep(width*.8,width*4.4,abs(contour));\n  float clusters=causticNoise(q*.17+vec2(-8.3,9.7));\n  float irregular=mix(.53,1.2,smoothstep(.12,.83,clusters));\n  return vec2(fine,halo)*irregular;\n}\nfloat causticLightAt(vec3 worldPos) {\n  // The projection stays in WORLD space, shared by seabed and object faces.\n  // Propagation shifts the light footprint slightly as it travels downward.\n  float depth=max(0.0,-worldPos.y);\n  vec2 p=worldPos.xz+vec2(.11,-.075)*depth;\n  float t=uTime*uCausticSpeed;\n  vec2 footprint=refractedFootprint(p,t);\n  vec2 base=curvedRidges(footprint*.42,t);\n  vec2 detail=curvedRidges((footprint+vec2(11.7,-8.2))*.72,-t*.81);\n  float crossing=base.x*detail.x;\n  float filaments=clamp(base.x*.78+detail.x*.29+crossing*.32,0.0,1.75);\n  float broad=clamp(base.y*.55+detail.y*.25,0.0,1.0);\n  float focus=clamp(1.12-.12*max(uChop-1.0,0.0),.72,1.12);\n  // At depth, defocused ribbons become broader and dimmer, never brighter.\n  float clarity=max(uClarity,.25);\n  float transport=exp(-depth*.053/clarity);\n  float detailFade=exp(-depth*.024/clarity);\n  float lighting=filaments*detailFade+(.12+(1.0-detailFade)*.24)*broad;\n  return lighting*uCaustics*uSun*focus*(.64+.26*uHeight)*transport;\n}\nvec3 waterAttenuate(vec3 lit,vec3 worldPos){\n  float distanceToCamera=length(worldPos-uEye);\n  float fog=1.0-exp(-distanceToCamera*.016/max(uClarity,.25));\n  return mix(lit,vec3(.014,.11,.16),clamp(fog,0.0,1.0));\n}\n\n\nuniform sampler2D uShadowMap;\nuniform mat4 uLightVP;\nuniform float uOcclusion;\n// Shadow occlusion from rock depth capture, with four stable PCF taps.\n// The light camera matches the downward sunlight used for caustics.\nfloat shadowVisibility(vec3 worldPoint){\n  vec4 clip=uLightVP*vec4(worldPoint,1.0);\n  vec3 ndc=clip.xyz/max(clip.w,0.0001);\n  vec3 uvz=ndc*.5+.5;\n  if(uvz.x<.002||uvz.y<.002||uvz.x>.998||uvz.y>.998\n      ||uvz.z<0.0||uvz.z>1.0)return 1.0;\n  float visibility=0.0;\n  vec2 texel=vec2(1.0/float(512.0));\n  float bias=.0018;\n  for(int y=0;y<2;y++){\n    for(int x=0;x<2;x++){\n      vec2 o=(vec2(float(x),float(y))-.5)*texel*1.8;\n      float receiver=texture2D(uShadowMap,uvz.xy+o).r;\n      visibility+=step(uvz.z-bias,receiver);\n    }\n  }\n  return mix(1.0,.16+.84*(visibility*.25),clamp(uOcclusion,0.,1.));\n}\n\nvoid main(){\n  vec2 p=vWorld.xz;\n  float grit=sin(p.x*1.7+sin(p.y*.28)*1.3)\n    *sin(p.y*1.4-p.x*.27)*.008;\n  vec3 sand=vec3(.225,.329,.305)+grit;\n  sand+=vec3(.75,.91,.82)*causticLightAt(vWorld)*shadowVisibility(vWorld+vec3(0.,.09,0.));\n  gl_FragColor=vec4(waterAttenuate(sand,vWorld),1.0);\n}"
});
const bottom=new THREE.Mesh(new THREE.PlaneGeometry(1100,1100,4,4),bottomMat);
bottom.rotation.x=-Math.PI/2;bottom.position.y=-13;scene.add(bottom);
const rockMat=new THREE.ShaderMaterial({
 uniforms:{
  uTime:waterUniforms.uTime,uClarity:waterUniforms.uClarity,
  uHeight:waterUniforms.uHeight,uChop:waterUniforms.uChop,
  uSun:waterUniforms.uSun,uCaustics:bottomMat.uniforms.uCaustics,
  uCausticSpeed:bottomMat.uniforms.uCausticSpeed,uCausticCurvature:bottomMat.uniforms.uCausticCurvature,uCausticFocus:bottomMat.uniforms.uCausticFocus,uShadowMap:bottomMat.uniforms.uShadowMap,uLightVP:bottomMat.uniforms.uLightVP,uOcclusion:bottomMat.uniforms.uOcclusion,uEye:waterUniforms.uEye
 },
 vertexShader:"\nvarying vec3 vWorld;\nvarying vec3 vWorldNormal;\nvoid main(){\n  vec4 local=vec4(position,1.0);\n  vec3 n=normal;\n  #ifdef USE_INSTANCING\n    local=instanceMatrix*local;\n    // Correct normal orientation for nonuniform rock-instance scaling.\n    vec3 sx=vec3(instanceMatrix[0].xyz);\n    vec3 sy=vec3(instanceMatrix[1].xyz);\n    vec3 sz=vec3(instanceMatrix[2].xyz);\n    n=mat3(instanceMatrix)*(n/vec3(\n      max(dot(sx,sx),.0001),\n      max(dot(sy,sy),.0001),\n      max(dot(sz,sz),.0001)\n    ));\n  #endif\n  vec4 world=modelMatrix*local;\n  vWorld=world.xyz;\n  vWorldNormal=normalize(mat3(modelMatrix)*n);\n  gl_Position=projectionMatrix*viewMatrix*world;\n}",
 fragmentShader:"precision highp float;\nuniform float uTime,uClarity,uHeight,uChop,uSun,uCaustics,uCausticSpeed,uCausticCurvature,uCausticFocus;\nuniform vec3 uEye;\nvarying vec3 vWorld;\nvarying vec3 vWorldNormal;\nvec2 cellHash(vec2 p){\n  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));\n  return fract(sin(p)*43758.5453);\n}\n// Continuous network of focused lines between neighboring wave lenslets.\nvec2 refractedFootprint(vec2 p,float t){\n  float a=dot(p,vec2(.96,.28))*.095-t*.70;\n  float b=dot(p,vec2(.40,.91))*.16-t*1.16;\n  float c=dot(p,vec2(-.71,.70))*.28-t*1.44;\n  float d=dot(p,vec2(.90,-.44))*.49-t*2.10;\n  float e=dot(p,vec2(-.30,-.95))*.88-t*3.45;\n  // Approximate surface slopes of the very same five waves rendered above.\n  vec2 slope=vec2(.96,.28)*(.68*.095*cos(a))\n    +vec2(.40,.91)*(.40*.16*cos(b))\n    +vec2(-.71,.70)*(.24*.28*cos(c))\n    +vec2(.90,-.44)*(.12*.49*cos(d))\n    +vec2(-.30,-.95)*(.055*.88*cos(e));\n  // Additional crossing capillary lenslets produce fast, fine changes.\n  vec2 micro=vec2(\n    sin(p.y*.43+p.x*.15-t*.93)+.48*sin(p.x*.63-p.y*.27+t*1.12),\n    cos(p.x*.39-p.y*.23+t*.84)+.43*cos(p.y*.71+p.x*.13-t*1.32)\n  );\n  return p+clamp(slope*17.0*uHeight,-vec2(2.3),vec2(2.3))\n     +micro*(.30+.13*uChop);\n}\n\n\n// Water Lab 05: low-frequency noise warps the caustic contours into locally\n// rotating, fluid-like ribbons, not straight cells. Derivatives are avoided.\nfloat causticNoise(vec2 p) {\n  vec2 i=floor(p),f=fract(p);\n  vec2 u=f*f*(3.0-2.0*f);\n  float a=cellHash(i).x;\n  float b=cellHash(i+vec2(1.0,0.0)).x;\n  float c=cellHash(i+vec2(0.0,1.0)).x;\n  float d=cellHash(i+vec2(1.0,1.0)).x;\n  return mix(mix(a,b,u.x),mix(c,d,u.x),u.y);\n}\nmat2 causticRotation(float a){\n  float c=cos(a),s=sin(a);\n  return mat2(c,-s,s,c);\n}\nvec2 causticFlow(vec2 p,float t){\n  float a=causticNoise(p*.11+vec2(t*.028,-t*.017));\n  float b=causticNoise(p*.13+vec2(11.8,-4.7)+vec2(-t*.023,t*.020));\n  vec2 slow=vec2(a-.5,b-.5)*(2.9*uCausticCurvature);\n  vec2 flowing=vec2(\n    sin(p.y*.17+t*.21)+.42*sin(p.x*.29-p.y*.12-t*.18),\n    cos(p.x*.16-t*.17)+.45*cos(p.y*.32+p.x*.13+t*.24)\n  )*(.68*uCausticCurvature);\n  return p+slow+flowing;\n}\nvec2 curvedRidges(vec2 p,float t){\n  vec2 q=causticFlow(p,t);\n  // Local turning breaks the visual lattice and allows lines to curve in\n  // different directions in different areas of the same rock or sand patch.\n  float theta=(causticNoise(q*.10+vec2(5.1,7.3))-.5)*4.5*uCausticCurvature;\n  vec2 r=causticRotation(theta)*q;\n  float phaseA=r.x*1.24+.76*sin(r.y*.57+t*.32)-t*.63;\n  float phaseB=r.y*1.48+.65*sin(r.x*.62-t*.27)+t*.47;\n  float phaseC=dot(r,vec2(.72,-.69))*1.93+.45*sin(r.y*.82+t*.36)-t*.83;\n  // Multiple crossing contours change topology as the underlying waves\n  // move, but do not form identical square cells or parallel straight rows.\n  float contour=sin(phaseA)*.74+sin(phaseB)*.62+sin(phaseC)*.32;\n  float width=mix(.15,.055,clamp(uCausticFocus*.55,0.0,1.0));\n  float fine=1.0-smoothstep(width*.36,width*1.65,abs(contour));\n  float halo=1.0-smoothstep(width*.8,width*4.4,abs(contour));\n  float clusters=causticNoise(q*.17+vec2(-8.3,9.7));\n  float irregular=mix(.53,1.2,smoothstep(.12,.83,clusters));\n  return vec2(fine,halo)*irregular;\n}\nfloat causticLightAt(vec3 worldPos) {\n  // The projection stays in WORLD space, shared by seabed and object faces.\n  // Propagation shifts the light footprint slightly as it travels downward.\n  float depth=max(0.0,-worldPos.y);\n  vec2 p=worldPos.xz+vec2(.11,-.075)*depth;\n  float t=uTime*uCausticSpeed;\n  vec2 footprint=refractedFootprint(p,t);\n  vec2 base=curvedRidges(footprint*.42,t);\n  vec2 detail=curvedRidges((footprint+vec2(11.7,-8.2))*.72,-t*.81);\n  float crossing=base.x*detail.x;\n  float filaments=clamp(base.x*.78+detail.x*.29+crossing*.32,0.0,1.75);\n  float broad=clamp(base.y*.55+detail.y*.25,0.0,1.0);\n  float focus=clamp(1.12-.12*max(uChop-1.0,0.0),.72,1.12);\n  // At depth, defocused ribbons become broader and dimmer, never brighter.\n  float clarity=max(uClarity,.25);\n  float transport=exp(-depth*.053/clarity);\n  float detailFade=exp(-depth*.024/clarity);\n  float lighting=filaments*detailFade+(.12+(1.0-detailFade)*.24)*broad;\n  return lighting*uCaustics*uSun*focus*(.64+.26*uHeight)*transport;\n}\nvec3 waterAttenuate(vec3 lit,vec3 worldPos){\n  float distanceToCamera=length(worldPos-uEye);\n  float fog=1.0-exp(-distanceToCamera*.016/max(uClarity,.25));\n  return mix(lit,vec3(.014,.11,.16),clamp(fog,0.0,1.0));\n}\n\n\nuniform sampler2D uShadowMap;\nuniform mat4 uLightVP;\nuniform float uOcclusion;\n// Shadow occlusion from rock depth capture, with four stable PCF taps.\n// The light camera matches the downward sunlight used for caustics.\nfloat shadowVisibility(vec3 worldPoint){\n  vec4 clip=uLightVP*vec4(worldPoint,1.0);\n  vec3 ndc=clip.xyz/max(clip.w,0.0001);\n  vec3 uvz=ndc*.5+.5;\n  if(uvz.x<.002||uvz.y<.002||uvz.x>.998||uvz.y>.998\n      ||uvz.z<0.0||uvz.z>1.0)return 1.0;\n  float visibility=0.0;\n  vec2 texel=vec2(1.0/float(512.0));\n  float bias=.0018;\n  for(int y=0;y<2;y++){\n    for(int x=0;x<2;x++){\n      vec2 o=(vec2(float(x),float(y))-.5)*texel*1.8;\n      float receiver=texture2D(uShadowMap,uvz.xy+o).r;\n      visibility+=step(uvz.z-bias,receiver);\n    }\n  }\n  return mix(1.0,.16+.84*(visibility*.25),clamp(uOcclusion,0.,1.));\n}\n\nvoid main(){\n  vec3 n=normalize(vWorldNormal);\n  vec3 sunDir=normalize(vec3(.37,.54,-.7));\n  float upward=max(dot(n,sunDir),0.0);\n  // Near-vertical faces still receive scattered underwater light;\n  // overhangs and sheltered faces stay mostly dim.\n  float exposure=pow(upward,.65);\n  float skyBounce=.19+.23*max(n.y,0.0);\n  // Diffuse marine ambient remains, but downward/overhanging faces receive\n  // very little focused light; this is an approximation, not raytraced shadow.\n  float shelter=mix(.17,1.0,smoothstep(-.35,.50,n.y));\n  float shadow=shadowVisibility(vWorld+n*.11);\n  float caustics=causticLightAt(vWorld)*exposure*shelter*shadow;\n  // Nonuniform rock albedo, without repeating UV textures or extra draws.\n  float roughPattern=sin(vWorld.x*2.3+vWorld.y*1.5)\n    *sin(vWorld.z*2.7-vWorld.x*.41)*.035;\n  vec3 rock=vec3(.17,.27,.265)+vec3(roughPattern);\n  rock*=(skyBounce+.29*exposure)*mix(.68,1.0,shadow);\n  rock+=vec3(.78,.95,.82)*caustics;\n  gl_FragColor=vec4(waterAttenuate(rock,vWorld),1.0);\n}"
});
const rocks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),rockMat,46);
const dummy=new THREE.Object3D();
for(let i=0;i<46;i++){
 // Keep a meaningful fraction of the rock samples inside the underwater
 // camera frustum for an immediate A/B of sand-to-rock illumination.
 const x=(Math.sin(i*71.1)*.5+.5)*38-19;
 const z=8-(Math.sin(i*17.71)*.5+.5)*77;
 dummy.position.set(x,-12.55,z);
 dummy.rotation.set(i*.3,i*.9,i*.14);
 dummy.scale.set(.65+(i%4)*.35,.40+(i%3)*.28,.75+(i%6)*.38);
 dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
}scene.add(rocks);
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
const sunCenter=new THREE.Vector3(0,-12,-26);
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
 if(v==="underwater"){camera.position.set(0,-4,14);pitch=.96;}
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
canvas.addEventListener("pointerup",()=>dragging=false);
canvas.addEventListener("pointercancel",()=>dragging=false);
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);resizeRefraction()}
window.addEventListener("resize",resize);
setView("surface");
let last=performance.now(),count=0,smoothed=60;
function animate(){
 requestAnimationFrame(animate);
 const t=clock.getElapsedTime(),now=performance.now();
 waterUniforms.uTime.value=t;waterUniforms.uHeight.value=params.height;
 waterUniforms.uChop.value=params.chop;waterUniforms.uSun.value=params.sun;
 waterUniforms.uClarity.value=params.clarity;
 bottomMat.uniforms.uCaustics.value=params.caustics;
 bottomMat.uniforms.uCausticSpeed.value=params.causticSpeed;
 bottomMat.uniforms.uCausticCurvature.value=params.causticCurvature;
 bottomMat.uniforms.uCausticFocus.value=params.causticFocus;
 bottomMat.uniforms.uOcclusion.value=params.occlusion;
 if((shadowFrame++ % (mobile?3:2))===0&&params.occlusion>.001){
   renderer.setRenderTarget(shadowTarget);
   renderer.clear();
   renderer.render(shadowScene,shadowCamera);
   renderer.setRenderTarget(null);
 }
 ocean.position.x=camera.position.x;ocean.position.z=camera.position.z;
 backdrop.position.copy(camera.position);
 backdrop.material.uniforms.uDepth.value=Math.max(0,-camera.position.y);
 waterUniforms.uRefraction.value=params.refraction;
 if(view!=="underwater"&&params.refraction>.001){
   ocean.visible=false;
   renderer.setRenderTarget(refractionTarget);
   renderer.clear();
   renderer.render(scene,camera);
   renderer.setRenderTarget(null);
   ocean.visible=true;
 }
 renderer.render(scene,camera);
 count++;
 if(now-last>800){
  smoothed=count*1000/(now-last);
  fpsLabel.textContent="FPS "+smoothed.toFixed(0);
  triLabel.textContent="Triangles "+(renderer.info.render.triangles/1000).toFixed(0)+"k";
  count=0;last=now;
 }
}
animate();
