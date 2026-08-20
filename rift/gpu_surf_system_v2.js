import * as THREE from "three";
import {
  Fn, uniform, color, float, uint, vec2, vec3,
  positionLocal, positionView, positionWorld, cameraPosition,
  attribute, floor, min, max, abs, dFdx, dFdy, cross, dot, pow, mix, clamp,
  smoothstep, sin, sqrt, fract,
} from "three/tsl";

const PATCH_COUNT = 44;
const BREAKER_ALONG = 12;
const BREAKER_PROFILE = 18;
const BREAKER_HALF_LENGTH = 7.2;
const BREAKER_OUTER = 12.0;
const BREAKER_INNER = 0.5;
const WASH_ALONG = 10;
const WASH_PROFILE = 20;
const WASH_OFFSHORE = 6.0;
const WASH_LANDWARD = 11.5;
const SPRAY_COUNT = 64;
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
  const smooth = new Float32Array(PATCH_COUNT);
  const maxRadius = domain * 0.48;
  for (let i = 0; i < PATCH_COUNT; i++) raw[i] = findShoreRadius(sampleHeight, waterY, i / PATCH_COUNT * TAU, maxRadius);
  for (let i = 0; i < PATCH_COUNT; i++) {
    let sum = 0, weight = 0;
    for (let k = -3; k <= 3; k++) {
      const w = 4 - Math.abs(k);
      sum += raw[(i + k + PATCH_COUNT) % PATCH_COUNT] * w;
      weight += w;
    }
    smooth[i] = sum / weight;
  }
  return Array.from({ length: PATCH_COUNT }, (_, i) => {
    const a = i / PATCH_COUNT * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    return {
      phase: i / PATCH_COUNT,
      cx: ca * smooth[i], cz: sa * smooth[i],
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
  const halfLength = breaker ? BREAKER_HALF_LENGTH : BREAKER_HALF_LENGTH * 1.14;
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
    const source = toCoord(patch.cx + patch.outwardX * 3.0, patch.cz + patch.outwardZ * 3.0, shallowHandle.domain, shallowHandle.N);
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
          const g = sampleHeight ? sampleHeight(x, z) : waterY - 1;
          y = Number.isFinite(g) ? Math.max(waterY + 0.02, g + 0.045) : waterY + 0.02;
        }
        const sc = breaker ? toCoord(x, z, shallowHandle.domain, shallowHandle.N) : source;
        positions[v * 3] = x; positions[v * 3 + 1] = y; positions[v * 3 + 2] = z;
        coords[v * 2] = sc[0]; coords[v * 2 + 1] = sc[1];
        profiles[v] = t; alongs[v] = alongN; phases[v] = patch.phase;
        if (dirs) { dirs[v * 2] = patch.inwardX; dirs[v * 2 + 1] = patch.inwardZ; }
        v++;
      }
    }
    const row = profileSegments + 1;
    for (let a = 0; a < alongSegments; a++) {
      for (let p = 0; p < profileSegments; p++) {
        const i0 = base + a * row + p, i1 = i0 + 1, i2 = base + (a + 1) * row + p, i3 = i2 + 1;
        indices[q++] = i0; indices[q++] = i2; indices[q++] = i1;
        indices[q++] = i1; indices[q++] = i2; indices[q++] = i3;
      }
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setAttribute("surfCoord", new THREE.BufferAttribute(coords, 2));
  g.setAttribute("surfProfile", new THREE.BufferAttribute(profiles, 1));
  g.setAttribute("surfAlong", new THREE.BufferAttribute(alongs, 1));
  g.setAttribute("surfPhase", new THREE.BufferAttribute(phases, 1));
  if (dirs) g.setAttribute("surfShoreDir", new THREE.BufferAttribute(dirs, 2));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeBoundingSphere();
  return g;
}

function smoothWeight(t) { return t.mul(t).mul(float(3).sub(t.mul(2))); }

