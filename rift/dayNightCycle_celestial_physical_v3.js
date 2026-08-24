import * as THREE from "three";
import * as base from "./dayNightCycle_celestial_scale_v2.js";
import {
  createReferenceAtmosphere,
  updateReferenceAtmosphere,
} from "./atmosphereReference_v1.js";

export * from "./dayNightCycle_celestial_scale_v2.js";

// -----------------------------------------------------------------------------
// Celestial presentation v3 + reference-atmosphere integration.
//
// The Sun keeps its readable photospheric disc / halo, while a lightweight
// vertex-colored atmosphere dome now supplies the blue zenith, bright hazy
// horizon and low-Sun aureole seen in the ocean reference photographs. The
// resulting sky colors are also exposed to the ocean and volumetric-cloud paths
// through globalThis.__riftReferenceAtmosphere so all three systems share the
// same lighting palette.
// -----------------------------------------------------------------------------

const ORBIT_RADIUS = 260;
const SUN_HORIZON_OFFSET = 10;
const SUN_DISC_BASE = 20.5;
const SUN_DISC_HORIZON = 23.0;
const SUN_HALO_BASE = 96;
const SUN_AUREOLE_BASE = 200;
const MOON_DISC = 17.0;
const MOON_GLOW = 44.0;
const HIGH_SUN = new THREE.Color(0xfff8df);
const LOW_SUN = new THREE.Color(0xff9a4d);
const MOON_COLOR = new THREE.Color(0xf2f1e9);
const atmosphereByCycle = new WeakMap();

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function hash2(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function createPhotosphereTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);
  const c = (size - 1) * 0.5;
  const radius = size * 0.465;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - c) / radius;
      const ny = (y - c) / radius;
      const rr = nx * nx + ny * ny;
      const i = (x + y * size) * 4;

      if (rr >= 1) {
        data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0;
        continue;
      }

      const r = Math.sqrt(rr);
      const mu = Math.sqrt(Math.max(0, 1 - rr));
      const limb = 0.72 + 0.28 * mu;
      const g1 = hash2(Math.floor(x * 0.22), Math.floor(y * 0.22));
      const g2 = hash2(Math.floor(x * 0.075) + 17, Math.floor(y * 0.075) - 11);
      const granulation = 0.965 + (g1 - 0.5) * 0.045 + (g2 - 0.5) * 0.025;
      const brightness = clamp01(limb * granulation);
      const edgeWarm = smooth01((r - 0.70) / 0.30);
      const edge = 1 - smooth01((r - 0.965) / 0.035);

      data[i] = Math.round(255 * brightness);
      data[i + 1] = Math.round(255 * brightness * (1 - edgeWarm * 0.035));
      data[i + 2] = Math.round(255 * brightness * (1 - edgeWarm * 0.105));
      data[i + 3] = Math.round(255 * edge);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function installPhysicalDisc(cycle) {
  if (!cycle?.__riftRealSun?.discMaterial || cycle.__riftPhysicalSunV3Installed) return;
  const texture = createPhotosphereTexture();
  const material = cycle.__riftRealSun.discMaterial;
  material.map = texture;
  material.alphaMap = null;
  material.transparent = true;
  material.alphaTest = 0.008;
  material.blending = THREE.NormalBlending;
  material.depthWrite = false;
  material.toneMapped = false;
  material.needsUpdate = true;
  cycle.__riftPhysicalSunTextureV3 = texture;
  cycle.__riftPhysicalSunV3Installed = true;
}

function updatePhysicalCelestials(cycle) {
  if (!cycle) return;
  installPhysicalDisc(cycle);

  const visual = cycle.__riftRealSun;
  const sunPos = cycle.sunBody?.group?.position;
  if (visual && sunPos) {
    const elevation = THREE.MathUtils.clamp(
      (sunPos.y - SUN_HORIZON_OFFSET) / ORBIT_RADIUS,
      -1,
      1,
    );
    const altitude = smooth01(Math.max(0, elevation) / 0.34);
    const horizon = smooth01(1 - Math.min(1, Math.abs(elevation) / 0.18));
    const discSize = THREE.MathUtils.lerp(SUN_DISC_BASE, SUN_DISC_HORIZON, horizon);
    const haloSize = SUN_HALO_BASE * (1 + horizon * 0.28);
    const aureoleSize = SUN_AUREOLE_BASE * (1 + horizon * 0.34);

    visual.disc?.scale.set(discSize, discSize, 1);
    visual.halo?.scale.set(haloSize, haloSize, 1);
    visual.aureole?.scale.set(aureoleSize, aureoleSize, 1);

    if (visual.discMaterial) {
      visual.discMaterial.color.copy(LOW_SUN).lerp(HIGH_SUN, altitude);
      if ((globalThis.__riftProceduralCloudOcclusion || 0) < 0.25) {
        visual.discMaterial.opacity = Math.max(0.93, visual.discMaterial.opacity || 0);
      }
    }
    if (visual.haloMaterial) {
      visual.haloMaterial.opacity *= THREE.MathUtils.lerp(1.18, 0.92, altitude);
    }
  }

  const moon = cycle.moonBody;
  if (moon?.core?.scale) {
    moon.core.scale.set(MOON_DISC, MOON_DISC, 1);
    if (moon.core.material?.color) moon.core.material.color.copy(MOON_COLOR);
  }
  if (moon?.glow?.scale) moon.glow.scale.set(MOON_GLOW, MOON_GLOW, 1);

  globalThis.__riftCelestialPhysicalV3 = {
    sunDisc: SUN_DISC_BASE,
    sunHorizonDisc: SUN_DISC_HORIZON,
    moonDisc: MOON_DISC,
    photosphere: true,
    referenceAtmosphere: true,
  };
}

export function createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight) {
  const cycle = base.createDayNightCycle(scene, sun, ambient, starfield, biome, moonLight);
  updatePhysicalCelestials(cycle);
  const atmosphere = createReferenceAtmosphere(scene, sun, ambient, moonLight);
  atmosphereByCycle.set(cycle, atmosphere);
  updateReferenceAtmosphere(
    atmosphere,
    cycle,
    null,
    globalThis.__riftProceduralWeatherState ?? null,
  );
  return cycle;
}

export function updateDayNightCycle(cycle, dt) {
  const result = base.updateDayNightCycle(cycle, dt);
  updatePhysicalCelestials(cycle);
  const atmosphere = atmosphereByCycle.get(cycle);
  if (atmosphere) {
    updateReferenceAtmosphere(
      atmosphere,
      cycle,
      result,
      globalThis.__riftProceduralWeatherState ?? null,
    );
  }
  return result;
}
