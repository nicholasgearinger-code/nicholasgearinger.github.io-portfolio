import * as THREE from "three/webgpu";
import {
  Fn,
  vec2,
  vec3,
  float,
  texture,
  screenUV,
  clamp,
  smoothstep,
  mix,
  exp,
  max,
  pow,
  dot,
  step,
} from "three/tsl";
import { FluidScreenSpaceRenderer } from "./FluidScreenSpaceRenderer.js";

// Fluid V3.2.1 visibility-first compositor.
//
// The MLS-MPM physics and the depth/thickness/bilateral reconstruction are the
// same as V3.2. The difference is intentionally conservative: the ordinary
// Three.js scene is rendered directly to the swapchain first, then the fluid is
// composited as a transparent screen-space dielectric overlay. This removes the
// V3.2 dependency on sampling sceneTarget.texture for the entire visible frame.
//
// The fluid existence mask is derived from the smoothed fluid depth itself, not
// from accumulated thickness, so a weak/unsupported additive thickness pass can
// no longer make every water pixel disappear.
export class FluidScreenSpaceRendererVisible extends FluidScreenSpaceRenderer {
  _buildCompositePass() {
    const fluidDepthTex = texture(this.smoothVTarget.texture);
    const thicknessTex = texture(this.thicknessTarget.texture);
    const farNode = this._cameraFar;

    const material = new THREE.MeshBasicNodeMaterial();
    material.transparent = true;
    material.depthTest = false;
    material.depthWrite = false;
    material.blending = THREE.NormalBlending;
    material.toneMapped = true;

    const uv = screenUV;
    const z = fluidDepthTex.sample(uv).r;
    const px = this._surfaceTexel;
    const zL = fluidDepthTex.sample(uv.sub(vec2(px.x, 0))).r;
    const zR = fluidDepthTex.sample(uv.add(vec2(px.x, 0))).r;
    const zD = fluidDepthTex.sample(uv.sub(vec2(0, px.y))).r;
    const zU = fluidDepthTex.sample(uv.add(vec2(0, px.y))).r;

    // The bilateral depth target stores positive view distance. Cleared pixels
    // become camera.far, while real fluid lies well in front of it.
    const fluidMask = float(1).sub(step(farNode.mul(0.97), z));

    // Reconstructed screen-space normal from the continuous, smoothed surface.
    const slopeX = zR.sub(zL).mul(6.0);
    const slopeY = zU.sub(zD).mul(6.0);
    const normal = vec3(slopeX.negate(), slopeY.negate(), 1).normalize();

    const thicknessRaw = thicknessTex.sample(uv).r;
    // Always give a confirmed depth surface a minimum optical thickness. This
    // keeps the water visible even if additive thickness is weak on a device.
    const thickness = clamp(
      thicknessRaw.mul(1.65).add(fluidMask.mul(0.18)),
      0,
      2.8,
    );
    const body = smoothstep(0.12, 1.15, thickness);

    // Beer-Lambert inspired body color. V3.2.1 intentionally blends this over
    // the already-rendered scene instead of sampling scene color for refraction.
    const shallow = vec3(0.055, 0.48, 0.58);
    const deep = vec3(0.008, 0.105, 0.165);
    const absorption = float(1).sub(exp(thickness.mul(-1.18)));
    const transmissionTint = mix(shallow, deep, clamp(absorption, 0, 1));

    // Schlick Fresnel for IOR ~= 1.333. Reflection is a compact sky approximation
    // for this robustness pass; scene refraction will be restored after the
    // surface is proven visible on iOS WebGPU.
    const ndv = clamp(normal.z, 0, 1);
    const fresnel = float(0.02037).add(
      float(0.97963).mul(pow(float(1).sub(ndv), 5)),
    );
    const skyFacing = clamp(normal.y.mul(0.45).add(0.62), 0, 1);
    const reflection = mix(
      vec3(0.035, 0.12, 0.18),
      vec3(0.70, 0.90, 1.0),
      skyFacing,
    );

    const sunDir = vec3(-0.34, 0.48, 0.81).normalize();
    const sunSpec = pow(max(dot(normal, sunDir), 0), 120).mul(2.6);

    const laplacian = zL.add(zR).add(zD).add(zU).sub(z.mul(4)).abs();
    const foam = smoothstep(0.018, 0.11, laplacian)
      .mul(smoothstep(0.10, 0.42, thickness));

    let water = mix(transmissionTint, reflection, clamp(fresnel.mul(1.25), 0, 0.92));
    water = water.add(vec3(1.0, 0.92, 0.76).mul(sunSpec));
    water = mix(water, vec3(0.94, 0.99, 1.0), clamp(foam.mul(0.70), 0, 0.70));

    material.colorNode = water;
    material.opacityNode = fluidMask.mul(
      mix(float(0.48), float(0.82), body),
    );

    this.compositeQuad = new THREE.QuadMesh(material);
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

    // 1) Render the normal pool/environment directly. Even if any fluid pass
    // fails visually, the user still sees the scene instead of a blank frame.
    renderer.autoClear = true;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);

    // 2) Nearest fluid surface depth.
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(this.fluidDepthTarget);
    renderer.clear();
    renderer.render(this.depthScene, camera);

    // 3) Approximate line-of-sight thickness. This improves absorption but is
    // no longer required for the water mask.
    renderer.setRenderTarget(this.thicknessTarget);
    renderer.clear();
    renderer.render(this.thicknessScene, camera);

    // 4/5) Separable edge-preserving smoothing merges particle splats into the
    // continuous free surface.
    renderer.setRenderTarget(this.smoothHTarget);
    renderer.clear();
    this.horizontalQuad.render(renderer);

    renderer.setRenderTarget(this.smoothVTarget);
    renderer.clear();
    this.verticalQuad.render(renderer);

    // 6) Transparent water overlay. Crucially, do not clear the swapchain here.
    renderer.setRenderTarget(null);
    renderer.autoClear = false;
    this.compositeQuad.render(renderer);

    renderer.setClearColor(oldClear, oldAlpha);
    renderer.autoClear = previousAutoClear;
    renderer.setRenderTarget(previousTarget);
  }
}