function sampleSmooth(buffer, coord, N) {
  const x0 = floor(coord.x), z0 = floor(coord.y);
  const x1 = min(x0.add(1), float(N - 1)), z1 = min(z0.add(1), float(N - 1));
  const tx = smoothWeight(coord.x.sub(x0)), tz = smoothWeight(coord.y.sub(z0));
  const row = uint(N);
  const i00 = z0.toUint().mul(row).add(x0.toUint()), i10 = z0.toUint().mul(row).add(x1.toUint());
  const i01 = z1.toUint().mul(row).add(x0.toUint()), i11 = z1.toUint().mul(row).add(x1.toUint());
  return mix(mix(buffer.element(i00), buffer.element(i10), tx), mix(buffer.element(i01), buffer.element(i11), tx), tz);
}

function breakerTerms(shallowHandle, coord) {
  return Fn(() => {
    const s = sampleSmooth(shallowHandle.state, coord, shallowHandle.N);
    const b = sampleSmooth(shallowHandle.bathymetry, coord, shallowHandle.N);
    const depth = max(b.x.add(s.x), float(0.08));
    const speed = vec2(s.y, s.z).length();
    const froude = speed.div(max(sqrt(float(GRAVITY).mul(depth)), float(0.08)));
    const rel = abs(s.x).div(max(b.x, float(0.25)));
    const depthBand = smoothstep(float(0.18), float(0.55), b.x).mul(float(1).sub(smoothstep(float(3.3), float(5.8), b.x)));
    const dynamic = max(smoothstep(float(0.20), float(0.50), rel), smoothstep(float(0.46), float(0.80), froude)).mul(depthBand);
    return vec3(clamp(max(s.w.mul(1.08), dynamic), 0, 1), speed, clamp(s.x, -0.65, 0.65));
  });
}

function createBreaker(scene, waterY, shallowHandle, patches) {
  const geometry = buildBand(patches, null, waterY, shallowHandle, "breaker");
  const material = new THREE.MeshStandardNodeMaterial({ color: 0x2b6871, roughness: 0.09, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false });
  const time = uniform(0), storm = uniform(0), day = uniform(1), underwater = uniform(0);
  const lightDir = uniform(new THREE.Vector3(0.35, 0.8, 0.3));
  const waterColor = uniform(color(0x2a6872)), lipColor = uniform(color(0xa9d7d7)), foamColor = uniform(color(0xf7f9f3));
  const coord = attribute("surfCoord", "vec2"), profile = attribute("surfProfile", "float"), along = attribute("surfAlong", "float"), phase = attribute("surfPhase", "float"), shore = attribute("surfShoreDir", "vec2");
  const terms = breakerTerms(shallowHandle, coord);

  material.positionNode = Fn(() => {
    const t = terms();
    const physical = t.x, speed = t.y, eta = t.z;
    const b = sampleSmooth(shallowHandle.bathymetry, coord, shallowHandle.N);
    const depthBand = smoothstep(float(0.24), float(0.68), b.x).mul(float(1).sub(smoothstep(float(3.0), float(5.4), b.x)));
    const travelA = fract(time.mul(0.090).add(phase.mul(0.16)));
    const travelB = fract(travelA.add(0.52));
    const centerA = float(0.12).add(travelA.mul(0.63)), centerB = float(0.10).add(travelB.mul(0.60));
    const ridgeA = float(1).sub(smoothstep(float(0.045), float(0.135), abs(profile.sub(centerA))));
    const ridgeB = float(1).sub(smoothstep(float(0.055), float(0.155), abs(profile.sub(centerB)))).mul(0.58);
    const ridge = max(ridgeA, ridgeB);
    const seeded = depthBand.mul(float(0.70).add(sin(time.mul(0.16).add(phase.mul(6.0))).mul(0.18))).mul(0.32);
    const energy = clamp(max(physical, seeded).mul(float(1).add(storm.mul(0.30))), 0, 1);
    const breakingZone = smoothstep(float(0.40), float(0.72), profile);
    const height = min(ridge.mul(energy).mul(float(0.44).add(speed.mul(0.035))), float(0.92));
    const shoulder = ridge.mul(energy).mul(breakingZone).mul(0.22);
    const collapse = ridge.mul(energy).mul(smoothstep(float(0.62), float(0.88), profile)).mul(0.24);
    return positionLocal.add(vec3(shore.x.mul(shoulder), eta.add(height).sub(collapse).add(0.022), shore.y.mul(shoulder)));
  })();

  const normal = Fn(() => cross(dFdx(positionView), dFdy(positionView)).normalize())();
  material.normalNode = normal;
  const frag = terms();
  const travel = fract(time.mul(0.090).add(phase.mul(0.16)));
  const center = float(0.12).add(travel.mul(0.63));
  const ridge = float(1).sub(smoothstep(float(0.05), float(0.15), abs(profile.sub(center))));
  const foam = clamp(max(ridge.mul(smoothstep(float(0.43), float(0.72), profile)).mul(frag.x.mul(0.82).add(0.18)), smoothstep(float(0.64), float(0.94), profile).mul(frag.x).mul(0.72)), 0, 1);
  const sideFade = float(1).sub(smoothstep(float(0.72), float(1), abs(along)));
  const worldNormal = Fn(() => cross(dFdx(positionWorld), dFdy(positionWorld)).normalize())();
  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = pow(float(1).sub(clamp(abs(dot(worldNormal, viewDir)), 0, 1)), float(3.2));
  const lightFacing = clamp(dot(worldNormal, lightDir.normalize()), 0, 1);
  material.colorNode = mix(mix(waterColor, lipColor, clamp(fresnel.mul(0.34).add(lightFacing.mul(day).mul(0.14)), 0, 0.56)), foamColor, foam.mul(0.95));
  material.roughnessNode = mix(float(0.075), float(0.52), foam.mul(0.94));
  material.opacityNode = clamp(sideFade.mul(float(0.10).add(frag.x.mul(0.62)).add(foam.mul(0.40))).mul(float(1).sub(underwater.mul(0.94))), 0, 0.88);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = waterY; mesh.frustumCulled = false; mesh.renderOrder = 7; scene.add(mesh);
  return { mesh, geometry, material, time, storm, day, underwater, lightDir, waterColor, lipColor, foamColor };
}

