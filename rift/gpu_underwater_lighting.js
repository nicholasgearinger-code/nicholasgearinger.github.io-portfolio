import * as THREE from "three";
import {
  Fn, uniform, color, float, uint, vec2, vec3,
  positionWorld, attribute, floor, min, abs, sin, cos, pow, max, mix, clamp,
  smoothstep,
} from "three/tsl";
import { SHALLOW_N, SHALLOW_DOMAIN } from "./gpu_shallow_water.js";

const CAUSTIC_DOMAIN = 320;
const CAUSTIC_SEGMENTS = 176;
const GOD_RAY_COUNT = 22;
const WATER_IOR = 1.333;
const AIR_IOR = 1.0003;

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
  canvas.width = 128;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Several overlapping cores avoid the obvious single-sprite flashlight look.
  const cores = [
    { x: 0.42, width: 0.18, alpha: 0.58 },
    { x: 0.52, width: 0.12, alpha: 0.78 },
    { x: 0.61, width: 0.20, alpha: 0.36 },
  ];
  for (const core of cores) {
    const x0 = canvas.width * core.x;
    const radius = canvas.width * core.width;
    const g = ctx.createLinearGradient(x0 - radius, 0, x0 + radius, 0);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(0.5, `rgba(255,255,255,${core.alpha})`);
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const vertical = ctx.createLinearGradient(0, 0, 0, canvas.height);
  vertical.addColorStop(0, "rgba(255,255,255,0.0)");
  vertical.addColorStop(0.05, "rgba(255,255,255,0.96)");
  vertical.addColorStop(0.36, "rgba(255,255,255,0.62)");
  vertical.addColorStop(0.76, "rgba(255,255,255,0.20)");
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
  const depthFocus = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const ground = sampleHeight ? sampleHeight(x, z) : waterY - 8;
    const depth = Number.isFinite(ground) ? waterY - ground : 0;

    if (Number.isFinite(ground)) pos.setY(i, ground + 0.06);
    else pos.setY(i, waterY - 24);

    shallowCoords[i * 2] = THREE.MathUtils.clamp(
      (x / SHALLOW_DOMAIN + 0.5) * (SHALLOW_N - 1), 0, SHALLOW_N - 1,
    );
    shallowCoords[i * 2 + 1] = THREE.MathUtils.clamp(
      (z / SHALLOW_DOMAIN + 0.5) * (SHALLOW_N - 1), 0, SHALLOW_N - 1,
    );

    waterMask[i] = depth > 0.20 ? 1 : 0;
    // Caustics are strongest in shallow/medium water and soften with depth.
    const emerge = smooth01((depth - 0.15) / 0.9);
    const deepFade = 1 - 0.72 * smooth01((depth - 7.0) / 15.0);
    depthFocus[i] = emerge * deepFade;
  }

  geometry.setAttribute("causticShallowCoord", new THREE.Float32BufferAttribute(shallowCoords, 2));
  geometry.setAttribute("causticWaterMask", new THREE.Float32BufferAttribute(waterMask, 1));
  geometry.setAttribute("causticDepthFocus", new THREE.Float32BufferAttribute(depthFocus, 1));
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
  const sunDirection = uniform(new THREE.Vector3(0.35, 0.82, 0.28));
  const causticColor = uniform(color(0xc9ffff));

  const coord = attribute("causticShallowCoord", "vec2");
  const waterMask = attribute("causticWaterMask", "float");
  const depthFocus = attribute("causticDepthFocus", "float");
  const shallow = sampleSmoothVec4(shallowHandle.state, coord, SHALLOW_N);
  const eta = shallow.x;
  const vx = shallow.y;
  const vz = shallow.z;
  const speed = vec2(vx, vz).length();

  // Domain warp driven by live water motion. This gives the caustic network the
  // characteristic swimming/folding motion produced by changing surface normals.
  const wx = positionWorld.x.mul(0.34);
  const wz = positionWorld.z.mul(0.34);
  const warpX = sin(wx.mul(0.73).add(wz.mul(0.41)).add(elapsed.mul(0.54)))
    .add(sin(wx.mul(-0.38).add(wz.mul(0.91)).sub(elapsed.mul(0.37))).mul(0.72))
    .add(eta.mul(2.3))
    .add(vx.mul(0.18));
  const warpZ = cos(wx.mul(0.56).sub(wz.mul(0.67)).sub(elapsed.mul(0.46)))
    .add(sin(wx.mul(0.88).add(wz.mul(0.22)).add(elapsed.mul(0.31))).mul(0.68))
    .sub(eta.mul(1.9))
    .add(vz.mul(0.18));

  const qx = wx.add(warpX.mul(0.88));
  const qz = wz.add(warpZ.mul(0.88));

  // Thin zero-contours of several differently rotated wave fields form an
  // interconnected cellular network. Unlike the previous broad sine bands,
  // this concentrates energy into narrow bright lines like real focused light.
  const f1 = sin(qx.mul(1.07))
    .add(sin(qz.mul(1.13)))
    .add(sin(qx.add(qz).mul(0.71)).mul(0.66));
  const f2 = sin(qx.mul(1.83).sub(qz.mul(0.47)).add(elapsed.mul(0.21)))
    .add(sin(qz.mul(1.69).add(qx.mul(0.39)).sub(elapsed.mul(0.17)))
    .add(sin(qx.sub(qz).mul(1.12)).mul(0.54));
  const f3 = sin(qx.mul(0.58).add(qz.mul(1.31)).sub(elapsed.mul(0.11)))
    .add(sin(qz.mul(0.62).sub(qx.mul(1.27)).add(elapsed.mul(0.13)));

  const edge1 = pow(float(1).sub(clamp(abs(f1).mul(0.72), 0, 1)), float(9.0));
  const edge2 = pow(float(1).sub(clamp(abs(f2).mul(0.86), 0, 1)), float(11.0));
  const edge3 = pow(float(1).sub(clamp(abs(f3).mul(0.94), 0, 1)), float(13.0));
  const fineNetwork = clamp(max(edge1, max(edge2.mul(0.82), edge3.mul(0.62))), 0, 1);

  // A broader secondary focus gives the white lines a faint luminous halo while
  // preserving a very bright narrow core.
  const halo1 = pow(float(1).sub(clamp(abs(f1).mul(0.40), 0, 1)), float(3.2));
  const halo2 = pow(float(1).sub(clamp(abs(f2).mul(0.46), 0, 1)), float(3.6));
  const halo = max(halo1, halo2.mul(0.72));

  const sunIncidence = clamp(sunDirection.y, 0, 1);
  const motionFocus = clamp(float(0.82).add(abs(eta).mul(0.55)).add(speed.mul(0.045)), 0.72, 1.25);
  const daylightFocus = daylight.mul(daylight).mul(sunIncidence.mul(0.68).add(0.32));
  const weather = float(1).sub(storm.mul(0.82));
  const viewBoost = float(0.16).add(underwater.mul(0.84));

  const coreIntensity = fineNetwork.mul(motionFocus)
    .mul(waterMask).mul(depthFocus).mul(daylightFocus).mul(weather).mul(viewBoost);
  const haloIntensity = halo.mul(0.21)
    .mul(waterMask).mul(depthFocus).mul(daylightFocus).mul(weather).mul(viewBoost);
  const intensity = clamp(coreIntensity.add(haloIntensity), 0, 1.35);

  material.colorNode = causticColor.mul(float(0.18).add(intensity.mul(1.55)));
  material.opacityNode = clamp(intensity.mul(0.82), 0, 0.92);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  mesh.userData.causticUniforms = {
    elapsed, daylight, underwater, storm, sunDirection, causticColor,
  };
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
    const radius = 12 + rng() * 126;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const ground = sampleHeight ? sampleHeight(x, z) : waterY - 10;
    const depth = Number.isFinite(ground) ? waterY - ground : 0;
    if (depth < 2.2) continue;

    const mat = new THREE.SpriteMaterial({
      map: texture,
      color: 0xbaf8ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      rotation: (rng() - 0.5) * 0.08,
    });
    const sprite = new THREE.Sprite(mat);
    const length = Math.min(depth * 0.96, 30);
    const width = 1.1 + rng() * 3.0;
    sprite.position.set(x, waterY - length * 0.50, z);
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
      baseOpacity: 0.035 + rng() * 0.065,
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
  const t = Number.isFinite(elapsed) ? elapsed : 0;

  const sx = sunDir?.x ?? 0.35;
  const sy = Math.max(0.03, sunDir?.y ?? 0.82);
  const sz = sunDir?.z ?? 0.28;

  const u = handle.causticMesh?.userData?.causticUniforms;
  if (u) {
    u.elapsed.value = t;
    u.daylight.value = day;
    u.underwater.value = underwater ? 1 : 0;
    u.storm.value = storm;
    u.sunDirection.value.set(sx, sy, sz).normalize();
    u.causticColor.value.set(0x78e1ee).lerp(new THREE.Color(0xe5ffff), day);
  }

  // Snell's law: air -> water. Use the refracted sun angle to lean the beams,
  // rather than an arbitrary screen-space tilt.
  const horizontalIncident = Math.hypot(sx, sz);
  const sinThetaAir = THREE.MathUtils.clamp(horizontalIncident, 0, 0.999);
  const sinThetaWater = THREE.MathUtils.clamp((AIR_IOR / WATER_IOR) * sinThetaAir, 0, 0.999);
  const cosThetaWater = Math.sqrt(Math.max(1e-5, 1 - sinThetaWater * sinThetaWater));
  const horizontalScale = horizontalIncident > 1e-5 ? sinThetaWater / horizontalIncident : 0;
  const refractX = sx * horizontalScale;
  const refractZ = sz * horizontalScale;
  const refractSlope = sinThetaWater / Math.max(cosThetaWater, 0.08);

  const globalIntensity = Math.pow(day, 1.7) * Math.pow(sy, 0.62) * (1 - storm * 0.78) * (underwater ? 1 : 0);

  for (const ray of handle.rays ?? []) {
    const w1 = Math.sin(t * 0.54 + ray.phase);
    const w2 = Math.sin(t * 0.93 + ray.phase * 1.61);
    const w3 = Math.cos(t * 1.37 + ray.phase * 0.77);
    const focus = 0.66 + 0.18 * w1 + 0.11 * w2 + 0.05 * w3;
    const driftX = w1 * 0.62 + w2 * 0.22;
    const driftZ = Math.cos(t * 0.43 + ray.phase) * 0.58 + w3 * 0.16;
    const refractLean = ray.length * refractSlope * 0.34;

    ray.sprite.visible = globalIntensity > 0.012;
    ray.sprite.material.opacity = ray.baseOpacity * globalIntensity * Math.max(0.18, focus);
    ray.sprite.material.rotation = ray.baseRotation + w2 * 0.038;
    ray.sprite.position.x = ray.baseX + driftX - refractX * refractLean;
    ray.sprite.position.z = ray.baseZ + driftZ - refractZ * refractLean;
    ray.sprite.scale.x = ray.width * (0.62 + Math.max(0.18, focus) * 0.58);
    ray.sprite.scale.y = ray.length * (0.985 + w1 * 0.014);
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
