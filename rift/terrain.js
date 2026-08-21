import * as THREE from "three";
import * as current from "./terrain_sand_base.js";

export * from "./terrain_sand_base.js";

// Coral Shallows uses real coral models for reef color now. Keep both the
// submerged floor and the dry beach in a believable tropical-sand range.
const DEEP_SAND = new THREE.Color(0xa99b80);
const MID_SAND = new THREE.Color(0xd5c39e);
const SHALLOW_SAND = new THREE.Color(0xf0e4c8);

const BEACH_WET = new THREE.Color(0xcdb58c);
const BEACH_DRY = new THREE.Color(0xe8d3aa);
const BEACH_PALE = new THREE.Color(0xf2e4c7);
const SURF_TINT = new THREE.Color(0xf8f2e5);

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

    const heightT = THREE.MathUtils.clamp((y + 2.5) / 9.0, 0, 1);
    if (heightT < 0.55) {
      sandColor.copy(DEEP_SAND).lerp(MID_SAND, heightT / 0.55);
    } else {
      sandColor.copy(MID_SAND).lerp(SHALLOW_SAND, (heightT - 0.55) / 0.45);
    }

    const depth = waterY - y;
    const neutralAmount = smoothstep01((depth - 0.15) / 1.10);

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
  const beachTopY = waterY + 7.5;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);
    if (y < waterY || y > beachTopY) continue;

    // Only strongly recolor genuinely beach-like slopes. This keeps nearby
    // low cliffs/rocks from being painted tan just because they share a height.
    const flatness = normals ? normals.getY(i) : 1;
    const slopeMask = smoothstep01((flatness - 0.58) / 0.30);
    if (slopeMask <= 0.001) continue;

    const beachT = smoothstep01((y - waterY) / (beachTopY - waterY));
    if (beachT < 0.58) {
      sandColor.copy(BEACH_WET).lerp(BEACH_DRY, beachT / 0.58);
    } else {
      sandColor.copy(BEACH_DRY).lerp(BEACH_PALE, (beachT - 0.58) / 0.42);
    }

    // Fine, low-contrast grain. It breaks up the flat vertex tint without
    // bringing back the old orange/red beach coloration.
    const grain = hash2(x * 0.24, z * 0.24) - 0.5;
    sandColor.offsetHSL(0, 0, grain * 0.028);

    // Wet sand darkens gently over the first ~1.1 world units above the sea.
    const wetBand = 1 - smoothstep01((y - waterY) / 1.10);
    if (wetBand > 0) {
      sandColor.lerp(BEACH_WET, wetBand * 0.72);
      sandColor.multiplyScalar(1 - wetBand * 0.055);
    }

    // A narrow pale band under the swash visually marries the animated foam to
    // the beach instead of leaving a hard water/sand color boundary.
    const aboveWater = y - waterY;
    const surfBand = smoothstep01(aboveWater / 0.08) *
      (1 - smoothstep01((aboveWater - 0.08) / 0.42));
    if (surfBand > 0) sandColor.lerp(SURF_TINT, surfBand * 0.22);

    const blend = THREE.MathUtils.clamp((0.78 + (1 - beachT) * 0.14) * slopeMask, 0, 0.94);
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
