// Independent Rift Water Lab spectral engine (not imported by Rift gameplay).
// Frequency-domain gravity-wave evolution + GPU inverse FFT (DIF butterflies).
// Float/half-float render targets are required; no lossy 8-bit FFT fallback.
export function createSpectralOcean(THREE, renderer, {mobile=false}={}) {
  const supported = renderer.extensions.has('EXT_color_buffer_float') ||
    renderer.extensions.has('EXT_color_buffer_half_float');
  if (!supported) return {supported:false, reason:'Floating-point render targets unavailable'};
  const n = mobile ? 64 : 128;
  const stages = Math.round(Math.log2(n));
  const texel = 1/n;
  const target = () => new THREE.WebGLRenderTarget(n,n,{
    type:THREE.HalfFloatType, format:THREE.RGBAFormat,
    minFilter:THREE.NearestFilter, magFilter:THREE.NearestFilter,
    wrapS:THREE.RepeatWrapping, wrapT:THREE.RepeatWrapping,
    depthBuffer:false, stencilBuffer:false, generateMipmaps:false
  });
  const targets=[target(),target()];
  const output=target();
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const scene=new THREE.Scene();
  const quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),null);
  quad.frustumCulled=false;
  scene.add(quad);
  const baseVertex='varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const spectrum=new THREE.ShaderMaterial({
    depthTest:false,depthWrite:false,
    uniforms:{uTime:{value:0},uWind:{value:1},uN:{value:n}},
    vertexShader:baseVertex,
    fragmentShader:`precision highp float;
      varying vec2 vUv;uniform float uTime,uWind,uN;
      const float PI=3.141592653589793;
      float hash(vec2 p) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      vec2 gaussian(vec2 i) {
        float a=max(hash(i+vec2(5.3,19.1)),.00001);
        float b=hash(i+vec2(91.7,3.8));
        float r=sqrt(-2.*log(a));
        return r*vec2(cos(2.*PI*b),sin(2.*PI*b));
      }
      float amplitude(vec2 p) {
        vec2 k=(p-uN*.5)*(2.*PI/512.);
        float m=length(k);
        if(m<.012||m>1.2)return 0.;
        vec2 direction=k/m;
        vec2 wind=normalize(vec2(.94,.34));
        float directional=.12+.88*pow(max(dot(direction,wind),0.),3.);
        float primary=exp(-.5*pow((m-.105)/.062,2.))*.032;
        float secondary=exp(-.5*pow((m-.32)/.16,2.))*.006;
        return (primary+secondary)*directional*sqrt(max(.1,uWind));
      }
      vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
      void main(){
        vec2 i=floor(gl_FragCoord.xy);
        vec2 minus=mod(uN-i,uN);
        vec2 k=(i-uN*.5)*(2.*PI/512.);
        float mag=length(k);
        float omega=sqrt(9.81*mag*tanh(mag*75.));
        // k and -k are a Hermitian pair. Real output after inverse FFT.
        vec2 h0=gaussian(i)*amplitude(i);
        vec2 hMinus=gaussian(minus)*amplitude(minus);
        float phase=omega*uTime;
        vec2 first=cmul(h0,vec2(cos(phase),sin(phase)));
        vec2 second=cmul(vec2(hMinus.x,-hMinus.y),vec2(cos(phase),-sin(phase)));
        vec2 z=first+second;
        if(mag<.012)z=vec2(0.);
        gl_FragColor=vec4(z,0.,1.);
      }`
  });
  const butterfly=new THREE.ShaderMaterial({
    depthTest:false,depthWrite:false,
    uniforms:{uSource:{value:null},uN:{value:n},uStage:{value:0},uAxis:{value:0}},
    vertexShader:baseVertex,
    fragmentShader:`precision highp float;
      uniform sampler2D uSource;
      uniform float uN,uStage,uAxis;
      const float PI=3.141592653589793;
      vec2 cmul(vec2 a,vec2 b){return vec2(a.x*b.x-a.y*b.y,a.x*b.y+a.y*b.x);}
      vec2 readComplex(vec2 pixel){return texture2D(uSource,(pixel+vec2(.5))/uN).rg;}
      void main(){
        vec2 pix=floor(gl_FragCoord.xy);
        float index=uAxis<.5?pix.x:pix.y;
        float m=uN/exp2(uStage);
        float halfM=m*.5;
        float j=mod(index,halfM);
        float upper=step(halfM,mod(index,m));
        vec2 partner=pix+(uAxis<.5?vec2(halfM,0.):vec2(0.,halfM))*(1.-2.*upper);
        vec2 self=readComplex(pix);
        vec2 other=readComplex(partner);
        vec2 value;
        if(upper<.5) value=self+other;
        else {
          float angle=2.*PI*j/m; // Inverse DFT sign.
          value=cmul(other-self,vec2(cos(angle),sin(angle)));
        }
        gl_FragColor=vec4(value,0.,1.);
      }`
  });
  const finalPass=new THREE.ShaderMaterial({
    depthTest:false,depthWrite:false,
    uniforms:{uSource:{value:null},uN:{value:n},uStages:{value:stages}},
    vertexShader:baseVertex,
    fragmentShader:`precision highp float;
      uniform sampler2D uSource;
      uniform float uN,uStages;
      float reverseBits(float x) {
        float r=0.;
        for(int j=0;j<8;j++){
          if(float(j)>=uStages)break;
          r=r*2.+mod(x,2.);
          x=floor(x*.5);
        }
        return r;
      }
      void main(){
        vec2 i=floor(gl_FragCoord.xy);
        vec2 rev=vec2(reverseBits(i.x),reverseBits(i.y));
        vec2 raw=texture2D(uSource,(rev+.5)/uN).rg;
        // Centered k coordinates induce checkerboard sign after IFFT.
        float checker=1.-2.*mod(i.x+i.y,2.);
        // Height textures are sampled with a common shader scale of 8.
        float h=raw.x*checker/8.;
        gl_FragColor=vec4(h,0.,0.,1.);
      }`
  });
  let idx=0;
  const draw=(material,destination)=>{
    const prev=renderer.getRenderTarget();
    try {
      quad.material=material;
      renderer.setRenderTarget(destination);
      renderer.render(scene,camera);
    } finally {renderer.setRenderTarget(prev);}
  };
  function update(time,wind=1) {
    spectrum.uniforms.uTime.value=time;
    spectrum.uniforms.uWind.value=wind;
    draw(spectrum,targets[0]);
    idx=0;
    for(let axis=0;axis<2;axis++) {
      for(let stage=0;stage<stages;stage++) {
        butterfly.uniforms.uSource.value=targets[idx].texture;
        butterfly.uniforms.uAxis.value=axis;
        butterfly.uniforms.uStage.value=stage;
        draw(butterfly,targets[1-idx]);
        idx=1-idx;
      }
    }
    finalPass.uniforms.uSource.value=targets[idx].texture;
    draw(finalPass,output);
    return output.texture;
  }
  return {
    supported:true, resolution:n, texel, texture:output.texture, update,
    dispose(){targets.forEach(t=>t.dispose());output.dispose();
      spectrum.dispose();butterfly.dispose();finalPass.dispose();quad.geometry.dispose();}
  };
}
