// Near-field SSFR-inspired optics for Rift's existing WebGPU ocean material.
// Fluid Lab M7/M8: reconstruct optical thickness and aeration from the
// physically solved local fluid state. Reuses the water's original viewport
// refraction sample: no depth prepass, SSFR screen composite or GPU compute.
// This is NOT Fluid Lab's full screen-space fluid renderer.
import * as THREE from "three";
import {
  attribute, uniform, positionWorld, cameraPosition, float,
  vec2, vec3, clamp, abs, max, min, mix, exp, smoothstep,
} from "three/tsl";

export function createFluidLabLocalOptics(handle, depth, labHydro, underwater) {
  if (!handle?.gpuFFT || !labHydro) return null;

  // Local refinement follows the camera near shore; the bow/hull generates
  // an additional smaller focus when the user is rowing. The uniforms are
  // updated from liquid.js once per frame, never read back from WebGPU.
  const boatPosition = uniform(new THREE.Vector2(0, 0));
  const boatActive = uniform(0);
  const dx = positionWorld.x.sub(cameraPosition.x);
  const dz = positionWorld.z.sub(cameraPosition.z);
  const cameraD2 = dx.mul(dx).add(dz.mul(dz));
  const bx = positionWorld.x.sub(boatPosition.x);
  const bz = positionWorld.z.sub(boatPosition.y);
  const boatD2 = bx.mul(bx).add(bz.mul(bz));

  // Ramped local falloff avoids visible rings where the high-fidelity
  // material transitions into the existing FFT/Water-Pro shading.
  const cameraMask = float(1).sub(smoothstep(float(10 * 10), float(32 * 32), cameraD2));
  const boatMask = float(1).sub(smoothstep(float(4 * 4), float(17 * 17), boatD2))
    .mul(boatActive);
  const depthMask = float(1).sub(smoothstep(float(2.0), float(12.0), depth));
  const mask = max(cameraMask, boatMask).mul(depthMask)
    .mul(labHydro.coverage);

  // Reconstruct optical path from measured bathymetry PLUS the solver's
  // actual eta. A small floor prevents zero-depth optical singularities
  // where wetting/drying meets the sand.
  const eta = labHydro.state.x;
  const flowX = labHydro.state.y;
  const flowZ = labHydro.state.z;
  const flowAbs = abs(flowX).add(abs(flowZ));
  const fluidDepth = max(float(0.06), depth.add(eta));
  const opticalThickness = clamp(fluidDepth, 0.06, 20);
  const flowEnergy = clamp(flowAbs.mul(0.24)
    .add(abs(eta).mul(0.52)), 0, 1);
  const aeration = clamp(
    labHydro.state.w.mul(0.88)
      .add(smoothstep(float(0.7), float(2.5), flowAbs).mul(0.12)),
    0, 0.94,
  ).mul(mask);
  // Momentum of moving shallow water creates a subtle lens displacement.
  // Clamp to suppress box-grid shimmer on devices with a 240² mesh.
  const lensOffset = vec2(
    clamp(flowX.mul(0.0028), -0.008, 0.008),
    clamp(flowZ.mul(-0.0028), -0.008, 0.008),
  ).mul(mask).mul(float(1).sub(aeration.mul(0.5)));

  const waterPath = opticalThickness.div(float(0.68));
  const transmittance = exp(vec3(-0.17, -0.075, -0.034).mul(waterPath));
  const foamRoughness = aeration.mul(0.18).add(flowEnergy.mul(mask).mul(0.035));
  const clarity = clamp(
    float(0.86).sub(opticalThickness.mul(0.035))
      .sub(aeration.mul(0.56)),
    0.26, 0.89,
  ).mul(float(1).sub(underwater.mul(0.27)));

  handle.fftLocalBoatCenter = boatPosition;
  handle.fftLocalBoatActive = boatActive;
  handle.fftLocalLabOpticsActive = true;
  return {
    mask, opticalThickness, transmittance, aeration,
    flowEnergy, lensOffset, foamRoughness, clarity,
  };
}

export function updateFluidLabLocalOptics(handle, boatWake) {
  if (!handle?.fftLocalLabOpticsActive) return;
  const available = boatWake?.riding && Number.isFinite(boatWake.x) &&
    Number.isFinite(boatWake.z);
  if (handle.fftLocalBoatActive) {
    handle.fftLocalBoatActive.value = available ? 1 : 0;
  }
  if (available && handle.fftLocalBoatCenter?.value) {
    handle.fftLocalBoatCenter.value.set(boatWake.x, boatWake.z);
  }
}
