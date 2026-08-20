import * as THREE from "three";
import {
  Fn, float, uint, vec2, vec3,
  positionLocal, positionView, positionWorld, cameraPosition,
  attribute, floor, min, max, abs, dFdx, dFdy, cross, dot, pow, mix, clamp,
  smoothstep, sin, sqrt,
} from "three/tsl";
import {
  createGPUSurfSystem as createBaseSurf,
  updateGPUSurfSystem as updateBaseSurf,
  disposeGPUSurfSystem as disposeBaseSurf,
} from "./gpu_surf_system_v4.js";
import {
  createGPUSwashSolver,
  updateGPUSwashSolver,
  updateGPUSwashVisuals,
  disposeGPUSwashSolver,
} from "./gpu_swash_solver_v4.js";

const TAU = Math.PI * 2;
const GRAVITY = 9.81;

function smooth01(t) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
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
    const depthBand = smoothstep(float(0.14), float(0.42), b.x)
      .mul(float(1).sub(smoothstep(float(4.8), float(8.0), b.x)));
    const dynamic = max(
      smoothstep(float(0.16), float(0.42), rel),
      smoothstep(float(0.42), float(0.76), froude),
    ).mul(depthBand);
    return vec3(clamp(max(s.w.mul(1.08), dynamic), 0, 1), speed, clamp(s.x, -0.70, 0.70));
  });
}

function continuousRidge(profile, phase, time) {
  const along = phase.mul(float(TAU));
  const a = sin(
    profile.mul(float(TAU * 3.10))
      .sub(time.mul(0.88))
      .add(along.mul(0.41)),
  );
  const b = sin(
    profile.mul(float(TAU * 4.73))
      .sub(time.mul(1.19))
      .add(along.mul(0.23))
      .add(2.17),
  );
  const c = sin(
    profile.mul(float(TAU * 6.41))
      .sub(time.mul(1.57))
      .add(along.mul(0.12))
      .add(4.61),
  );

  const r0 = smoothstep(float(0.54), float(0.96), a);
  const r1 = smoothstep(float(0.62), float(0.97), b).mul(0.42);
  const r2 = smoothstep(float(0.68), float(0.98), c).mul(0.22);
  const slowSet = float(0.78).add(
    sin(time.mul(0.137).add(along.mul(0.07))).mul(0.16),
  );
  return clamp(max(r0, max(r1, r2)).mul(slowSet), 0, 1);
}

function disposeProceduralLayer(scene, layer) {
  if (!layer) return;
  if (layer.mesh) scene?.remove(layer.mesh);
  try { layer.geometry?.dispose?.(); } catch (_) {}
  try { layer.material?.dispose?.(); } catch (_) {}
}

function removeProceduralWash(scene, handle) {
  if (!handle) return;
  disposeProceduralLayer(scene, handle.wash);
  disposeProceduralLayer(scene, handle.wetSand);
  handle.wash = null;
  handle.wetSand = null;
}

function extendBreakerOntoBeach(handle) {
  const geometry = handle?.waves?.geometry;
  const pos = geometry?.getAttribute?.("position");
  const profile = geometry?.getAttribute?.("surfProfile");
  const shoreDir = geometry?.getAttribute?.("surfShoreDir");
  if (!pos || !profile || !shoreDir || handle.breakerBeachExtensionApplied) return;

  for (let i = 0; i < pos.count; i++) {
    const p = profile.getX(i);
    if (p <= 0.70) continue;
    const t = smooth01((p - 0.70) / 0.30);
    const shift = 1.35 * t;
    pos.setX(i, pos.getX(i) + shoreDir.getX(i) * shift);
    pos.setZ(i, pos.getZ(i) + shoreDir.getY(i) * shift);
  }

  pos.needsUpdate = true;
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  handle.breakerBeachExtensionApplied = true;
}

