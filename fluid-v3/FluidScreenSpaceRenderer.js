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
  abs,
  exp,
  max,
  pow,
  dot,
  step,
  perspectiveDepthToViewZ,
} from "three/tsl";

// Fluid V3.2 screen-space surface reconstruction.
//
// MLS-MPM remains the source of truth. This renderer never reads particle data
// back to the CPU. Instead it renders the GPU particle buffer into low-resolution
// depth/thickness buffers, performs an edge-preserving bilateral depth filter,
// reconstructs a continuous screen-space normal, and composites a refractive
// dielectric water surface over the opaque scene.
//
// This is deliberately isolated from the solver so the physics can keep evolving
// independently of the final surfacing technique.
export class FluidScreenSpaceRenderer {
  constructor(renderer, solver, camera, {
    domainSize = new THREE.Vector3(10, 10, 10),
    surfaceScale = 0.56,
    splatRadius = 0.235,
    thicknessPerParticle = 0.040,
  } = {}) {
    this.renderer = renderer;
    this.solver = solver;
    this.camera = camera;
    this.domainSize = domainSize.clone();
    this.surfaceScale = surfaceScale;
    this.splatRadius = splatRadius;
    this.thicknessPerParticle = thicknessPerParticle;

    this._drawingSize = new THREE.Vector2();
    this._lastWidth = 0;
    this._lastHeight = 0;

    this._cameraNear = uniform(camera.near);
    this._cameraFar = uniform(camera.far);
    this._horizontalTexel = uniform(new THREE.Vector2(1 / 512, 0));
    this._verticalTexel = uniform(new THREE.Vector2(0, 1 / 512));
    this._surfaceTexel = uniform(new THREE.Vector2(1 / 512, 1 / 512));

    this._buildParticlePasses();
    this._buildTargets();
    this._buildBilateralPasses();
    this._buildCompositePass();
    this.resize();
  }

  _particlePositionNode() {
    const particle = this.solver.particleBuffer.element(instanceIndex);
    const simPosition = particle.get('position');
    const local = attribute('position');
    const domainScale = vec3(this.domainSize.x, this.domainSize.y, this.domainSize.z);
    return local.add(simPosition.sub(0.5).mul(domainScale));
  }

  _buildParticlePasses() {
    // Screen-space splats are intentionally larger than the diagnostic V3.1
    // particles so neighboring fluid samples overlap into a closed surface.
    const geometry = new THREE.IcosahedronGeometry(this.splatRadius, 1);
    geometry.deleteAttribute('uv');

    const depthMaterial = new THREE.MeshBasicNodeMaterial();
    depthMaterial.colorNode = vec4(1, 1, 1, 1);
    depthMaterial.positionNode = Fn(() => this._particlePositionNode())();
    depthMaterial.depthWrite = true;
    depthMaterial.depthTest = true;
    depthMaterial.toneMapped = false;

    const depthMesh = new THREE.Mesh(geometry, depthMaterial);
    depthMesh.count = this.solver.particleCount;
    depthMesh.frustumCulled = false;

    this.depthScene = new THREE.Scene();
    this.depthScene.add(depthMesh);

    const thicknessMaterial = new THREE.MeshBasicNodeMaterial();
    thicknessMaterial.colorNode = vec4(this.thicknessPerParticle, 0, 0, 1);
    thicknessMaterial.positionNode = Fn(() => this._particlePositionNode())();
    thicknessMaterial.transparent = true;
    thicknessMaterial.blending = THREE.AdditiveBlending;
    thicknessMaterial.depthTest = false;
    thicknessMaterial.depthWrite = false;
    thicknessMaterial.toneMapped = false;

    const thicknessMesh = new THREE.Mesh(geometry, thicknessMaterial);
    thicknessMesh.count = this.solver.particleCount;
    thicknessMesh.frustumCulled = false;

    this.thicknessScene = new THREE.Scene();
    this.thicknessScene.add(thicknessMesh);
  }

  _makeDepthTexture() {
    const depth = new THREE.DepthTexture();
    depth.type = THREE.FloatType;
    depth.minFilter = THREE.NearestFilter;
    depth.magFilter = THREE.NearestFilter;
    return depth;
  }

