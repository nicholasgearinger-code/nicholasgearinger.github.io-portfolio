import * as THREE from "three";
import * as current from "./terrain_sand_base.js";

export * from "./terrain_sand_base.js";

// Use one shared sand family above and below water so the shoreline feels like
// the same material instead of switching from pale underwater sand to red land.
const DEEP_SAND = new THREE.Color(0xd3ccb8);
const MID_SAND = new THREE.Color(0xe7decb);
const SHALLOW_SAND = new THREE.Color(0xf7efde);

const BEACH_WET = new THREE.Color(0xdbd1bb);
const BEACH_DRY = new THREE.Color(0xebe2cf);
const BEACH_PALE = new THREE.Color(0xf7efde);
const SURF_TINT = new THREE.Color(0xfcf8f0);

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

    const heightT = THREE.MathUtils.clamp((y + 3.3) / 10.5, 0, 1);
    if (heightT < 0.5) {
      sandColor.copy(DEEP_SAND).lerp(MID_SAND, heightT / 0.5);
    } else {
      sandColor.copy(MID_SAND).lerp(SHALLOW_SAND, (heightT - 0.5) / 0.5);
    }

    const depth = waterY - y;
    const neutralAmount = THREE.MathUtils.clamp(
      0.97 + smoothstep01(depth / 1.9) * 0.03,
      0,
      1,
    );

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
  const beachTopY = waterY + 14.0;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    if (y < waterY || y > beachTopY) continue;

    // Broader slope allowance so more of the beach actually gets corrected.
    const flatness = normals ? normals.getY(i) : 1;
    const slopeMask = smoothstep01((flatness - 0.22) / 0.36);
    if (slopeMask <= 0.001) continue;

    const beachT = smoothstep01((y - waterY) / (beachTopY - waterY));
    if (beachT < 0.55) {
      sandColor.copy(BEACH_WET).lerp(BEACH_DRY, beachT / 0.55);
    } else {
      sandColor.copy(BEACH_DRY).lerp(BEACH_PALE, (beachT - 0.55) / 0.45);
    }

    // Very subtle grain only.
    const grain = hash2(x * 0.18, z * 0.18) - 0.5;
    sandColor.offsetHSL(0, 0, grain * 0.012);

    const wetBand = 1 - smoothstep01((y - waterY) / 1.6);
    if (wetBand > 0) {
      sandColor.lerp(BEACH_WET, wetBand * 0.58);
      sandColor.multiplyScalar(1 - wetBand * 0.03);
    }

    const aboveWater = y - waterY;
    const surfBand =
      smoothstep01(aboveWater / 0.08) *
      (1 - smoothstep01((aboveWater - 0.08) / 0.52));
    if (surfBand > 0) {
      sandColor.lerp(SURF_TINT, surfBand * 0.18);
    }

    // Strong override so the old reddish Crystal palette stops leaking through.
    const blend = THREE.MathUtils.clamp(
      (0.96 + (1 - beachT) * 0.03) * slopeMask,
      0,
      1,
    );

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
