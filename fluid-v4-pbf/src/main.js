// Fluid V4 portfolio integration layer.
// PBF/SSFR core pinned to Particles4All commit 58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0 (MIT).

const q = new URLSearchParams(location.search);
const defaults = {
  preset:'small', view:'ssfr', bodies:'1', body:'sphere:0.55:0.82', bodysize:'0.13',
  grab:'1', grabstrength:'23', force:'1', fradius:'0.14', fstrength:'36', flimit:'6',
  particles:'30000', substeps:'2', iters:'4', xsph:'0.03', scorr:'0.08', tension:'0.25',
  ssfrscale:'0.52', ssfrfilter:'2', ssfriters:'3', ssfrradius:'0.72', ssfrdelta:'8.6',
  ssfrmu:'1.04', ssfrthickr:'1.75', ssfrthick:'0.55', ssfrthickblur:'20',
  ior:'1.333', absorption:'0.425', transmit:'0.34902 0.705882 0.894118', roughness:'0.048',
  camera:'-0.72 0.56 2.85 0.75 0.40 0.50', floorplane:'1', cubemap:'', v4ui:'1'
};
for (const [k,v] of Object.entries(defaults)) if (!q.has(k)) q.set(k,v);
history.replaceState(null,'',location.pathname+'?'+q.toString()+location.hash);

await import('https://cdn.jsdelivr.net/gh/matsuoka-601/Particles4All@58d6fa6d2c50e3f58da5c7a6f9b885ce26c485f0/src/main.js');

const canvas = document.getElementById('view');
const fpsEl = document.getElementById('v4fps');
const statsEl = document.getElementById('v4stats');
const modeEl = document.getElementById('v4mode');
const hintEl = document.getElementById('v4hint');
const modeBtn = document.getElementById('modeBtn');
const dropBtn = document.getElementById('dropBtn');
const pauseBtn = document.getElementById('pauseV4');
const resetBtn = document.getElementById('resetV4');

const sim = window.__sim;
const ui = window.__ui;
const cam = window.__cam;
if (!sim || !ui || !cam) throw new Error('Fluid V4 bridge: upstream PBF core did not initialize.');

// Keep the camera pulled back enough to read the entire pool on a phone.
cam.az = -0.72;
cam.el = 0.56;
cam.dist = 2.85;
cam.target = [0.75, 0.40, 0.50];

let mode = 'water';
let activePointer = null;
let rotating = false;
let draggingBall = false;
let dragDistance = 0;
let dragOffset = [0,0,0];
let dragTarget = null;
let lastX = 0, lastY = 0;
let lastRay = null;
let dropUntil = 0;
let dropWasActive = false;