function createWashLayers(scene, waterY, sampleHeight, shallowHandle, patches) {
  const geometry = buildBand(patches, sampleHeight, waterY, shallowHandle, "wash");
  const wetGeometry = geometry.clone();
  const wetPos = wetGeometry.attributes.position;
  for (let i = 0; i < wetPos.count; i++) wetPos.setY(i, wetPos.getY(i) - 0.026);
  wetPos.needsUpdate = true;

  const time = uniform(0), storm = uniform(0), day = uniform(1);
  const foamColor = uniform(color(0xf7f9f3)), wetColor = uniform(color(0x3a332a));
  const coord = attribute("surfCoord", "vec2"), profile = attribute("surfProfile", "float"), along = attribute("surfAlong", "float"), phase = attribute("surfPhase", "float");
  const terms = breakerTerms(shallowHandle, coord);
  const t = terms();
  const pulse = float(0.53).add(sin(time.mul(0.34).add(phase.mul(6.0))).mul(0.34));
  const energy = clamp(max(t.x, smoothstep(float(0.28), float(0.82), pulse).mul(0.26)).mul(float(1).add(storm.mul(0.24))), 0, 1);
  const runup = clamp(float(0.42).add(energy.mul(0.32)).add(clamp(t.y.mul(0.045), 0, 0.14)).add(pulse.mul(0.08)), 0.30, 0.90);
  const sideFade = float(1).sub(smoothstep(float(0.76), float(1), abs(along)));

  const foamMat = new THREE.MeshBasicNodeMaterial({ color: 0xffffff, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false });
  const front = float(1).sub(smoothstep(runup.sub(0.10), runup.add(0.045), profile));
  const edge = float(1).sub(smoothstep(float(0.018), float(0.085), abs(profile.sub(runup))));
  const laceA = abs(sin(positionWorld.x.mul(0.92).add(positionWorld.z.mul(0.74)).add(time.mul(0.72))));
  const laceB = abs(sin(positionWorld.x.mul(1.36).sub(positionWorld.z.mul(0.58)).sub(time.mul(0.53))));
  const lace = smoothstep(float(0.38), float(0.86), laceA.mul(0.56).add(laceB.mul(0.44)));
  const foamMask = clamp(edge.mul(0.95).add(front.mul(energy.mul(0.36).add(0.10)).mul(float(0.28).add(lace.mul(0.72)))), 0, 1).mul(sideFade);
  foamMat.colorNode = foamColor;
  foamMat.opacityNode = foamMask.mul(float(0.46).add(day.mul(0.42)));

  const wetMat = new THREE.MeshBasicNodeMaterial({ color: 0x302a24, transparent: true, opacity: 1, side: THREE.DoubleSide, depthWrite: false });
  const wetRunup = clamp(runup.add(0.08), 0.38, 0.96);
  const wetFront = float(1).sub(smoothstep(wetRunup.sub(0.13), wetRunup.add(0.08), profile));
  const shoreOnly = smoothstep(float(0.16), float(0.34), profile);
  const wetMask = wetFront.mul(shoreOnly).mul(sideFade).mul(float(0.22).add(energy.mul(0.32)).add(pulse.mul(0.14)));
  wetMat.colorNode = wetColor;
  wetMat.opacityNode = clamp(wetMask, 0, 0.48).mul(float(0.72).add(day.mul(0.18)));

  const wet = new THREE.Mesh(wetGeometry, wetMat); wet.frustumCulled = false; wet.renderOrder = 8; scene.add(wet);
  const foam = new THREE.Mesh(geometry, foamMat); foam.frustumCulled = false; foam.renderOrder = 9; scene.add(foam);
  return { foam: { mesh: foam, geometry, material: foamMat, time, storm, day, foamColor }, wet: { mesh: wet, geometry: wetGeometry, material: wetMat, time, storm, day, wetColor } };
}

