import * as THREE from "three";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";
import {
  Fn, uniform, color, float, uint, vec2, vec3,
  positionLocal, positionView, positionWorld, positionViewDirection, cameraPosition,
  attribute, floor, min, dFdx, dFdy, cross, dot, abs, pow, mix, clamp, smoothstep,
} from "three/tsl";

const FFT_N = 128;
const RENDER_N = 256;

const DAY_SURFACE = new THREE.Color(0x0b3c49);
const NIGHT_SURFACE = new THREE.Color(0x06151f);
const STORM_SURFACE = new THREE.Color(0x06191d);
const DAY_CREST = new THREE.Color(0xdceceb);
const NIGHT_CREST = new THREE.Color(0x6f8fa0);
const DAY_FOAM = new THREE.Color(0xf1f6f3);
const NIGHT_FOAM = new THREE.Color(0x8ca1aa);
const DAY_UNDERWATER = new THREE.Color(0x168da0);
const NIGHT_UNDERWATER = new THREE.Color(0x082e48);

function buildDenseRenderGeometry(size, waterY, sampleHeight) {
  const geometry = new THREE.PlaneGeometry(size, size, RENDER_N - 1, RENDER_N - 1);
  geometry.rotateX(-Math.PI / 2);

  const count = geometry.attributes.position.count;
  const coords = new Float32Array(count * 2);
  const shore = new Float32Array(count);
  const pos = geometry.attributes.position;

  for (let ry = 0; ry < RENDER_N; ry++) {
    const fy = ry * (FFT_N - 1) / (RENDER_N - 1);
    for (let rx = 0; rx < RENDER_N; rx++) {
      const fx = rx * (FFT_N - 1) / (RENDER_N - 1);
      const i = ry * RENDER_N + rx;
      coords[i * 2] = fx;
      coords[i * 2 + 1] = fy;

      const x = pos.getX(i);
      const z = pos.getZ(i);
      const groundY = sampleHeight ? sampleHeight(x, z) : null;
      const signedDepth = groundY === null ? 8 : waterY - groundY;
      if (signedDepth <= -0.55) shore[i] = 0;
      else if (signedDepth < 0) {
        const t = (signedDepth + 0.55) / 0.55;
        shore[i] = t * t * (3 - 2 * t) * 0.18;
      } else {
        const t = THREE.MathUtils.clamp(signedDepth / 3.5, 0, 1);
        const e = t * t * (3 - 2 * t);
        shore[i] = 0.18 + e * 0.82;
      }
    }
  }

  geometry.setAttribute("fftCoord", new THREE.Float32BufferAttribute(coords, 2));
  geometry.setAttribute("fftShoreDense", new THREE.Float32BufferAttribute(shore, 1));
  return geometry;
}

function installDenseFFTGeometry(handle, size, sampleHeight) {
  if (!handle?.gpuFFT || handle.fftDenseGeometryApplied) return;
  const spatialA = handle.resources?.[8];
  const spatialB = handle.resources?.[9];
  if (!spatialA || !spatialB) return;

  const geometry = buildDenseRenderGeometry(size, handle.waterY ?? 0, sampleHeight);
  const coord = attribute("fftCoord", "vec2");
  const shore = attribute("fftShoreDense", "float");

  handle.mesh.material.positionNode = Fn(() => {
    const x0f = floor(coord.x);
    const z0f = floor(coord.y);
    const x1f = min(x0f.add(1), float(FFT_N - 1));
    const z1f = min(z0f.add(1), float(FFT_N - 1));
    const tx = coord.x.sub(x0f);
    const tz = coord.y.sub(z0f);

    const x0 = x0f.toUint();
    const x1 = x1f.toUint();
    const z0 = z0f.toUint();
    const z1 = z1f.toUint();
    const row = uint(FFT_N);

    const i00 = z0.mul(row).add(x0);
    const i10 = z0.mul(row).add(x1);
    const i01 = z1.mul(row).add(x0);
    const i11 = z1.mul(row).add(x1);

    const a00 = spatialA.element(i00);
    const a10 = spatialA.element(i10);
    const a01 = spatialA.element(i01);
    const a11 = spatialA.element(i11);
    const b00 = spatialB.element(i00).x;
    const b10 = spatialB.element(i10).x;
    const b01 = spatialB.element(i01).x;
    const b11 = spatialB.element(i11).x;

    const a0 = mix(a00, a10, tx);
    const a1 = mix(a01, a11, tx);
    const a = mix(a0, a1, tz);
    const b0 = mix(b00, b10, tx);
    const b1 = mix(b01, b11, tx);
    const dz = mix(b0, b1, tz);

    return positionLocal.add(vec3(
      a.z.mul(shore),
      a.x.mul(shore),
      dz.mul(shore),
    ));
  })();

  const oldGeometry = handle.mesh.geometry;
  handle.mesh.geometry = geometry;
  oldGeometry.dispose();
  handle.mesh.material.needsUpdate = true;
  handle.fftDenseGeometryApplied = true;
}