const rayAt = (x,y) => {
  const r = canvas.getBoundingClientRect();
  return window.__screenRay((x-r.left)/Math.max(1,r.width),(y-r.top)/Math.max(1,r.height),r.width/Math.max(1,r.height));
};
const add = (a,b) => [a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const mul = (a,s) => [a[0]*s,a[1]*s,a[2]*s];
const sub = (a,b) => [a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const dot = (a,b) => a[0]*b[0]+a[1]*b[1]+a[2]*b[2];

function hitSphere(ray){
  const body=sim.bodies?.[0], pose=sim.bodyPose?.[0];
  if(!body||!pose)return null;
  const c=pose.centre, radius=body.size*1.18;
  const oc=sub(ray.origin,c), b=dot(oc,ray.dir), cc=dot(oc,oc)-radius*radius;
  const d=b*b-cc;if(d<0)return null;
  const s=Math.sqrt(d), t=(-b-s)>0?(-b-s):(-b+s);
  if(t<=0)return null;
  return {t,hit:add(ray.origin,mul(ray.dir,t)),centre:[...c],radius};
}
function clampBallTarget(p,r){
  const b=sim.params.box;
  return [Math.min(b[0]-r,Math.max(r,p[0])),Math.min(b[1]-r,Math.max(r,p[1])),Math.min(b[2]-r,Math.max(r,p[2]))];
}
function setMode(next){
  mode=next;
  if(mode==='water'){
    modeBtn.textContent='MODE: WATER';modeBtn.classList.add('active');
    modeEl.textContent='WATER MODE';hintEl.textContent='Water mode: tap the surface for a ripple, or drag through it to stir the water.';
    if(draggingBall){draggingBall=false;sim.releaseBody();}
  }else{
    modeBtn.textContent='MODE: BALL';modeBtn.classList.remove('active');
    modeEl.textContent='BALL MODE';hintEl.textContent='Ball mode: touch the sphere, drag it, then release slowly to drop or quickly to throw.';
  }
}
modeBtn.onclick=()=>setMode(mode==='water'?'ball':'water');

function waterTap(ray, strength=2.8){
  // Ray-tube impulse into actual PBF particles: surface displacement naturally rebounds into ripples.
  const imp=mul(ray.dir,strength);
  sim.applyRayImpulse(ray.origin,ray.dir,imp,ui.forceRadius||0.14,Math.max(ui.forceLimit||6,4));
}
function waterDrag(a,b,dx,dy){
  const gain=48;
  const imp=[(b.dir[0]-a.dir[0])*gain,b.dir[1]*0.38+(dy>0?-0.35:0),(b.dir[2]-a.dir[2])*gain];
  sim.applyRayImpulse(b.origin,b.dir,imp,(ui.forceRadius||0.14)*1.15,Math.max(ui.forceLimit||6,5));
}

canvas.onpointerdown=e=>{
  if(e.button!==0)return;
  e.preventDefault();
  activePointer=e.pointerId;lastX=e.clientX;lastY=e.clientY;lastRay=rayAt(lastX,lastY);
  try{canvas.setPointerCapture(e.pointerId)}catch{}
  if(mode==='water'){
    waterTap(lastRay,2.65);
    return;
  }
  const hit=hitSphere(lastRay);
  if(hit){
    draggingBall=true;rotating=false;dragDistance=hit.t;dragOffset=sub(hit.hit,hit.centre);
    dragTarget=hit.centre;
  }else{
    // Empty-space drag in BALL mode remains a camera orbit gesture.
    rotating=true;
  }
};
canvas.onpointermove=e=>{
  if(activePointer!==e.pointerId)return;
  e.preventDefault();
  const dx=e.clientX-lastX,dy=e.clientY-lastY;
  const ray=rayAt(e.clientX,e.clientY);
  if(mode==='water'){
    if(lastRay&&(Math.abs(dx)+Math.abs(dy)>0.5))waterDrag(lastRay,ray,dx,dy);
  }else if(draggingBall){
    const body=sim.bodies?.[0];
    const raw=sub(add(ray.origin,mul(ray.dir,dragDistance)),dragOffset);
    dragTarget=clampBallTarget(raw,(body?.size||0.13)*1.05);
  }else if(rotating){
    cam.orbit(-dx*0.006,dy*0.006);
  }
  lastX=e.clientX;lastY=e.clientY;lastRay=ray;
};
function endPointer(e){
  if(activePointer!==e.pointerId)return;
  e.preventDefault();
  if(draggingBall){draggingBall=false;dragTarget=null;sim.releaseBody();}
  rotating=false;activePointer=null;lastRay=null;
  try{canvas.releasePointerCapture(e.pointerId)}catch{}
}
canvas.onpointerup=endPointer;canvas.onpointercancel=endPointer;
canvas.onwheel=e=>{e.preventDefault();cam.zoom(e.deltaY>0?1.08:0.92)};

// The upstream animation loop calls this hook each frame. While held, body velocity follows
// the pointer target; release therefore retains momentum and produces a real throw.
ui.holdFrame=()=>{
  const now=performance.now();
  if(dropUntil>now){
    const b=sim.params.box, body=sim.bodies?.[0];
    const r=(body?.size||0.13)*1.05;
    sim.holdBody(1,clampBallTarget([b[0]*0.5,b[1]*0.88,b[2]*0.5],r),28,8);
    dropWasActive=true;return;
  }
  if(dropWasActive){dropWasActive=false;sim.releaseBody();}
  if(draggingBall&&dragTarget&&!ui.paused)sim.holdBody(1,dragTarget,24,8);
};

dropBtn.onclick=()=>{
  setMode('ball');
  dropUntil=performance.now()+360;
  dropWasActive=false;
};
pauseBtn.onclick=()=>{
  document.getElementById('pause').click();
  requestAnimationFrame(()=>{pauseBtn.textContent=ui.paused?'RESUME':'PAUSE'});
};
resetBtn.onclick=()=>{
  draggingBall=false;dragTarget=null;dropUntil=0;sim.releaseBody();
  document.getElementById('reset').click();
  cam.az=-0.72;cam.el=0.56;cam.dist=2.85;cam.target=[0.75,0.40,0.50];
};

setMode('water');

function hudLoop(){
  const text=document.getElementById('stats').textContent||'';
  const m=text.match(/([0-9.]+)\s+fps/i);
  if(m)fpsEl.textContent=Math.round(Number(m[1]))+' FPS';
  const fluid=sim.scene?.nFluid||sim.n||0;
  const scale=window.__ssfr?.renderScale;
  statsEl.textContent=`${fluid.toLocaleString()} particles · ${scale?Math.round(scale*100)+'% surface':'PBF'}`;
  pauseBtn.textContent=ui.paused?'RESUME':'PAUSE';
  requestAnimationFrame(hudLoop);
}
requestAnimationFrame(hudLoop);
