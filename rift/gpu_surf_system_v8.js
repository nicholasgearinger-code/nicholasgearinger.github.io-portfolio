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
} from "./gpu_surf_system_v7.js";
import { disposeGPUSwashSolver as disposeOldSwash } from "./gpu_swash_solver_v4.js";
import {
  createGPUSwashSolver,
  updateGPUSwashSolver,
  updateGPUSwashVisuals,
} from "./gpu_swash_solver_v5.js";

const TAU = Math.PI * 2;
const GRAVITY = 9.81;

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
    const depth = max(b.x.add(s.x), float(0.07));
    const speed = vec2(s.y, s.z).length();
    const froude = speed.div(max(sqrt(float(GRAVITY).mul(depth)), float(0.07)));
    const rel = abs(s.x).div(max(b.x, float(0.22)));
    const depthBand = smoothstep(float(0.10), float(0.32), b.x)
      .mul(float(1).sub(smoothstep(float(4.2), float(7.0), b.x)));
    const dynamic = max(
      smoothstep(float(0.13), float(0.38), rel),
      smoothstep(float(0.40), float(0.78), froude),
    ).mul(depthBand);
    return vec3(clamp(max(s.w.mul(1.10), dynamic), 0, 1), speed, clamp(s.x, -0.75, 0.75));
  });
}

function refinedRidge(profile, phase, time) {
  const along = phase.mul(float(TAU));
  const p0 = sin(profile.mul(float(TAU * 2.82)).sub(time.mul(0.74)).add(along.mul(0.29)));
  const p1 = sin(profile.mul(float(TAU * 4.37)).sub(time.mul(1.07)).add(along.mul(0.17)).add(1.81));
  const p2 = sin(profile.mul(float(TAU * 6.13)).sub(time.mul(1.43)).sub(along.mul(0.11)).add(4.27));

  const broad = pow(clamp(p0.mul(0.5).add(0.5), 0, 1), float(3.2));
  const mid = pow(clamp(p1.mul(0.5).add(0.5), 0, 1), float(5.0)).mul(0.34);
  const short = pow(clamp(p2.mul(0.5).add(0.5), 0, 1), float(6.8)).mul(0.15);
  const setEnvelope = float(0.76)
    .add(sin(time.mul(0.113).add(along.mul(0.051))).mul(0.15))
    .add(sin(time.mul(0.071).sub(along.mul(0.033)).add(2.6)).mul(0.07));

  return clamp(max(broad, max(mid, short)).mul(setEnvelope), 0, 1);
}

function installRefinedBreaker(handle, shallowHandle) {
  const waves = handle?.waves;
  const material = waves?.material;
  if (!material || !shallowHandle?.gpuShallowWater || handle.realisticBreakerV8Installed) return;

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

    const wetBand = smoothstep(float(0.08), float(0.28), bathy.x)
      .mul(float(1).sub(smoothstep(float(6.4), float(9.2), bathy.x)));
    const ridge = refinedRidge(profile, phase, time);
    const shoal = smoothstep(float(0.17), float(0.70), profile);
    const breakZone = smoothstep(float(0.50), float(0.78), profile);
    const lipZone = smoothstep(float(0.60), float(0.84), profile)
      .mul(float(1).sub(smoothstep(float(0.90), float(1.01), profile)));
    const impactZone = smoothstep(float(0.74), float(0.96), profile);
    const landFade = float(1).sub(smoothstep(float(0.97), float(1.035), profile));

    const height = min(
      ridge
        .mul(wetBand)
        .mul(float(0.12).add(shoal.mul(0.66)))
        .mul(float(0.76).add(physical.mul(0.58)))
        .mul(float(1).add(storm.mul(0.32)))
        .mul(landFade),
      float(1.22),
    );

    const lip = min(
      pow(ridge, float(1.65))
        .mul(wetBand)
        .mul(lipZone)
        .mul(float(0.045).add(physical.mul(0.13))),
      float(0.18),
    );

    const pitch = min(
      ridge
        .mul(wetBand)
        .mul(breakZone)
        .mul(float(0.085).add(physical.mul(0.21)))
        .mul(float(1).add(speedLocal.mul(0.017)))
        .add(lip.mul(0.42)),
      float(0.38),
    );

    const collapse = ridge
      .mul(wetBand)
      .mul(impactZone)
      .mul(float(0.055).add(physical.mul(0.20)));

    return positionLocal.add(vec3(
      shore.x.mul(pitch),
      eta.add(height).add(lip).sub(collapse).add(0.018),
      shore.y.mul(pitch),
    ));
  })();

  const viewNormal = Fn(() => cross(dFdx(positionView), dFdy(positionView)).normalize())();
  const worldNormal = Fn(() => cross(dFdx(positionWorld), dFdy(positionWorld)).normalize())();
  material.normalNode = viewNormal;

  const frag = terms();
  const ridge = refinedRidge(profile, phase, time);
  const breakZone = smoothstep(float(0.48), float(0.78), profile);
  const impactZone = smoothstep(float(0.72), float(0.96), profile);

  const laceA = abs(sin(positionWorld.x.mul(1.37).add(positionWorld.z.mul(0.91)).add(time.mul(0.54))));
  const laceB = abs(sin(positionWorld.x.mul(0.77).sub(positionWorld.z.mul(1.63)).sub(time.mul(0.39))));
  const laceC = abs(sin(positionWorld.x.mul(2.11).add(positionWorld.z.mul(0.41)).add(time.mul(0.23))));
  const breakup = smoothstep(
    float(0.34), float(0.86),
    laceA.mul(0.44).add(laceB.mul(0.36)).add(laceC.mul(0.20)),
  );

  const crestFoam = pow(ridge, float(1.45))
    .mul(breakZone)
    .mul(float(0.22).add(frag.x.mul(0.78)))
    .mul(float(0.34).add(breakup.mul(0.66)));
  const crashFoam = ridge
    .mul(impactZone)
    .mul(float(0.16).add(frag.x.mul(0.78)))
    .mul(float(0.48).add(breakup.mul(0.52)));
  const foam = clamp(max(crestFoam, crashFoam), 0, 0.86);

  const viewDir = cameraPosition.sub(positionWorld).normalize();
  const fresnel = pow(float(1).sub(clamp(abs(dot(worldNormal, viewDir)), 0, 1)), float(4.0));
  const lightFacing = clamp(dot(worldNormal, waves.lightDir.normalize()), 0, 1);
  const backlit = float(1).sub(lightFacing)
    .mul(ridge)
    .mul(breakZone)
    .mul(day)
    .mul(0.16);

  let litWater = mix(
    waves.waterColor,
    waves.crestColor,
    clamp(fresnel.mul(0.38).add(lightFacing.mul(day).mul(0.17)), 0, 0.60),
  );
  litWater = mix(litWater, waves.crestColor, clamp(backlit, 0, 0.18));

  material.colorNode = mix(litWater, waves.foamColor, foam.mul(0.90));
  material.roughnessNode = mix(float(0.060), float(0.46), foam.mul(0.92));
  material.opacityNode = clamp(
    float(0.060)
      .add(ridge.mul(0.31))
      .add(foam.mul(0.34))
      .mul(float(1).sub(underwater.mul(0.96))),
    0,
    0.72,
  );
  material.needsUpdate = true;
  handle.realisticBreakerV8Installed = true;
}

