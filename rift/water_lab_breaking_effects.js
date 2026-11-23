// Water Lab showcase breakers: thin spectral crest sheets, spray and entrained bubbles.
// This is an inexpensive VISUAL approximation of wave breaking, not a full 3D CFD solver.
export function createBreakingEffects(THREE, scene, water, { mobile=false }={}) {
  const group=new THREE.Group();
  scene.add(group);
  const cell=512;
  const count=mobile?52:115;
  const along=9, across=4;
  const positions=[], patchIds=[];
  const wind=new THREE.Vector2(.94,.34).normalize();
  const cross=new THREE.Vector2(-wind.y,wind.x);
  const seed=(id,j=0)=>{const x=Math.sin(id*127.17+j*74.41)*43758.5453;return x-Math.floor(x);};
  // Each patch has a connected strip that folds forward, dips over its lip,
  // and disappears unless the FFT detects an energetic crest.
  for(let i=0;i<count;i++){
    const cx=(seed(i,1)-.5)*96,cz=(seed(i,2)-.5)*96;
    const span=2.2+seed(i,3)*3.7;
    const length=.7+seed(i,4)*1.0;
    const add=(x,y)=>{
      const acrossMeters=(x/(along-1)-.5)*span;
      const forward=y/(across-1)*length;
      positions.push(cx+cross.x*acrossMeters+wind.x*forward,0,
                     cz+cross.y*acrossMeters+wind.y*forward);
      patchIds.push(i+1);
    };
    const base=positions.length/3;
    for(let y=0;y<across;y++)for(let x=0;x<along;x++)add(x,y);
  }
  // Build a regular contiguous index buffer, retaining seeded patch centers.
  const indices=[], patchVertexCount=along*across;
  for(let i=0;i<count;i++){
    const start=i*patchVertexCount;
    for(let y=0;y<across-1;y++)for(let x=0;x<along-1;x++){
      const a=start+y*along+x,b=a+1,c=a+along,d=c+1;
      indices.push(a,c,b,b,c,d);
    }
  }
  const lipGeometry=new THREE.BufferGeometry();
  lipGeometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  lipGeometry.setAttribute('aPatch',new THREE.Float32BufferAttribute(patchIds,1));
  lipGeometry.setIndex(indices);
  const uniforms={
    uTime:water.uTime,uWave:water.uSimTex,uTexel:water.uSimTexel,
    uHeight:water.uHeight,uSimStrength:water.uSimStrength,
    uSpectralSwell:water.uSpectralSwell,uWindCascade:water.uWindCascade,
    uBreaking:water.uBreakingWaves,uThreshold:water.uBreakingThreshold,
    uCameraXZ:{value:new THREE.Vector2()}
  };
  const lipMaterial=new THREE.ShaderMaterial({
    uniforms,transparent:true,depthWrite:false,side:THREE.DoubleSide,
    vertexShader:`precision highp float;
      attribute float aPatch;
      uniform sampler2D uWave;
      uniform float uTexel,uHeight,uSimStrength,uSpectralSwell,uWindCascade;
      uniform float uBreaking,uThreshold,uTime;
      uniform vec2 uCameraXZ;
      varying float vBreak,vFront,vPatch;
      float h(vec2 uv){return texture2D(uWave,fract(uv)).r;}
      void main(){
        vec3 pos=position;
        vec2 worldXZ=pos.xz+uCameraXZ;
        vec2 uv=fract(worldXZ/512.+.5);
        vec2 dx=vec2(uTexel,0.),dz=dx.yx;
        float waveHeight=h(uv)*8.*uHeight*uSimStrength*uSpectralSwell*uWindCascade;
        vec2 slope=vec2(h(uv+dx)-h(uv-dx),h(uv+dz)-h(uv-dz))*
            (8./(1024.*uTexel))*uHeight*uSimStrength*uSpectralSwell*uWindCascade;
        // Local patch seed shares the same grid and wind direction.
        float steep=length(slope);
        float limit=mix(.024,.15,clamp(uThreshold,0.,1.));
        float high=smoothstep(.01,.16,waveHeight);
        float trigger=high*smoothstep(limit,limit+.055,steep)*
                     clamp(uBreaking,0.,2.);
        // The sheet is most visible on the leading half of a crest.
        float progress=fract(length(pos.xz)*.061+aPatch*.137);
        // Across the narrow strip the lip rises then tips forward and falls.
        vec2 wind=normalize(vec2(.94,.34));
        float front=clamp(dot(pos.xz,wind)*.22+
                    fract(aPatch*.381),0.,1.);
        float fold=sin(front*3.14159265);
        pos.y=waveHeight+trigger*(.10+.40*fold-.37*front*front);
        pos.xz+=wind*trigger*(.20+.45*front*front);
        vBreak=clamp(trigger,0.,1.);
        vFront=front;vPatch=aPatch;
        gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.);
      }`,
    fragmentShader:`precision highp float;
      uniform float uTime;
      varying float vBreak,vFront,vPatch;
      void main(){
        if(vBreak<.11)discard;
        float streak=fract(sin(vPatch*17.31+floor(uTime*2.)*.09)*43758.54);
        float coverage=smoothstep(.12,.8,vBreak)*(.68+.32*streak);
        float edge=smoothstep(0.,.17,vFront)*(1.-smoothstep(.75,1.,vFront));
        float alpha=coverage*edge*.70;
        if(alpha<.01)discard;
        vec3 whitewater=mix(vec3(.35,.70,.75),vec3(.88,.97,.95),
                       clamp(vBreak*.9+vFront*.3,0.,1.));
        gl_FragColor=vec4(whitewater,alpha);
      }`
  });
  const crestMesh=new THREE.Mesh(lipGeometry,lipMaterial);
  crestMesh.frustumCulled=false;
  crestMesh.renderOrder=3;
  group.add(crestMesh);

  // Deterministic GPU-driven spray/bubble sprites. A single wave texture
  // lookup determines whether a seed lies on an energetic crest.
  function makeParticles(underwater){
    const n=mobile?(underwater?160:230):(underwater?420:650);
    const v=new Float32Array(n*3),seedAttr=new Float32Array(n);
    for(let i=0;i<n;i++){
      v[3*i]=(seed(i,6)-.5)*90;
      v[3*i+1]=0;
      v[3*i+2]=(seed(i,7)-.5)*90;
      seedAttr[i]=seed(i,8);
    }
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(v,3));
    geometry.setAttribute('aSeed',new THREE.BufferAttribute(seedAttr,1));
    const material=new THREE.ShaderMaterial({
      uniforms:{
        uTime:water.uTime,uWave:water.uSimTex,uTexel:water.uSimTexel,
        uSimStrength:water.uSimStrength,uHeight:water.uHeight,
        uSpectralSwell:water.uSpectralSwell,uWindCascade:water.uWindCascade,
        uBreaking:water.uBreakingWaves,uThreshold:water.uBreakingThreshold,
        uUnder:{value:underwater?1:0},uCameraXZ:uniforms.uCameraXZ
      },
      transparent:true,depthWrite:false,blending:THREE.NormalBlending,
      vertexShader:`precision highp float;
        attribute float aSeed;
        uniform sampler2D uWave;
        uniform float uTime,uTexel,uSimStrength,uHeight,uSpectralSwell;
        uniform float uWindCascade,uBreaking,uThreshold,uUnder;
        uniform vec2 uCameraXZ;
        varying float vAlpha,vUnder;
        float wave(vec2 uv){return texture2D(uWave,fract(uv)).r;}
        void main(){
          vec3 p=position;
          float life=fract(uTime*(uUnder>.5?.27:.42)+aSeed*6.19);
          float age=life*(uUnder>.5?3.7:2.4);
          vec2 wind=normalize(vec2(.94,.34));
          p.xz+=wind*age*(uUnder>.5?.14:1.0);
          vec2 uv=fract((p.xz+uCameraXZ)/512.+.5);
          vec2 dx=vec2(uTexel,0.),dz=dx.yx;
          float h=wave(uv)*8.*uSimStrength*uHeight*uSpectralSwell*uWindCascade;
          float sx=wave(uv+dx)-wave(uv-dx);
          float sz=wave(uv+dz)-wave(uv-dz);
          float slope=length(vec2(sx,sz))*8./(1024.*uTexel);
          float threshold=mix(.022,.13,clamp(uThreshold,0.,1.));
          float birth=smoothstep(.006,.12,h)*
                     smoothstep(threshold,threshold+.065,slope)*
                     clamp(uBreaking,0.,2.);
          float burst=sin(life*3.14159265);
          p.y=uUnder>.5?h-.08-1.7*burst:
                 h+.14+age*(.85+aSeed*.95)-1.25*age*age;
          p.x+=sin(aSeed*73.+age*7.)*age*.1;
          vec4 eye=modelViewMatrix*vec4(p,1.);
          gl_Position=projectionMatrix*eye;
          float scale=uUnder>.5?3.3:4.3;
          gl_PointSize=clamp(scale*(110./max(-eye.z,1.)),1.,9.);
          vAlpha=birth*burst*(uUnder>.5?.56:.76);
          vUnder=uUnder;
        }`,
      fragmentShader:`precision highp float;
        varying float vAlpha,vUnder;
        void main(){
          vec2 q=gl_PointCoord-.5;
          float r=dot(q,q);
          if(r>.245||vAlpha<.018)discard;
          float core=1.-smoothstep(.01,.24,r);
          vec3 color=mix(vec3(.94,.98,1.),vec3(.52,.83,.90),vUnder);
          gl_FragColor=vec4(color,core*vAlpha);
        }`
    });
    const points=new THREE.Points(geometry,material);
    points.frustumCulled=false;
    points.renderOrder=4;
    group.add(points);
    return points;
  }
  const spray=makeParticles(false),bubbles=makeParticles(true);
  return {
    group,crestMesh,spray,bubbles,
    update(camera,mode,params){
      const on=mode==='spectral'&&params.breakingWaves>.001;
      group.visible=on;
      if(!on)return;
      const x=Math.round(camera.position.x/8)*8,z=Math.round(camera.position.z/8)*8;
      group.position.set(x,0,z);
      uniforms.uCameraXZ.value.set(x,z);
      spray.visible=camera.position.y>=-.5;
      bubbles.visible=camera.position.y<1.5;
    },
    dispose(){
      scene.remove(group);
      crestMesh.geometry.dispose();crestMesh.material.dispose();
      for(const p of [spray,bubbles]){p.geometry.dispose();p.material.dispose();}
    }
  };
}
