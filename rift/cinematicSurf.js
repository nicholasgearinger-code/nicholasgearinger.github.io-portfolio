// Cinematic rolling surf for Coral Shallows.
// Reference: irregular turquoise rolling wave -> turbulent white crest ->
// broad lace-like shoreward foam. The previous PBF surface looked like a
// floating blob and the old opaque ribbons looked like horizontal strips.
//
// Animation is intentional: FFT and shallow-water physics still run beneath
// it for buoyancy, water interaction, swash, and foam energy. This renderer
// spends its mobile budget on a continuous silhouette and believable foam,
// NOT on a costly volumetric particle surface.
//
// Two dynamic meshes, two draw calls, one small generated tileable texture;
// no compute dispatch, offscreen render, GPU readback, or shader derivatives.
// ?riftSurfVisual=legacy restores the old rolling/PBF experiment.
import * as THREE from "three";
import { attribute, texture, uniform, vec2, color, mix, clamp, float } from "three/tsl";
import { emitRiftWaterImpact } from "./waterLabInteractions.js";

const MOBILE = typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "") ||
    (navigator.maxTouchPoints || 0) > 0);
const COLS = MOBILE ? 40 : 64;
const FACE_ROWS = MOBILE ? 15 : 21;
const FOAM_ROWS = MOBILE ? 13 : 19;
const WAVES = [
  { far: 49, near: 14, period: 10.7, phase: 0.07, height: 2.5, width: 4.5 },
  { far: 71, near: 26, period: 12.8, phase: 0.41, height: 3.6, width: 6.5 },
  { far: 93, near: 41, period: 15.0, phase: 0.78, height: 3.9, width: 7.6 },
];
const clamp01 = x => Math.max(0, Math.min(1, x));
const lerp = (a,b,t)=>a+(b-a)*t;
const fract = x=>x-Math.floor(x);
const smooth=(a,b,x)=>{const t=clamp01((x-a)/(b-a));return t*t*(3-2*t);};
const h=(x,y,seed=0)=>fract(Math.sin(x*127.1+y*311.7+seed*81.7)*43758.5453);
function tileNoise(u,v,f,seed=0){
  const x=u*f,y=v*f,ix=Math.floor(x),iy=Math.floor(y);
  const tx=x-ix,ty=y-iy,ax=tx*tx*(3-2*tx),ay=ty*ty*(3-2*ty);
  const wrap=n=>(n%f+f)%f;
  const a=lerp(h(wrap(ix),wrap(iy),seed),h(wrap(ix+1),wrap(iy),seed),ax);
  const b=lerp(h(wrap(ix),wrap(iy+1),seed),h(wrap(ix+1),wrap(iy+1),seed),ax);
  return lerp(a,b,ay);
}
function foamTexture(){
  // Baked once at startup: domain-warped foam threads and irregular
  // whitewater islands. One GPU texture sample per mesh pixel.
  const size=MOBILE?160:256;
  const bytes=new Uint8Array(size*size*4);
  for(let y=0;y<size;y++){
    const v=y/size;
    for(let x=0;x<size;x++){
      const u=x/size;
      const wx=tileNoise(u,v,4,1)-0.5;
      const wy=tileNoise(u,v,4,2)-0.5;
      const uu=u+wx*0.075,vv=v+wy*0.075;
      const macro=tileNoise(uu,vv,5,3)*0.5+
        tileNoise(uu,vv,10,5)*0.32+
        tileNoise(uu,vv,20,9)*0.18;
      const curling=tileNoise(uu,vv,13,11);
      const micro=tileNoise(uu,vv,30,4);
      // Thin white filaments, branching gaps, broad broken patches.
      const filaments=1-smooth(0.045,0.23,Math.abs(curling-0.52));
      const islands=smooth(.37,.66,macro);
      const lace=smooth(.34,.65,macro+filaments*.30+micro*.09);
      const voids=1-smooth(.64,.81,tileNoise(uu,vv,7,8));
      const opacity=clamp01((islands*.51+filaments*.47+lace*.31)
        *voids - .15);
      const idx=(y*size+x)*4;
      bytes[idx]=230+Math.round(opacity*24);
      bytes[idx+1]=239+Math.round(opacity*15);
      bytes[idx+2]=234+Math.round(opacity*18);
      bytes[idx+3]=Math.round(opacity*255);
    }
  }
  const tex=new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat);
  tex.wrapS=THREE.RepeatWrapping;
  tex.wrapT=THREE.RepeatWrapping;
  tex.magFilter=THREE.LinearFilter;
  tex.minFilter=THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps=true;
  tex.needsUpdate=true;
  return tex;
}

