import * as THREE from "three";
import {
  Fn, uniform, color, float, uint, vec2,
  positionWorld, attribute, floor, min, abs, sin, cos, pow, max, mix, clamp,
} from "three/tsl";
import { SHALLOW_N, SHALLOW_DOMAIN } from "./gpu_shallow_water.js";

const CAUSTIC_DOMAIN = 320;
const CAUSTIC_SEGMENTS = 160;
const GOD_RAY_COUNT = 16;

function smooth01(t) {
  t = THREE.MathUtils.clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}

function smoothWeight(t) {
  return t.mul(t).mul(float(3).sub(t.mul(2)));
}

function sampleSmoothVec4(buffer, coord, N) {
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

function createBeamTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");

  const horizontal = ctx.createLinearGradient(0, 0, canvas.width, 0);
  horizontal.addColorStop(0, "rgba(255,255,255,0)");
  horizontal.addColorStop(0.28, "rgba(255,255,255,0.12)");
  horizontal.addColorStop(0.5, "rgba(255,255,255,0.82)");
  horizontal.addColorStop(0.72, "rgba(255,255,255,0.12)");
  horizontal.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const vertical = ctx.createLinearGradient(0, 0, 0, canvas.height);
  vertical.addColorStop(0, "rgba(255,255,255,0.0)");
  vertical.addColorStop(0.09, "rgba(255,255,255,0.82)");
  vertical.addColorStop(0.60, "rgba(255,255,255,0.45)");
  vertical.addColorStop(1, "rgba(255,255,255,0.0)");
  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = vertical;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

function buildTerrainConformingCausticGeometry(sampleHeight, waterY) {
  const geometry = new THREE.PlaneGeometry(
    CAUSTIC_DOMAIN,
    CAUSTIC_DOMAIN,
    CAUSTIC_SEGMENTS,
    CAUSTIC_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);

  const pos = geometry.attributes.position;
  const shallowCoords = new Float32Array(pos.count * 2);
  const waterMask = new Float32Array(pos.count);
  const depthMask = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const ground = sampleHeight ? sampleHeight(x, z) : waterY - 8;
    const depth = Number.isFinite(ground) ? waterY - ground : 0;

    if (Number.isFinite(ground)) pos.setY(i, ground + 0.055);
    else pos.setY(i, waterY - 24);

    shallowCoords[i * 2] = THREE.MathUtils.clamp(
      (x / SHALLOW_DOMAIN + 0.5) * (SHALLOW_N - 1),
      0,
      SHALLOW_N - 1,
    );
    shallowCoords[i * 2 + 1] = THREE.MathUtils.clamp(
      (z / SHALLOW_DOMAIN + 0.5) * (SHALLOW_N - 1),
      0,
      SHALLOW_N - 1,
    );

    waterMask[i] = depth > 0.25 ? 1 : 0;
    const emerge = smooth01((depth - 0.25) / 0.85);
    const deepFade = 1 - 0.62 * smooth01((depth - 8.0) / 14.0);
    depthMask[i] = emerge * deepFade;
  }

  geometry.setAttribute("causticShallowCoord", new THREE.Float32BufferAttribute(shallowCoords, 2));
  geometry.setAttribute("causticWaterMask", new THREE.Float32BufferAttribute(waterMask, 1));
  geometry.setAttribute("causticDepthMask", new THREE.Float32BufferAttribute(depthMask, 1));
  geometry.computeVertexNormals();
  return geometry;
}

