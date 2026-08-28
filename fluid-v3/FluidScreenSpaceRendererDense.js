import * as THREE from "three/webgpu";
import {
  Fn,
  attribute,
  instanceIndex,
  vec2,
  vec3,
  vec4,
  float,
  uniform,
  texture,
  screenUV,
  clamp,
  smoothstep,
  mix,
  exp,
  max,
  min,
  pow,
  dot,
  step,
  abs,
  perspectiveDepthToViewZ,
} from "three/tsl";

// Fluid V3.2.2: visibility-first continuous surface reconstruction.
//
// The MLS-MPM particle/grid solver remains untouched. Particles are rendered
// only into a depth buffer. A one-pixel nearest-depth dilation closes sub-pixel
// gaps between neighboring particles, then a wider separable bilateral filter
// removes the remaining particle-scale scalloping while preserving large wave
// silhouettes. The ordinary scene is rendered directly to the swapchain first;
// the fluid is then composited as a transparent dielectric overlay.
//
// This intentionally removes the V3.2 additive-thickness and offscreen scene
// color dependencies. Those can be reintroduced after the continuous surface
// itself is robust on iOS WebGPU.
export class FluidScreenSpaceRenderer {
  constructor(renderer, solver, camera, {
    domainSize = new THREE.Vector3(10, 10, 10),
    surfaceScale = 0.56,
    splatRadius = 0.235,
  } = {}) {
    this.renderer = renderer;
    this.solver = solver;
    this.camera = camera;
    this.domainSize = domainSize.clone();

    // V3.1 particle spacing is ~0.23-0.27 world units. The diagnostic radius
    // merely touched neighbors; reconstruction needs deliberate overlap.
    this.splatRadius = Math.max(splatRadius, 0.34);
    this.surfaceScale = Math.max(surfaceScale, 0.64);

    this._cameraNear = uniform(camera.near);
    this._cameraFar = uniform(camera.far);
    this._texel = uniform(new THREE.Vector2(1 / 512, 1 / 512));
    this._horizontalTexel = uniform(new THREE.Vector2(1 / 512, 0));
    this._verticalTexel = uniform(new THREE.Vector2(0, 1 / 512));
    this._drawingSize = new THREE.Vector2();
    this._lastWidth = 0;
    this._lastHeight = 0;

    this._buildParticleDepthPass();
    this._buildTargets();
    this._buildDilationPass();
    this._buildBilateralPasses();
    this._buildCompositePass();
    this.resize();
  }

  _particlePositionNode() {
    const particle = this.solver.particleBuffer.element(instanceIndex);
    const simPosition = particle.get('position');
    const local = attribute('position');
    const scale = vec3(this.domainSize.x, this.domainSize.y, this.domainSize.z);
    return local.add(simPosition.sub(0.5).mul(scale));
  }

  _buildParticleDepthPass() {
    const geometry = new THREE.IcosahedronGeometry(this.splatRadius, 1);
    geometry.deleteAttribute('uv');

    const material = new THREE.MeshBasicNodeMaterial();
    material.colorNode = vec4(1, 1, 1, 1);
    material.positionNode = Fn(() => this._particlePositionNode())();
    material.depthWrite = true;
    material.depthTest = true;
    material.toneMapped = false;

    const mesh = new THREE.Mesh(geometry, material);
    mesh.count = this.solver.particleCount;
    mesh.frustumCulled = false;

    this.depthScene = new THREE.Scene();
    this.depthScene.add(mesh);
  }

  _makeDepthTexture() {
    const depth = new THREE.DepthTexture();
    depth.type = THREE.FloatType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    return depth;
  }

  _makeLinearTarget() {
    const target = new THREE.RenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    target.texture.minFilter = THREE.LinearFilter;
    target.texture.magFilter = THREE.LinearFilter;
    return target;
  }

  _buildTargets() {
    this.fluidDepth = this._makeDepthTexture();
    this.fluidDepthTarget = new THREE.RenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.fluidDepthTarget.depthTexture = this.fluidDepth;

    this.dilateTarget = this._makeLinearTarget();
    this.smoothHTarget = this._makeLinearTarget();
    this.smoothVTarget = this._makeLinearTarget();
  }

