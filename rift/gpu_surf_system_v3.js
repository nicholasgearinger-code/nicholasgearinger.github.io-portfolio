import * as THREE from "three";
import {
  Fn, uniform, color, float, uint, vec2, vec3,
  positionLocal, positionView, positionWorld, cameraPosition,
  attribute, floor, min, max, abs, dFdx, dFdy, cross, dot, pow, mix, clamp,
  smoothstep, sin, sqrt, fract,
} from "three/tsl";

const SHORE_SEGMENTS = 256;
const WAVE_PROFILE = 32;
const WAVE_OFFSHORE = 14.0;
const WAVE_INSHORE = 0.35;
const WASH_PROFILE = 28;
const WASH_OFFSHORE = 5.5;
const WASH_LANDWARD = 10.5;
const SPRAY_COUNT = 48;
const GRAVITY = 9.81;
const TAU = Math.PI * 2;

function smooth01(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function findShoreRadius(sampleHeight, waterY, angle, maxRadius) {
  if (!sampleHeight) return maxRadius * 0.45;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let prevR = 5.0;
  let prevG = sampleHeight(ca * prevR, sa * prevR);
  let prevWet = Number.isFinite(prevG) && prevG < waterY - 0.05;

  for (let r = 5.75; r <= maxRadius; r += 0.75) {
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

function buildShoreline(sampleHeight, waterY, domain) {
  const raw = new Float32Array(SHORE_SEGMENTS);
  const smooth = new Float32Array(SHORE_SEGMENTS);
  const maxRadius = domain * 0.48;

  for (let i = 0; i < SHORE_SEGMENTS; i++) {
    raw[i] = findShoreRadius(sampleHeight, waterY, i / SHORE_SEGMENTS * TAU, maxRadius);
  }

  for (let i = 0; i < SHORE_SEGMENTS; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -5; k <= 5; k++) {
      const w = 6 - Math.abs(k);
      sum += raw[(i + k + SHORE_SEGMENTS) % SHORE_SEGMENTS] * w;
      weight += w;
    }
    smooth[i] = sum / weight;
  }

  const points = [];
  for (let i = 0; i <= SHORE_SEGMENTS; i++) {
    const wrapped = i % SHORE_SEGMENTS;
    const angle = wrapped / SHORE_SEGMENTS * TAU;
    const ca = Math.cos(angle), sa = Math.sin(angle);
    const r = smooth[wrapped];
    points.push({
      phase: wrapped / SHORE_SEGMENTS,
      x: ca * r,
      z: sa * r,
      outwardX: ca,
      outwardZ: sa,
      inwardX: -ca,
      inwardZ: -sa,
    });
  }
  return points;
}

function toCoord(x, z, domain, N) {
  return [
    THREE.MathUtils.clamp((x / domain + 0.5) * (N - 1), 0, N - 1),
    THREE.MathUtils.clamp((z / domain + 0.5) * (N - 1), 0, N - 1),
  ];
}

function buildContinuousBand(shoreline, sampleHeight, waterY, shallowHandle, kind) {
  const isWave = kind === "wave";
  const profileSegments = isWave ? WAVE_PROFILE : WASH_PROFILE;
  const outer = isWave ? WAVE_OFFSHORE : WASH_OFFSHORE;
  const inner = isWave ? WAVE_INSHORE : -WASH_LANDWARD;
  const rows = SHORE_SEGMENTS + 1;
  const cols = profileSegments + 1;
  const vertexCount = rows * cols;

  const positions = new Float32Array(vertexCount * 3);
  const coords = new Float32Array(vertexCount * 2);
  const profiles = new Float32Array(vertexCount);
  const phases = new Float32Array(vertexCount);
  const shoreDirs = isWave ? new Float32Array(vertexCount * 2) : null;
  const indices = new Uint32Array(SHORE_SEGMENTS * profileSegments * 6);

  let v = 0;
  for (let s = 0; s <= SHORE_SEGMENTS; s++) {
    const shore = shoreline[s];
    const sourceX = shore.x + shore.outwardX * 2.4;
    const sourceZ = shore.z + shore.outwardZ * 2.4;
    const sourceCoord = toCoord(sourceX, sourceZ, shallowHandle.domain, shallowHandle.N);

    for (let p = 0; p <= profileSegments; p++) {
      const t = p / profileSegments;
      const radial = THREE.MathUtils.lerp(outer, inner, smooth01(t));
      const x = shore.x + shore.outwardX * radial;
      const z = shore.z + shore.outwardZ * radial;
      let y = 0;

      if (!isWave) {
        const g = sampleHeight ? sampleHeight(x, z) : waterY - 1;
        y = Number.isFinite(g) ? Math.max(waterY + 0.018, g + 0.04) : waterY + 0.018;
      }

      const sc = isWave ? toCoord(x, z, shallowHandle.domain, shallowHandle.N) : sourceCoord;
      positions[v * 3] = x;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = z;
      coords[v * 2] = sc[0];
      coords[v * 2 + 1] = sc[1];
      profiles[v] = t;
      phases[v] = shore.phase;
      if (shoreDirs) {
        shoreDirs[v * 2] = shore.inwardX;
        shoreDirs[v * 2 + 1] = shore.inwardZ;
      }
      v++;
    }
  }

  let q = 0;
  for (let s = 0; s < SHORE_SEGMENTS; s++) {
    for (let p = 0; p < profileSegments; p++) {
      const i0 = s * cols + p;
      const i1 = i0 + 1;
      const i2 = (s + 1) * cols + p;
      const i3 = i2 + 1;
      indices[q++] = i0; indices[q++] = i2; indices[q++] = i1;
      indices[q++] = i1; indices[q++] = i2; indices[q++] = i3;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("surfCoord", new THREE.BufferAttribute(coords, 2));
  geometry.setAttribute("surfProfile", new THREE.BufferAttribute(profiles, 1));
  geometry.setAttribute("surfPhase", new THREE.BufferAttribute(phases, 1));
  if (shoreDirs) geometry.setAttribute("surfShoreDir", new THREE.BufferAttribute(shoreDirs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function smoothWeight(t) {
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

function sampleSmooth(buffer, coord, N) {
  const x0 = floor(coord.x), z0 = floor(coord.y);
  const x1 = min(x0.add(1), float(N - 1)), z1 = min(z0.add(1), float(N - 1));
  const tx = smoothWeight(coord.x.sub(x0)), tz = smoothWeight(coord.y.sub(z0));
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
    const depthBand = smoothstep(float(0.16), float(0.48), b.x)
      .mul(float(1).sub(smoothstep(float(4.0), float(7.2), b.x)));
    const dynamic = max(
      smoothstep(float(0.18), float(0.46), rel),
      smoothstep(float(0.44), float(0.78), froude),
    ).mul(depthBand);
    return vec3(clamp(max(s.w.mul(1.02), dynamic), 0, 1), speed, clamp(s.x, -0.60, 0.60));
  });
}

function waveFront(profile, phase, time, offset, speed, widthA = 0.026, widthB = 0.082) {
  const travel = fract(time.mul(speed).add(float(offset)).add(phase.mul(0.018)));
  const center = float(0.04).add(travel.mul(0.79));
  return float(1).sub(smoothstep(float(widthA), float(widthB), abs(profile.sub(center))));
}

function createShoreWaves(scene, waterY, shallowHandle, shoreline) {
  const geometry = buildContinuousBand(shoreline, null, waterY, shallowHandle, "wave");
  const material = new THREE.MeshStandardNodeMaterial({
    color: 0x2d7078,
    roughness: 0.10,
    metalness: 0,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const time = uniform(0), storm = uniform(0), day = uniform(1), underwater = uniform(0);
  const lightDir = uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const waterColor = uniform(color(0x2a6971));
  const crestColor = uniform(color(0xa8d5d7));
  const foamColor = uniform(color(0xf7f9f3));

  const coord = attribute("surfCoord", "vec2");
  const profile = attribute("surfProfile", "float");
  const phase = attribute("surfPhase", "float");
  const shore = attribute("surfShoreDir", "vec2");
  const terms = breakerTerms(shallowHandle, coord);

  material.positionNode = Fn(() => {
    const t = terms();
    const physical = t.x;
    const speedLocal = t.y;
    const eta = t.z;
    const bathy = sampleSmooth(shallowHandle.bathymetry, coord, shallowHandle.N);
    const wetBand = smoothstep(float(0.12), float(0.42), bathy.x)
      .mul(float(1).sub(smoothstep(float(6.0), float(9.0), bathy.x)));

    const r0 = waveFront(profile, phase, time, 0.00, 0.070);
    const r1 = waveFront(profile, phase, time, 0.25, 0.070, 0.030, 0.090).mul(0.88);
    const r2 = waveFront(profile, phase, time, 0.50, 0.070, 0.034, 0.096).mul(0.72);
    const r3 = waveFront(profile, phase, time, 0.75, 0.070, 0.038, 0.102).mul(0.58);
    const ridge = max(max(r0, r1), max(r2, r3));

    const shoal = smoothstep(float(0.18), float(0.70), profile);
    const breakerBoost = float(0.72).add(physical.mul(0.46));
    const height = ridge
      .mul(wetBand)
      .mul(float(0.10).add(shoal.mul(0.26)))
      .mul(breakerBoost)
      .mul(float(1).add(storm.mul(0.34)));
    const cappedHeight = min(height, float(0.56));
    const lean = ridge.mul(shoal).mul(wetBand).mul(float(0.035).add(speedLocal.mul(0.010)));

    return positionLocal.add(vec3(
      shore.x.mul(lean),
      eta.add(cappedHeight).add(0.015),
      shore.y.mul(lean),
    ));
  })();

  const viewNormal = Fn(() => cross(dFdx(positionView), dFdy(positionView)).normalize())();
  const worldNormal = Fn(() => cross(dFdx(positionWorld), dFdy(positionWorld)).normalize())();
  material.normalNode = viewNormal;

  const frag = terms();
  const r0 = waveFront(profile, phase, time, 0.00, 0.070);
  const r1 = waveFront(profile, phase, time, 0.25, 0.070, 0.030, 0.090).mul(0.88);
  const r2 = waveFront(profile, phase, time, 0.50, 0.070, 0.034, 0.096).mul(0.72);
  const r3 = waveFront(profile, phase, time, 0.75, 0.070, 0.038, 0.102).mul(0.58);
  const ridge = max(max(r0, r1), max(r2, r3));
  const breakZone = smoothstep(float(0.50), float(0.72), profile);

  const laceA = abs(sin(positionWorld.x.mul(1.15).add(positionWorld.z.mul(0.74)).add(time.mul(0.55))));
  const laceB = abs(sin(positionWorld.x.mul(0.63).sub(positionWorld.z.mul(1.28)).sub(time.mul(0.42))));
  const breakup = smoothstep(float(0.46), float(0.86), laceA.mul(0.56).add(laceB.mul(0.44)));
  const foam = clamp(
    ridge.mul(breakZone).mul(float(0.18).add(frag.x.mul(0.78))).mul(float(0.28).add(breakup.mul(0.72))),
    0,
    1,
  );

  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = pow(float(1).sub(clamp(abs(dot(worldNormal, viewDir)), 0, 1)), float(3.2));
  const lightFacing = clamp(dot(worldNormal, lightDir.normalize()), 0, 1);
  const litWater = mix(
    waterColor,
    crestColor,
    clamp(fresnel.mul(0.28).add(lightFacing.mul(day).mul(0.15)), 0, 0.48),
  );
  material.colorNode = mix(litWater, foamColor, foam.mul(0.94));
  material.roughnessNode = mix(float(0.075), float(0.48), foam.mul(0.92));
  material.opacityNode = clamp(
    float(0.08)
      .add(ridge.mul(0.34))
      .add(foam.mul(0.40))
      .mul(float(1).sub(underwater.mul(0.95))),
    0,
    0.72,
  );

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = waterY;
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  scene.add(mesh);
  return { mesh, geometry, material, time, storm, day, underwater, lightDir, waterColor, crestColor, foamColor };
}

function createWash(scene, waterY, sampleHeight, shallowHandle, shoreline) {
  const foamGeometry = buildContinuousBand(shoreline, sampleHeight, waterY, shallowHandle, "wash");
  const wetGeometry = foamGeometry.clone();
  const wetPos = wetGeometry.attributes.position;
  for (let i = 0; i < wetPos.count; i++) wetPos.setY(i, wetPos.getY(i) - 0.024);
  wetPos.needsUpdate = true;

  const time = uniform(0), storm = uniform(0), day = uniform(1);
  const foamColor = uniform(color(0xf7f9f4));
  const wetColor = uniform(color(0x3a3129));
  const coord = attribute("surfCoord", "vec2");
  const profile = attribute("surfProfile", "float");
  const phase = attribute("surfPhase", "float");
  const terms = breakerTerms(shallowHandle, coord);
  const t = terms();

  const swash = float(0.5).add(sin(time.mul(0.38).add(phase.mul(float(TAU * 1.8)))).mul(0.5));
  const energy = clamp(t.x.mul(0.72).add(swash.mul(0.28)).add(storm.mul(0.16)), 0, 1);
  const runup = clamp(
    float(0.40)
      .add(swash.mul(0.18))
      .add(energy.mul(0.16))
      .add(clamp(t.y.mul(0.025), 0, 0.08)),
    0.34,
    0.78,
  );

  const frontEdge = float(1).sub(smoothstep(float(0.012), float(0.050), abs(profile.sub(runup))));
  const backCenter = runup.sub(0.12);
  const backEdge = float(1).sub(smoothstep(float(0.018), float(0.070), abs(profile.sub(backCenter))));
  const behind = float(1).sub(smoothstep(runup.sub(0.22), runup.add(0.02), profile));

  const laceA = abs(sin(positionWorld.x.mul(1.10).add(positionWorld.z.mul(0.92)).add(time.mul(0.66))));
  const laceB = abs(sin(positionWorld.x.mul(1.64).sub(positionWorld.z.mul(0.71)).sub(time.mul(0.49))));
  const lace = smoothstep(float(0.48), float(0.88), laceA.mul(0.52).add(laceB.mul(0.48)));
  const residue = behind.mul(lace).mul(energy).mul(0.12);
  const foamMask = clamp(
    frontEdge.mul(float(0.48).add(energy.mul(0.34)))
      .add(backEdge.mul(0.16).mul(lace))
      .add(residue),
    0,
    1,
  );

  const foamMat = new THREE.MeshBasicNodeMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  foamMat.colorNode = foamColor;
  foamMat.opacityNode = foamMask.mul(float(0.30).add(day.mul(0.28)));

  const wetMat = new THREE.MeshBasicNodeMaterial({
    color: 0x302922,
    transparent: true,
    opacity: 1,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const wetRunup = clamp(runup.add(0.06), 0.38, 0.84);
  const wetFront = float(1).sub(smoothstep(wetRunup.sub(0.16), wetRunup.add(0.06), profile));
  const landMask = smoothstep(float(0.26), float(0.44), profile);
  const wetMask = clamp(wetFront.mul(landMask).mul(float(0.16).add(energy.mul(0.20))), 0, 0.34);
  wetMat.colorNode = wetColor;
  wetMat.opacityNode = wetMask.mul(float(0.72).add(day.mul(0.14)));

  const wet = new THREE.Mesh(wetGeometry, wetMat);
  wet.frustumCulled = false;
  wet.renderOrder = 8;
  scene.add(wet);

  const foam = new THREE.Mesh(foamGeometry, foamMat);
  foam.frustumCulled = false;
  foam.renderOrder = 9;
  scene.add(foam);

  return {
    foam: { mesh: foam, geometry: foamGeometry, material: foamMat, time, storm, day, foamColor },
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
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,.66)");
  g.addColorStop(.3, "rgba(245,250,250,.30)");
  g.addColorStop(1, "rgba(230,248,250,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function createSpray(scene, waterY, shoreline) {
  const positions = new Float32Array(SPRAY_COUNT * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const texture = makeSprayTexture();
  const material = new THREE.PointsMaterial({
    color: 0xf6fbff,
    size: 0.22,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: texture,
    alphaTest: texture ? 0.015 : 0,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 10;
  scene.add(points);

  const particles = Array.from({ length: SPRAY_COUNT }, (_, i) => {
    const shoreIndex = Math.floor(i / SPRAY_COUNT * SHORE_SEGMENTS) % SHORE_SEGMENTS;
    return {
      shore: shoreline[shoreIndex],
      seed: (i * 0.61803398875) % 1,
      speed: 0.14 + (((i * 47) % 83) / 82) * 0.07,
    };
  });
  return { points, geometry, material, texture, particles, waterY };
}

function updateSpray(handle, elapsed, storm, day) {
  const arr = handle.geometry.attributes.position.array;
  for (let i = 0; i < handle.particles.length; i++) {
    const p = handle.particles[i];
    const shore = p.shore;
    const set = 0.5 + 0.5 * Math.sin(elapsed * 0.40 + shore.phase * TAU * 1.8 + p.seed * 5.0);
    const active = smooth01((set - 0.82) / 0.14);
    const life = ((elapsed * p.speed + p.seed) % 1 + 1) % 1;
    const idx = i * 3;

    if (active < 0.08 || life > 0.62) {
      arr[idx] = shore.x;
      arr[idx + 1] = -999;
      arr[idx + 2] = shore.z;
      continue;
    }

    const radial = 0.8 + p.seed * 1.9;
    const shoreward = life * (0.35 + storm * 0.35);
    const rise = Math.sin(Math.PI * Math.min(1, life / 0.62)) * (0.22 + p.seed * 0.42 + storm * 0.18);
    arr[idx] = shore.x + shore.outwardX * (radial - shoreward);
    arr[idx + 1] = handle.waterY + 0.16 + rise;
    arr[idx + 2] = shore.z + shore.outwardZ * (radial - shoreward);
  }
  handle.geometry.attributes.position.needsUpdate = true;
  handle.material.opacity = 0.08 + day * 0.10 + storm * 0.08;
  handle.material.size = 0.20 + storm * 0.07;
}

export function createGPUSurfSystem(scene, sampleHeight, waterY, shallowHandle) {
  if (!scene || !shallowHandle?.gpuShallowWater || !shallowHandle.state || !shallowHandle.bathymetry) return null;
  const shoreline = buildShoreline(sampleHeight, waterY, shallowHandle.domain);
  const waves = createShoreWaves(scene, waterY, shallowHandle, shoreline);
  const wash = createWash(scene, waterY, sampleHeight, shallowHandle, shoreline);
  const spray = createSpray(scene, waterY, shoreline);
  return {
    gpuSurfSystem: true,
    shoreline,
    waves,
    wash: wash.foam,
    wetSand: wash.wet,
    spray,
    waterY,
  };
}

export function updateGPUSurfSystem(handle, elapsed, cameraY, storm = 0, day = 1, sunDir = null) {
  if (!handle?.gpuSurfSystem) return;
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
  const dayT = THREE.MathUtils.clamp(day, 0, 1);
  const stormT = THREE.MathUtils.clamp(storm, 0, 1);
  const t = Number.isFinite(elapsed) ? elapsed : 0;

  if (handle.waves) {
    handle.waves.time.value = t;
    handle.waves.storm.value = stormT;
    handle.waves.day.value = dayT;
    handle.waves.underwater.value = underwater ? 1 : 0;
    if (sunDir && handle.waves.lightDir?.value) handle.waves.lightDir.value.copy(sunDir).normalize();
    handle.waves.waterColor.value.set(0x17383f).lerp(new THREE.Color(0x2a6971), dayT);
    handle.waves.crestColor.value.set(0x67858b).lerp(new THREE.Color(0xa8d5d7), dayT);
    handle.waves.foamColor.value.set(0x8f9b9c).lerp(new THREE.Color(0xf7f9f3), dayT);
    handle.waves.mesh.visible = !underwater;
  }

  for (const layer of [handle.wash, handle.wetSand]) {
    if (!layer) continue;
    layer.time.value = t;
    layer.storm.value = stormT;
    layer.day.value = dayT;
    layer.mesh.visible = !underwater;
  }
  if (handle.wash?.foamColor?.value) {
    handle.wash.foamColor.value.set(0x929d9e).lerp(new THREE.Color(0xf8faf4), dayT);
  }
  if (handle.wetSand?.wetColor?.value) {
    handle.wetSand.wetColor.value.set(0x181a1a).lerp(new THREE.Color(0x3a3129), dayT);
  }

  if (handle.spray) {
    handle.spray.points.visible = !underwater;
    if (!underwater) updateSpray(handle.spray, t, stormT, dayT);
  }
}

export function disposeGPUSurfSystem(scene, handle) {
  if (!handle?.gpuSurfSystem) return;
  for (const layer of [handle.waves, handle.wash, handle.wetSand]) {
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