  _buildTargets() {
    this.sceneDepth = this._makeDepthTexture();
    this.sceneTarget = new THREE.RenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.sceneTarget.depthTexture = this.sceneDepth;
    this.sceneTarget.texture.minFilter = THREE.LinearFilter;
    this.sceneTarget.texture.magFilter = THREE.LinearFilter;

    this.fluidDepth = this._makeDepthTexture();
    this.fluidDepthTarget = new THREE.RenderTarget(1, 1, {
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.fluidDepthTarget.depthTexture = this.fluidDepth;

    this.thicknessTarget = new THREE.RenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.thicknessTarget.texture.minFilter = THREE.LinearFilter;
    this.thicknessTarget.texture.magFilter = THREE.LinearFilter;

    this.smoothHTarget = new THREE.RenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.smoothHTarget.texture.minFilter = THREE.LinearFilter;
    this.smoothHTarget.texture.magFilter = THREE.LinearFilter;

    this.smoothVTarget = new THREE.RenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.smoothVTarget.texture.minFilter = THREE.LinearFilter;
    this.smoothVTarget.texture.magFilter = THREE.LinearFilter;
  }

  _buildBilateralMaterial(sourceTexture, texelUniform, sourceIsPerspectiveDepth) {
    const source = texture(sourceTexture);
    const nearNode = this._cameraNear;
    const farNode = this._cameraFar;

    const material = new THREE.MeshBasicNodeMaterial();
    material.toneMapped = false;
    material.colorNode = Fn(() => {
      const uv = screenUV;
      const raw0 = source.sample(uv).r;
      const z0 = sourceIsPerspectiveDepth
        ? perspectiveDepthToViewZ(raw0, nearNode, farNode).negate()
        : raw0;

      // Seven-tap separable bilateral filter. Spatial weights smooth over the
      // individual particle spheres while the depth term protects silhouettes,
      // splash sheets and holes from bleeding into the background.
      const offsets = [-3, -2, -1, 0, 1, 2, 3];
      const spatial = [0.036, 0.111, 0.216, 0.274, 0.216, 0.111, 0.036];
      let weighted = float(0);
      let totalWeight = float(0);

      for (let i = 0; i < offsets.length; i++) {
        const tapUV = uv.add(texelUniform.mul(offsets[i]));
        const raw = source.sample(tapUV).r;
        const z = sourceIsPerspectiveDepth
          ? perspectiveDepthToViewZ(raw, nearNode, farNode).negate()
          : raw;
        const rangeWeight = exp(abs(z.sub(z0)).mul(-2.2));
        const w = rangeWeight.mul(spatial[i]);
        weighted = weighted.add(z.mul(w));
        totalWeight = totalWeight.add(w);
      }

      const filtered = weighted.div(max(totalWeight, 0.00001));
      return vec4(filtered, filtered, filtered, 1);
    })();
    return material;
  }

  _buildBilateralPasses() {
    const hMaterial = this._buildBilateralMaterial(
      this.fluidDepth,
      this._horizontalTexel,
      true,
    );
    this.horizontalQuad = new THREE.QuadMesh(hMaterial);

    const vMaterial = this._buildBilateralMaterial(
      this.smoothHTarget.texture,
      this._verticalTexel,
      false,
    );
    this.verticalQuad = new THREE.QuadMesh(vMaterial);
  }

  _buildCompositePass() {
    const sceneColorTex = texture(this.sceneTarget.texture);
    const sceneDepthTex = texture(this.sceneDepth);
    const fluidDepthTex = texture(this.smoothVTarget.texture);
    const thicknessTex = texture(this.thicknessTarget.texture);
    const nearNode = this._cameraNear;
    const farNode = this._cameraFar;

    const material = new THREE.MeshBasicNodeMaterial();
    material.toneMapped = true;
    material.colorNode = Fn(() => {
      const uv = screenUV;
      const sceneColor = sceneColorTex.sample(uv).rgb;
      const z = fluidDepthTex.sample(uv).r;
      const sceneZ = perspectiveDepthToViewZ(
        sceneDepthTex.sample(uv).r,
        nearNode,
        farNode,
      ).negate();

      const px = this._surfaceTexel;
      const zL = fluidDepthTex.sample(uv.sub(vec2(px.x, 0))).r;
      const zR = fluidDepthTex.sample(uv.add(vec2(px.x, 0))).r;
      const zD = fluidDepthTex.sample(uv.sub(vec2(0, px.y))).r;
      const zU = fluidDepthTex.sample(uv.add(vec2(0, px.y))).r;

      // Reconstruct a stable view-space normal from the smoothed fluid depth.
      // The scale converts view-depth change across one pixel into a useful
      // surface slope without requiring CPU-side mesh generation.
      const slopeX = zR.sub(zL).mul(6.5);
      const slopeY = zU.sub(zD).mul(6.5);
      const normal = vec3(slopeX.negate(), slopeY.negate(), 1).normalize();

      const thicknessRaw = thicknessTex.sample(uv).r;
      const thickness = clamp(thicknessRaw.mul(1.8), 0, 2.5);
      const densityMask = smoothstep(0.025, 0.16, thicknessRaw);
      const inFront = step(z, sceneZ.add(0.06));
      const fluidMask = densityMask.mul(inFront);

      // Refraction through the continuous reconstructed surface. This is a
      // screen-space approximation of a 1.333-IOR dielectric and is intentionally
      // tied to both the reconstructed normal and accumulated fluid thickness.
      const distortion = normal.xy.mul(clamp(thickness.mul(0.013), 0.002, 0.028));
      const refractUV = uv.add(distortion).clamp(0.002, 0.998);
      const refractedScene = sceneColorTex.sample(refractUV).rgb;

      // Beer-Lambert-style absorption: red attenuates fastest, then green,
      // leaving the familiar cyan/blue transmission through deeper water.
      const absorption = vec3(0.19, 0.072, 0.028);
      const transmittance = exp(absorption.mul(thickness.mul(-2.15)));
      const transmitted = refractedScene.mul(transmittance)
        .add(vec3(0.006, 0.055, 0.075).mul(float(1).sub(transmittance)));

      // Schlick Fresnel for water/air (F0 ~= 0.02037 at IOR 1.333). We use a
      // screen-space environment approximation for now; the physics/surface
      // reconstruction remains independent and can later receive SSR/planar env.
      const ndv = clamp(normal.z, 0, 1);
      const fresnel = float(0.02037).add(
        float(0.97963).mul(pow(float(1).sub(ndv), 5)),
      );
      const skyT = clamp(normal.y.mul(0.5).add(0.60), 0, 1);
      const reflection = mix(
        vec3(0.035, 0.12, 0.18),
        vec3(0.62, 0.83, 0.96),
        skyT,
      );

      // Compact sun highlight from the reconstructed fluid normal.
      const sunDir = vec3(-0.34, 0.48, 0.81).normalize();
      const sunSpec = pow(max(dot(normal, sunDir), 0), 150).mul(3.8);

      // High curvature + sufficient thickness becomes aerated whitewater. This
      // comes from the reconstructed surface itself, not an animated foam decal.
      const laplacian = abs(zL.add(zR).add(zD).add(zU).sub(z.mul(4)));
      const curvature = smoothstep(0.010, 0.085, laplacian);
      const foam = curvature.mul(smoothstep(0.055, 0.20, thicknessRaw));

      let water = mix(transmitted, reflection, fresnel);
      water = water.add(vec3(1.0, 0.91, 0.72).mul(sunSpec));
      water = mix(water, vec3(0.91, 0.98, 1.0), clamp(foam.mul(0.72), 0, 0.72));

      const finalColor = mix(sceneColor, water, fluidMask);
      return vec4(finalColor, 1);
    })();

    this.compositeQuad = new THREE.QuadMesh(material);
  }

  resize() {
    this.renderer.getDrawingBufferSize(this._drawingSize);
    const fullW = Math.max(1, Math.floor(this._drawingSize.x));
    const fullH = Math.max(1, Math.floor(this._drawingSize.y));
    if (fullW === this._lastWidth && fullH === this._lastHeight) return;
    this._lastWidth = fullW;
    this._lastHeight = fullH;

    const fluidW = Math.max(96, Math.floor(fullW * this.surfaceScale));
    const fluidH = Math.max(96, Math.floor(fullH * this.surfaceScale));

    this.sceneTarget.setSize(fullW, fullH);
    this.fluidDepthTarget.setSize(fluidW, fluidH);
    this.thicknessTarget.setSize(fluidW, fluidH);
    this.smoothHTarget.setSize(fluidW, fluidH);
    this.smoothVTarget.setSize(fluidW, fluidH);

    this._horizontalTexel.value.set(1 / fluidW, 0);
    this._verticalTexel.value.set(0, 1 / fluidH);
    this._surfaceTexel.value.set(1 / fluidW, 1 / fluidH);
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

    renderer.autoClear = true;

    // 1) Opaque/transmissive scene without the diagnostic particle mesh.
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);

    // 2) Nearest fluid surface depth.
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.fluidDepthTarget);
    renderer.clear();
    renderer.render(this.depthScene, camera);

    // 3) Approximate line-of-sight thickness by additive particle splatting.
    renderer.setRenderTarget(this.thicknessTarget);
    renderer.clear();
    renderer.render(this.thicknessScene, camera);

    // 4/5) Edge-preserving depth smoothing turns thousands of individual
    // particle spheres into one coherent free surface while retaining crests.
    renderer.setRenderTarget(this.smoothHTarget);
    renderer.clear();
    this.horizontalQuad.render(renderer);

    renderer.setRenderTarget(this.smoothVTarget);
    renderer.clear();
    this.verticalQuad.render(renderer);

    // 6) Full-resolution refraction/reflection/absorption composite.
    renderer.setRenderTarget(null);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    this.compositeQuad.render(renderer);

    renderer.setClearColor(oldClear, oldAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }

  dispose() {
    this.sceneTarget.dispose();
    this.fluidDepthTarget.dispose();
    this.thicknessTarget.dispose();
    this.smoothHTarget.dispose();
    this.smoothVTarget.dispose();
    this.depthScene.traverse((o) => {
      o.geometry?.dispose?.();
      o.material?.dispose?.();
    });
    this.thicknessScene.traverse((o) => o.material?.dispose?.());
    this.horizontalQuad.material?.dispose?.();
    this.verticalQuad.material?.dispose?.();
    this.compositeQuad.material?.dispose?.();
  }
}
