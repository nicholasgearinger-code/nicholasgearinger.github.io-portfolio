import * as THREE from "three";
import {
  Fn, uniform, color, float, uint, vec2, vec3,
  positionLocal, positionView, positionWorld, cameraPosition,
  attribute, floor, min, max, abs, dFdx, dFdy, cross, dot, pow, mix, clamp,
  smoothstep, sin, cos, sqrt,
} from "three/tsl";

// -----------------------------------------------------------------------------
// Smooth 3D shoreline breaker tubes
//
// Offshore FFT + shallow-water equations remain the physical source. A true
// overturning breaker cannot be represented by a single-valued height field, so
// this separate high-resolution ribbon maps the solved shallow-water state onto
// a rounded Lagrangian-style cross-section. The crest can therefore rise, roll
// past vertical, and fold shoreward without damaging the stable base ocean mesh.
// -----------------------------------------------------------------------------

const ALONG_SEGMENTS = 416;
const PROFILE_SEGMENTS = 56;
const INNER_OFFSET = 1.0;
const OUTER_OFFSET = 15.0;
const GRAVITY = 9.81;
const PI = Math.PI;

function smooth01(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function findShoreRadius(sampleHeight, waterY, angle, maxRadius) {
  if (!sampleHeight) return maxRadius * 0.45;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let previousR = 6;
  let previousGround = sampleHeight(ca * previousR, sa * previousR);
  let previousWet = Number.isFinite(previousGround) && previousGround < waterY - 0.08;

  for (let r = 7.25; r <= maxRadius; r += 1.25) {
    const ground = sampleHeight(ca * r, sa * r);
    if (!Number.isFinite(ground)) continue;
    const wet = ground < waterY - 0.08;
    if (!previousWet && wet) {
      let lo = previousR, hi = r;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) * 0.5;
        const g = sampleHeight(ca * mid, sa * mid);
        if (Number.isFinite(g) && g < waterY - 0.08) hi = mid;
        else lo = mid;
      }
      return (lo + hi) * 0.5;
    }
    previousR = r;
    previousWet = wet;
  }
  return maxRadius * 0.45;
}

