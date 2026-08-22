import * as THREE from "three";
import * as current from "./terrain_sand_base.js";

export * from "./terrain_sand_base.js";

// One unified tropical sand family for both land and seabed.
// The shore should feel like the same sand continuing underwater,
// with only a slightly darker wet band at the waterline.
const DEEP_SAND = new THREE.Color(0xd8cfbc);
const MID_SAND = new THREE.Color(0xebe2d0);
const LIGHT_SAND = new THREE.Color(0xf6eddc);

const WET_SAND = new THREE.Color(0xdccfb8);
const SURF_TINT = new THREE.Color(0xfbf7ef);

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

function applyCrystalSeafloorSand(geometry) {
  const positions = geometry?.attributes?.position;
  const colors = geometry?.attributes?.color;
  if (!positions || !colors) return geometry;

  const waterY = current.LIQUID_LEVEL.crystal;

  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    if (y >= waterY) continue;

    const depth = waterY - y;
    const depthT = smoothstep01(1.0 - THREE.MathUtils.clamp(depth / 10.0, 0, 1));

    if (depthT < 0.5) {
      sandColor.copy(DEEP_SAND).lerp(MID_SAND, depthT / 0.5);
    } else {
      sandColor.copy(MID_SAND).lerp(LIGHT_SAND, (depthT - 0.5) / 0.5);
    }

    // Keep the override very strong so the old warm/red crystal palette
    // no longer leaks through.
    const blend = THREE.MathUtils.clamp(0.985 + depthT * 0.015, 0, 1);

    existingColor.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
    existingColor.lerp(sandColor, blend);
    colors.setXYZ(i, existingColor.r, existingColor.g, existingColor.b);
  }

  colors.needsUpdate = true;
  return geometry;
}

function applyCrystalBeachSand(geometry) {
  const positions = geometry?.attributes?.position;
  const normals = geometry?.attributes?.normal;
  const colors = geometry?.attributes?.color;
  if (!positions || !colors) return geometry;

  const waterY = current.LIQUID_LEVEL.crystal;
  const beachTopY = waterY + 18.0;

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    const z = positions.getZ(i);

    if (y < waterY || y > beachTopY) continue;

    const flatness = normals ? normals.getY(i) : 1;
    const slopeMask = smoothstep01((flatness - 0.18) / 0.34);
    if (slopeMask <= 0.001) continue;

    const beachT = smoothstep01((y - waterY) / (beachTopY - waterY));

    // Same sand family as underwater.
    sandColor.copy(MID_SAND).lerp(LIGHT_SAND, beachT * 0.9);

    // Very subtle grain variation only.
    const grain = hash2(x * 0.14, z * 0.14) - 0.5;
    sandColor.offsetHSL(0, 0, grain * 0.008);

    // Narrow darker wet band right at the waterline.
    const wetBand = 1.0 - smoothstep01((y - waterY) / 1.25);
    if (wetBand > 0.0) {
      sandColor.lerp(WET_SAND, wetBand * 0.78);
      sandColor.multiplyScalar(1.0 - wetBand * 0.03);
    }

    // Very subtle pale surf tint just above the water edge.
    const aboveWater = y - waterY;
    const surfBand =
      smoothstep01(aboveWater / 0.08) *
      (1.0 - smoothstep01((aboveWater - 0.08) / 0.42));
    if (surfBand > 0.0) {
      sandColor.lerp(SURF_TINT, surfBand * 0.12);
    }

    // Strong override everywhere on the beach so the shore matches the seabed.
    const blend = THREE.MathUtils.clamp((0.985 + (1.0 - beachT) * 0.01) * slopeMask, 0, 1);

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
    applyCrystalSeafloorSand(geometry);
    applyCrystalBeachSand(geometry);
  }
  return geometry;
}
