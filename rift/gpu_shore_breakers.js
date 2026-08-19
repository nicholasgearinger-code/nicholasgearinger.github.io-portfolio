import * as THREE from "three";
import {
  Fn, uniform, color, float, uint, vec2, vec3,
  positionLocal, positionView, positionWorld, positionViewDirection, cameraPosition,
  attribute, floor, min, max, abs, dFdx, dFdy, cross, dot, pow, mix, clamp,
  smoothstep, sin,
} from "three/tsl";

// -----------------------------------------------------------------------------
// 3D shoreline breaker ribbon
//
// The deep ocean and shoaling surface remain height fields, but an overturning
// crest cannot be represented by y=f(x,z). This mesh is a separate Lagrangian-
// style ribbon around the shoreline. It reads the live GPU shallow-water state
// (eta, velocityX, velocityZ, breaking energy) and uses that solved state to
// create the pitching lip. The mesh is visual geometry only; it does not replace
// the shallow-water equations that decide where/when breaking occurs.
// -----------------------------------------------------------------------------

const ALONG_SEGMENTS = 384;
const PROFILE_SEGMENTS = 28;
const INNER_OFFSET = 0.8;
const OUTER_OFFSET = 17.0;

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

  // Search from the island center outward. The first dry->wet transition is the
  // principal shoreline for this polar direction. Small 1.5-unit steps keep the
  // ribbon stable on irregular beaches without an expensive contouring pass.
  for (let r = 7.5; r <= maxRadius; r += 1.5) {
    const ground = sampleHeight(ca * r, sa * r);
    if (!Number.isFinite(ground)) continue;
    const wet = ground < waterY - 0.08;
    if (!previousWet && wet) {
      let lo = previousR, hi = r;
      for (let k = 0; k < 7; k++) {
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
    const angle = (a / along) * Math.PI * 2;
    shoreRadii[a] = findShoreRadius(sampleHeight, waterY, angle, maxRadius);
  }
  shoreRadii[along] = shoreRadii[0];

  let v = 0;
  for (let a = 0; a <= along; a++) {
    const angle = (a / along) * Math.PI * 2;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const radius = shoreRadii[a];

    // For an island, inward radial direction is a stable first-order shoreline
    // normal. The solved shallow-water velocity still determines whether a crest
    // is energetic enough to pitch, so this direction only orients the ribbon.
    const inwardX = -ca;
    const inwardZ = -sa;

    for (let p = 0; p <= profile; p++) {
      const t = p / profile;
      // Slightly ease physical spacing toward the crest region so the fold has
      // more geometry than the outer tail/wash portion.
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

function sampleSmoothState(buffer, coord, N) {
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
  if (!scene || !shallowHandle?.gpuShallowWater || !shallowHandle.state) return null;

  const geometry = buildBreakerGeometry(
    sampleHeight,
    waterY,
    shallowHandle.domain,
    shallowHandle.N,
  );

  const material = new THREE.MeshStandardNodeMaterial({
    color: 0x2b8ea0,
    roughness: 0.10,
    metalness: 0.0,
    transparent: true,
    opacity: 0.86,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const time = uniform(0.0);
  const storm = uniform(0.0);
  const daylight = uniform(1.0);
  const underwater = uniform(0.0);
  const lightDirection = uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const waterColor = uniform(color(0x167e91));
  const lipColor = uniform(color(0x8edce0));
  const foamColor = uniform(color(0xf1f6f3));

  const coord = attribute("breakerShallowCoord", "vec2");
  const profile = attribute("breakerProfile", "float");
  const shore = attribute("breakerShoreDir", "vec2");
  const phaseSeed = attribute("breakerPhase", "float");
  const state = shallowHandle.state;

  material.positionNode = Fn(() => {
    const s = sampleSmoothState(state, coord, shallowHandle.N);
    const eta = s.x;
    const velocity = vec2(s.y, s.z);
    const speed = velocity.length();
    const breaking = clamp(s.w, 0, 1);

    // Wave sets modulate an already physics-derived break. They do not create a
    // breaker by themselves; they only prevent the whole shoreline from firing
    // with identical strength on every frame.
    const setPulse = float(0.68).add(
      sin(time.mul(0.36).add(phaseSeed.mul(11.0))).mul(0.20)
    ).add(
      sin(time.mul(0.17).add(phaseSeed.mul(4.7)).add(1.8)).mul(0.12)
    );
    const energy = clamp(breaking.mul(setPulse).mul(float(0.84).add(storm.mul(0.52))), 0, 1);

    // Across-ribbon profile: offshore tail -> rising face -> lip -> shoreward
    // collapse. Concentrated smooth masks avoid the giant triangular wedges that
    // occurred when the main ocean mesh itself was forced to curl.
    const rise = smoothstep(float(0.18), float(0.55), profile)
      .mul(float(1).sub(smoothstep(float(0.82), float(1.0), profile)));
    const lip = smoothstep(float(0.48), float(0.72), profile)
      .mul(float(1).sub(smoothstep(float(0.76), float(0.98), profile)));
    const collapse = smoothstep(float(0.68), float(0.95), profile);

    const lift = rise.mul(energy).mul(float(1.9).add(speed.mul(0.08)));
    const pitch = lip.mul(energy).mul(float(2.9).add(speed.mul(0.11)));
    const lipDrop = collapse.mul(energy).mul(0.72);

    // The lip pitches toward shore. Because this is a separate ribbon, the top
    // can pass horizontally over lower profile vertices without destabilizing
    // the base FFT/shallow-water surface.
    const horizontal = pitch.sub(collapse.mul(energy).mul(0.55));
    return positionLocal.add(vec3(
      shore.x.mul(horizontal),
      eta.add(lift).sub(lipDrop).add(0.035),
      shore.y.mul(horizontal),
    ));
  })();

  const geometricNormal = Fn(() => {
    const dx = dFdx(positionView);
    const dy = dFdy(positionView);
    return cross(dx, dy).normalize();
  })();
  material.normalNode = geometricNormal;

  const sFrag = sampleSmoothState(state, coord, shallowHandle.N);
  const breakerEnergy = clamp(sFrag.w, 0, 1);
  const lipMask = smoothstep(float(0.48), float(0.66), profile)
    .mul(float(1).sub(smoothstep(float(0.80), float(0.97), profile)));
  const washMask = float(1).sub(smoothstep(float(0.26), float(0.72), profile));
  const foam = clamp(
    breakerEnergy.mul(lipMask.mul(1.35).add(washMask.mul(0.45)))
      .mul(float(1).sub(underwater.mul(0.82))),
    0,
    1,
  );

  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const worldNormal = Fn(() => {
    const dx = dFdx(positionWorld);
    const dy = dFdy(positionWorld);
    return cross(dx, dy).normalize();
  })();
  const fresnel = pow(
    float(1).sub(clamp(abs(dot(worldNormal, viewDir)), 0, 1)),
    float(3.4),
  );
  const lightFacing = clamp(dot(worldNormal, lightDirection.normalize()), 0, 1);

  material.colorNode = Fn(() => {
    const wet = mix(waterColor, lipColor, fresnel.mul(0.36).add(lightFacing.mul(daylight).mul(0.12)));
    return mix(wet, foamColor, foam.mul(0.94));
  })();
  material.roughnessNode = mix(float(0.08), float(0.48), foam.mul(0.96));
  material.emissiveNode = lipColor.mul(underwater.mul(daylight).mul(0.055))
    .add(foamColor.mul(foam.mul(0.008)));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = waterY;
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
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
  handle.waterColor.value.set(0x0a3140).lerp(new THREE.Color(0x167e91), day);
  handle.lipColor.value.set(0x365f73).lerp(new THREE.Color(0x8edce0), day);
  handle.foamColor.value.set(0x83949d).lerp(new THREE.Color(0xf1f6f3), day);
}

export function disposeGPUShoreBreakers(scene, handle) {
  if (!handle?.gpuShoreBreakers) return;
  if (handle.mesh) scene?.remove(handle.mesh);
  try { handle.geometry?.dispose?.(); } catch (_) {}
  try { handle.material?.dispose?.(); } catch (_) {}
}