function createCausticMesh(sampleHeight, waterY, shallowHandle) {
  const geometry = buildTerrainConformingCausticGeometry(sampleHeight, waterY);
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    opacity: 1,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const elapsed = uniform(0.0);
  const daylight = uniform(1.0);
  const underwater = uniform(0.0);
  const storm = uniform(0.0);
  const causticColor = uniform(color(0xd7ffff));

  const coord = attribute("causticShallowCoord", "vec2");
  const waterMask = attribute("causticWaterMask", "float");
  const depthMask = attribute("causticDepthMask", "float");
  const shallow = sampleSmoothVec4(shallowHandle.state, coord, SHALLOW_N);
  const eta = shallow.x;
  const vx = shallow.y;
  const vz = shallow.z;
  const speed = vec2(vx, vz).length();

  // Small live-wave domain warp: enough to make the caustics swim with the
  // simulated surface without turning the pattern into broad streaks.
  const baseX = positionWorld.x.mul(0.58);
  const baseZ = positionWorld.z.mul(0.58);

  const warpA = sin(baseX.mul(0.71).add(baseZ.mul(0.43)).add(elapsed.mul(0.46)));
  const warpB = cos(baseX.mul(-0.39).add(baseZ.mul(0.83)).sub(elapsed.mul(0.34)));

  const qx = baseX.add(warpA.mul(0.52)).add(eta.mul(1.25)).add(vx.mul(0.10));
  const qz = baseZ.add(warpB.mul(0.52)).sub(eta.mul(1.05)).add(vz.mul(0.10));

  // Three independently closed focus fields. Their near-zero contours form the
  // thin, connected cellular lines seen in real swimming-pool/ocean caustics.
  const a1 = sin(qx.mul(1.18));
  const a2 = sin(qz.mul(1.07));
  const a3 = sin(qx.add(qz).mul(0.74).add(elapsed.mul(0.10)));
  const fieldA = a1.add(a2).add(a3.mul(0.62));

  const b1 = sin(qx.mul(1.79).sub(qz.mul(0.41)).add(elapsed.mul(0.15)));
  const b2 = sin(qz.mul(1.63).add(qx.mul(0.36)).sub(elapsed.mul(0.12)));
  const fieldB = b1.add(b2);

  const c1 = sin(qx.mul(0.53).add(qz.mul(1.37)).sub(elapsed.mul(0.08)));
  const c2 = sin(qz.mul(0.59).sub(qx.mul(1.29)).add(elapsed.mul(0.09)));
  const fieldC = c1.add(c2);

  const lineA = pow(float(1).sub(clamp(abs(fieldA).mul(0.78), 0, 1)), float(12));
  const lineB = pow(float(1).sub(clamp(abs(fieldB).mul(0.88), 0, 1)), float(14));
  const lineC = pow(float(1).sub(clamp(abs(fieldC).mul(0.92), 0, 1)), float(15));

  const core = max(lineA, max(lineB.mul(0.82), lineC.mul(0.68)));

  const haloA = pow(float(1).sub(clamp(abs(fieldA).mul(0.43), 0, 1)), float(4));
  const haloB = pow(float(1).sub(clamp(abs(fieldB).mul(0.48), 0, 1)), float(4));
  const halo = max(haloA, haloB.mul(0.70));

  const focus = clamp(float(0.86).add(abs(eta).mul(0.38)).add(speed.mul(0.035)), 0.78, 1.18);
  const lighting = daylight.mul(daylight).mul(float(1).sub(storm.mul(0.76)));
  const visibility = float(0.22).add(underwater.mul(0.78));

  const coreIntensity = core.mul(focus).mul(waterMask).mul(depthMask).mul(lighting).mul(visibility);
  const haloIntensity = halo.mul(0.20).mul(waterMask).mul(depthMask).mul(lighting).mul(visibility);
  const intensity = clamp(coreIntensity.add(haloIntensity), 0, 1.25);

  material.colorNode = causticColor.mul(float(0.15).add(intensity.mul(1.70)));
  material.opacityNode = clamp(intensity.mul(0.86), 0, 0.90);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.userData.causticUniforms = { elapsed, daylight, underwater, storm, causticColor };
  return mesh;
}