function installContinuousBreaker(handle, shallowHandle) {
  const waves = handle?.waves;
  const material = waves?.material;
  if (!material || !shallowHandle?.gpuShallowWater || handle.continuousBreakerInstalled) return;

  const coord = attribute("surfCoord", "vec2");
  const profile = attribute("surfProfile", "float");
  const phase = attribute("surfPhase", "float");
  const shore = attribute("surfShoreDir", "vec2");
  const terms = breakerTerms(shallowHandle, coord);
  const time = waves.time;
  const storm = waves.storm;
  const day = waves.day;
  const underwater = waves.underwater;

  material.positionNode = Fn(() => {
    const t = terms();
    const physical = t.x;
    const speedLocal = t.y;
    const eta = t.z;
    const bathy = sampleSmooth(shallowHandle.bathymetry, coord, shallowHandle.N);
    const wetBand = smoothstep(float(0.10), float(0.34), bathy.x)
      .mul(float(1).sub(smoothstep(float(7.2), float(10.0), bathy.x)));

    const ridge = continuousRidge(profile, phase, time);
    const shoal = smoothstep(float(0.20), float(0.72), profile);
    const breakZone = smoothstep(float(0.50), float(0.77), profile);
    const impactZone = smoothstep(float(0.74), float(0.94), profile);
    const landFade = float(1).sub(smoothstep(float(0.95), float(1.02), profile));

    const height = min(
      ridge
        .mul(wetBand)
        .mul(float(0.14).add(shoal.mul(0.54)))
        .mul(float(0.80).add(physical.mul(0.50)))
        .mul(float(1).add(storm.mul(0.30)))
        .mul(landFade),
      float(1.08),
    );

    const pitch = min(
      ridge
        .mul(wetBand)
        .mul(breakZone)
        .mul(float(0.075).add(physical.mul(0.16)))
        .mul(float(1).add(speedLocal.mul(0.015))),
      float(0.29),
    );

    const collapse = ridge
      .mul(wetBand)
      .mul(impactZone)
      .mul(float(0.05).add(physical.mul(0.18)));

    return positionLocal.add(vec3(
      shore.x.mul(pitch),
      eta.add(height).sub(collapse).add(0.018),
      shore.y.mul(pitch),
    ));
  })();

  const viewNormal = Fn(() => cross(dFdx(positionView), dFdy(positionView)).normalize())();
  const worldNormal = Fn(() => cross(dFdx(positionWorld), dFdy(positionWorld)).normalize())();
  material.normalNode = viewNormal;

  const frag = terms();
  const ridge = continuousRidge(profile, phase, time);
  const breakZone = smoothstep(float(0.48), float(0.76), profile);
  const impactZone = smoothstep(float(0.72), float(0.94), profile);
  const laceA = abs(sin(positionWorld.x.mul(1.18).add(positionWorld.z.mul(0.82)).add(time.mul(0.61))));
  const laceB = abs(sin(positionWorld.x.mul(0.69).sub(positionWorld.z.mul(1.34)).sub(time.mul(0.43))));
  const breakup = smoothstep(float(0.38), float(0.84), laceA.mul(0.54).add(laceB.mul(0.46)));
  const crestFoam = ridge
    .mul(breakZone)
    .mul(float(0.25).add(frag.x.mul(0.72)))
    .mul(float(0.40).add(breakup.mul(0.60)));
  const crashFoam = ridge
    .mul(impactZone)
    .mul(float(0.18).add(frag.x.mul(0.74)));
  const foam = clamp(max(crestFoam, crashFoam), 0, 0.90);

  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = pow(float(1).sub(clamp(abs(dot(worldNormal, viewDir)), 0, 1)), float(3.0));
  const lightFacing = clamp(dot(worldNormal, waves.lightDir.normalize()), 0, 1);
  const litWater = mix(
    waves.waterColor,
    waves.crestColor,
    clamp(fresnel.mul(0.32).add(lightFacing.mul(day).mul(0.18)), 0, 0.56),
  );

  material.colorNode = mix(litWater, waves.foamColor, foam.mul(0.92));
  material.roughnessNode = mix(float(0.070), float(0.50), foam.mul(0.90));
  material.opacityNode = clamp(
    float(0.075)
      .add(ridge.mul(0.34))
      .add(foam.mul(0.38))
      .mul(float(1).sub(underwater.mul(0.95))),
    0,
    0.78,
  );
  material.needsUpdate = true;
  handle.continuousBreakerInstalled = true;
}

function pushImpactParticles(layer, elapsed, storm) {
  if (!layer?.points?.visible || !layer.geometry?.attributes?.position || !Array.isArray(layer.particles)) return;
  const arr = layer.geometry.attributes.position.array;
  for (let i = 0; i < layer.particles.length; i++) {
    const p = layer.particles[i];
    const idx = i * 3;
    if (arr[idx + 1] < -100) continue;
    const life = ((elapsed * p.speed + p.seed) % 1 + 1) % 1;
    const shore = p.shore;
    if (!shore) continue;
    const push = life * (layer.mist ? 0.36 : 0.68) * (1 + storm * 0.30);
    arr[idx] += shore.inwardX * push;
    arr[idx + 2] += shore.inwardZ * push;
  }
  layer.geometry.attributes.position.needsUpdate = true;
}

export function createGPUSurfSystem(scene, sampleHeight, waterY, shallowHandle) {
  const handle = createBaseSurf(scene, sampleHeight, waterY, shallowHandle);
  if (!handle?.gpuSurfSystem) return handle;

  removeProceduralWash(scene, handle);
  extendBreakerOntoBeach(handle);
  installContinuousBreaker(handle, shallowHandle);

  handle.fluidSwash = createGPUSwashSolver(
    scene,
    sampleHeight,
    waterY,
    shallowHandle,
    handle.shoreline,
  );
  handle.fluidFoam = !!handle.fluidSwash;

  if (handle.fluidSwash) {
    console.info("[gpu-surf] ACTIVE v7: continuous breakers + animated physical swash foam");
  }
  return handle;
}

export function updateGPUSurfCompute(handle, renderer, elapsedTime = 0) {
  if (!handle?.gpuSurfSystem || !handle.fluidSwash?.gpuSwash) return;
  updateGPUSwashSolver(handle.fluidSwash, renderer, elapsedTime);
}

export function updateGPUSurfSystem(handle, elapsed, cameraY, storm = 0, day = 1, sunDir = null) {
  if (!handle?.gpuSurfSystem) return;
  updateBaseSurf(handle, elapsed, cameraY, storm, day, sunDir);

  if (handle.fluidSwash?.gpuSwash) {
    updateGPUSwashVisuals(handle.fluidSwash, cameraY, storm, day);
    const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
    handle.fluidSwash.mesh.visible = !underwater;
  }

  const underwater = Number.isFinite(cameraY) && cameraY < handle.waterY - 0.10;
  if (!underwater) {
    const t = Number.isFinite(elapsed) ? elapsed : 0;
    const stormT = THREE.MathUtils.clamp(storm, 0, 1);
    pushImpactParticles(handle.spray, t, stormT);
    pushImpactParticles(handle.mist, t, stormT);
  }
}

export function disposeGPUSurfSystem(scene, handle) {
  if (!handle?.gpuSurfSystem) return;
  if (handle.fluidSwash?.gpuSwash) disposeGPUSwashSolver(scene, handle.fluidSwash);
  handle.fluidSwash = null;
  disposeBaseSurf(scene, handle);
}