function makeSprayTexture() {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 64; c.height = 64;
  const ctx = c.getContext("2d"); if (!ctx) return null;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, "rgba(255,255,255,.75)"); g.addColorStop(.3, "rgba(245,250,250,.38)"); g.addColorStop(1, "rgba(230,248,250,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function createSpray(scene, waterY, patches) {
  const positions = new Float32Array(SPRAY_COUNT * 3);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const texture = makeSprayTexture();
  const material = new THREE.PointsMaterial({ color: 0xf6fbff, size: 0.28, transparent: true, opacity: 0.24, depthWrite: false, blending: THREE.AdditiveBlending, map: texture, alphaTest: texture ? 0.015 : 0 });
  const points = new THREE.Points(geometry, material); points.frustumCulled = false; points.renderOrder = 10; scene.add(points);
  const particles = Array.from({ length: SPRAY_COUNT }, (_, i) => ({ patch: patches[i % patches.length], seed: (i * 0.61803398875) % 1, lateral: ((i * 37) % 101) / 50 - 1, radial: ((i * 53) % 97) / 96, speed: 0.16 + (((i * 71) % 89) / 88) * 0.09 }));
  return { points, geometry, material, texture, particles, waterY };
}

function updateSpray(h, elapsed, storm, day) {
  const arr = h.geometry.attributes.position.array;
  for (let i = 0; i < h.particles.length; i++) {
    const p = h.particles[i], patch = p.patch;
    const set = 0.5 + 0.5 * Math.sin(elapsed * 0.42 + patch.phase * 6 + p.seed * 4);
    const active = smooth01((set - 0.76) / 0.18);
    const life = ((elapsed * p.speed + p.seed) % 1 + 1) % 1;
    const idx = i * 3;
    if (active < 0.08 || life > 0.70) { arr[idx] = patch.cx; arr[idx + 1] = -999; arr[idx + 2] = patch.cz; continue; }
    const tangential = p.lateral * BREAKER_HALF_LENGTH * 0.78;
    const outward = 1.3 + p.radial * 2.8;
    const shoreward = life * (0.55 + storm * 0.45);
    const rise = Math.sin(Math.PI * Math.min(1, life / 0.70)) * (0.34 + p.radial * 0.58 + storm * 0.26);
    arr[idx] = patch.cx + patch.tangentX * tangential + patch.outwardX * (outward - shoreward);
    arr[idx + 1] = h.waterY + 0.22 + rise;
    arr[idx + 2] = patch.cz + patch.tangentZ * tangential + patch.outwardZ * (outward - shoreward);
  }
  h.geometry.attributes.position.needsUpdate = true;
  h.material.opacity = 0.12 + day * 0.12 + storm * 0.10;
  h.material.size = 0.24 + storm * 0.09;
}