function buildBreakerGeometry(sampleHeight, waterY, shallowDomain, shallowN) {
  const along = ALONG_SEGMENTS;
  const profile = PROFILE_SEGMENTS;
  const vertexCount = (along + 1) * (profile + 1);
  const positions = new Float32Array(vertexCount * 3);
  const shallowCoords = new Float32Array(vertexCount * 2);
  const profileT = new Float32Array(vertexCount);
  const shoreDir = new Float32Array(vertexCount * 2);
  const shorePhase = new Float32Array(vertexCount);
  const indices = new Uint32Array(along * profile * 6);
  const maxRadius = shallowDomain * 0.48;

  const shoreRadii = new Float32Array(along + 1);
  for (let a = 0; a <= along; a++) {
    const angle = (a / along) * PI * 2;
    shoreRadii[a] = findShoreRadius(sampleHeight, waterY, angle, maxRadius);
  }
  shoreRadii[along] = shoreRadii[0];

  // Smooth the polar shoreline contour before building the ribbon. This removes
  // little terrain-sampling kinks that would otherwise show up as faceted crests.
  const smoothed = new Float32Array(shoreRadii.length);
  for (let a = 0; a < along; a++) {
    let sum = 0, weight = 0;
    for (let k = -4; k <= 4; k++) {
      const idx = (a + k + along) % along;
      const w = 5 - Math.abs(k);
      sum += shoreRadii[idx] * w;
      weight += w;
    }
    smoothed[a] = sum / weight;
  }
  smoothed[along] = smoothed[0];

  let v = 0;
  for (let a = 0; a <= along; a++) {
    const angle = (a / along) * PI * 2;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const radius = smoothed[a];
    const inwardX = -ca;
    const inwardZ = -sa;

    for (let p = 0; p <= profile; p++) {
      const t = p / profile;
      // Dense spacing around the crest, slightly broader spacing in the wash.
      const e = smooth01(t);
      const offset = INNER_OFFSET + (OUTER_OFFSET - INNER_OFFSET) * e;
      const x = ca * (radius + offset);
      const z = sa * (radius + offset);

      positions[v * 3] = x;
      positions[v * 3 + 1] = 0;
      positions[v * 3 + 2] = z;
      shallowCoords[v * 2] = THREE.MathUtils.clamp((x / shallowDomain + 0.5) * (shallowN - 1), 0, shallowN - 1);
      shallowCoords[v * 2 + 1] = THREE.MathUtils.clamp((z / shallowDomain + 0.5) * (shallowN - 1), 0, shallowN - 1);
      profileT[v] = t;
      shoreDir[v * 2] = inwardX;
      shoreDir[v * 2 + 1] = inwardZ;
      shorePhase[v] = a / along;
      v++;
    }
  }

  let q = 0;
  const row = profile + 1;
  for (let a = 0; a < along; a++) {
    for (let p = 0; p < profile; p++) {
      const i0 = a * row + p;
      const i1 = i0 + 1;
      const i2 = (a + 1) * row + p;
      const i3 = i2 + 1;
      indices[q++] = i0; indices[q++] = i2; indices[q++] = i1;
      indices[q++] = i1; indices[q++] = i2; indices[q++] = i3;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("breakerShallowCoord", new THREE.BufferAttribute(shallowCoords, 2));
  geometry.setAttribute("breakerProfile", new THREE.BufferAttribute(profileT, 1));
  geometry.setAttribute("breakerShoreDir", new THREE.BufferAttribute(shoreDir, 2));
  geometry.setAttribute("breakerPhase", new THREE.BufferAttribute(shorePhase, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function smoothWeight(t) {
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

function sampleSmooth(buffer, coord, N) {
  const x0f = floor(coord.x);
  const z0f = floor(coord.y);
  const x1f = min(x0f.add(1), float(N - 1));
  const z1f = min(z0f.add(1), float(N - 1));
  const tx = smoothWeight(coord.x.sub(x0f));
  const tz = smoothWeight(coord.y.sub(z0f));
  const row = uint(N);
  const i00 = z0f.toUint().mul(row).add(x0f.toUint());
  const i10 = z0f.toUint().mul(row).add(x1f.toUint());
  const i01 = z1f.toUint().mul(row).add(x0f.toUint());
  const i11 = z1f.toUint().mul(row).add(x1f.toUint());
  const a0 = mix(buffer.element(i00), buffer.element(i10), tx);
  const a1 = mix(buffer.element(i01), buffer.element(i11), tx);
  return mix(a0, a1, tz);
}

export function createGPUShoreBreakers(scene, sampleHeight, waterY, shallowHandle) {
  if (!scene || !shallowHandle?.gpuShallowWater || !shallowHandle.state || !shallowHandle.bathymetry) return null;

  const geometry = buildBreakerGeometry(sampleHeight, waterY, shallowHandle.domain, shallowHandle.N);
  const material = new THREE.MeshStandardNodeMaterial({
    color: 0x2b8ea0,
    roughness: 0.085,
    metalness: 0.0,
    transparent: true,
    opacity: 0.91,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const time = uniform(0.0);
  const storm = uniform(0.0);
  const daylight = uniform(1.0);
  const underwater = uniform(0.0);
  const lightDirection = uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const waterColor = uniform(color(0x167e91));
  const lipColor = uniform(color(0x91e4e6));
  const foamColor = uniform(color(0xf3f8f5));

  const coord = attribute("breakerShallowCoord", "vec2");
  const profile = attribute("breakerProfile", "float");
  const shore = attribute("breakerShoreDir", "vec2");
  const phaseSeed = attribute("breakerPhase", "float");
  const state = shallowHandle.state;
  const bathymetry = shallowHandle.bathymetry;

  const breakerTerms = Fn(() => {
    const s = sampleSmooth(state, coord, shallowHandle.N);
    const b = sampleSmooth(bathymetry, coord, shallowHandle.N);
    const depth = max(b.x.add(s.x), float(0.08));
    const speed = vec2(s.y, s.z).length();
    const celerity = sqrt(float(GRAVITY).mul(depth));
    const froude = speed.div(max(celerity, float(0.05)));
    const relativeHeight = abs(s.x).div(max(b.x, float(0.20)));
    const depthBand = smoothstep(float(0.18), float(0.65), b.x)
      .mul(float(1).sub(smoothstep(float(5.2), float(8.5), b.x)));
    const dynamicBreak = max(
      smoothstep(float(0.30), float(0.66), relativeHeight),
      smoothstep(float(0.52), float(0.92), froude),
    ).mul(depthBand);
    const physicalEnergy = clamp(max(s.w, dynamicBreak), 0, 1);
    return vec3(physicalEnergy, speed, s.x);
  });

  material.positionNode = Fn(() => {
    const terms = breakerTerms();
    const breaking = terms.x;
    const speed = terms.y;
    const eta = terms.z;

    const setPulse = float(0.80)
      .add(sin(time.mul(0.31).add(phaseSeed.mul(8.7))).mul(0.12))
      .add(sin(time.mul(0.14).add(phaseSeed.mul(3.1)).add(2.2)).mul(0.08));
    const energy = clamp(
      breaking.mul(setPulse).mul(float(1.05).add(storm.mul(0.42))),
      0,
      1,
    );

    // Tube cross-section. The active section rotates through roughly 270°:
    // lower face -> vertical crest -> overhanging lip -> downward crash.
    const tubeT = clamp(profile.sub(0.22).div(0.66), 0, 1);
    const tubeMask = smoothstep(float(0.16), float(0.30), profile)
      .mul(float(1).sub(smoothstep(float(0.90), float(0.99), profile)));
    const theta = tubeT.mul(float(PI * 1.52));

    const radius = energy.mul(float(2.15).add(speed.mul(0.14)));
    const arcForward = sin(theta).mul(radius);
    const arcLift = float(1).sub(cos(theta)).mul(radius);

    // The upper lip is pushed farther shoreward and then allowed to fall. This
    // makes the profile non-monotonic in X/Z, which is the actual geometric
    // requirement for a visible tube rather than another peaked height field.
    const lip = smoothstep(float(0.58), float(0.75), tubeT);
    const lipForward = lip.mul(energy).mul(float(1.7).add(speed.mul(0.10)));
    const crash = smoothstep(float(0.78), float(0.99), tubeT);
    const crashDrop = crash.mul(energy).mul(float(1.35).add(speed.mul(0.05)));

    // Calm portions collapse almost exactly onto the solved shallow surface.
    const horizontal = arcForward.mul(tubeMask).add(lipForward);
    const vertical = arcLift.mul(tubeMask).sub(crashDrop);
    return positionLocal.add(vec3(
      shore.x.mul(horizontal),
      eta.add(vertical).add(energy.mul(0.06)).add(0.025),
      shore.y.mul(horizontal),
    ));
  })();

  const geometricNormal = Fn(() => {
    const dx = dFdx(positionView);
    const dy = dFdy(positionView);
    return cross(dx, dy).normalize();
  })();
  material.normalNode = geometricNormal;

  const termsFrag = breakerTerms();
  const breakerEnergy = termsFrag.x;
  const tubeTFrag = clamp(profile.sub(0.22).div(0.66), 0, 1);
  const lipFoam = smoothstep(float(0.54), float(0.68), tubeTFrag)
    .mul(float(1).sub(smoothstep(float(0.86), float(0.98), tubeTFrag)));
  const impactFoam = smoothstep(float(0.77), float(0.98), tubeTFrag);
  const washFoam = float(1).sub(smoothstep(float(0.12), float(0.44), profile));
  const foam = clamp(
    breakerEnergy.mul(
      lipFoam.mul(1.55)
        .add(impactFoam.mul(1.05))
        .add(washFoam.mul(0.55))
    ).mul(float(1).sub(underwater.mul(0.84))),
    0,
    1,
  );

  const worldNormal = Fn(() => {
    const dx = dFdx(positionWorld);
    const dy = dFdy(positionWorld);
    return cross(dx, dy).normalize();
  })();
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = pow(float(1).sub(clamp(abs(dot(worldNormal, viewDir)), 0, 1)), float(3.2));
  const lightFacing = clamp(dot(worldNormal, lightDirection.normalize()), 0, 1);

  material.colorNode = Fn(() => {
    const translucentLip = mix(
      waterColor,
      lipColor,
      clamp(fresnel.mul(0.42).add(lightFacing.mul(daylight).mul(0.16)), 0, 0.60),
    );
    return mix(translucentLip, foamColor, foam.mul(0.96));
  })();
  material.roughnessNode = mix(float(0.07), float(0.50), foam.mul(0.97));
  material.emissiveNode = lipColor.mul(underwater.mul(daylight).mul(0.065))
    .add(foamColor.mul(foam.mul(0.010)));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = waterY;
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  scene.add(mesh);

  return {
    gpuShoreBreakers: true,
    mesh,
    geometry,
    material,
    time,
    storm,
    daylight,
    underwater,
    lightDirection,
    waterColor,
    lipColor,
    foamColor,
  };
}

export function updateGPUShoreBreakers(handle, elapsed, cameraY, waterY, stormAmount = 0, dayAmount = 1, sunDir = null) {
  if (!handle?.gpuShoreBreakers) return;
  handle.time.value = Number.isFinite(elapsed) ? elapsed : 0;
  handle.storm.value = THREE.MathUtils.clamp(stormAmount, 0, 1);
  handle.daylight.value = THREE.MathUtils.clamp(dayAmount, 0, 1);
  handle.underwater.value = Number.isFinite(cameraY) && cameraY < waterY - 0.12 ? 1 : 0;
  if (sunDir && handle.lightDirection?.value) handle.lightDirection.value.copy(sunDir).normalize();

  const day = handle.daylight.value;
  handle.waterColor.value.set(0x092b36).lerp(new THREE.Color(0x167e91), day);
  handle.lipColor.value.set(0x31566c).lerp(new THREE.Color(0x91e4e6), day);
  handle.foamColor.value.set(0x82939b).lerp(new THREE.Color(0xf3f8f5), day);
}

export function disposeGPUShoreBreakers(scene, handle) {
  if (!handle?.gpuShoreBreakers) return;
  if (handle.mesh) scene?.remove(handle.mesh);
  try { handle.geometry?.dispose?.(); } catch (_) {}
  try { handle.material?.dispose?.(); } catch (_) {}
}
