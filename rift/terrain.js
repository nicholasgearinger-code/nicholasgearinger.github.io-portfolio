import * as THREE from "three";
import * as current from "./terrain_sand_base.js";

export * from "./terrain_sand_base.js";

// Tropical sand should carry the warm light of the scene without starting from
// a red/orange albedo. Use neutral cream/tan tones both below and above water.
const DEEP_SAND = new THREE.Color(0xc7bfad);
const MID_SAND = new THREE.Color(0xe4d9c0);
const SHALLOW_SAND = new THREE.Color(0xf6eedb);

const BEACH_WET = new THREE.Color(0xcdbd9f);
const BEACH_DRY = new THREE.Color(0xe8d8b8);
const BEACH_PALE = new THREE.Color(0xf4e8d0);
const SURF_TINT = new THREE.Color(0xfaf6ed);

const sandColor = new THREE.Color();
const existingColor = new THREE.Color();

function smoothstep01(t) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function hash2(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function neutralizeCrystalSeafloor(geometry) {
  const positions = geometry?.attributes?.position;
  const colors = geometry?.attributes?.color;
  if (!positions || !colors) return geometry;

  const waterY = current.LIQUID_LEVEL.crystal;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    if (y >= waterY) continue;

    const heightT = THREE.MathUtils.clamp((y + 3.0) / 9.8, 0, 1);
    if (heightT < 0.52) {
      sandColor.copy(DEEP_SAND).lerp(MID_SAND, heightT / 0.52);
    } else {
      sandColor.copy(MID_SAND).lerp(SHALLOW_SAND, (heightT - 0.52) / 0.48);
    }

    const depth = waterY - y;
    const neutralAmount = THREE.MathUtils.clamp(0.90 + smoothstep01(depth / 1.6) * 0.10, 0, 1);
    existingColor.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
    existingColor.lerp(sandColor, neutralAmount);
    colors.setXYZ(i, existingColor.r, existingColor.g, existingColor.b);
  }

  colors.needsUpdate = true;
  return geometry;
}

function neutralizeCrystalBeach(geometry) {
  const positions = geometry?.attributes?.position;
  const normals = geometry?.attributes?.normal;
  const colors = geometry?.attributes?.color;
  if (!positions || !colors) return geometry;

  const waterY = current.LIQUID_LEVEL.crystal;
  const beachTopY = waterY + 12.0;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    if (y < waterY || y > beachTopY) continue;

    const flatness = normals ? normals.getY(i) : 1;
    const slopeMask = smoothstep01((flatness - 0.34) / 0.42);
    if (slopeMask <= 0.001) continue;

    const beachT = smoothstep01((y - waterY) / (beachTopY - waterY));
    if (beachT < 0.55) {
      sandColor.copy(BEACH_WET).lerp(BEACH_DRY, beachT / 0.55);
    } else {
      sandColor.copy(BEACH_DRY).lerp(BEACH_PALE, (beachT - 0.55) / 0.45);
    }

    const grain = hash2(x * 0.22, z * 0.22) - 0.5;
    sandColor.offsetHSL(0, 0, grain * 0.018);

    const wetBand = 1 - smoothstep01((y - waterY) / 1.35);
    if (wetBand > 0) {
      sandColor.lerp(BEACH_WET, wetBand * 0.62);
      sandColor.multiplyScalar(1 - wetBand * 0.035);
    }

    const aboveWater = y - waterY;
    const surfBand = smoothstep01(aboveWater / 0.08) *
      (1 - smoothstep01((aboveWater - 0.08) / 0.48));
    if (surfBand > 0) sandColor.lerp(SURF_TINT, surfBand * 0.18);

    const blend = THREE.MathUtils.clamp((0.92 + (1 - beachT) * 0.06) * slopeMask, 0, 0.98);
    existingColor.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
    existingColor.lerp(sandColor, blend);
    colors.setXYZ(i, existingColor.r, existingColor.g, existingColor.b);
  }

  colors.needsUpdate = true;
  return geometry;
}

export function buildPlanetTerrain(level, seedStr) {
  const geometry = current.buildPlanetTerrain(level, seedStr);
  if (level?.biome === "crystal") {
    neutralizeCrystalSeafloor(geometry);
    neutralizeCrystalBeach(geometry);
  }
  return geometry;
}
