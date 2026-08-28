import {
  vec2,
  vec3,
  float,
  texture,
  screenUV,
  clamp,
  mix,
  max,
  pow,
  dot,
  step,
} from "three/tsl";
import * as THREE from "three/webgpu";
import { FluidScreenSpaceRenderer as DenseRenderer } from "./FluidScreenSpaceRendererDense.js";

// V3.3 presentation pass: keep the dense MLS-MPM depth reconstruction, but make
// the result read as a coherent glass-like body of water. Particle-scale
// curvature foam is intentionally disabled until we have a velocity/thickness
// criterion that can distinguish true aeration from reconstruction edges.
export class FluidScreenSpaceRenderer extends DenseRenderer {
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
    const slopeX = zR.sub(zL).mul(3.35);
    const slopeY = zU.sub(zD).mul(3.35);
    const normal = vec3(slopeX.negate(), slopeY.negate(), 1).normalize();

    // Water/air Fresnel, IOR ~= 1.333.
    const ndv = clamp(normal.z, 0, 1);
    const fresnel = float(0.02037).add(
      float(0.97963).mul(pow(float(1).sub(ndv), 5)),
    );

    // Stronger material separation from the cyan pool floor. This is still a
    // transparent overlay, but it now has enough absorption/body tint to read as
    // a liquid volume rather than an almost invisible mask.
    const body = vec3(0.012, 0.185, 0.255);
    const deepBody = vec3(0.004, 0.075, 0.125);
    const grazing = clamp(float(1).sub(ndv).mul(1.4), 0, 1);
    const transmissionTint = mix(body, deepBody, grazing.mul(0.55));

    const skyFacing = clamp(normal.y.mul(0.40).add(0.64), 0, 1);
    const reflection = mix(
      vec3(0.025, 0.11, 0.17),
      vec3(0.74, 0.92, 1.0),
      skyFacing,
    );

    const sunDir = vec3(-0.30, 0.54, 0.79).normalize();
    const halfDir = vec3(sunDir.x, sunDir.y, sunDir.z.add(1)).normalize();
    const spec = pow(max(dot(normal, halfDir), 0), 105).mul(3.4);

    let water = mix(
      transmissionTint,
      reflection,
      clamp(fresnel.mul(1.9).add(grazing.mul(0.08)), 0, 0.92),
    );
    water = water.add(vec3(1.0, 0.94, 0.82).mul(spec));

    material.colorNode = water;
    // A materially readable base opacity, with stronger grazing reflection.
    material.opacityNode = fluidMask.mul(
      mix(float(0.58), float(0.86), clamp(fresnel.mul(3.2).add(grazing.mul(0.45)), 0, 1)),
    );

    this.compositeQuad = new THREE.QuadMesh(material);
  }
}
