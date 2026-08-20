import * as THREE from "three";
import {
  Fn, uniform, color, float, uint, vec2, vec3,
  positionLocal, positionView, positionWorld, cameraPosition,
  attribute, floor, min, max, abs, dFdx, dFdy, cross, dot, pow, mix, clamp,
  smoothstep, sin, sqrt, fract,
} from "three/tsl";

// Natural coastal surf layer.
// The global ocean remains FFT + shallow-water. This layer only reconstructs
// visually dense shoaling wave trains, whitewater and swash from the solved
// finite-depth field near the shoreline.
const PATCH_COUNT = 44;
const BREAKER_ALONG = 14;
const BREAKER_PROFILE = 24;
const BREAKER_HALF_LENGTH = 7.6;
const BREAKER_OUTER = 15.0;
const BREAKER_INNER = 0.35;
const WASH_ALONG = 12;
const WASH_PROFILE = 24;
const WASH_OFFSHORE = 6.5;
const WASH_LANDWARD = 12.5;
const SPRAY_COUNT = 56;
const GRAVITY = 9.81;
const TAU = Math.PI * 2;

function smooth01(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function findShoreRadius(sampleHeight, waterY, angle, maxRadius) {
  if (!sampleHeight) return maxRadius * 0.45;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let prevR = 5;
  let prevG = sampleHeight(ca * prevR, sa * prevR);
  let prevWet = Number.isFinite(prevG) && prevG < waterY - 0.05;
  for (let r = 5.8; r <= maxRadius; r += 0.9) {
    const g = sampleHeight(ca * r, sa * r);
    if (!Number.isFinite(g)) continue;
    const wet = g < waterY - 0.05;
    if (!prevWet && wet) {
      let lo = prevR, hi = r;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) * 0.5;
        const mg = sampleHeight(ca * mid, sa * mid);
        if (Number.isFinite(mg) && mg < waterY - 0.05) hi = mid;
        else lo = mid;
      }
      return (lo + hi) * 0.5;
    }
    prevR = r;
    prevWet = wet;
  }
  return maxRadius * 0.45;
}

function buildPatches(sampleHeight, waterY, domain) {
  const raw = new Float32Array(PATCH_COUNT);
  const smoothed = new Float32Array(PATCH_COUNT);
  const maxRadius = domain * 0.48;
  for (let i = 0; i < PATCH_COUNT; i++) {
    raw[i] = findShoreRadius(sampleHeight, waterY, i / PATCH_COUNT * TAU, maxRadius);
  }
  for (let i = 0; i < PATCH_COUNT; i++) {
    let sum = 0, weight = 0;
    for (let k = -3; k <= 3; k++) {
      const w = 4 - Math.abs(k);
      sum += raw[(i + k + PATCH_COUNT) % PATCH_COUNT] * w;
      weight += w;
    }
    smoothed[i] = sum / weight;
  }
  return Array.from({ length: PATCH_COUNT }, (_, i) => {
    const a = i / PATCH_COUNT * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    return {
      phase: i / PATCH_COUNT,
      cx: ca * smoothed[i], cz: sa * smoothed[i],
      outwardX: ca, outwardZ: sa,
      inwardX: -ca, inwardZ: -sa,
      tangentX: -sa, tangentZ: ca,
    };
  });
}

function toCoord(x, z, domain, N) {
  return [
    THREE.MathUtils.clamp((x / domain + 0.5) * (N - 1), 0, N - 1),
    THREE.MathUtils.clamp((z / domain + 0.5) * (N - 1), 0, N - 1),
  ];
}

