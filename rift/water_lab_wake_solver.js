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
    accumulator=0;
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
  function sample(x,z){
    const fx=(x-centerX)/cell+segments*.5;
    const fz=(z-centerZ)/cell+segments*.5;
    if(fx<1||fz<1||fx>=segments-1||fz>=segments-1)return 0;
    const ix=Math.floor(fx),iz=Math.floor(fz),tx=fx-ix,tz=fz-iz;
    const a=height[at(ix,iz)],b=height[at(ix+1,iz)];
    const c=height[at(ix,iz+1)],d=height[at(ix+1,iz+1)];
    return (a+(b-a)*tx)*(1-tz)+(c+(d-c)*tx)*tz;
  }
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
  function advance(dt,{x,z,heading,speed:boatSpeed,bob=0,amount=1}){
    recenter(x,z);
    const movement=Math.min(1,Math.max(0,boatSpeed)/5)*Math.max(0,amount);
    if(movement>.015&&dt>0){
      const dx=-Math.sin(heading),dz=-Math.cos(heading);
      const sx=-dz,sz=dx;
      // A displaced hull produces a pressure rise near the bow and a
      // trailing low-pressure hollow. Off-axis lobes generate diverging waves.
      // Source velocity has units of m/s. The previous 12*dt source
      // generated centimetre-scale waves that were invisible from the
      // chase camera. Stronger, narrower displacement and bilateral
      // sources create measurable wake crests without painted lines.
      pressure(x+dx*2.2,z+dz*2.2,145*movement*dt,1.18);
      pressure(x-dx*1.2,z-dz*1.2,-165*movement*dt,1.45);
      pressure(x-dx*2.0+sx*1.1,z-dz*2.0+sz*1.1,104*movement*dt,.95);
      pressure(x-dx*2.0-sx*1.1,z-dz*2.0-sz*1.1,104*movement*dt,.95);
    }
    // A bobbing hull moves water even when no forward wake exists.
    // Apply an opposing displacement at each side of the hull to drive
    // compact concentric ripples without synthetic line geometry.
    if(Math.abs(bob)>.018&&dt>0&&amount>0){
      const pulse=Math.max(-1,Math.min(1,bob))*18*dt*Math.min(amount,2);
      const sx=-Math.cos(heading),sz=Math.sin(heading);
      pressure(x+sx*.8,z+sz*.8,pulse,1.05);
      pressure(x-sx*.8,z-sz*.8,pulse,1.05);
    }
    accumulator=Math.min(.10,accumulator+Math.max(0,dt));
    let steps=0;
    while(accumulator>=stepTime&&steps<4){step(stepTime);accumulator-=stepTime;steps++;}
    if(steps>=4)accumulator=Math.min(accumulator,stepTime);
  }
  return {sample,advance,recenter,clear,get resolution(){return n;},get cellSize(){return cell;},
    get center(){return {x:centerX,z:centerZ};}};
}