  _buildDilationPass() {
    const source = texture(this.fluidDepth);
    const nearNode = this._cameraNear;
    const farNode = this._cameraFar;
    const px = this._texel;

    const material = new THREE.MeshBasicNodeMaterial();
    material.toneMapped = false;
    material.colorNode = Fn(() => {
      const uv = screenUV;
      const toView = (raw) => perspectiveDepthToViewZ(raw, nearNode, farNode).negate();

      let nearest = toView(source.sample(uv).r);
      nearest = min(nearest, toView(source.sample(uv.add(vec2(px.x, 0))).r));
      nearest = min(nearest, toView(source.sample(uv.sub(vec2(px.x, 0))).r));
      nearest = min(nearest, toView(source.sample(uv.add(vec2(0, px.y))).r));
      nearest = min(nearest, toView(source.sample(uv.sub(vec2(0, px.y))).r));
      nearest = min(nearest, toView(source.sample(uv.add(px)).r));
      nearest = min(nearest, toView(source.sample(uv.sub(px)).r));
      nearest = min(nearest, toView(source.sample(uv.add(vec2(px.x, px.y.negate()))).r));
      nearest = min(nearest, toView(source.sample(uv.add(vec2(px.x.negate(), px.y))).r));
      return vec4(nearest, nearest, nearest, 1);
    })();

    this.dilateQuad = new THREE.QuadMesh(material);
  }

  _makeBilateralMaterial(sourceTexture, texelUniform) {
    const source = texture(sourceTexture);
    const material = new THREE.MeshBasicNodeMaterial();
    material.toneMapped = false;

    material.colorNode = Fn(() => {
      const uv = screenUV;
      const z0 = source.sample(uv).r;
      const offsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
      const spatial = [0.028, 0.066, 0.124, 0.180, 0.204, 0.180, 0.124, 0.066, 0.028];
      let weighted = float(0);
      let total = float(0);

      for (let i = 0; i < offsets.length; i++) {
        const z = source.sample(uv.add(texelUniform.mul(offsets[i]))).r;
        // Wider range sigma than V3.2: smooth particle-scale depth scalloping,
        // but still reject genuinely different splash layers/background.
        const range = exp(abs(z.sub(z0)).mul(-0.92));
        const w = range.mul(spatial[i]);
        weighted = weighted.add(z.mul(w));
        total = total.add(w);
      }

      const filtered = weighted.div(max(total, 0.00001));
      return vec4(filtered, filtered, filtered, 1);
    })();
    return material;
  }

  _buildBilateralPasses() {
    this.horizontalQuad = new THREE.QuadMesh(
      this._makeBilateralMaterial(this.dilateTarget.texture, this._horizontalTexel),
    );
    this.verticalQuad = new THREE.QuadMesh(
      this._makeBilateralMaterial(this.smoothHTarget.texture, this._verticalTexel),
    );
  }

