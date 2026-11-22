// Standalone Rift Water Lab 01. NO imports from Rift gameplay or renderer.
// The production game stays entirely untouched while new waves are evaluated.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.1/build/three.module.js";

const canvas = document.getElementById("scene");
const status = document.getElementById("status");
const fpsLabel = document.getElementById("fps");
const triLabel = document.getElementById("tri");
const params = {height:1, chop:1, sun:1, clarity:1, caustics:1, causticSpeed:1};
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
  uSun:{value:1},uClarity:{value:1},uEye:{value:camera.position}
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
const waterFrag=`
precision highp float;
uniform float uTime,uSun,uClarity;
uniform vec3 uEye;
varying vec3 vWorld,vWaveNormal;
varying float vCrest;
float hash21(vec2 x){return fract(sin(dot(x,vec2(127.1,311.7)))*43758.5453);}
vec3 sky(vec3 dir) {
  float h=clamp(dir.y*.8+.28,0.,1.);
  vec3 base=mix(vec3(.65,.81,.91),vec3(.10,.36,.68),pow(h,.64));
  float clouds=sin(dir.x*21.+uTime*.002)*sin(dir.z*24.-dir.x*11.);
  clouds=smoothstep(.30,.76,clouds)*(.35+.65*smoothstep(.1,.65,dir.y));
  base=mix(base,vec3(.95,.98,1.),clouds*.58);
  vec3 sunDir=normalize(vec3(.37,.54,-.7));
  float solar=pow(max(dot(dir,sunDir),0.),240.);
  return base+vec3(1.,.81,.54)*solar*2.2*uSun;
}
void main(){
  vec3 N=normalize(vWaveNormal);
  vec3 V=normalize(uEye-vWorld);
  bool underwater=!gl_FrontFacing;
  if(underwater) N=-N;
  float t=uTime;
  vec2 p=vWorld.xz;
  vec2 mini=vec2(sin(p.x*2.3+p.y*.65+t*1.7),cos(p.y*2.8-p.x*.45+t*1.5));
  N=normalize(N+vec3(mini.x,.0,mini.y)*.036);
  float facing=clamp(dot(N,V),0.,1.);
  float fresnel=.023+.977*pow(1.-facing,5.);
  vec3 reflection=sky(reflect(-V,N));
  float sunSpark=pow(max(dot(reflect(-normalize(vec3(.37,.54,-.7)),N),V),0.),95.);
  if(!underwater){
    float slope=1.-clamp(abs(N.y),0.,1.);
    vec3 body=mix(vec3(.016,.16,.23),vec3(.016,.34,.40),clamp(.55+vWorld.y*.16,0.,1.));
    vec3 colorOut=mix(body,reflection,clamp(.18+fresnel*.73+slope*.08,0.,.96));
    float foam=vCrest*smoothstep(.4,.78,slope);
    colorOut=mix(colorOut,vec3(.80,.95,.93),foam*.46);
    colorOut+=vec3(1.,.86,.62)*sunSpark*.78*uSun;
    float distanceToEye=length(uEye-vWorld);
    colorOut=mix(colorOut,vec3(.53,.72,.80),1.-exp(-distanceToEye*.0027));
    gl_FragColor=vec4(colorOut,1.);
  }else{
    // Ocean ceiling: upward water-to-air transmission, moving wave facets,
    // and the Snell-window-inspired central highlight.
    float skyWindow=pow(clamp(dot(normalize(vWorld-uEye),vec3(0.,1.,0.)),0.,1.),.8);
    vec3 transmit=sky(normalize(vec3(N.x*.80,.36+N.y*.16,N.z*.80)));
    float depth=max(0.,-uEye.y);
    vec3 tint=mix(vec3(.045,.30,.40),vec3(.11,.55,.58),skyWindow);
    vec3 outColor=mix(tint,transmit*.76,clamp(.2+skyWindow*.58,0.,.85));
    outColor*=exp(-depth*.033/uClarity);
    outColor+=vec3(.02,.16,.20)*pow(max(0.,1.-fresnel),2.)*uSun;
    gl_FragColor=vec4(outColor,1.);
  }
}`;
const geom=new THREE.PlaneGeometry(560,560,mobile?170:244,mobile?170:244);
geom.rotateX(-Math.PI/2);
const ocean=new THREE.Mesh(geom,new THREE.ShaderMaterial({
 uniforms:waterUniforms,vertexShader:waterVert,fragmentShader:waterFrag,side:THREE.DoubleSide
}));
ocean.frustumCulled=false;
scene.add(ocean);
const backdrop=new THREE.Mesh(new THREE.SphereGeometry(700,24,16),new THREE.ShaderMaterial({
 uniforms:{uUnder:{value:0},uTime:waterUniforms.uTime},
 side:THREE.BackSide,depthWrite:false,
 vertexShader:`varying vec3 vDir;void main(){vDir=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
 fragmentShader:`precision mediump float;varying vec3 vDir;uniform float uUnder;uniform float uTime;
 void main(){vec3 d=normalize(vDir);float h=clamp(d.y*.5+.5,0.,1.);
 vec3 air=mix(vec3(.67,.84,.93),vec3(.12,.40,.75),pow(h,.75));
 float cloud=sin(d.x*28.+d.z*13.+uTime*.004)*sin(d.z*31.-d.x*17.);
 air=mix(air,vec3(.94,.96,.97),smoothstep(.25,.85,cloud)*.38);
 vec3 sea=mix(vec3(.013,.085,.14),vec3(.03,.31,.43),smoothstep(.12,.93,h));
 gl_FragColor=vec4(mix(air,sea,uUnder),1.);}`
}));
backdrop.renderOrder=-100;
scene.add(backdrop);
const bottomMat=new THREE.ShaderMaterial({
 uniforms:{uTime:waterUniforms.uTime,uClarity:waterUniforms.uClarity,uHeight:waterUniforms.uHeight,uChop:waterUniforms.uChop,uSun:waterUniforms.uSun,uCaustics:{value:1},uCausticSpeed:{value:1},uEye:waterUniforms.uEye},
 vertexShader:"varying vec3 vWorld;void main(){vec4 w=modelMatrix*vec4(position,1.0);vWorld=w.xyz;gl_Position=projectionMatrix*viewMatrix*w;}",
 fragmentShader:"\nprecision highp float;\nvarying vec3 vWorld;\nuniform float uTime,uClarity,uHeight,uChop,uSun,uCaustics,uCausticSpeed;\nuniform vec3 uEye;\nvec2 cellHash(vec2 p){\n  p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));\n  return fract(sin(p)*43758.5453);\n}\n// Continuous network of focused lines between neighboring wave lenslets.\nvec2 causticNetwork(vec2 p) {\n  vec2 id=floor(p),f=fract(p);\n  float nearest=8.0,second=8.0;\n  for(int iy=-1;iy<=1;iy++) {\n    for(int ix=-1;ix<=1;ix++) {\n      vec2 g=vec2(float(ix),float(iy));\n      vec2 h=cellHash(id+g);\n      vec2 center=g+0.5+0.22*(h-0.5);\n      vec2 v=center-f;\n      float d=dot(v,v);\n      if(d<nearest){ second=nearest;nearest=d; }\n      else if(d<second){second=d;}\n    }\n  }\n  float gap=max(0.0,sqrt(second)-sqrt(nearest));\n  float thin=1.0-smoothstep(0.008,0.075,gap);\n  float soft=1.0-smoothstep(0.02,0.19,gap);\n  return vec2(thin,soft);\n}\n// Light projected through the moving surface: strongly warped by gradients\n// of the traveling long and crossing short waves, not an animated Voronoi\n// center. This stretches, merges and splits bright strands continuously.\nvec2 refractedFootprint(vec2 p,float t){\n  float a=dot(p,vec2(.96,.28))*.095-t*.70;\n  float b=dot(p,vec2(.40,.91))*.16-t*1.16;\n  float c=dot(p,vec2(-.71,.70))*.28-t*1.44;\n  float d=dot(p,vec2(.90,-.44))*.49-t*2.10;\n  float e=dot(p,vec2(-.30,-.95))*.88-t*3.45;\n  // Approximate surface slopes of the very same five waves rendered above.\n  vec2 slope=vec2(.96,.28)*(.68*.095*cos(a))\n    +vec2(.40,.91)*(.40*.16*cos(b))\n    +vec2(-.71,.70)*(.24*.28*cos(c))\n    +vec2(.90,-.44)*(.12*.49*cos(d))\n    +vec2(-.30,-.95)*(.055*.88*cos(e));\n  // Additional crossing capillary lenslets produce fast, fine changes.\n  vec2 micro=vec2(\n    sin(p.y*.43+p.x*.15-t*.93)+.48*sin(p.x*.63-p.y*.27+t*1.12),\n    cos(p.x*.39-p.y*.23+t*.84)+.43*cos(p.y*.71+p.x*.13-t*1.32)\n  );\n  return p+clamp(slope*17.0*uHeight,-vec2(2.3),vec2(2.3))\n     +micro*(.30+.13*uChop);\n}\nvoid main(){\n  vec2 p=vWorld.xz;\n  float t=uTime*uCausticSpeed;\n  vec2 footprint=refractedFootprint(p,t);\n  // Two scales are offset and rotate at different rates: fine lines appear,\n  // drift, brighten at intersections and vanish naturally.\n  vec2 primary=causticNetwork(footprint*.33);\n  vec2 secondary=causticNetwork((footprint+vec2(13.7,-7.9))*.55\n    +vec2(.13*sin(t*.19),.11*cos(t*.15)));\n  float filaments=clamp(primary.x*.74+secondary.x*.25,0.0,1.0);\n  float halo=clamp(primary.y*.60+secondary.y*.26,0.0,1.0);\n  // Small irregular focusing peaks where moving strands intersect.\n  float crossings=primary.x*secondary.x;\n  float focus=clamp(1.12-.12*max(uChop-1.0,0.0),.72,1.12);\n  float attenuation=exp(-13.0*.051/max(uClarity,.25));\n  float light=(.10*halo+.87*filaments+.30*crossings)\n    *uCaustics*uSun*focus*(.64+.26*uHeight)*attenuation;\n  float grit=sin(p.x*1.7+sin(p.y*.28)*1.3)\n    *sin(p.y*1.4-p.x*.27)*.008;\n  vec3 sand=vec3(.225,.329,.305)+grit;\n  sand+=vec3(.75,.91,.82)*light;\n  float range=length(vWorld-uEye);\n  float fog=1.0-exp(-range*.016/max(uClarity,.25));\n  gl_FragColor=vec4(mix(sand,vec3(.014,.11,.16),clamp(fog,0.0,1.0)),1.0);\n}"
});
const bottom=new THREE.Mesh(new THREE.PlaneGeometry(1100,1100,4,4),bottomMat);
bottom.rotation.x=-Math.PI/2;bottom.position.y=-13;scene.add(bottom);
const rockMat=new THREE.MeshStandardMaterial({color:0x416469,roughness:1,flatShading:false});
const rocks=new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1,1),rockMat,46);
const dummy=new THREE.Object3D();
for(let i=0;i<46;i++){const x=(Math.sin(i*71.1)*.5+.5)*130-65,z=-10-(Math.sin(i*17.71)*.5+.5)*160;
 dummy.position.set(x,-12.6,z);dummy.rotation.set(i*.3,i*.9,i*.14);dummy.scale.set(.35+(i%4)*.29,.23+(i%3)*.18,.55+(i%6)*.32);
 dummy.updateMatrix();rocks.setMatrixAt(i,dummy.matrix);
}scene.add(rocks);
const ambient=new THREE.HemisphereLight(0x9beaff,0x184250,1.4);
scene.add(ambient);const sun=new THREE.DirectionalLight(0xf5fbff,2.0);
sun.position.set(50,80,-90);scene.add(sun);
function setView(v){
 view=v;
 for(const b of document.querySelectorAll("[data-view]"))b.setAttribute("aria-pressed",String(b.dataset.view===v));
 if(v==="surface"){camera.position.set(0,4.6,14);pitch=-.07;}
 if(v==="waterline"){camera.position.set(0,.23,14);pitch=-.015;}
 if(v==="underwater"){camera.position.set(0,-4,14);pitch=.18;}
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
function resize(){camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)}
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
 ocean.position.x=camera.position.x;ocean.position.z=camera.position.z;
 backdrop.position.copy(camera.position);
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
