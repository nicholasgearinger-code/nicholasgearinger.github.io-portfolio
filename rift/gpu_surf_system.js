import * as THREE from "three";
import {
  Fn, uniform, color, float, uint, vec2, vec3,
  positionLocal, positionView, positionWorld, cameraPosition,
  attribute, floor, min, max, abs, dFdx, dFdy, cross, dot, pow, mix, clamp,
  smoothstep, sin, cos, sqrt,
} from "three/tsl";

const PATCH_COUNT = 32;
const BREAKER_ALONG = 14;
const BREAKER_PROFILE = 14;
const BREAKER_HALF_LENGTH = 8.0;
const BREAKER_INNER = 0.8;
const BREAKER_OUTER = 10.0;
const WASH_ALONG = 8;
const WASH_PROFILE = 12;
const WASH_OFFSHORE = 4.0;
const WASH_LANDWARD = 8.0;
const SPRAY_COUNT = 112;
const GRAVITY = 9.81;
const TAU = Math.PI * 2;

function smooth01(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function findShoreRadius(sampleHeight, waterY, angle, maxRadius) {
  if (!sampleHeight) return maxRadius * 0.45;
  const ca = Math.cos(angle);
  const sa = Math.sin(angle);
  let previousR = 5.0;
  let previousGround = sampleHeight(ca * previousR, sa * previousR);
  let previousWet = Number.isFinite(previousGround) && previousGround < waterY - 0.06;

  for (let r = 6.0; r <= maxRadius; r += 1.0) {
    const ground = sampleHeight(ca * r, sa * r);
    if (!Number.isFinite(ground)) continue;
    const wet = ground < waterY - 0.06;
    if (!previousWet && wet) {
      let lo = previousR;
      let hi = r;
      for (let k = 0; k < 7; k++) {
        const mid = (lo + hi) * 0.5;
        const g = sampleHeight(ca * mid, sa * mid);
        if (Number.isFinite(g) && g < waterY - 0.06) hi = mid;
        else lo = mid;
      }
      return (lo + hi) * 0.5;
    }
    previousR = r;
    previousWet = wet;
  }
  return maxRadius * 0.45;
}

function buildShorePatches(sampleHeight, waterY, shallowDomain) {
  const maxRadius = shallowDomain * 0.48;
  const patches = [];
  const raw = new Float32Array(PATCH_COUNT);

  for (let i = 0; i < PATCH_COUNT; i++) {
    const angle = (i / PATCH_COUNT) * TAU;
    raw[i] = findShoreRadius(sampleHeight, waterY, angle, maxRadius);
  }

  // Small circular smoothing pass keeps each local patch aligned to the beach
  // while avoiding the kinks that made the old continuous ribbon look faceted.
  const radii = new Float32Array(PATCH_COUNT);
  for (let i = 0; i < PATCH_COUNT; i++) {
    const im2 = (i - 2 + PATCH_COUNT) % PATCH_COUNT;
    const im1 = (i - 1 + PATCH_COUNT) % PATCH_COUNT;
    const ip1 = (i + 1) % PATCH_COUNT;
    const ip2 = (i + 2) % PATCH_COUNT;
    radii[i] = (raw[im2] + raw[ip2] + 2 * (raw[im1] + raw[ip1]) + 3 * raw[i]) / 9;
  }

  for (let i = 0; i < PATCH_COUNT; i++) {
    const angle = (i / PATCH_COUNT) * TAU;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    patches.push({
      index: i,
      phase: i / PATCH_COUNT,
      angle,
      cx: ca * radii[i],
      cz: sa * radii[i],
      outwardX: ca,
      outwardZ: sa,
      inwardX: -ca,
      inwardZ: -sa,
      tangentX: -sa,
      tangentZ: ca,
    });
  }
  return patches;
}

function toShallowCoord(x, z, domain, N) {
  return [
    THREE.MathUtils.clamp((x / domain + 0.5) * (N - 1), 0, N - 1),
    THREE.MathUtils.clamp((z / domain + 0.5) * (N - 1), 0, N - 1),
  ];
}

function buildBreakerGeometry(patches, shallowDomain, shallowN) {
  const vertsPerPatch = (BREAKER_ALONG + 1) * (BREAKER_PROFILE + 1);
  const quadsPerPatch = BREAKER_ALONG * BREAKER_PROFILE;
  const vertexCount = PATCH_COUNT * vertsPerPatch;
  const positions = new Float32Array(vertexCount * 3);
  const coords = new Float32Array(vertexCount * 2);
  const profiles = new Float32Array(vertexCount);
  const shoreDirs = new Float32Array(vertexCount * 2);
  const phases = new Float32Array(vertexCount);
  const indices = new Uint32Array(PATCH_COUNT * quadsPerPatch * 6);

  let v = 0;
  let q = 0;
  for (const patch of patches) {
    const baseVertex = v;
    for (let a = 0; a <= BREAKER_ALONG; a++) {
      const alongT = a / BREAKER_ALONG;
      const along = (alongT * 2 - 1) * BREAKER_HALF_LENGTH;
      for (let p = 0; p <= BREAKER_PROFILE; p++) {
        const t = p / BREAKER_PROFILE;
        const eased = smooth01(t);
        const radial = THREE.MathUtils.lerp(BREAKER_OUTER, BREAKER_INNER, eased);
        const x = patch.cx + patch.tangentX * along + patch.outwardX * radial;
        const z = patch.cz + patch.tangentZ * along + patch.outwardZ * radial;
        const sc = toShallowCoord(x, z, shallowDomain, shallowN);

        positions[v * 3] = x;
        positions[v * 3 + 1] = 0;
        positions[v * 3 + 2] = z;
        coords[v * 2] = sc[0];
        coords[v * 2 + 1] = sc[1];
        profiles[v] = t;
        shoreDirs[v * 2] = patch.inwardX;
        shoreDirs[v * 2 + 1] = patch.inwardZ;
        phases[v] = patch.phase;
        v++;
      }
    }

    const row = BREAKER_PROFILE + 1;
    for (let a = 0; a < BREAKER_ALONG; a++) {
      for (let p = 0; p < BREAKER_PROFILE; p++) {
        const i0 = baseVertex + a * row + p;
        const i1 = i0 + 1;
        const i2 = baseVertex + (a + 1) * row + p;
        const i3 = i2 + 1;
        indices[q++] = i0; indices[q++] = i2; indices[q++] = i1;
        indices[q++] = i1; indices[q++] = i2; indices[q++] = i3;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("surfCoord", new THREE.BufferAttribute(coords, 2));
  geometry.setAttribute("surfProfile", new THREE.BufferAttribute(profiles, 1));
  geometry.setAttribute("surfShoreDir", new THREE.BufferAttribute(shoreDirs, 2));
  geometry.setAttribute("surfPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildWashGeometry(patches, sampleHeight, waterY, shallowDomain, shallowN) {
  const vertsPerPatch = (WASH_ALONG + 1) * (WASH_PROFILE + 1);
  const quadsPerPatch = WASH_ALONG * WASH_PROFILE;
  const vertexCount = PATCH_COUNT * vertsPerPatch;
  const positions = new Float32Array(vertexCount * 3);
  const sourceCoords = new Float32Array(vertexCount * 2);
  const profiles = new Float32Array(vertexCount);
  const phases = new Float32Array(vertexCount);
  const indices = new Uint32Array(PATCH_COUNT * quadsPerPatch * 6);

  let v = 0;
  let q = 0;
  for (const patch of patches) {
    const sourceX = patch.cx + patch.outwardX * 2.3;
    const sourceZ = patch.cz + patch.outwardZ * 2.3;
    const sourceCoord = toShallowCoord(sourceX, sourceZ, shallowDomain, shallowN);
    const baseVertex = v;

    for (let a = 0; a <= WASH_ALONG; a++) {
      const along = (a / WASH_ALONG * 2 - 1) * (BREAKER_HALF_LENGTH * 1.05);
      for (let p = 0; p <= WASH_PROFILE; p++) {
        const t = p / WASH_PROFILE;
        const radial = THREE.MathUtils.lerp(WASH_OFFSHORE, -WASH_LANDWARD, smooth01(t));
        const x = patch.cx + patch.tangentX * along + patch.outwardX * radial;
        const z = patch.cz + patch.tangentZ * along + patch.outwardZ * radial;
        const ground = sampleHeight ? sampleHeight(x, z) : waterY - 1;
        const y = Number.isFinite(ground)
          ? Math.max(waterY + 0.025, ground + 0.045)
          : waterY + 0.025;

        positions[v * 3] = x;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = z;
        sourceCoords[v * 2] = sourceCoord[0];
        sourceCoords[v * 2 + 1] = sourceCoord[1];
        profiles[v] = t;
        phases[v] = patch.phase;
        v++;
      }
    }

    const row = WASH_PROFILE + 1;
    for (let a = 0; a < WASH_ALONG; a++) {
      for (let p = 0; p < WASH_PROFILE; p++) {
        const i0 = baseVertex + a * row + p;
        const i1 = i0 + 1;
        const i2 = baseVertex + (a + 1) * row + p;
        const i3 = i2 + 1;
        indices[q++] = i0; indices[q++] = i2; indices[q++] = i1;
        indices[q++] = i1; indices[q++] = i2; indices[q++] = i3;
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("washSourceCoord", new THREE.BufferAttribute(sourceCoords, 2));
  geometry.setAttribute("washProfile", new THREE.BufferAttribute(profiles, 1));
  geometry.setAttribute("washPhase", new THREE.BufferAttribute(phases, 1));
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

function makeBreakerTerms(state, bathymetry, coord, N) {
  return Fn(() => {
    const s = sampleSmooth(state, coord, N);
    const b = sampleSmooth(bathymetry, coord, N);
    const depth = max(b.x.add(s.x), float(0.08));
    const speed = vec2(s.y, s.z).length();
    const celerity = sqrt(float(GRAVITY).mul(depth));
    const froude = speed.div(max(celerity, float(0.08)));
    const relativeHeight = abs(s.x).div(max(b.x, float(0.25)));
    const depthBand = smoothstep(float(0.22), float(0.75), b.x)
      .mul(float(1).sub(smoothstep(float(4.2), float(7.0), b.x)));
    const dynamic = max(
      smoothstep(float(0.24), float(0.56), relativeHeight),
      smoothstep(float(0.50), float(0.84), froude),
    ).mul(depthBand);
    const physical = clamp(max(s.w.mul(1.15), dynamic), 0, 1);
    return vec3(physical, speed, clamp(s.x, -0.8, 0.8));
  });
}

function createBreakerMesh(scene, waterY, shallowHandle, patches) {
  const geometry = buildBreakerGeometry(patches, shallowHandle.domain, shallowHandle.N);
  const material = new THREE.MeshStandardNodeMaterial({
    color: 0x2b8ea0,
    roughness: 0.10,
    metalness: 0.0,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const time = uniform(0.0);
  const storm = uniform(0.0);
  const daylight = uniform(1.0);
  const underwater = uniform(0.0);
  const lightDirection = uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const waterColor = uniform(color(0x147589));
  const lipColor = uniform(color(0xa7e4e6));
  const foamColor = uniform(color(0xf4f8f4));

  const coord = attribute("surfCoord", "vec2");
  const profile = attribute("surfProfile", "float");
  const shore = attribute("surfShoreDir", "vec2");
  const phase = attribute("surfPhase", "float");
  const state = shallowHandle.state;
  const bathymetry = shallowHandle.bathymetry;
  const terms = makeBreakerTerms(state, bathymetry, coord, shallowHandle.N);

  material.positionNode = Fn(() => {
    const t = terms();
    const physical = t.x;
    const speed = t.y;
    const eta = t.z;
    const setPulse = float(0.58)
      .add(sin(time.mul(0.47).add(phase.mul(17.0))).mul(0.28))
      .add(sin(time.mul(0.19).add(phase.mul(7.0)).add(1.7)).mul(0.14));
    const setActive = smoothstep(float(0.48), float(0.82), setPulse);
    const b = sampleSmooth(bathymetry, coord, shallowHandle.N);
    const depthBand = smoothstep(float(0.30), float(0.85), b.x)
      .mul(float(1).sub(smoothstep(float(4.0), float(6.8), b.x)));
    const seeded = depthBand.mul(setActive).mul(0.24);
    const energy = clamp(max(physical, seeded).mul(float(1.0).add(storm.mul(0.32))), 0, 1);

    const tubeT = clamp(profile.sub(0.18).div(0.68), 0, 1);
    const tubeMask = smoothstep(float(0.10), float(0.30), profile)
      .mul(float(1).sub(smoothstep(float(0.88), float(0.99), profile)));
    const theta = tubeT.mul(float(Math.PI * 1.25));
    const radius = min(
      energy.mul(float(0.82).add(speed.mul(0.07))),
      float(1.65),
    );
    const arcForward = sin(theta).mul(radius);
    const arcLift = float(1).sub(cos(theta)).mul(radius);
    const lip = smoothstep(float(0.56), float(0.78), tubeT);
    const crash = smoothstep(float(0.78), float(0.98), tubeT);
    const horizontal = arcForward.mul(tubeMask)
      .add(lip.mul(energy).mul(0.72))
      .sub(crash.mul(energy).mul(0.16));
    const vertical = arcLift.mul(tubeMask)
      .sub(crash.mul(energy).mul(0.68));

    return positionLocal.add(vec3(
      shore.x.mul(horizontal),
      eta.add(vertical).add(0.035),
      shore.y.mul(horizontal),
    ));
  })();

  const geometricNormal = Fn(() => {
    const dx = dFdx(positionView);
    const dy = dFdy(positionView);
    return cross(dx, dy).normalize();
  })();
  material.normalNode = geometricNormal;

  const frag = terms();
  const energyFrag = frag.x;
  const tubeTFrag = clamp(profile.sub(0.18).div(0.68), 0, 1);
  const lipFoam = smoothstep(float(0.50), float(0.68), tubeTFrag)
    .mul(float(1).sub(smoothstep(float(0.86), float(0.98), tubeTFrag)));
  const impactFoam = smoothstep(float(0.75), float(0.96), tubeTFrag);
  const faceMask = smoothstep(float(0.16), float(0.34), profile)
    .mul(float(1).sub(smoothstep(float(0.89), float(0.99), profile)));
  const foam = clamp(
    energyFrag.mul(lipFoam.mul(1.65).add(impactFoam.mul(1.10))),
    0,
    1,
  );

  const worldNormal = Fn(() => {
    const dx = dFdx(positionWorld);
    const dy = dFdy(positionWorld);
    return cross(dx, dy).normalize();
  })();
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = pow(float(1).sub(clamp(abs(dot(worldNormal, viewDir)), 0, 1)), float(3.1));
  const lightFacing = clamp(dot(worldNormal, lightDirection.normalize()), 0, 1);

  material.colorNode = Fn(() => {
    const lit = mix(
      waterColor,
      lipColor,
      clamp(fresnel.mul(0.38).add(lightFacing.mul(daylight).mul(0.12)), 0, 0.55),
    );
    return mix(lit, foamColor, foam.mul(0.96));
  })();
  material.roughnessNode = mix(float(0.075), float(0.48), foam.mul(0.95));
  material.emissiveNode = foamColor.mul(foam.mul(0.008));
  material.opacityNode = clamp(
    energyFrag.mul(faceMask.mul(0.68).add(foam.mul(0.48)))
      .mul(float(1).sub(underwater.mul(0.90))),
    0,
    0.92,
  );

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = waterY;
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  scene.add(mesh);

  return { mesh, geometry, material, time, storm, daylight, underwater, lightDirection, waterColor, lipColor, foamColor };
}

function createWashMesh(scene, waterY, sampleHeight, shallowHandle, patches) {
  const geometry = buildWashGeometry(
    patches,
    sampleHeight,
    waterY,
    shallowHandle.domain,
    shallowHandle.N,
  );
  const material = new THREE.MeshBasicNodeMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const time = uniform(0.0);
  const storm = uniform(0.0);
  const daylight = uniform(1.0);
  const foamColor = uniform(color(0xf5f8f3));
  const coord = attribute("washSourceCoord", "vec2");
  const profile = attribute("washProfile", "float");
  const phase = attribute("washPhase", "float");
  const state = shallowHandle.state;
  const bathymetry = shallowHandle.bathymetry;
  const terms = makeBreakerTerms(state, bathymetry, coord, shallowHandle.N);

  const t = terms();
  const physical = t.x;
  const speed = t.y;
  const pulse = float(0.56)
    .add(sin(time.mul(0.43).add(phase.mul(17.0))).mul(0.27))
    .add(sin(time.mul(0.17).add(phase.mul(5.0)).add(2.1)).mul(0.13));
  const setActive = smoothstep(float(0.42), float(0.82), pulse);
  const energy = clamp(
    max(physical, setActive.mul(0.20)).mul(float(1.0).add(storm.mul(0.28))),
    0,
    1,
  );
  const runup = clamp(
    float(0.28)
      .add(energy.mul(0.52))
      .add(clamp(speed.mul(0.05), 0, 0.18)),
    0.18,
    0.88,
  );
  const front = float(1).sub(smoothstep(runup.sub(0.10), runup.add(0.08), profile));
  const edge = float(1).sub(smoothstep(float(0.035), float(0.16), abs(profile.sub(runup))));
  const breakup = float(0.72).add(
    sin(positionWorld.x.mul(0.65).add(positionWorld.z.mul(0.83)).add(time.mul(1.7))).mul(0.18)
  );
  const foamMask = clamp(
    front.mul(energy.mul(0.72).add(0.08)).add(edge.mul(0.48)).mul(breakup),
    0,
    1,
  );

  material.colorNode = foamColor;
  material.opacityNode = foamMask.mul(float(0.36).add(daylight.mul(0.46)));

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  scene.add(mesh);
  return { mesh, geometry, material, time, storm, daylight, foamColor };
}

function makeSprayTexture() {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0.0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.28, "rgba(245,250,250,0.70)");
  g.addColorStop(0.68, "rgba(225,245,248,0.20)");
  g.addColorStop(1.0, "rgba(220,245,250,0.0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function createSpray(scene, waterY, patches) {
  const positions = new Float32Array(SPRAY_COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const texture = makeSprayTexture();
  const material = new THREE.PointsMaterial({
    color: 0xf5fbff,
    size: 0.58,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.58,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: texture ?? null,
    alphaTest: texture ? 0.02 : 0,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 9;
  scene.add(points);

  const particles = [];
  for (let i = 0; i < SPRAY_COUNT; i++) {
    const patch = patches[i % patches.length];
    const seed = (i * 0.61803398875) % 1;
    particles.push({
      patch,
      seed,
      lateral: ((i * 37) % 101) / 100 * 2 - 1,
      radial: ((i * 53) % 97) / 96,
      speed: 0.18 + (((i * 71) % 89) / 88) * 0.14,
    });
    positions[i * 3 + 1] = -999;
  }
  geometry.attributes.position.needsUpdate = true;
  return { points, geometry, material, texture, particles, waterY };
}

function updateSpray(handle, elapsed, storm, day) {
  if (!handle?.points) return;
  const arr = handle.geometry.attributes.position.array;
  const stormT = THREE.MathUtils.clamp(storm, 0, 1);
  const dayT = THREE.MathUtils.clamp(day, 0, 1);

  for (let i = 0; i < handle.particles.length; i++) {
    const p = handle.particles[i];
    const patch = p.patch;
    const set = 0.5 + 0.5 * Math.sin(elapsed * 0.46 + patch.phase * 17.0 + p.seed * 3.0);
    const active = smooth01((set - 0.62) / 0.30);
    const life = ((elapsed * p.speed + p.seed) % 1 + 1) % 1;
    const visible = active > 0.03 && life < 0.82;
    const idx = i * 3;

    if (!visible) {
      arr[idx] = patch.cx;
      arr[idx + 1] = -999;
      arr[idx + 2] = patch.cz;
      continue;
    }

    const tangential = p.lateral * (BREAKER_HALF_LENGTH * 0.9);
    const outward = 1.8 + p.radial * 4.4;
    const shorewardTravel = life * (1.1 + stormT * 0.8);
    const rise = Math.sin(Math.PI * Math.min(1, life / 0.82)) * (0.9 + p.radial * 1.4 + stormT * 0.55);
    const jitter = Math.sin(elapsed * 4.1 + p.seed * 19.0) * 0.25;

    arr[idx] = patch.cx
      + patch.tangentX * (tangential + jitter)
      + patch.outwardX * (outward - shorewardTravel);
    arr[idx + 1] = handle.waterY + 0.35 + rise;
    arr[idx + 2] = patch.cz
      + patch.tangentZ * (tangential + jitter)
      + patch.outwardZ * (outward - shorewardTravel);
  }
  handle.geometry.attributes.position.needsUpdate = true;
  handle.material.opacity = 0.34 + dayT * 0.26 + stormT * 0.15;
  handle.material.size = 0.48 + stormT * 0.18;
}

export function createGPUSurfSystem(scene, sampleHeight, waterY, shallowHandle) {
  if (!scene || !shallowHandle?.gpuShallowWater || !shallowHandle.state || !shallowHandle.bathymetry) return null;
  const patches = buildShorePatches(sampleHeight, waterY, shallowHandle.domain);
  const breaker = createBreakerMesh(scene, waterY, shallowHandle, patches);
  const wash = createWashMesh(scene, waterY, sampleHeight, shallowHandle, patches);
  const spray = createSpray(scene, waterY, patches);
  return { gpuSurfSystem: true, patches, breaker, wash, spray, waterY };
}

export function updateGPUSurfSystem(handle, elapsed, cameraY, storm = 0, day = 1, sunDir = null) {
  if (!handle?.gpuSurfSystem) return;
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  const stormT = THREE.MathUtils.clamp(storm, 0, 1);

  if (handle.breaker) {
    handle.breaker.time.value = Number.isFinite(elapsed) ? elapsed : 0;
    handle.breaker.storm.value = stormT;
    handle.breaker.daylight.value = dayT;
    handle.breaker.underwater.value = underwater ? 1 : 0;
    if (sunDir && handle.breaker.lightDirection?.value) handle.breaker.lightDirection.value.copy(sunDir).normalize();
    handle.breaker.waterColor.value.set(0x0b3340).lerp(new THREE.Color(0x147589), dayT);
    handle.breaker.lipColor.value.set(0x5a8390).lerp(new THREE.Color(0xa7e4e6), dayT);
    handle.breaker.foamColor.value.set(0x87969c).lerp(new THREE.Color(0xf4f8f4), dayT);
    handle.breaker.mesh.visible = !underwater;
  }

  if (handle.wash) {
    handle.wash.time.value = Number.isFinite(elapsed) ? elapsed : 0;
    handle.wash.storm.value = stormT;
    handle.wash.daylight.value = dayT;
    handle.wash.foamColor.value.set(0x89989c).lerp(new THREE.Color(0xf6faf6), dayT);
    handle.wash.mesh.visible = !underwater;
  }

  if (handle.spray) {
    handle.spray.points.visible = !underwater;
    if (!underwater) updateSpray(handle.spray, elapsed, stormT, dayT);
  }
}

export function disposeGPUSurfSystem(scene, handle) {
  if (!handle?.gpuSurfSystem) return;
  for (const layer of [handle.breaker, handle.wash]) {
    if (!layer) continue;
    try { scene?.remove(layer.mesh); } catch (_) {}
    try { layer.geometry?.dispose?.(); } catch (_) {}
    try { layer.material?.dispose?.(); } catch (_) {}
  }
  if (handle.spray) {
    try { scene?.remove(handle.spray.points); } catch (_) {}
    try { handle.spray.geometry?.dispose?.(); } catch (_) {}
    try { handle.spray.material?.dispose?.(); } catch (_) {}
    try { handle.spray.texture?.dispose?.(); } catch (_) {}
  }
}
