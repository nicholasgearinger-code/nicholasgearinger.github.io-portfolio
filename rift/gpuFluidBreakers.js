// Coral Shallows: fluid-driven plunging-breaker sheet.
// Unlike the former time-animated curl, this narrow surface is shaped and
// aerated by the EXISTING 2D GPU shallow-water state: eta, velocity and W
// (energy dissipated by hydraulic-jump breaking). No CPU readback, extra GPU
// compute dispatch, texture, full-screen pass or expensive neighbor solver.
//
// NOTE: the water beneath is still a depth-integrated heightfield. This
// renders an overturning *sheet* from solved energy; it is not a general 3D
// SPH/FLIP ocean volume. ?riftBreakFluid=off restores the old curling sheet.
import * as THREE from "three";
import {
  Fn, attribute, float, vec3, color, clamp, max, abs,
  mix, smoothstep,
} from "three/tsl";
import { createFluidLabShoreFlow } from "./fluidLabShoreFlow.js";

const MOBILE = typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "") ||
    (navigator.maxTouchPoints || 0) > 0);

function saturate(n) { return Math.max(0, Math.min(1, n)); }

export function createGPUFluidBreakers(scene, ocean) {
  const shore = ocean?.fftSurfSystem;
  const shallow = ocean?.fftShallowHandle;
  const samples = shore?.__riftShoreFoamLayers?.samples;
  if (!scene || !ocean?.gpuFFT || !shallow?.gpuShallowWater ||
      !Array.isArray(samples) || samples.length < 8) return null;

  const along = Math.min(MOBILE ? 56 : 88, samples.length);
  const rows = MOBILE ? 6 : 9;
  const verts = (along + 1) * (rows + 1);
  const position = new Float32Array(verts * 3);
  const shallowCoords = new Float32Array(verts * 2);
  const outward = new Float32Array(verts * 2);
  const verticalParam = new Float32Array(verts);
  const shoreDepth = new Float32Array(verts);
  const coverage = new Float32Array(verts);
  const indices = [];
  const N = shallow.N || 256;
  const domain = shallow.domain || 360;
  const waterY = ocean.waterY ?? 0;

  for (let i = 0; i <= along; i++) {
    const source = samples[Math.floor((i % along) * samples.length / along)];
    // Coast samples point into the sea, away from the beach.
    let ox = Number(source.outwardX) || 0;
    let oz = Number(source.outwardZ) || 0;
    const len = Math.hypot(ox, oz) || 1;
    ox /= len; oz /= len;
    const x = source.x + ox * 2.1;
    const z = source.z + oz * 2.1;
    const ux = saturate(x / domain + 0.5) * (N - 1);
    const uz = saturate(z / domain + 0.5) * (N - 1);
    const depth = Math.max(0, waterY - (Number(source.seaY) || waterY - 2));
    const wet = 1 - saturate((Math.max(Math.abs(x), Math.abs(z)) /
      (domain * 0.5) - 0.78) / 0.17);
    for (let j = 0; j <= rows; j++) {
      const k = i * (rows + 1) + j;
      const off = k * 3;
      const v = j / rows;
      position[off] = x;
      position[off + 1] = waterY + 0.025;
      position[off + 2] = z;
      shallowCoords[k * 2] = ux;
      shallowCoords[k * 2 + 1] = uz;
      outward[k * 2] = ox;
      outward[k * 2 + 1] = oz;
      verticalParam[k] = v;
      shoreDepth[k] = Math.min(depth, 24);
      coverage[k] = wet;
      if (i < along && j < rows) {
        const a = k, b = k + rows + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(position, 3));
  geometry.setAttribute("shallowCoord", new THREE.BufferAttribute(shallowCoords, 2));
  geometry.setAttribute("shallowCoverage", new THREE.BufferAttribute(coverage, 1));
  geometry.setAttribute("riftBreakerOutward", new THREE.BufferAttribute(outward, 2));
  geometry.setAttribute("riftBreakerV", new THREE.BufferAttribute(verticalParam, 1));
  geometry.setAttribute("riftBreakerDepth", new THREE.BufferAttribute(shoreDepth, 1));
  geometry.setIndex(indices);

  const hydro = createFluidLabShoreFlow(ocean, geometry);
  if (!hydro) {
    geometry.dispose();
    return null;
  }

  const v = attribute("riftBreakerV", "float");
  const direction = attribute("riftBreakerOutward", "vec2");
  const bathy = attribute("riftBreakerDepth", "float");
  const sim = hydro.state;
  const wetBand = smoothstep(float(0.15), float(0.60), bathy)
    .mul(float(1).sub(smoothstep(float(4.6), float(7.2), bathy)))
    .mul(hydro.coverage);
  const crest = smoothstep(float(0.015), float(0.24), sim.x)
    .mul(clamp(sim.w.mul(0.82).add(abs(sim.y).add(abs(sim.z))
      .mul(0.045)), 0, 1))
    .mul(wetBand);
  const breaking = smoothstep(float(0.13), float(0.62), sim.w);
  const height = clamp(max(sim.x, float(0)).mul(1.20)
    .add(sim.w.mul(0.27)).add(float(0.11)), 0.04, 0.74)
    .mul(crest);
  const lip = smoothstep(float(0.55), float(0.98), v)
    .mul(breaking);
  const white = clamp(lip.mul(0.83)
    .add(sim.w.mul(0.20)).add(v.mul(0.07)), 0, 1);
  const submerged = ocean.fftUnderwaterMix ?? null;

  const material = new THREE.MeshBasicNodeMaterial({
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    opacity: 1,
    color: 0x3babb8,
  });
  material.forceSinglePass = true;
  material.positionNode = Fn(() => {
    // The water folds SHOREWARD over itself at the crest. The height and
    // aeration originate in the same hydraulic-break energy as the foam.
    const baseline = float(0.61).mul(float(1).sub(v));
    const forwardCurl = lip.mul(height).mul(0.80);
    // Advect the whole breaker shoreward with the solved water velocity.
    // A fixed x/z curl would simply stand still and fade, even if fluid
    // crossed it. Outward is the coast normal pointing toward the sea.
    const shorewardFlow = sim.y.mul(direction.x)
      .add(sim.z.mul(direction.y)).negate();
    const travel = clamp(shorewardFlow.mul(0.23)
      .add(sim.x.mul(0.27)), -0.27, 0.54).mul(crest);
    const radial = baseline.sub(forwardCurl).sub(travel);
    const y = max(sim.x, float(0)).mul(0.72)
      .add(v.mul(height))
      .sub(lip.mul(height).mul(smoothstep(float(0.78), float(1), v)).mul(0.35));
    return vec3(
      attribute("position", "vec3").x.add(direction.x.mul(radial)),
      float(waterY + 0.026).add(y),
      attribute("position", "vec3").z.add(direction.y.mul(radial)),
    );
  })();
  material.colorNode = mix(color(0x238c9a), color(0xf0fbf8), white);
  material.opacityNode = clamp(crest.mul(float(0.30).add(v.mul(0.50)))
    .mul(submerged ? float(1).sub(submerged.mul(0.96)) : float(1)),
    0, 0.80);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "rift-solved-fluid-breaking-wave";
  mesh.renderOrder = 12;
  mesh.frustumCulled = false; // positions are displaced entirely on the GPU
  scene.add(mesh);

  // Existing time-scripted curling wall must not render on top of the real
  // solved-fluid crest. Persistent foam/swashing still run as before.
  shore.__riftGPUFluidBreaker = true;
  let disposed = false;
  return {
    mesh, geometry, material, vertices: verts,
    dispose() {
      if (disposed) return;
      disposed = true;
      shore.__riftGPUFluidBreaker = false;
      scene.remove(mesh);
      // WebGPU can have queued submissions referring to resources from
      // the previous frame. Remove immediately, defer GPU resource free.
      const release = () => { geometry.dispose(); material.dispose(); };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(release));
      } else {
        release();
      }
    },
  };
}