function addSprayTurbulence(layer, elapsed, storm) {
  if (!layer?.points?.visible || !layer.geometry?.attributes?.position || !Array.isArray(layer.particles)) return;
  const arr = layer.geometry.attributes.position.array;
  for (let i = 0; i < layer.particles.length; i++) {
    const p = layer.particles[i];
    const idx = i * 3;
    if (arr[idx + 1] < -100 || !p.shore) continue;

    const flutter = Math.sin(elapsed * (1.7 + p.seed * 0.8) + p.seed * 17.0);
    const gust = Math.sin(elapsed * 0.63 + p.seed * 11.0) * 0.5 + 0.5;
    const lateral = flutter * (layer.mist ? 0.10 : 0.055) * (1 + storm * 0.45);
    const lift = gust * (layer.mist ? 0.035 : 0.055) * (1 + storm * 0.35);

    arr[idx] += -p.shore.outwardZ * lateral;
    arr[idx + 2] += p.shore.outwardX * lateral;
    arr[idx + 1] += lift;
  }
  layer.geometry.attributes.position.needsUpdate = true;
}

export function createGPUSurfSystem(scene, sampleHeight, waterY, shallowHandle) {
  const handle = createBaseSurf(scene, sampleHeight, waterY, shallowHandle);
  if (!handle?.gpuSurfSystem) return handle;

  if (handle.fluidSwash?.gpuSwash) {
    disposeOldSwash(scene, handle.fluidSwash);
  }
  handle.fluidSwash = createGPUSwashSolver(
    scene,
    sampleHeight,
    waterY,
    shallowHandle,
    handle.shoreline,
  );
  handle.fluidFoam = !!handle.fluidSwash;

  installRefinedBreaker(handle, shallowHandle);

  if (handle.fluidSwash) {
    console.info("[gpu-surf] ACTIVE v8: refined shoaling breakers + swash v5 wet-sand memory");
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
    addSprayTurbulence(handle.spray, t, stormT);
    addSprayTurbulence(handle.mist, t, stormT);

    if (handle.spray?.material) {
      handle.spray.material.opacity = (0.22 + day * 0.16 + stormT * 0.14);
      handle.spray.material.size = 0.27 + stormT * 0.10;
    }
    if (handle.mist?.material) {
      handle.mist.material.opacity = 0.045 + day * 0.055 + stormT * 0.075;
      handle.mist.material.size = 0.58 + stormT * 0.16;
    }
  }
}

export function disposeGPUSurfSystem(scene, handle) {
  disposeBaseSurf(scene, handle);
}
