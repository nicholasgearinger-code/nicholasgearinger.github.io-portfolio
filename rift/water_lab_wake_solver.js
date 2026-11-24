// Local water displacement solver for the independent sailing laboratory.
// A damped 2D shallow-water wave equation provides a height perturbation
// atop the ocean's directional deep-water waves. Hull forces inject pressure
// at bow and stern. It is a free-surface approximation, not full 3D CFD.
export function createWakeSolver({segments=112,size=110}={}){
  const n=segments+1, length=n*n, cell=size/segments;
  let height=new Float32Array(length),velocity=new Float32Array(length);
  let nextHeight=new Float32Array(length),nextVelocity=new Float32Array(length);
  let centerX=-3.2,centerZ=-13,accumulator=0;
  const speed=7.5,damping=.34,stepTime=1/60,cell2=cell*cell;
  const at=(x,z)=>z*n+x;
  function clear(){
    height.fill(0);velocity.fill(0);nextHeight.fill(0);nextVelocity.fill(0);
    accumulator=0;previousSpeed=0;previousBob=0;initialized=false;
  }
  function recenter(x,z){
    const sx=Math.trunc((x-centerX)/(cell*4))*4;
    const sz=Math.trunc((z-centerZ)/(cell*4))*4;
    if(!sx&&!sz)return;
    const hx=new Float32Array(length),hv=new Float32Array(length);
    if(Math.abs(sx)<n-3&&Math.abs(sz)<n-3){
      for(let z=0;z<n;z++)for(let x=0;x<n;x++){
        const ox=x+sx,oz=z+sz;
        if(ox<0||oz<0||ox>=n||oz>=n)continue;
        hx[at(x,z)]=height[at(ox,oz)];
        hv[at(x,z)]=velocity[at(ox,oz)];
      }
    }
    height=hx;velocity=hv;nextHeight=new Float32Array(length);nextVelocity=new Float32Array(length);
    centerX+=sx*cell;centerZ+=sz*cell;
  }
  function interpolate(field,x,z){
    const fx=(x-centerX)/cell+segments*.5;
    const fz=(z-centerZ)/cell+segments*.5;
    if(!Number.isFinite(fx)||!Number.isFinite(fz)||fx<1||fz<1||
       fx>=segments-1||fz>=segments-1)return 0;
    const ix=Math.floor(fx),iz=Math.floor(fz),tx=fx-ix,tz=fz-iz;
    const a=field[at(ix,iz)],b=field[at(ix+1,iz)];
    const c=field[at(ix,iz+1)],d=field[at(ix+1,iz+1)];
    const result=(a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz;
    return Number.isFinite(result)?result:0;
  }
  function sample(x,z){return interpolate(height,x,z);}
  function sampleVelocity(x,z){return interpolate(velocity,x,z);}
  function pressure(x,z,magnitude,radius=1.8){
    const gx=(x-centerX)/cell+segments*.5,gz=(z-centerZ)/cell+segments*.5;
    const span=Math.ceil(radius*2/cell);
    const ix=Math.round(gx),iz=Math.round(gz);
    const sigma=Math.max(radius*.65,cell*.65),denom=1/(2*sigma*sigma);
    for(let dz=-span;dz<=span;dz++)for(let dx=-span;dx<=span;dx++){
      const px=ix+dx,pz=iz+dz;
      if(px<3||pz<3||px>=segments-2||pz>=segments-2)continue;
      const rx=(px-gx)*cell,rz=(pz-gz)*cell;
      const d2=rx*rx+rz*rz;
      if(d2>radius*radius*4)continue;
      velocity[at(px,pz)]+=magnitude*Math.exp(-d2*denom);
    }
  }
  function step(dt){
    const coeff=speed*speed*dt/cell2,friction=Math.exp(-damping*dt);
    for(let z=1;z<segments;z++){
      const rim=Math.min(z,segments-z)/(segments*.15);
      for(let x=1;x<segments;x++){
        const i=at(x,z),v=velocity[i],h=height[i];
        const lap=height[i-1]+height[i+1]+height[i-n]+height[i+n]-4*h;
        // Absorbing edge suppresses reflections off the local solver border.
        const edge=Math.min(rim,Math.min(x,segments-x)/(segments*.15));
        const absorb=Math.min(1,Math.max(.76,edge));
        nextVelocity[i]=(v+coeff*lap)*friction*absorb;
        nextHeight[i]=Math.max(-1.25,Math.min(1.25,h+nextVelocity[i]*dt));
      }
    }
    [height,nextHeight]=[nextHeight,height];
    [velocity,nextVelocity]=[nextVelocity,velocity];
    // Edge cells remain zero (Dirichlet boundary).
  }
  // 24.0: incremental hull forcing. The pressure sources are a simplified
  // shallow-water response to moving displaced volume—not full Navier-Stokes.
  // Fixed timestep CFL is kept below 1/sqrt(2); a speed-dependent forcing
  // ramp prevents stationary hull bobbing from repeatedly pumping the grid.
  let previousSpeed=0,previousHeading=0,previousBob=0,initialized=false;
  function advance(dt,{x,z,heading,speed:boatSpeed,bob=0,turnRate=0,amount=1}){
    if(!Number.isFinite(x)||!Number.isFinite(z)||!Number.isFinite(dt)||dt<=0)return;
    recenter(x,z);
    const s=Math.max(0,Math.min(15,Number.isFinite(boatSpeed)?boatSpeed:0));
    const turn=Math.max(-1.5,Math.min(1.5,Number.isFinite(turnRate)?turnRate:0));
    const strength=Math.max(0,Math.min(2,amount));
    const accel=initialized?Math.max(-7,Math.min(7,(s-previousSpeed)/Math.max(dt,.008))):0;
    const heave=initialized?Math.max(-2,Math.min(2,(bob-previousBob)/Math.max(dt,.008))):0;
    previousSpeed=s;previousHeading=heading;previousBob=bob;initialized=true;
    const forwardX=-Math.sin(heading),forwardZ=-Math.cos(heading);
    const sideX=-forwardZ,sideZ=forwardX;
    const flow=Math.min(1.35,s/7.5);
    const energy=Math.min(1,cell/.62)*strength;
    if(flow>.012&&energy>.001){
      // Smooth Froude-like speed scaling and extra hull pressure under
      // acceleration. The source respects frame dt and grid cell size.
      const force=energy*flow*dt*(.82+.18*Math.min(2,Math.abs(accel)/3));
      pressure(x+forwardX*2.15,z+forwardZ*2.15,79*force,1.18);
      pressure(x-forwardX*1.30,z-forwardZ*1.30,-73*force,1.38);
      const spread=1.00+.28*flow;
      for(const side of [-1,1]){
        const shear=Math.max(.48,Math.min(1.65,1+side*turn*.52));
        const offset=side*spread;
        pressure(x-forwardX*2.1+sideX*offset,
          z-forwardZ*2.1+sideZ*offset,53*force*shear,.92);
        pressure(x-forwardX*3.75+sideX*offset*1.40,
          z-forwardZ*3.75+sideZ*offset*1.40,25*force*shear,1.18);
      }
      if(Math.abs(turn)>.025){
        const lateral=30*energy*flow*dt*turn;
        pressure(x+sideX*.95,z+sideZ*.95,lateral,1.05);
        pressure(x-sideX*.95,z-sideZ*.95,-lateral,1.05);
      }
      if(Math.abs(accel)>.15){
        // Starting/stopping produces a short stern/fore displacement, not
        // a persistent stationary ring of equally strong wave pulses.
        const impulse=4.2*energy*dt*accel;
        pressure(x-forwardX*1.4,z-forwardZ*1.4,impulse,1.3);
      }
    }
    if(strength>.001&&Math.abs(bob)>.018){
      const heaveForce=Math.max(-1.4,Math.min(1.4,bob))*strength*
        (1.6+2.6*flow)*dt;
      // Only heave a small amount of local water at rest.
      const impulse=heaveForce+.35*heave*dt*strength;
      pressure(x+sideX*.72,z+sideZ*.72,impulse,1.0);
      pressure(x-sideX*.72,z-sideZ*.72,impulse,1.0);
    }
    accumulator=Math.min(.10,accumulator+Math.min(.05,dt));
    let steps=0;
    while(accumulator>=stepTime&&steps<4){
      step(stepTime);accumulator-=stepTime;steps++;
    }
    if(steps>=4)accumulator=Math.min(accumulator,stepTime);
  }
  return {sample,sampleVelocity,advance,recenter,clear,get resolution(){return n;},get cellSize(){return cell;},
    get center(){return {x:centerX,z:centerZ};}};
}