function setupSmoothFFTLighting(handle) {
  const material = handle?.mesh?.material;
  if (!material || handle.fftSmoothLightingApplied) return;

  const surfaceColor = uniform(color(0x0b3138));
  const underwaterColor = uniform(color(0x168da0));
  const crestColor = uniform(color(0xdceceb));
  const foamColor = uniform(color(0xf1f6f3));
  const sunGlintColor = uniform(color(0xfff0d4));
  const moonGlintColor = uniform(color(0xa8cbea));
  const lightDirection = uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const daylight = uniform(1.0);
  const underwaterMix = uniform(0.0);
  const waterLevel = uniform(handle.waterY ?? 0);
  const foamStrength = uniform(1.0);

  const geometricNormal = Fn(() => {
    const dx = dFdx(positionView);
    const dy = dFdy(positionView);
    return cross(dx, dy).normalize();
  })();

  const worldNormal = Fn(() => {
    const dx = dFdx(positionWorld);
    const dy = dFdy(positionWorld);
    return cross(dx, dy).normalize();
  })();

  material.normalNode = geometricNormal;

  const fresnel = Fn(() => {
    const facing = clamp(abs(dot(geometricNormal, positionViewDirection)), 0, 1);
    return pow(float(1).sub(facing), float(4.2));
  })();

  const crest = smoothstep(
    waterLevel.add(0.45),
    waterLevel.add(2.6),
    positionWorld.y,
  );

  const slope = clamp(float(1).sub(abs(worldNormal.y)), 0, 1);
  const steepCrest = smoothstep(float(0.10), float(0.38), slope)
    .mul(smoothstep(float(0.24), float(0.82), crest));
  const whitecap = clamp(
    steepCrest.mul(foamStrength).mul(float(1).sub(underwaterMix.mul(0.86))),
    0,
    1,
  );

  // The direction passed by main.js is already blended between moon and sun.
  // Use it for a real moving glint lobe, with warm daylight and cool moonlight.
  const viewDirWorld = cameraPosition.sub(positionWorld).normalize();
  const halfDir = lightDirection.normalize().add(viewDirWorld).normalize();
  const directFacing = clamp(dot(worldNormal, lightDirection.normalize()), 0, 1);
  const glint = pow(clamp(dot(worldNormal, halfDir), 0, 1), float(72))
    .mul(float(0.12).add(daylight.mul(0.88)))
    .mul(float(1).sub(underwaterMix.mul(0.72)));
  const glintColor = mix(moonGlintColor, sunGlintColor, daylight);

  material.colorNode = Fn(() => {
    const base = mix(surfaceColor, underwaterColor, underwaterMix);
    const grazingLight = mix(base, crestColor, fresnel.mul(0.30));
    const crestLight = crest.mul(float(1).sub(underwaterMix)).mul(0.11);
    const directionalLift = directFacing.mul(daylight.mul(0.08).add(0.025));
    const litWater = mix(grazingLight, crestColor, crestLight.add(directionalLift));
    const foamed = mix(litWater, foamColor, whitecap.mul(0.82));
    return mix(foamed, glintColor, clamp(glint.mul(0.78), 0, 0.72));
  })();

  const baseRoughness = mix(
    float(0.18),
    float(0.04),
    fresnel.mul(0.82).add(glint.mul(0.18)),
  );
  material.roughnessNode = mix(baseRoughness, float(0.40), whitecap.mul(0.90));

  // Underwater radiance follows daylight smoothly instead of staying fixed.
  material.emissiveNode = underwaterColor
    .mul(underwaterMix.mul(float(0.035).add(daylight.mul(0.085))))
    .add(foamColor.mul(whitecap.mul(0.01)));

  material.needsUpdate = true;

  handle.fftSurfaceColor = surfaceColor;
  handle.fftUnderwaterColor = underwaterColor;
  handle.fftCrestColor = crestColor;
  handle.fftFoamColor = foamColor;
  handle.fftSunGlintColor = sunGlintColor;
  handle.fftMoonGlintColor = moonGlintColor;
  handle.fftLightDirection = lightDirection;
  handle.fftDaylight = daylight;
  handle.fftUnderwaterMix = underwaterMix;
  handle.fftFoamStrength = foamStrength;
  handle.fftSmoothLightingApplied = true;
}

