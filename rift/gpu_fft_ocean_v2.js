import * as THREE from "three";
import {
  createGPUFFTOceanPlane as createBaseOcean,
  updateGPUFFTOcean as updateBaseOcean,
  updateGPUFFTOceanVisuals as updateBaseVisuals,
  disposeGPUFFTOcean as disposeBaseOcean,
} from "./gpu_fft_ocean.js";
import {
  Fn, uniform, color, float, uint, vec3,
  positionLocal, positionView, positionWorld, positionViewDirection, cameraPosition,
  attribute, floor, min, dFdx, dFdy, cross, dot, abs, pow, mix, clamp, smoothstep,
} from "three/tsl";

const FFT_N = 128;
const RENDER_N = 320;
const DETAIL_DOMAIN = 420;

const DAY_SURFACE = new THREE.Color(0x0b3c49);
const NIGHT_SURFACE = new THREE.Color(0x06151f);
const STORM_SURFACE = new THREE.Color(0x06191d);
const DAY_CREST = new THREE.Color(0xdceceb);
const NIGHT_CREST = new THREE.Color(0x6f8fa0);
const DAY_FOAM = new THREE.Color(0xf1f6f3);
const NIGHT_FOAM = new THREE.Color(0x8ca1aa);
const DAY_UNDERWATER = new THREE.Color(0x168da0);
const NIGHT_UNDERWATER = new THREE.Color(0x082e48);

function positiveFract(v) {
  return ((v % 1) + 1) % 1;
}

