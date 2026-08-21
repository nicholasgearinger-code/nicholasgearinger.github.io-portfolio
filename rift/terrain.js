import * as THREE from "three";
import * as current from "./terrain_sand_base.js";

export * from "./terrain_sand_base.js";

// Coral Shallows uses real coral models for reef color now. Keep the terrain
// underneath them physically believable sand instead of multiplying the sand
// texture by the older orange/pink reef vertex palette.
const DEEP_SAND = new THREE.Color(0xa99b80);
const MID_SAND = new THREE.Color(0xd5c39e);
const SHALLOW_SAND = new THREE.Color(0xf0e4c8);
const sandColor = new THREE.Color();
const existingColor = new THREE.Color();

function smoothstep01(t) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function neutralizeCrystalSeafloor(geometry) {
  const positions = geometry?.attributes?.position;
  const colors = geometry?.attributes?.color;
  if (!positions || !colors) return geometry;

  const waterY = current.LIQUID_LEVEL.crystal;

  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    if (y >= waterY) continue; // preserve dry island / beach colors exactly

    // The normal reef floor lives roughly between -2.5 and 6.5. Use height
    // only to create natural damp/deep taupe -> warm beige -> pale shallow sand.
    const heightT = THREE.MathUtils.clamp((y + 2.5) / 9.0, 0, 1);
    if (heightT < 0.55) {
      sandColor.copy(DEEP_SAND).lerp(MID_SAND, heightT / 0.55);
    } else {
      sandColor.copy(MID_SAND).lerp(SHALLOW_SAND, (heightT - 0.55) / 0.45);
    }

    // Fade the correction gently through the final 1.25 units below the water
    // line so the submerged sand meets the existing wet-beach treatment without
    // a visible color seam at the shoreline.
    const depth = waterY - y;
    const neutralAmount = smoothstep01((depth - 0.15) / 1.10);

    existingColor.setRGB(colors.getX(i), colors.getY(i), colors.getZ(i));
    existingColor.lerp(sandColor, neutralAmount);
    colors.setXYZ(i, existingColor.r, existingColor.g, existingColor.b);
  }

  colors.needsUpdate = true;
  return geometry;
}

export function buildPlanetTerrain(level, seedStr) {
  const geometry = current.buildPlanetTerrain(level, seedStr);
  if (level?.biome === "crystal") neutralizeCrystalSeafloor(geometry);
  return geometry;
}
