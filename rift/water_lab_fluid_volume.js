// Water Lab 14.2: localized, genuine 3D position-based particle fluid.
// CPU spatial hash + pair density/pressure constraints + viscosity and gravity.
// Surface rendering is point-sprite visualization; no claim of voxel/mesh CFD.
export function createLocalFluidVolume(THREE,scene,{mobile=false}={}) {
  const count=mobile?256:512, radius=.24, spacing=.38;
  const bounds={width:8.5,depth:8.5,bottom:-2.65,top:3.2};
  const positions=new Float32Array(count*3);
  const prev=new Float32Array(count*3);
  const velocity=new Float32Array(count*3);
  const predicted=new Float32Array(count*3);
  const correction=new Float32Array(count*3);
  const density=new Float32Array(count);
  const sourceAge=new Float32Array(count);
  const particleIDs=new Float32Array(count);
  const hash=new Map();
  let active=0,carry=0,lastT=null,originX=0,originZ=0,spawnClock=0,frame=0;
  const range=radius*2.4,range2=range*range,restDensity=4.2;
  let enabled=false;
  const key=(x,y,z)=>x+','+y+','+z;
  const seed=(i)=>{let x=Math.sin(i*127.17+9.83)*43758.5453;return x-Math.floor(x);};
  function spawn(p,seedIndex,force=1){
    const i=active%count,k=i*3;
    const cross=(seed(seedIndex*7+1)-.5)*4.2;
    const depth=(seed(seedIndex*7+2)-.5)*2.3;
    p[k]=cross*.92;
    p[k+1]=.22+seed(seedIndex*7+3)*.72;
    p[k+2]=depth-1.5;
    predicted[k]=p[k];predicted[k+1]=p[k+1];predicted[k+2]=p[k+2];
    prev[k]=p[k];prev[k+1]=p[k+1];prev[k+2]=p[k+2];
    velocity[k]=.3+(seed(seedIndex*7+4)-.5)*.4;
    velocity[k+1]=1.3+seed(seedIndex*7+5)*1.35*force;
    velocity[k+2]=.75+(seed(seedIndex*7+6)-.5)*.45;
    sourceAge[i]=0;
    if(active<count)active++;
    return i;
  }
  // Start with a small real fluid volume so the demo is immediately visible.
  for(let i=0;i<count*.5;i++)spawn(positions,i,1);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('aIndex',new THREE.BufferAttribute(particleIDs,1));
  geometry.setDrawRange(0,active);
  const material=new THREE.ShaderMaterial({
    transparent:true,depthWrite:false,depthTest:true,
    uniforms:{uPointSize:{value:mobile?8:10},uOpacity:{value:.78}},
    vertexShader:`precision highp float;
      uniform float uPointSize;
      void main(){
       vec4 view=modelViewMatrix*vec4(position,1.);
       gl_Position=projectionMatrix*view;
       gl_PointSize=clamp(uPointSize*13./max(1.,-view.z),1.5,15.);
      }`,
    fragmentShader:`precision highp float;
      uniform float uOpacity;
      void main(){
       vec2 n=gl_PointCoord*2.-1.;
       float r2=dot(n,n);
       if(r2>1.)discard;
       float shade=sqrt(max(0.,1.-r2));
       vec3 normal=normalize(vec3(n,shade));
       vec3 light=normalize(vec3(-.37,.8,.44));
       float diffuse=max(dot(normal,light),0.);
       float glint=pow(max(dot(reflect(-light,normal),vec3(0.,0.,1.)),0.),22.);
       vec3 col=mix(vec3(.018,.22,.30),vec3(.18,.69,.72),.35+.65*diffuse);
       col+=vec3(.62,.86,.81)*glint*.65;
       float alpha=uOpacity*(.25+.72*shade)*smoothstep(1.,.73,r2);
       gl_FragColor=vec4(col,alpha);
      }`
  });
  const mesh=new THREE.Points(geometry,material);
  mesh.frustumCulled=false;
  mesh.renderOrder=5;
  scene.add(mesh);
  const neighbors=[];
  function buildHash(){
    hash.clear();
    for(let i=0;i<active;i++){
      const k=i*3;
      const name=key(Math.floor(predicted[k]/range),Math.floor(predicted[k+1]/range),
                     Math.floor(predicted[k+2]/range));
      let cell=hash.get(name);
      if(!cell){cell=[];hash.set(name,cell);}
      cell.push(i);
    }
  }
  function adjacent(i,out){
    out.length=0;
    const k=i*3,x=Math.floor(predicted[k]/range),y=Math.floor(predicted[k+1]/range),
      z=Math.floor(predicted[k+2]/range);
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++){
      const list=hash.get(key(x+a,y+b,z+c));
      if(!list)continue;
      for(let t=0;t<list.length;t++){const j=list[t];if(j!==i)out.push(j);}
    }
  }
  function constrain(i,point){
    const k=i*3,x=point[k],y=point[k+1],z=point[k+2],eps=.12;
    point[k]=Math.max(-bounds.width*.5,Math.min(bounds.width*.5,x));
    point[k+1]=Math.max(bounds.bottom,Math.min(bounds.top,y));
    point[k+2]=Math.max(-bounds.depth*.5,Math.min(bounds.depth*.5,z));
    // A smooth submerged bed is a solid collision surface.
    const bed=bounds.bottom+.18*Math.sin(point[k]*.7)+.12*Math.cos(point[k+2]*.6);
    if(point[k+1]<bed+eps)point[k+1]=bed+eps;
  }
  function simulate(dt,pressure,viscosity){
    for(let i=0;i<active;i++){
      const k=i*3;prev[k]=positions[k];prev[k+1]=positions[k+1];prev[k+2]=positions[k+2];
      // Incompressible liquid particles experience real 3D gravity.
      velocity[k+1]-=9.81*dt;
      const decay=Math.max(0,1-.16*dt);
      for(let d=0;d<3;d++){
        velocity[k+d]*=decay;
        predicted[k+d]=positions[k+d]+velocity[k+d]*dt;
      }
      constrain(i,predicted);
      sourceAge[i]+=dt;
    }
    // Position-based fluid iterations: local density and collision forces.
    for(let iter=0;iter<3;iter++){
      buildHash();correction.fill(0);
      for(let i=0;i<active;i++){
        const k=i*3;adjacent(i,neighbors);
        let local=0;
        for(let v=0;v<neighbors.length;v++){
          const j=neighbors[v],q=j*3,
          dx=predicted[k]-predicted[q],
          dy=predicted[k+1]-predicted[q+1],
          dz=predicted[k+2]-predicted[q+2];
          const d2=dx*dx+dy*dy+dz*dz;
          if(d2>=range2||d2<1e-10)continue;
          const len=Math.sqrt(d2),w=Math.max(0,1-len/range);
          local+=w*w*w;
          // Paired pressure repulsion, conserving local impulse direction.
          const overlap=Math.max(0,spacing-len);
          const strength=(overlap*.41+pressure*w*w*.024)/len;
          correction[k]+=dx*strength;
          correction[k+1]+=dy*strength;
          correction[k+2]+=dz*strength;
        }
        density[i]=local;
      }
      for(let i=0;i<active;i++){
        const k=i*3;
        // Clamp one iteration to prevent explosive high-density clumps.
        const mag=Math.hypot(correction[k],correction[k+1],correction[k+2]);
        const scale=mag>.16?.16/mag:1;
        predicted[k]+=correction[k]*scale;
        predicted[k+1]+=correction[k+1]*scale;
        predicted[k+2]+=correction[k+2]*scale;
        constrain(i,predicted);
      }
    }
    buildHash();
    const velNext=new Float32Array(active*3);
    for(let i=0;i<active;i++){
      const k=i*3;adjacent(i,neighbors);
      let avgX=0,avgY=0,avgZ=0,weight=0;
      for(let v=0;v<neighbors.length;v++){
        const j=neighbors[v],q=j*3,dx=predicted[k]-predicted[q],
        dy=predicted[k+1]-predicted[q+1],dz=predicted[k+2]-predicted[q+2];
        const d2=dx*dx+dy*dy+dz*dz;
        if(d2>range2)continue;
        const w=Math.pow(Math.max(0,1-Math.sqrt(d2)/range),2);
        weight+=w;avgX+=velocity[q]*w;avgY+=velocity[q+1]*w;avgZ+=velocity[q+2]*w;
      }
      const inv=1/Math.max(weight,.0001),blend=Math.min(.35,viscosity*.12);
      velNext[k]=((predicted[k]-prev[k])/dt)*(1-blend)+avgX*inv*blend;
      velNext[k+1]=((predicted[k+1]-prev[k+1])/dt)*(1-blend)+avgY*inv*blend;
      velNext[k+2]=((predicted[k+2]-prev[k+2])/dt)*(1-blend)+avgZ*inv*blend;
    }
    for(let i=0;i<active;i++)for(let d=0;d<3;d++){
      const k=i*3+d;
      positions[k]=predicted[k];
      velocity[k]=Math.max(-9,Math.min(9,velNext[k]));
    }
    geometry.attributes.position.needsUpdate=true;
  }
  function update(t,camera,params,mode){
    const on=mode==='spectral'&&params.fluidVolume>0.01&&params.breakingWaves>.001;
    mesh.visible=on;enabled=on;
    if(!on){lastT=t;return;}
    const dt=lastT===null?1/60:Math.min(.055,Math.max(0,t-lastT));
    lastT=t;
    const camX=camera.position.x,camZ=camera.position.z;
    // The local simulation domain follows the camera in discrete steps.
    // Recenter without teleporting the internal 3D particle trajectories.
    const nextX=Math.round(camX/16)*16,nextZ=Math.round((camZ-10)/16)*16;
    if(Math.abs(nextX-originX)>8||Math.abs(nextZ-originZ)>8){
      const deltaX=originX-nextX,deltaZ=originZ-nextZ;
      for(let i=0;i<active;i++){positions[3*i]+=deltaX;positions[3*i+2]+=deltaZ;}
      originX=nextX;originZ=nextZ;
    }
    mesh.position.set(originX,0,originZ);
    carry+=dt;
    let steps=0;
    while(carry>=1/30&&steps<2){
      const step=1/30;
      spawnClock+=step*params.fluidVolume*8;
      while(spawnClock>=1&&active<count){
        spawn(positions,frame++,params.breakingWaves);
        spawnClock-=1;
      }
      simulate(step,Math.max(.2,params.fluidPressure),params.fluidViscosity);
      carry-=step;steps++;
    }
    if(steps===2)carry=Math.min(carry,1/30);
    geometry.setDrawRange(0,active);
  }
  return {mesh,update,dispose(){scene.remove(mesh);geometry.dispose();material.dispose();}};
}