function applyPhotographicOceanLook(handle, underwater = false, day = 1, storm = 0, sunDir = null) {
  if (!handle?.gpuFFT) return;

  const dayT = Math.max(0, Math.min(1, day));
  const stormT = Math.max(0, Math.min(1, storm));

  if (handle.fftDaylight) handle.fftDaylight.value = dayT;
  if (handle.fftUnderwaterMix) handle.fftUnderwaterMix.value = underwater ? 1 : 0;
  if (handle.fftFoamStrength) handle.fftFoamStrength.value = 0.78 + stormT * 0.72;

  if (sunDir && handle.fftLightDirection?.value) {
    handle.fftLightDirection.value.copy(sunDir).normalize();
  }

  if (handle.fftSurfaceColor?.value) {
    handle.fftSurfaceColor.value.copy(NIGHT_SURFACE).lerp(DAY_SURFACE, dayT).lerp(STORM_SURFACE, stormT * 0.72);
  }
  if (handle.fftCrestColor?.value) {
    handle.fftCrestColor.value.copy(NIGHT_CREST).lerp(DAY_CREST, dayT);
  }
  if (handle.fftFoamColor?.value) {
    handle.fftFoamColor.value.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
  }
  if (handle.fftUnderwaterColor?.value) {
    handle.fftUnderwaterColor.value.copy(NIGHT_UNDERWATER).lerp(DAY_UNDERWATER, dayT);
  }

  if (underwater) {
    if (handle.deepTint?.value) handle.deepTint.value.set(0x0b5e70);
    if (handle.shallowTint?.value) handle.shallowTint.value.set(0x4fd7df);
    if (handle.mesh?.material) {
      handle.mesh.material.opacity = 0.72;
      handle.mesh.material.metalness = 0.0;
    }
    return;
  }

  if (handle.deepTint?.value) handle.deepTint.value.set(stormT > 0.45 ? 0x07191d : 0x082a31);
  if (handle.shallowTint?.value) handle.shallowTint.value.set(stormT > 0.45 ? 0x183b40 : 0x14535c);
  if (handle.mesh?.material) {
    handle.mesh.material.opacity = 0.965;
    handle.mesh.material.metalness = 0.012;
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  handle.waveScale.value = 47.0;
  handle.mesh.scale.y = 1.12;
  handle.fftVisualBoost = true;
  handle.fftUnderwater = false;

  installDenseFFTGeometry(handle, size, sampleHeight);
  handle.mesh.material.normalNode = null;
  handle.mesh.material.colorNode = null;
  setupSmoothFFTLighting(handle);
  applyPhotographicOceanLook(handle, false, 1, 0, null);

  console.info("[gpu-fft-ocean] ACTIVE: dense interpolated FFT + day/night glint");
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  return updateBaseOcean(handle, renderer, elapsedTime);
}

export function updateGPUFFTOceanVisuals(
  handle,
  elapsed,
  skyColor,
  cameraY,
  playerPos,
  sunDir,
  skyHorizon,
  reflectionTexture,
  reflectionMatrix,
  refractionTexture,
  resolution,
  storm = 0,
  day = 1,
) {
  if (!handle?.gpuFFT) return;

  updateBaseVisuals(
    handle,
    elapsed,
    skyColor,
    cameraY,
    playerPos,
    sunDir,
    skyHorizon,
    reflectionTexture,
    reflectionMatrix,
    refractionTexture,
    resolution,
    storm,
    day,
  );

  setupSmoothFFTLighting(handle);

  const stormT = Math.max(0, Math.min(1, storm));
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.12;
  const longSet = Math.sin(elapsed * 0.071 + 0.4) * 3.4;
  const shortSet = Math.sin(elapsed * 0.193 + 2.1) * 1.7;

  handle.waveScale.value = 47.0 + longSet + shortSet + stormT * 15.0;
  handle.mesh.scale.y = 1.12 + stormT * 0.11;

  if (handle.fftUnderwater !== underwater) handle.fftUnderwater = underwater;
  applyPhotographicOceanLook(handle, underwater, day, storm, sunDir);
}

export function disposeGPUFFTOcean(scene, handle) {
  return disposeBaseOcean(scene, handle);
}