function buildDenseRenderGeometry(size, waterY, sampleHeight) {
  const geometry = new THREE.PlaneGeometry(size, size, RENDER_N - 1, RENDER_N - 1);
  geometry.rotateX(-Math.PI / 2);

  const count = geometry.attributes.position.count;
  const longCoords = new Float32Array(count * 2);
  const detailCoords = new Float32Array(count * 2);
  const shore = new Float32Array(count);
  const pos = geometry.attributes.position;

  for (let ry = 0; ry < RENDER_N; ry++) {
    const fy = ry * (FFT_N - 1) / (RENDER_N - 1);
    for (let rx = 0; rx < RENDER_N; rx++) {
      const fx = rx * (FFT_N - 1) / (RENDER_N - 1);
      const i = ry * RENDER_N + rx;
      longCoords[i * 2] = fx;
      longCoords[i * 2 + 1] = fy;

      const x = pos.getX(i);
      const z = pos.getZ(i);
      // The short-wave cascade is periodic over a much smaller physical
      // domain. Long swell underneath breaks up the repetition visually.
      detailCoords[i * 2] = positiveFract(x / DETAIL_DOMAIN + 0.5) * FFT_N;
      detailCoords[i * 2 + 1] = positiveFract(z / DETAIL_DOMAIN + 0.5) * FFT_N;

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

  geometry.setAttribute("fftCoordLong", new THREE.Float32BufferAttribute(longCoords, 2));
  geometry.setAttribute("fftCoordDetail", new THREE.Float32BufferAttribute(detailCoords, 2));
  geometry.setAttribute("fftShoreDense", new THREE.Float32BufferAttribute(shore, 1));
  return geometry;
}

function installDualCascadeGeometry(handle, detailHandle, size, sampleHeight) {
  if (!handle?.gpuFFT || !detailHandle?.gpuFFT || handle.fftDenseGeometryApplied) return;
  const longA = handle.resources?.[8];
  const longB = handle.resources?.[9];
  const detailA = detailHandle.resources?.[8];
  const detailB = detailHandle.resources?.[9];
  if (!longA || !longB || !detailA || !detailB) return;

  const geometry = buildDenseRenderGeometry(size, handle.waterY ?? 0, sampleHeight);
  const longCoord = attribute("fftCoordLong", "vec2");
  const detailCoord = attribute("fftCoordDetail", "vec2");
  const shore = attribute("fftShoreDense", "float");

  handle.mesh.material.positionNode = Fn(() => {
    // Long-swell cascade: clamped at the finite 2000-unit ocean boundary.
    const lx0f = floor(longCoord.x);
    const lz0f = floor(longCoord.y);
    const lx1f = min(lx0f.add(1), float(FFT_N - 1));
    const lz1f = min(lz0f.add(1), float(FFT_N - 1));
    const ltx = longCoord.x.sub(lx0f);
    const ltz = longCoord.y.sub(lz0f);
    const lx0 = lx0f.toUint(), lx1 = lx1f.toUint();
    const lz0 = lz0f.toUint(), lz1 = lz1f.toUint();
    const row = uint(FFT_N);
    const li00 = lz0.mul(row).add(lx0);
    const li10 = lz0.mul(row).add(lx1);
    const li01 = lz1.mul(row).add(lx0);
    const li11 = lz1.mul(row).add(lx1);
    const la0 = mix(longA.element(li00), longA.element(li10), ltx);
    const la1 = mix(longA.element(li01), longA.element(li11), ltx);
    const la = mix(la0, la1, ltz);
    const lb0 = mix(longB.element(li00).x, longB.element(li10).x, ltx);
    const lb1 = mix(longB.element(li01).x, longB.element(li11).x, ltx);
    const ldz = mix(lb0, lb1, ltz);

    // Short-wave cascade: wraps cleanly across its 420-unit periodic domain.
    const dx0f = floor(detailCoord.x);
    const dz0f = floor(detailCoord.y);
    const dx1f = dx0f.add(1).mod(float(FFT_N));
    const dz1f = dz0f.add(1).mod(float(FFT_N));
    const dtx = detailCoord.x.sub(dx0f);
    const dtz = detailCoord.y.sub(dz0f);
    const dx0 = dx0f.toUint(), dx1 = dx1f.toUint();
    const dz0 = dz0f.toUint(), dz1 = dz1f.toUint();
    const di00 = dz0.mul(row).add(dx0);
    const di10 = dz0.mul(row).add(dx1);
    const di01 = dz1.mul(row).add(dx0);
    const di11 = dz1.mul(row).add(dx1);
    const da0 = mix(detailA.element(di00), detailA.element(di10), dtx);
    const da1 = mix(detailA.element(di01), detailA.element(di11), dtx);
    const da = mix(da0, da1, dtz);
    const db0 = mix(detailB.element(di00).x, detailB.element(di10).x, dtx);
    const db1 = mix(detailB.element(di01).x, detailB.element(di11).x, dtx);
    const ddz = mix(db0, db1, dtz);

    // Long cascade carries the silhouette; the smaller-domain cascade adds
    // curved secondary waves/chop without returning to Gerstner waves.
    const detailVertical = float(0.72);
    const detailHorizontal = float(0.58);
    return positionLocal.add(vec3(
      la.z.add(da.z.mul(detailHorizontal)).mul(shore),
      la.x.add(da.x.mul(detailVertical)).mul(shore),
      ldz.add(ddz.mul(detailHorizontal)).mul(shore),
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
  const crest = smoothstep(waterLevel.add(0.45), waterLevel.add(2.6), positionWorld.y);
  const slope = clamp(float(1).sub(abs(worldNormal.y)), 0, 1);
  const steepCrest = smoothstep(float(0.10), float(0.38), slope)
    .mul(smoothstep(float(0.24), float(0.82), crest));
  const whitecap = clamp(
    steepCrest.mul(foamStrength).mul(float(1).sub(underwaterMix.mul(0.86))),
    0, 1,
  );

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
    const foamed = mix(litWater, foamColor, whitecap.mul(0.78));
    return mix(foamed, glintColor, clamp(glint.mul(0.78), 0, 0.72));
  })();

  const baseRoughness = mix(float(0.18), float(0.04), fresnel.mul(0.82).add(glint.mul(0.18)));
  material.roughnessNode = mix(baseRoughness, float(0.40), whitecap.mul(0.90));
  material.emissiveNode = underwaterColor
    .mul(underwaterMix.mul(float(0.035).add(daylight.mul(0.085))))
    .add(foamColor.mul(whitecap.mul(0.01)));
  material.needsUpdate = true;

  handle.fftSurfaceColor = surfaceColor;
  handle.fftUnderwaterColor = underwaterColor;
  handle.fftCrestColor = crestColor;
  handle.fftFoamColor = foamColor;
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
  if (handle.fftFoamStrength) handle.fftFoamStrength.value = 0.62 + stormT * 0.76;
  if (sunDir && handle.fftLightDirection?.value) handle.fftLightDirection.value.copy(sunDir).normalize();
  if (handle.fftSurfaceColor?.value) {
    handle.fftSurfaceColor.value.copy(NIGHT_SURFACE).lerp(DAY_SURFACE, dayT).lerp(STORM_SURFACE, stormT * 0.72);
  }
  if (handle.fftCrestColor?.value) handle.fftCrestColor.value.copy(NIGHT_CREST).lerp(DAY_CREST, dayT);
  if (handle.fftFoamColor?.value) handle.fftFoamColor.value.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
  if (handle.fftUnderwaterColor?.value) handle.fftUnderwaterColor.value.copy(NIGHT_UNDERWATER).lerp(DAY_UNDERWATER, dayT);

  if (underwater) {
    if (handle.deepTint?.value) handle.deepTint.value.set(0x0b5e70);
    if (handle.shallowTint?.value) handle.shallowTint.value.set(0x4fd7df);
    if (handle.mesh?.material) { handle.mesh.material.opacity = 0.72; handle.mesh.material.metalness = 0.0; }
  } else {
    if (handle.deepTint?.value) handle.deepTint.value.set(stormT > 0.45 ? 0x07191d : 0x082a31);
    if (handle.shallowTint?.value) handle.shallowTint.value.set(stormT > 0.45 ? 0x183b40 : 0x14535c);
    if (handle.mesh?.material) { handle.mesh.material.opacity = 0.965; handle.mesh.material.metalness = 0.012; }
  }
}

export function createGPUFFTOceanPlane(scene, y, size, sampleHeight) {
  const handle = createBaseOcean(scene, y, size, sampleHeight);
  if (!handle) return handle;

  // Second genuine FFT simulation dedicated to the shorter wave band.
  // Its render mesh is removed; only its GPU spectrum/displacement buffers are
  // sampled by the primary ocean mesh.
  const detailHandle = createBaseOcean(scene, y, DETAIL_DOMAIN, null);
  if (detailHandle?.mesh) {
    scene.remove(detailHandle.mesh);
    detailHandle.mesh.visible = false;
  }
  handle.fftDetailHandle = detailHandle;

  handle.waveScale.value = 43.0;
  if (detailHandle?.waveScale) detailHandle.waveScale.value = 31.0;
  handle.mesh.scale.y = 1.08;
  handle.fftVisualBoost = true;
  handle.fftUnderwater = false;

  installDualCascadeGeometry(handle, detailHandle, size, sampleHeight);
  handle.mesh.material.normalNode = null;
  handle.mesh.material.colorNode = null;
  setupSmoothFFTLighting(handle);
  applyPhotographicOceanLook(handle, false, 1, 0, null);

  console.info("[gpu-fft-ocean] ACTIVE: dual-cascade FFT swell + wind waves");
  return handle;
}

export function updateGPUFFTOcean(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuFFT) return;
  updateBaseOcean(handle, renderer, elapsedTime);
  if (handle.fftDetailHandle?.gpuFFT) updateBaseOcean(handle.fftDetailHandle, renderer, elapsedTime);
}

export function updateGPUFFTOceanVisuals(
  handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
  reflectionTexture, reflectionMatrix, refractionTexture, resolution,
  storm = 0, day = 1,
) {
  if (!handle?.gpuFFT) return;

  updateBaseVisuals(
    handle, elapsed, skyColor, cameraY, playerPos, sunDir, skyHorizon,
    reflectionTexture, reflectionMatrix, refractionTexture, resolution, storm, day,
  );
  setupSmoothFFTLighting(handle);

  const stormT = Math.max(0, Math.min(1, storm));
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.12;
  const longSet = Math.sin(elapsed * 0.071 + 0.4) * 2.3;
  const detailSet = Math.sin(elapsed * 0.173 + 1.9) * 2.1;

  handle.waveScale.value = 43.0 + longSet + stormT * 11.0;
  if (handle.fftDetailHandle?.waveScale) {
    handle.fftDetailHandle.waveScale.value = 31.0 + detailSet + stormT * 12.0;
  }
  handle.mesh.scale.y = 1.08 + stormT * 0.08;

  if (handle.fftUnderwater !== underwater) handle.fftUnderwater = underwater;
  applyPhotographicOceanLook(handle, underwater, day, storm, sunDir);
}

export function disposeGPUFFTOcean(scene, handle) {
  const detail = handle?.fftDetailHandle;
  if (handle) handle.fftDetailHandle = null;
  if (detail?.gpuFFT) disposeBaseOcean(scene, detail);
  return disposeBaseOcean(scene, handle);
}