function makeGrid(rows, twoParts=false){
  const parts=twoParts?2:1;
  const count=WAVES.length*parts*(COLS+1)*(rows+1);
  const position=new Float32Array(count*3);
  const vertexColor=new Float32Array(count*3);
  const alpha=new Float32Array(count);
  const foamLevel=new Float32Array(count);
  const uv=new Float32Array(count*2);
  const indices=[];
  let offset=0;
  for(let w=0;w<WAVES.length;w++)for(let part=0;part<parts;part++){
    const base=offset;
    for(let i=0;i<=COLS;i++)for(let j=0;j<=rows;j++){
      const vertex=base+i*(rows+1)+j;
      uv[vertex*2]=i/COLS*5.1+w*.29;
      uv[vertex*2+1]=j/rows*2.4+part*.29;
      if(i<COLS&&j<rows){
        const a=vertex,b=a+rows+1;
        indices.push(a,b,a+1,a+1,b,b+1);
      }
    }
    offset+=(COLS+1)*(rows+1);
  }
  const geometry=new THREE.BufferGeometry();
  const props=[
    ["position",position,3],["color",vertexColor,3],
    ["riftOpacity",alpha,1],["riftFoam",foamLevel,1],
    ["riftSurfUV",uv,2],
  ];
  for(const [name,buffer,size] of props)
    geometry.setAttribute(name,new THREE.BufferAttribute(buffer,size)
      .setUsage(name==="riftSurfUV"?THREE.StaticDrawUsage:THREE.DynamicDrawUsage));
  geometry.setIndex(indices);
  return {geometry,position,vertexColor,alpha,foamLevel,uv,rows,parts,
    vertexCount:count};
}
function setPoint(grid,w,part,i,j,x,y,z,r,g,b,opacity,foam=0){
  const index=(((w*grid.parts+part)*(COLS+1)+i)*(grid.rows+1)+j);
  const k=index*3;
  grid.position[k]=x;grid.position[k+1]=y;grid.position[k+2]=z;
  grid.vertexColor[k]=r;grid.vertexColor[k+1]=g;grid.vertexColor[k+2]=b;
  grid.alpha[index]=clamp01(opacity);
  grid.foamLevel[index]=clamp01(foam);
}
function pushGPU(grid,withNormals=false){
  grid.geometry.attributes.position.needsUpdate=true;
  grid.geometry.attributes.color.needsUpdate=true;
  grid.geometry.attributes.riftOpacity.needsUpdate=true;
  grid.geometry.attributes.riftFoam.needsUpdate=true;
  if(withNormals)grid.geometry.computeVertexNormals();
}