export function createGPUSurfSystem(scene, sampleHeight, waterY, shallowHandle) {
  if (!scene || !shallowHandle?.gpuShallowWater || !shallowHandle.state || !shallowHandle.bathymetry) return null;
  const patches = buildPatches(sampleHeight, waterY, shallowHandle.domain);
  const breaker = createBreaker(scene, waterY, shallowHandle, patches);
  const wash = createWashLayers(scene, waterY, sampleHeight, shallowHandle, patches);
  const spray = createSpray(scene, waterY, patches);
  return { gpuSurfSystem: true, patches, breaker, wash: wash.foam, wetSand: wash.wet, spray, waterY };
}

export function updateGPUSurfSystem(handle, elapsed, cameraY, storm = 0, day = 1, sunDir = null) {
  if (!handle?.gpuSurfSystem) return;
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
  const dayT = THREE.MathUtils.clamp(day, 0, 1), stormT = THREE.MathUtils.clamp(storm, 0, 1), t = Number.isFinite(elapsed) ? elapsed : 0;
  if (handle.breaker) {
    handle.breaker.time.value = t; handle.breaker.storm.value = stormT; handle.breaker.day.value = dayT; handle.breaker.underwater.value = underwater ? 1 : 0;
    if (sunDir && handle.breaker.lightDir?.value) handle.breaker.lightDir.value.copy(sunDir).normalize();
    handle.breaker.waterColor.value.set(0x173a42).lerp(new THREE.Color(0x2a6872), dayT);
    handle.breaker.lipColor.value.set(0x637f85).lerp(new THREE.Color(0xa9d7d7), dayT);
    handle.breaker.foamColor.value.set(0x8f9b9c).lerp(new THREE.Color(0xf7f9f3), dayT);
    handle.breaker.mesh.visible = !underwater;
  }
  for (const layer of [handle.wash, handle.wetSand]) {
    if (!layer) continue;
    layer.time.value = t; layer.storm.value = stormT; layer.day.value = dayT; layer.mesh.visible = !underwater;
  }
  if (handle.wash?.foamColor?.value) handle.wash.foamColor.value.set(0x929d9e).lerp(new THREE.Color(0xf8faf4), dayT);
  if (handle.wetSand?.wetColor?.value) handle.wetSand.wetColor.value.set(0x181a1a).lerp(new THREE.Color(0x3a332a), dayT);
  if (handle.spray) { handle.spray.points.visible = !underwater; if (!underwater) updateSpray(handle.spray, t, stormT, dayT); }
}

export function disposeGPUSurfSystem(scene, handle) {
  if (!handle?.gpuSurfSystem) return;
  for (const layer of [handle.breaker, handle.wash, handle.wetSand]) {
    if (!layer) continue;
    scene?.remove(layer.mesh); try { layer.geometry?.dispose?.(); } catch (_) {} try { layer.material?.dispose?.(); } catch (_) {}
  }
  if (handle.spray) {
    scene?.remove(handle.spray.points); try { handle.spray.geometry?.dispose?.(); } catch (_) {} try { handle.spray.material?.dispose?.(); } catch (_) {} try { handle.spray.texture?.dispose?.(); } catch (_) {}
  }
}