function buildBand(patches, sampleHeight, waterY, shallowHandle, kind) {
  const breaker = kind === "breaker";
  const alongSegments = breaker ? BREAKER_ALONG : WASH_ALONG;
  const profileSegments = breaker ? BREAKER_PROFILE : WASH_PROFILE;
  const halfLength = breaker ? BREAKER_HALF_LENGTH : BREAKER_HALF_LENGTH * 1.16;
  const outer = breaker ? BREAKER_OUTER : WASH_OFFSHORE;
  const inner = breaker ? BREAKER_INNER : -WASH_LANDWARD;
  const vertsPerPatch = (alongSegments + 1) * (profileSegments + 1);
  const positions = new Float32Array(PATCH_COUNT * vertsPerPatch * 3);
  const coords = new Float32Array(PATCH_COUNT * vertsPerPatch * 2);
  const profiles = new Float32Array(PATCH_COUNT * vertsPerPatch);
  const alongs = new Float32Array(PATCH_COUNT * vertsPerPatch);
  const phases = new Float32Array(PATCH_COUNT * vertsPerPatch);
  const dirs = breaker ? new Float32Array(PATCH_COUNT * vertsPerPatch * 2) : null;
  const indices = new Uint32Array(PATCH_COUNT * alongSegments * profileSegments * 6);
  let v = 0, q = 0;

  for (const patch of patches) {
    const base = v;
    const source = toCoord(
      patch.cx + patch.outwardX * 3.2,
      patch.cz + patch.outwardZ * 3.2,
      shallowHandle.domain,
      shallowHandle.N,
    );
    for (let a = 0; a <= alongSegments; a++) {
      const alongN = a / alongSegments * 2 - 1;
      const along = alongN * halfLength;
      for (let p = 0; p <= profileSegments; p++) {
        const t = p / profileSegments;
        const radial = THREE.MathUtils.lerp(outer, inner, smooth01(t));
        const x = patch.cx + patch.tangentX * along + patch.outwardX * radial;
        const z = patch.cz + patch.tangentZ * along + patch.outwardZ * radial;
        let y = 0;
        if (!breaker) {
          const ground = sampleHeight ? sampleHeight(x, z) : waterY - 1;
          y = Number.isFinite(ground)
            ? Math.max(waterY + 0.018, ground + 0.042)
            : waterY + 0.018;
        }
        const sc = breaker ? toCoord(x, z, shallowHandle.domain, shallowHandle.N) : source;
        positions[v * 3] = x;
        positions[v * 3 + 1] = y;
        positions[v * 3 + 2] = z;
        coords[v * 2] = sc[0];
        coords[v * 2 + 1] = sc[1];
        profiles[v] = t;
        alongs[v] = alongN;
        phases[v] = patch.phase;
        if (dirs) {
          dirs[v * 2] = patch.inwardX;
          dirs[v * 2 + 1] = patch.inwardZ;
        }
        v++;
      }
    }
    const row = profileSegments + 1;
    for (let a = 0; a < alongSegments; a++) {
      for (let p = 0; p < profileSegments; p++) {
        const i0 = base + a * row + p;
        const i1 = i0 + 1;
        const i2 = base + (a + 1) * row + p;
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
  geometry.setAttribute("surfAlong", new THREE.BufferAttribute(alongs, 1));
  geometry.setAttribute("surfPhase", new THREE.BufferAttribute(phases, 1));
  if (dirs) geometry.setAttribute("surfShoreDir", new THREE.BufferAttribute(dirs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function smoothWeight(t) {
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

function sampleSmooth(buffer, coord, N) {
  const x0 = floor(coord.x), z0 = floor(coord.y);
  const x1 = min(x0.add(1), float(N - 1));
  const z1 = min(z0.add(1), float(N - 1));
  const tx = smoothWeight(coord.x.sub(x0));
  const tz = smoothWeight(coord.y.sub(z0));
  const row = uint(N);
  const i00 = z0.toUint().mul(row).add(x0.toUint());
  const i10 = z0.toUint().mul(row).add(x1.toUint());
  const i01 = z1.toUint().mul(row).add(x0.toUint());
  const i11 = z1.toUint().mul(row).add(x1.toUint());
  return mix(
    mix(buffer.element(i00), buffer.element(i10), tx),
    mix(buffer.element(i01), buffer.element(i11), tx),
    tz,
  );
}

function breakerTerms(shallowHandle, coord) {
  return Fn(() => {
    const s = sampleSmooth(shallowHandle.state, coord, shallowHandle.N);
    const b = sampleSmooth(shallowHandle.bathymetry, coord, shallowHandle.N);
    const depth = max(b.x.add(s.x), float(0.08));
    const speed = vec2(s.y, s.z).length();
    const froude = speed.div(max(sqrt(float(GRAVITY).mul(depth)), float(0.08)));
    const rel = abs(s.x).div(max(b.x, float(0.25)));
    const depthBand = smoothstep(float(0.16), float(0.52), b.x)
      .mul(float(1).sub(smoothstep(float(3.4), float(5.8), b.x)));
    const dynamic = max(
      smoothstep(float(0.19), float(0.48), rel),
      smoothstep(float(0.44), float(0.78), froude),
    ).mul(depthBand);
    return vec3(
      clamp(max(s.w.mul(1.02), dynamic), 0, 1),
      speed,
      clamp(s.x, -0.55, 0.55),
    );
  });
}

function waveRidge(profile, center, innerWidth, outerWidth) {
  return float(1).sub(smoothstep(innerWidth, outerWidth, abs(profile.sub(center))));
}

function createBreaker(scene, waterY, shallowHandle, patches) {
  const geometry = buildBand(patches, null, waterY, shallowHandle, "breaker");
  const material = new THREE.MeshStandardNodeMaterial({
    color: 0x3b8790,
    roughness: 0.10,
    metalness: 0,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const time = uniform(0), storm = uniform(0), day = uniform(1), underwater = uniform(0);
  const lightDir = uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const waterColor = uniform(color(0x3a8790));
  const lipColor = uniform(color(0xaedbd9));
  const foamColor = uniform(color(0xf8faf5));
  const coord = attribute("surfCoord", "vec2");
  const profile = attribute("surfProfile", "float");
  const along = attribute("surfAlong", "float");
  const phase = attribute("surfPhase", "float");
  const shore = attribute("surfShoreDir", "vec2");
  const terms = breakerTerms(shallowHandle, coord);

  material.positionNode = Fn(() => {
    const t = terms();
    const physical = t.x;
    const speed = t.y;
    const eta = t.z;
    const bathy = sampleSmooth(shallowHandle.bathymetry, coord, shallowHandle.N);
    const depthBand = smoothstep(float(0.18), float(0.58), bathy.x)
      .mul(float(1).sub(smoothstep(float(3.5), float(5.7), bathy.x)));

    const baseTravel = fract(
      time.mul(0.105)
        .add(phase.mul(0.18))
        .add(along.mul(0.020))
        .add(sin(phase.mul(18.0).add(along.mul(2.2))).mul(0.012))
    );
    const c0 = float(0.08).add(baseTravel.mul(0.72));
    const c1 = float(0.08).add(fract(baseTravel.add(0.25)).mul(0.72));
    const c2 = float(0.08).add(fract(baseTravel.add(0.50)).mul(0.72));
    const c3 = float(0.08).add(fract(baseTravel.add(0.75)).mul(0.72));

    const r0 = waveRidge(profile, c0, float(0.018), float(0.070));
    const r1 = waveRidge(profile, c1, float(0.020), float(0.076)).mul(0.88);
    const r2 = waveRidge(profile, c2, float(0.021), float(0.080)).mul(0.74);
    const r3 = waveRidge(profile, c3, float(0.023), float(0.084)).mul(0.62);
    const ridge = max(max(r0, r1), max(r2, r3));

    const shoal = smoothstep(float(0.12), float(0.66), profile);
    const collapse = smoothstep(float(0.72), float(0.92), profile);
    const localEnergy = clamp(
      depthBand.mul(0.54)
        .add(physical.mul(0.52))
        .mul(float(1).add(storm.mul(0.22))),
      0,
      1,
    );
    const amplitude = mix(float(0.075), float(0.34), shoal)
      .mul(float(1).sub(collapse.mul(0.58)));
    const height = ridge.mul(localEnergy).mul(amplitude)
      .add(ridge.mul(0.018));

    const steepen = ridge.mul(localEnergy)
      .mul(smoothstep(float(0.48), float(0.76), profile));
    const shoulder = min(steepen.mul(float(0.13).add(speed.mul(0.012))), float(0.20));
    const crashDrop = ridge.mul(localEnergy)
      .mul(smoothstep(float(0.72), float(0.91), profile))
      .mul(0.12);

    return positionLocal.add(vec3(
      shore.x.mul(shoulder),
      eta.add(height).sub(crashDrop).add(0.020),
      shore.y.mul(shoulder),
    ));
  })();

  const geometricNormal = Fn(() => cross(dFdx(positionView), dFdy(positionView)).normalize())();
  material.normalNode = geometricNormal;

  const frag = terms();
  const baseTravel = fract(
    time.mul(0.105)
      .add(phase.mul(0.18))
      .add(along.mul(0.020))
  );
  const fc0 = float(0.08).add(baseTravel.mul(0.72));
  const fc1 = float(0.08).add(fract(baseTravel.add(0.25)).mul(0.72));
  const fc2 = float(0.08).add(fract(baseTravel.add(0.50)).mul(0.72));
  const fc3 = float(0.08).add(fract(baseTravel.add(0.75)).mul(0.72));
  const fr0 = waveRidge(profile, fc0, float(0.016), float(0.065));
  const fr1 = waveRidge(profile, fc1, float(0.018), float(0.070)).mul(0.84);
  const fr2 = waveRidge(profile, fc2, float(0.019), float(0.074)).mul(0.70);
  const fr3 = waveRidge(profile, fc3, float(0.020), float(0.078)).mul(0.56);
  const ridge = max(max(fr0, fr1), max(fr2, fr3));

  const nearBreak = smoothstep(float(0.48), float(0.77), profile)
    .mul(float(1).sub(smoothstep(float(0.90), float(0.99), profile)));
  const foamBreakup = float(0.68).add(
    sin(positionWorld.x.mul(0.82).add(positionWorld.z.mul(1.17)).add(time.mul(0.92))).mul(0.18)
  ).add(
    sin(positionWorld.x.mul(1.43).sub(positionWorld.z.mul(0.64)).sub(time.mul(0.61))).mul(0.11)
  );
  const crestFoam = clamp(
    ridge.mul(nearBreak)
      .mul(float(0.28).add(frag.x.mul(0.86)))
      .mul(foamBreakup),
    0,
    1,
  );
  const impactFoam = ridge.mul(smoothstep(float(0.70), float(0.90), profile))
    .mul(frag.x).mul(0.62);
  const foam = clamp(max(crestFoam, impactFoam), 0, 1);

  const sideFade = float(1).sub(smoothstep(float(0.76), float(1), abs(along)));
  const worldNormal = Fn(() => cross(dFdx(positionWorld), dFdy(positionWorld)).normalize())();
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = pow(float(1).sub(clamp(abs(dot(worldNormal, viewDir)), 0, 1)), float(3.3));
  const lightFacing = clamp(dot(worldNormal, lightDir.normalize()), 0, 1);
  const waterLit = mix(
    waterColor,
    lipColor,
    clamp(fresnel.mul(0.30).add(lightFacing.mul(day).mul(0.13)), 0, 0.50),
  );
  material.colorNode = mix(waterLit, foamColor, foam.mul(0.96));
  material.roughnessNode = mix(float(0.085), float(0.54), foam.mul(0.94));

  const waterPresence = ridge.mul(float(0.16).add(frag.x.mul(0.20)));
  material.opacityNode = clamp(
    sideFade
      .mul(waterPresence.add(foam.mul(0.76)))
      .mul(float(1).sub(underwater.mul(0.96))),
    0,
    0.84,
  );

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = waterY;
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  scene.add(mesh);
  return {
    mesh, geometry, material, time, storm, day, underwater,
    lightDir, waterColor, lipColor, foamColor,
  };
}

function createWashLayers(scene, waterY, sampleHeight, shallowHandle, patches) {
  const geometry = buildBand(patches, sampleHeight, waterY, shallowHandle, "wash");
  const wetGeometry = geometry.clone();
  const wetPos = wetGeometry.attributes.position;
  for (let i = 0; i < wetPos.count; i++) wetPos.setY(i, wetPos.getY(i) - 0.026);
  wetPos.needsUpdate = true;

  const time = uniform(0), storm = uniform(0), day = uniform(1);
  const foamColor = uniform(color(0xf8faf5));
  const wetColor = uniform(color(0x3a332a));
  const coord = attribute("surfCoord", "vec2");
  const profile = attribute("surfProfile", "float");
  const along = attribute("surfAlong", "float");
  const phase = attribute("surfPhase", "float");
  const terms = breakerTerms(shallowHandle, coord);
  const t = terms();

  const pulse = float(0.52)
    .add(sin(time.mul(0.34).add(phase.mul(6.0))).mul(0.31))
    .add(sin(time.mul(0.16).add(phase.mul(2.7)).add(1.4)).mul(0.10));
  const energy = clamp(
    t.x.mul(0.74)
      .add(smoothstep(float(0.30), float(0.80), pulse).mul(0.20))
      .mul(float(1).add(storm.mul(0.20))),
    0,
    1,
  );
  const runup = clamp(
    float(0.38)
      .add(energy.mul(0.28))
      .add(clamp(t.y.mul(0.035), 0, 0.10))
      .add(pulse.mul(0.07)),
    0.30,
    0.82,
  );
  const sideFade = float(1).sub(smoothstep(float(0.78), float(1), abs(along)));

  const foamMat = new THREE.MeshBasicNodeMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const edge = float(1).sub(
    smoothstep(float(0.012), float(0.060), abs(profile.sub(runup)))
  );
  const trailingZone = smoothstep(runup.sub(0.26), runup.sub(0.04), profile)
    .mul(float(1).sub(smoothstep(runup.sub(0.04), runup.add(0.02), profile)));
  const laceA = abs(sin(
    positionWorld.x.mul(1.08)
      .add(positionWorld.z.mul(0.82))
      .add(time.mul(0.76))
  ));
  const laceB = abs(sin(
    positionWorld.x.mul(1.64)
      .sub(positionWorld.z.mul(0.71))
      .sub(time.mul(0.57))
  ));
  const laceC = abs(sin(
    positionWorld.x.mul(0.53)
      .add(positionWorld.z.mul(1.92))
      .add(time.mul(0.41))
  ));
  const lace = smoothstep(
    float(0.56),
    float(0.88),
    laceA.mul(0.44).add(laceB.mul(0.34)).add(laceC.mul(0.22)),
  );
  const residue = trailingZone.mul(lace)
    .mul(float(0.08).add(energy.mul(0.20)));
  const foamMask = clamp(
    edge.mul(float(0.46).add(energy.mul(0.42)))
      .add(residue),
    0,
    1,
  ).mul(sideFade);

  foamMat.colorNode = foamColor;
  foamMat.opacityNode = foamMask.mul(float(0.30).add(day.mul(0.38)));

  const wetMat = new THREE.MeshBasicNodeMaterial({
    color: 0x302a24,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wetRunup = clamp(runup.add(0.10), 0.38, 0.92);
  const wetFront = float(1).sub(
    smoothstep(wetRunup.sub(0.14), wetRunup.add(0.08), profile)
  );
  const shoreOnly = smoothstep(float(0.16), float(0.34), profile);
  const wetMask = wetFront.mul(shoreOnly).mul(sideFade)
    .mul(float(0.22).add(energy.mul(0.26)).add(pulse.mul(0.11)));
  wetMat.colorNode = wetColor;
  wetMat.opacityNode = clamp(wetMask, 0, 0.42)
    .mul(float(0.70).add(day.mul(0.16)));

  const wet = new THREE.Mesh(wetGeometry, wetMat);
  wet.frustumCulled = false;
  wet.renderOrder = 8;
  scene.add(wet);
  const foam = new THREE.Mesh(geometry, foamMat);
  foam.frustumCulled = false;
  foam.renderOrder = 9;
  scene.add(foam);

  return {
    foam: { mesh: foam, geometry, material: foamMat, time, storm, day, foamColor },
    wet: { mesh: wet, geometry: wetGeometry, material: wetMat, time, storm, day, wetColor },
  };
}

function makeSprayTexture() {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const gradient = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  gradient.addColorStop(0, "rgba(255,255,255,.72)");
  gradient.addColorStop(0.3, "rgba(245,250,250,.34)");
  gradient.addColorStop(1, "rgba(230,248,250,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function createSpray(scene, waterY, patches) {
  const positions = new Float32Array(SPRAY_COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const texture = makeSprayTexture();
  const material = new THREE.PointsMaterial({
    color: 0xf6fbff,
    size: 0.24,
    transparent: true,
    opacity: 0.20,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: texture,
    alphaTest: texture ? 0.015 : 0,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 10;
  scene.add(points);
  const particles = Array.from({ length: SPRAY_COUNT }, (_, i) => ({
    patch: patches[i % patches.length],
    seed: (i * 0.61803398875) % 1,
    lateral: ((i * 37) % 101) / 50 - 1,
    radial: ((i * 53) % 97) / 96,
    speed: 0.16 + (((i * 71) % 89) / 88) * 0.08,
  }));
  return { points, geometry, material, texture, particles, waterY };
}

function updateSpray(handle, elapsed, storm, day) {
  const positions = handle.geometry.attributes.position.array;
  for (let i = 0; i < handle.particles.length; i++) {
    const particle = handle.particles[i];
    const patch = particle.patch;
    const set = 0.5 + 0.5 * Math.sin(
      elapsed * 0.42 + patch.phase * 6 + particle.seed * 4
    );
    const active = smooth01((set - 0.80) / 0.16);
    const life = ((elapsed * particle.speed + particle.seed) % 1 + 1) % 1;
    const idx = i * 3;
    if (active < 0.10 || life > 0.66) {
      positions[idx] = patch.cx;
      positions[idx + 1] = -999;
      positions[idx + 2] = patch.cz;
      continue;
    }
    const tangential = particle.lateral * BREAKER_HALF_LENGTH * 0.76;
    const outward = 1.2 + particle.radial * 2.4;
    const shoreward = life * (0.48 + storm * 0.40);
    const rise = Math.sin(Math.PI * Math.min(1, life / 0.66))
      * (0.28 + particle.radial * 0.48 + storm * 0.22);
    positions[idx] = patch.cx
      + patch.tangentX * tangential
      + patch.outwardX * (outward - shoreward);
    positions[idx + 1] = handle.waterY + 0.18 + rise;
    positions[idx + 2] = patch.cz
      + patch.tangentZ * tangential
      + patch.outwardZ * (outward - shoreward);
  }
  handle.geometry.attributes.position.needsUpdate = true;
  handle.material.opacity = 0.10 + day * 0.10 + storm * 0.09;
  handle.material.size = 0.22 + storm * 0.08;
}

export function createGPUSurfSystem(scene, sampleHeight, waterY, shallowHandle) {
  if (!scene || !shallowHandle?.gpuShallowWater || !shallowHandle.state || !shallowHandle.bathymetry) {
    return null;
  }
  const patches = buildPatches(sampleHeight, waterY, shallowHandle.domain);
  const breaker = createBreaker(scene, waterY, shallowHandle, patches);
  const wash = createWashLayers(scene, waterY, sampleHeight, shallowHandle, patches);
  const spray = createSpray(scene, waterY, patches);
  return {
    gpuSurfSystem: true,
    patches,
    breaker,
    wash: wash.foam,
    wetSand: wash.wet,
    spray,
    waterY,
  };
}

export function updateGPUSurfSystem(
  handle,
  elapsed,
  cameraY,
  storm = 0,
  day = 1,
  sunDir = null,
) {
  if (!handle?.gpuSurfSystem) return;
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  const stormT = THREE.MathUtils.clamp(storm, 0, 1);
  const t = Number.isFinite(elapsed) ? elapsed : 0;

  if (handle.breaker) {
    handle.breaker.time.value = t;
    handle.breaker.storm.value = stormT;
    handle.breaker.day.value = dayT;
    handle.breaker.underwater.value = underwater ? 1 : 0;
    if (sunDir && handle.breaker.lightDir?.value) {
      handle.breaker.lightDir.value.copy(sunDir).normalize();
    }
    handle.breaker.waterColor.value
      .set(0x1b4650)
      .lerp(new THREE.Color(0x3a8790), dayT);
    handle.breaker.lipColor.value
      .set(0x68868a)
      .lerp(new THREE.Color(0xaedbd9), dayT);
    handle.breaker.foamColor.value
      .set(0x909b9b)
      .lerp(new THREE.Color(0xf8faf5), dayT);
    handle.breaker.mesh.visible = !underwater;
  }

  for (const layer of [handle.wash, handle.wetSand]) {
    if (!layer) continue;
    layer.time.value = t;
    layer.storm.value = stormT;
    layer.day.value = dayT;
    layer.mesh.visible = !underwater;
  }
  if (handle.wash?.foamColor?.value) {
    handle.wash.foamColor.value
      .set(0x929d9e)
      .lerp(new THREE.Color(0xf8faf5), dayT);
  }
  if (handle.wetSand?.wetColor?.value) {
    handle.wetSand.wetColor.value
      .set(0x181a1a)
      .lerp(new THREE.Color(0x3a332a), dayT);
  }

  if (handle.spray) {
    handle.spray.points.visible = !underwater;
    if (!underwater) updateSpray(handle.spray, t, stormT, dayT);
  }
}

export function disposeGPUSurfSystem(scene, handle) {
  if (!handle?.gpuSurfSystem) return;
  for (const layer of [handle.breaker, handle.wash, handle.wetSand]) {
    if (!layer) continue;
    scene?.remove(layer.mesh);
    try { layer.geometry?.dispose?.(); } catch (_) {}
    try { layer.material?.dispose?.(); } catch (_) {}
  }
  if (handle.spray) {
    scene?.remove(handle.spray.points);
    try { handle.spray.geometry?.dispose?.(); } catch (_) {}
    try { handle.spray.material?.dispose?.(); } catch (_) {}
    try { handle.spray.texture?.dispose?.(); } catch (_) {}
  }
}