export function createCinematicSurfZone(scene,ocean,groundHeight){
  const samples=ocean?.fftSurfSystem?.__riftShoreFoamLayers?.samples;
  if(!scene||!ocean?.gpuFFT||!Array.isArray(samples)||samples.length<12)
    return null;
  const foamMap=foamTexture();
  const face=makeGrid(FACE_ROWS);
  const whitewater=makeGrid(FOAM_ROWS,true);
  const motion=uniform(0);
  const driftUV=attribute("riftSurfUV","vec2");
  const refUV=vec2(driftUV.x.add(motion.mul(.023)),
    driftUV.y.sub(motion.mul(.072)));
  const cellular=texture(foamMap,refUV);
  const faceMaterial=new THREE.MeshStandardNodeMaterial({
    color:0xffffff,roughness:.13,metalness:.035,
    transparent:true,opacity:1,side:THREE.DoubleSide,depthWrite:false,
  });
  faceMaterial.forceSinglePass=true;
  faceMaterial.colorNode=mix(
    attribute("color","vec3"),color(0xf3fcf6),
    clamp(cellular.a.mul(attribute("riftFoam","float")).mul(1.5),0,1));
  faceMaterial.opacityNode=attribute("riftOpacity","float");
  const foamMaterial=new THREE.MeshBasicNodeMaterial({
    color:0xffffff,transparent:true,opacity:1,
    side:THREE.DoubleSide,depthWrite:false,
  });
  foamMaterial.forceSinglePass=true;
  foamMaterial.colorNode=mix(color(0xb3e5df),color(0xffffff),
    clamp(cellular.a.mul(1.5),0,1));
  foamMaterial.opacityNode=clamp(
    attribute("riftOpacity","float").mul(cellular.a).mul(1.15),0,.96);

  const faceMesh=new THREE.Mesh(face.geometry,faceMaterial);
  const foamMesh=new THREE.Mesh(whitewater.geometry,foamMaterial);
  faceMesh.name="rift-cinematic-rolling-water";
  foamMesh.name="rift-cinematic-breaking-foam";
  faceMesh.frustumCulled=foamMesh.frustumCulled=false;
  faceMesh.renderOrder=11;
  foamMesh.renderOrder=13;
  scene.add(faceMesh,foamMesh);

  const sea=ocean.waterY??8;
  let centerIndex=0,previousCamera={x:Infinity,z:Infinity};
  let timeLast=0,frameAccum=0,lastImpacts=[-10,-10,-10],disposed=false;
  const depthCache=new Map();
  const sampleCount=samples.length;
  function groundAt(index,distance){
    if(typeof groundHeight!=="function")return sea-6;
    let line=depthCache.get(index);
    if(!line){line=new Float32Array(35).fill(NaN);depthCache.set(index,line);}
    const f=Math.max(0,Math.min(33.99,distance/3.1));
    const k=Math.floor(f),t=f-k;
    const p=samples[index],ox=p.outwardX||0,oz=p.outwardZ||0;
    if(!Number.isFinite(line[k]))
      line[k]=groundHeight(p.x+ox*k*3.1,p.z+oz*k*3.1);
    if(!Number.isFinite(line[k+1]))
      line[k+1]=groundHeight(p.x+ox*(k+1)*3.1,p.z+oz*(k+1)*3.1);
    return lerp(line[k],line[k+1],t);
  }
  function nearest(camera){
    if(!camera||!Number.isFinite(camera.x))return;
    const d=Math.hypot(camera.x-previousCamera.x,
      camera.z-previousCamera.z);
    if(d<9)return;
    let shortest=Infinity,next=0;
    for(let i=0;i<sampleCount;i++){
      const p=samples[i],dx=p.x-camera.x,dz=p.z-camera.z;
      const dd=dx*dx+dz*dz;
      if(dd<shortest){shortest=dd;next=i;}
    }
    centerIndex=next;
    previousCamera={x:camera.x,z:camera.z};
  }
  const sampleAt=i=>{const index=(centerIndex+i-Math.floor(COLS/2)+
    sampleCount*4)%sampleCount;return {p:samples[index],index};};
  function updateGeometry(t){
    motion.value=t;
    for(let w=0;w<WAVES.length;w++){
      const wave=WAVES[w];
      for(let i=0;i<=COLS;i++){
        const {p,index}=sampleAt(i);
        const norm=Math.hypot(p.outwardX,p.outwardZ)||1;
        const ox=p.outwardX/norm,oz=p.outwardZ/norm;
        const along=i/COLS;
        const taper=smooth(0,.10,along)*(1-smooth(.90,1,along));
        const stagger=(i-COLS*.5)*.0039+
          (p.liftRand||0)*.012;
        const phase=fract(t/wave.period+wave.phase+stagger);
        const travelled=smooth(0,1,phase);
        const distance=lerp(wave.far,wave.near,travelled);
        const depth=Math.max(0,sea-groundAt(index,distance));
        const shoal=clamp01((12-depth)/11);
        const rising=smooth(.04,.52,phase);
        const crash=1-smooth(.79,.98,phase);
        const height=wave.height*(.60+.56*shoal)*
          (.53+.47*rising)*crash;
        const curl=smooth(.35,.69,phase)*
          (1-smooth(.84,.99,phase));
        const broken=smooth(.48,.77,phase)*
          (1-smooth(.94,1,phase));
        const variation=1+.11*Math.sin(i*.52+w*1.7+t*.37)+
          .06*Math.sin(i*1.43-w*.83);
        const H=height*variation;
        const waveAlpha=taper*smooth(.015,.10,phase)*
          (1-smooth(.89,1,phase));
        for(let j=0;j<=FACE_ROWS;j++){
          const v=j/FACE_ROWS;
          const lip=smooth(.59,.98,v);
          const faceH=H*Math.sin(v*Math.PI*.5) -
            curl*H*smooth(.83,1,v)*.42;
          const curved=distance+(1-v)*(wave.width+H*.21)-
            curl*lip*lip*H*.85;
          const brokenEdge=0.11*Math.sin(i*1.83+j*.79+t*.9);
          const X=p.x+ox*(curved+brokenEdge*curl),
            Z=p.z+oz*(curved+brokenEdge*curl);
          const heightY=sea+0.035+faceH+
            .052*Math.sin(i*.83+v*9.0+t*1.1)*curl;
          const foamEdge=smooth(.66,.96,v)*broken+
            curl*smooth(.88,1,v)*.46;
          const alpha=waveAlpha*smooth(.02,.37,v)*
            (.82-.15*broken);
          const shade=clamp01(v*.64+shoal*.18);
          setPoint(face,w,0,i,j,X,heightY,Z,
            lerp(.026,.080,shade),
            lerp(.29,.60,shade),
            lerp(.39,.68,shade),
            alpha,Math.min(1,foamEdge*1.15));
        }
        // Part 0: crest foam follows and cascades down the physical curl.
        // The irregular texture masks individual tendrils; nothing floats
        // as an isolated whitewater particle blob.
        for(let j=0;j<=FOAM_ROWS;j++){
          const v=j/FOAM_ROWS;
          const lip=smooth(.76,.98,v);
          const crestX=distance-H*curl*(.52+.55*v);
          const capY=sea+.035+H*(.95-.50*v)-
            H*.10*curl*lip;
          const irregular=Math.sin(i*1.23+j*.42+t*2.1)*.12+
            Math.sin(i*.29+j*1.9-t*.7)*.09;
          setPoint(whitewater,w,0,i,j,
            p.x+ox*(crestX+irregular),
            capY+irregular*.35,
            p.z+oz*(crestX+irregular),
            .86,.96,.94,
            taper*broken*(.25+.70*smooth(.20,.65,v))*
              (1-smooth(.86,1,v))*.95,
            1);
        }
        // Part 1: wide shoreward-whitewater wash, curling filaments and
        // broken foam islands extending naturally toward the sand.
        const trail=(8+w*3.8)*(0.32+.68*broken);
        for(let j=0;j<=FOAM_ROWS;j++){
          const v=j/FOAM_ROWS;
          const radial=distance-v*trail;
          const stream=.33*Math.sin(i*.27+t*.63+v*2.7)+
            .15*Math.sin(i*1.12-v*8.5+t*.95);
          const shade=clamp01(broken*(1-.30*v));
          const nearshoreFoam=1-smooth(.76,1,v);
          const opacity=taper*shade*nearshoreFoam*
            (.78+.22*Math.sin(i*.78+v*8.3+t*.67));
          // Thin sheet follows the low nearshore swell and avoids the
          // previous rigid, straight, turquoise band against the shore.
          const y=sea+.11+H*.09*(1-v)+
            .07*Math.sin(i*.65+v*10+t*1.6);
          setPoint(whitewater,w,1,i,j,
            p.x+ox*(radial+stream),y,
            p.z+oz*(radial+stream),.91,.97,.94,
            opacity,.9);
        }
        if(i===Math.floor(COLS/2)&&broken>.72&&
            distance<39&&t-lastImpacts[w]>1.2){
          lastImpacts[w]=t;
          emitRiftWaterImpact(ocean,
            p.x+ox*(distance-2),p.z+oz*(distance-2),{
              strength:Math.min(1.6,.7+H*.20),
              radius:Math.min(4.9,2+H*.52),
              foam:.19,kind:"cinematic-surf-collapse",
            },t);
        }
      }
    }
    pushGPU(face,true);
    pushGPU(whitewater,false);
  }
  function update(dt,elapsed,camera,cameraY){
    if(disposed)return;
    const underwater=Number.isFinite(cameraY)&&cameraY<sea-.12;
    faceMesh.visible=foamMesh.visible=!underwater;
    if(underwater)return;
    nearest(camera);
    const time=Number.isFinite(elapsed)?elapsed:timeLast+
      Math.max(0,dt);
    if(time<timeLast){frameAccum=1;lastImpacts=[-10,-10,-10];}
    timeLast=time;
    // Keep the expensive CPU ribbon updates bounded when iPhone is at
    // 11–13fps. Shaders move foam texture continuously between updates.
    frameAccum+=Math.max(0,Math.min(.10,dt));
    const interval=MOBILE
      ? (dt>.063?1/9:1/13) : 1/24;
    motion.value=time;
    if(frameAccum>=interval){updateGeometry(time);frameAccum=0;}
  }
  function dispose(){
    if(disposed)return;
    disposed=true;
    scene.remove(faceMesh,foamMesh);
    const release=()=>{
      face.geometry.dispose();whitewater.geometry.dispose();
      faceMaterial.dispose();foamMaterial.dispose();
      foamMap.dispose();
    };
    if(typeof requestAnimationFrame==="function")
      requestAnimationFrame(()=>requestAnimationFrame(release));
    else release();
  }
  updateGeometry(0);
  return {update,dispose,bodyMesh:faceMesh,foamMesh,
    waveFaceVertices:face.vertexCount,foamVertices:whitewater.vertexCount,
    particlePool:{particles:[]},mode:"cinematic"};
}
