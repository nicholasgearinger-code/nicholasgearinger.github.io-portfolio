import * as THREE from "three/webgpu";
import {
  vec2,
  vec3,
  float,
  texture,
  screenUV,
  clamp,
  mix,
  exp,
  max,
  pow,
  dot,
  step,
  perspectiveDepthToViewZ,
} from "three/tsl";
import { FluidScreenSpaceRenderer as DenseRenderer } from "./FluidScreenSpaceRendererDense.js";

// V3.4: robust screen-space refraction + depth absorption.
//
// The ordinary scene is still rendered directly to the swapchain so a failed
// auxiliary sample can never blank the whole frame. A second lightweight scene
// render supplies background color/depth only to water pixels. Water thickness
// is estimated from scene-depth minus reconstructed fluid-depth.
export class FluidScreenSpaceRenderer extends DenseRenderer {
  _buildTargets() {
    super._buildTargets();

    this.sceneDepth = this._makeDepthTexture();
    this.sceneTarget = new THREE.RenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.sceneTarget.depthTexture = this.sceneDepth;
    this.sceneTarget.texture.minFilter = THREE.LinearFilter;
    this.sceneTarget.texture.magFilter = THREE.LinearFilter;
  }

  _buildCompositePass() {
    const depthTex = texture(this.smoothVTarget.texture);
    const backgroundTex = texture(this.sceneTarget.texture);
    const backgroundDepthTex = texture(this.sceneDepth);
    const nearNode = this._cameraNear;
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

    const fluidExists = float(1).sub(step(farNode.mul(0.965), z));

    // A little less normal smoothing than V3.3 makes ripples and impact waves
    // read more sharply while preserving the continuous depth surface.
    const slopeX = zR.sub(zL).mul(4.15);
    const slopeY = zU.sub(zD).mul(4.15);
    const normal = vec3(slopeX.negate(), slopeY.negate(), 1).normalize();

    const sceneRawDepth = backgroundDepthTex.sample(uv).r;
    const sceneZ = perspectiveDepthToViewZ(sceneRawDepth, nearNode, farNode).negate();

    // Do not draw water over geometry that is genuinely in front of the fluid
    // surface (for example the near half of the interacting sphere).
    const sceneBehindWater = step(z.add(0.025), sceneZ);
    const fluidMask = fluidExists.mul(sceneBehindWater);

    // Approximate line-of-sight water thickness from front water depth to the
    // first opaque surface behind it. This is the key input for Beer absorption.
    const opticalDepth = clamp(sceneZ.sub(z), 0, 7.0);

    // Screen-space refraction: perturb the background lookup with the continuous
    // reconstructed water normal. Deeper water bends the lookup a little more.
    const distortionScale = clamp(opticalDepth.mul(0.0045).add(0.0025), 0.0025, 0.025);
    const refractUV = uv.add(normal.xy.mul(distortionScale)).clamp(0.002, 0.998);
    const refractedBackground = backgroundTex.sample(refractUV).rgb;

    // Beer-Lambert-style absorption. Red disappears fastest, blue slowest.
    // The coefficients are artist-scaled for this small pool rather than meters.
    const absorptionCoeff = vec3(0.32, 0.085, 0.028);
    const transmittance = exp(absorptionCoeff.mul(opticalDepth.mul(-0.72)));
    const deepScatter = vec3(0.004, 0.085, 0.125);
    const transmitted = refractedBackground.mul(transmittance)
      .add(deepScatter.mul(float(1).sub(transmittance)));

    // Schlick Fresnel for air/water, IOR ~= 1.333.
    const ndv = clamp(normal.z, 0, 1);
    const fresnel = float(0.02037).add(
      float(0.97963).mul(pow(float(1).sub(ndv), 5)),
    );
    const skyFacing = clamp(normal.y.mul(0.42).add(0.64), 0, 1);
    const reflection = mix(
      vec3(0.018, 0.095, 0.155),
      vec3(0.68, 0.88, 1.0),
      skyFacing,
    );

    const sunDir = vec3(-0.30, 0.54, 0.79).normalize();
    const halfDir = vec3(sunDir.x, sunDir.y, sunDir.z.add(1)).normalize();
    const spec = pow(max(dot(normal, halfDir), 0), 135).mul(4.2);

    let water = mix(
      transmitted,
      reflection,
      clamp(fresnel.mul(1.35), 0, 0.94),
    );
    water = water.add(vec3(1.0, 0.95, 0.84).mul(spec));

    material.colorNode = water;
    // The water color already contains its refracted background, so composite it
    // almost opaquely. This avoids the washed-out double-background look from V3.3.
    material.opacityNode = fluidMask.mul(0.975);

    this.compositeQuad = new THREE.QuadMesh(material);
  }

  resize() {
    super.resize();
    if (!this.sceneTarget) return;
    const w = Math.max(1, this._lastWidth || 1);
    const h = Math.max(1, this._lastHeight || 1);
    if (this.sceneTarget.width !== w || this.sceneTarget.height !== h) {
      this.sceneTarget.setSize(w, h);
    }
  }

  render(scene, camera = this.camera) {
    this._cameraNear.value = camera.near;
    this._cameraFar.value = camera.far;
    this.resize();

    // Capture opaque/background scene for refraction. The actual visible scene
    // is still drawn again by DenseRenderer.render(), which keeps this pass safe
    // on iOS even if the auxiliary render target ever fails to sample correctly.
    const renderer = this.renderer;
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    renderer.autoClear = true;
    renderer.setRenderTarget(this.sceneTarget);
    renderer.render(scene, camera);
    renderer.setRenderTarget(previousTarget);
    renderer.autoClear = previousAutoClear;

    super.render(scene, camera);
  }

  dispose() {
    this.sceneTarget?.dispose();
    super.dispose();
  }
}