  _buildCompositePass() {
    const depthTex = texture(this.smoothVTarget.texture);
    const farNode = this._cameraFar;
    const px = this._texel;

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.toneMapped = true;

    const uv = screenUV;
    const z = depthTex.sample(uv).r;
    const zL = depthTex.sample(uv.sub(vec2(px.x, 0))).r;
    const zR = depthTex.sample(uv.add(vec2(px.x, 0))).r;
    const zD = depthTex.sample(uv.sub(vec2(0, px.y))).r;
    const zU = depthTex.sample(uv.add(vec2(0, px.y))).r;

    const fluidMask = float(1).sub(step(farNode.mul(0.965), z));

    const slopeX = zR.sub(zL).mul(4.4);
    const slopeY = zU.sub(zD).mul(4.4);
    const normal = vec3(slopeX.negate(), slopeY.negate(), 1).normalize();

    // Fresnel reflection for IOR 1.333. The base remains intentionally clear;
    // the pool below is rendered normally and shows through the overlay.
    const ndv = clamp(normal.z, 0, 1);
    const fresnel = float(0.02037).add(
      float(0.97963).mul(pow(float(1).sub(ndv), 5)),
    );
    const skyFacing = clamp(normal.y.mul(0.45).add(0.62), 0, 1);
    const reflection = mix(
      vec3(0.025, 0.13, 0.19),
      vec3(0.70, 0.90, 1.0),
      skyFacing,
    );
    const transmissionTint = vec3(0.025, 0.27, 0.34);

    const sunDir = vec3(-0.34, 0.48, 0.81).normalize();
    const sunSpec = pow(max(dot(normal, sunDir), 0), 145).mul(2.2);

    // Foam now requires much larger continuous-surface curvature. This removes
    // the previous white stipple caused by tiny particle-scale depth changes.
    const laplacian = abs(zL.add(zR).add(zD).add(zU).sub(z.mul(4)));
    const foam = smoothstep(0.085, 0.34, laplacian);

    let water = mix(transmissionTint, reflection, clamp(fresnel.mul(1.35), 0, 0.94));
    water = water.add(vec3(1.0, 0.92, 0.78).mul(sunSpec));
    water = mix(water, vec3(0.94, 0.99, 1.0), foam.mul(0.46));

    material.colorNode = water;
    material.opacityNode = fluidMask.mul(
      mix(float(0.42), float(0.70), clamp(fresnel.mul(2.0), 0, 1)),
    );

    this.compositeQuad = new THREE.QuadMesh(material);
  }

  resize() {
    this.renderer.getDrawingBufferSize(this._drawingSize);
    const fullW = Math.max(1, Math.floor(this._drawingSize.x));
    const fullH = Math.max(1, Math.floor(this._drawingSize.y));
    if (fullW === this._lastWidth && fullH === this._lastHeight) return;
    this._lastWidth = fullW;
    this._lastHeight = fullH;

    const fluidW = Math.max(128, Math.floor(fullW * this.surfaceScale));
    const fluidH = Math.max(128, Math.floor(fullH * this.surfaceScale));
    this.fluidDepthTarget.setSize(fluidW, fluidH);
    this.dilateTarget.setSize(fluidW, fluidH);
    this.smoothHTarget.setSize(fluidW, fluidH);
    this.smoothVTarget.setSize(fluidW, fluidH);

    this._texel.value.set(1 / fluidW, 1 / fluidH);
    this._horizontalTexel.value.set(1 / fluidW, 0);
    this._verticalTexel.value.set(0, 1 / fluidH);
  }

  render(scene, camera = this.camera) {
    this._cameraNear.value = camera.near;
    this._cameraFar.value = camera.far;
    this.resize();

    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const oldClear = new THREE.Color();
    renderer.getClearColor(oldClear);
    const oldAlpha = renderer.getClearAlpha();

    // Scene always remains visible, even if an intermediate fluid pass fails.
    renderer.autoClear = true;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);

    renderer.setClearColor(0x000000, 1);

    // Nearest MLS-MPM particle surface.
    renderer.setRenderTarget(this.fluidDepthTarget);
    renderer.clear();
    renderer.render(this.depthScene, camera);

    // Close one-pixel/sub-pixel holes before smoothing.
    renderer.setRenderTarget(this.dilateTarget);
    renderer.clear();
    this.dilateQuad.render(renderer);

    // Strong edge-preserving smoothing.
    renderer.setRenderTarget(this.smoothHTarget);
    renderer.clear();
    this.horizontalQuad.render(renderer);

    renderer.setRenderTarget(this.smoothVTarget);
    renderer.clear();
    this.verticalQuad.render(renderer);

    // Transparent continuous fluid overlay; never clear the swapchain here.
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    this.compositeQuad.render(renderer);

    renderer.setClearColor(oldClear, oldAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  dispose() {
    this.fluidDepthTarget.dispose();
    this.dilateTarget.dispose();
    this.smoothHTarget.dispose();
    this.smoothVTarget.dispose();
    this.depthScene.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this.dilateQuad.material?.dispose?.();
    this.horizontalQuad.material?.dispose?.();
    this.verticalQuad.material?.dispose?.();
    this.compositeQuad.material?.dispose?.();
  }
}