function createGodRays(sampleHeight, waterY) {
  const group = new THREE.Group();
  const texture = createBeamTexture();
  const rays = [];
  const rng = (() => {
    let s = 0x51f15e;
    return () => {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();

  for (let i = 0; i < GOD_RAY_COUNT; i++) {
    const angle = rng() * Math.PI * 2;
    const radius = 18 + rng() * 118;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const ground = sampleHeight ? sampleHeight(x, z) : waterY - 10;
    const depth = Number.isFinite(ground) ? waterY - ground : 0;
    if (depth < 2.5) continue;

    const mat = new THREE.SpriteMaterial({
      map: texture,
      color: 0xa8efff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      rotation: (rng() - 0.5) * 0.10,
    });
    const sprite = new THREE.Sprite(mat);
    const length = Math.min(depth * 0.94, 28);
    const width = 2.0 + rng() * 3.8;
    sprite.position.set(x, waterY - length * 0.52, z);
    sprite.scale.set(width, length, 1);
    sprite.visible = false;
    group.add(sprite);

    rays.push({
      sprite,
      baseX: x,
      baseZ: z,
      length,
      width,
      phase: rng() * Math.PI * 2,
      baseOpacity: 0.055 + rng() * 0.085,
      baseRotation: mat.rotation,
    });
  }

  group.userData.beamTexture = texture;
  return { group, rays };
}

export function createGPUUnderwaterLighting(scene, sampleHeight, waterY, shallowHandle) {
  if (!scene || !shallowHandle?.gpuShallowWater) return null;

  const causticMesh = createCausticMesh(sampleHeight, waterY, shallowHandle);
  const godRays = createGodRays(sampleHeight, waterY);
  scene.add(causticMesh);
  scene.add(godRays.group);

  return {
    gpuUnderwaterLighting: true,
    waterY,
    causticMesh,
    godRayGroup: godRays.group,
    rays: godRays.rays,
    beamTexture: godRays.group.userData.beamTexture,
  };
}

export function updateGPUUnderwaterLighting(handle, elapsed, cameraY, dayAmount = 1, stormAmount = 0, sunDir = null) {
  if (!handle?.gpuUnderwaterLighting) return;
  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.08;
  const day = THREE.MathUtils.clamp(dayAmount, 0, 1);
  const storm = THREE.MathUtils.clamp(stormAmount, 0, 1);

  const u = handle.causticMesh?.userData?.causticUniforms;
  if (u) {
    u.elapsed.value = Number.isFinite(elapsed) ? elapsed : 0;
    u.daylight.value = day;
    u.underwater.value = underwater ? 1 : 0;
    u.storm.value = storm;
    u.causticColor.value.set(0x78dce9).lerp(new THREE.Color(0xe5ffff), day);
  }

  const sunX = sunDir?.x ?? 0.35;
  const sunZ = sunDir?.z ?? 0.25;
  const t = Number.isFinite(elapsed) ? elapsed : 0;
  const globalIntensity = Math.pow(day, 1.55) * (1 - storm * 0.72) * (underwater ? 1 : 0);

  for (const ray of handle.rays ?? []) {
    const w1 = Math.sin(t * 0.62 + ray.phase);
    const w2 = Math.sin(t * 1.07 + ray.phase * 1.73);
    const focus = 0.72 + 0.20 * w1 + 0.08 * w2;
    const driftX = w1 * 0.85 + w2 * 0.32;
    const driftZ = Math.cos(t * 0.48 + ray.phase) * 0.72;
    const refractLean = ray.length * 0.075;

    ray.sprite.visible = globalIntensity > 0.015;
    ray.sprite.material.opacity = ray.baseOpacity * globalIntensity * Math.max(0.24, focus);
    ray.sprite.material.rotation = ray.baseRotation + w2 * 0.055;
    ray.sprite.position.x = ray.baseX + driftX - sunX * refractLean;
    ray.sprite.position.z = ray.baseZ + driftZ - sunZ * refractLean;
    ray.sprite.scale.x = ray.width * (0.78 + focus * 0.32);
    ray.sprite.scale.y = ray.length * (0.96 + w1 * 0.025);
  }
}

export function disposeGPUUnderwaterLighting(scene, handle) {
  if (!handle?.gpuUnderwaterLighting) return;
  if (handle.causticMesh) {
    scene?.remove(handle.causticMesh);
    try { handle.causticMesh.geometry?.dispose?.(); } catch (_) {}
    try { handle.causticMesh.material?.dispose?.(); } catch (_) {}
  }
  if (handle.godRayGroup) scene?.remove(handle.godRayGroup);
  for (const ray of handle.rays ?? []) {
    try { ray.sprite.material?.dispose?.(); } catch (_) {}
  }
  try { handle.beamTexture?.dispose?.(); } catch (_) {}
}
