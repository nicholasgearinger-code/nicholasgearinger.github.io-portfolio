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


// Build render-only terrain chunks from the EXISTING collision geometry.
// Original terrain geometry stays untouched: physics/height sampling continues
// to use it, while the renderer culls individual spatial tiles. All tiles use
// original vertex samples and UVs, so there is no procedural mismatch.
// Adjacent tiles meet at their exact original border vertices.
export function buildTerrainRenderChunks(sourceGeometry, material, divisions = 4) {
  const position = sourceGeometry.getAttribute("position");
  const uv = sourceGeometry.getAttribute("uv");
  const color = sourceGeometry.getAttribute("color");
  const normal = sourceGeometry.getAttribute("normal");
  if (!position || !uv || !normal || !color) return null;
  const stride = Math.round(Math.sqrt(position.count));
  const segments = stride - 1;
  if (stride * stride !== position.count || segments % divisions !== 0) return null;
  const cells = segments / divisions;
  const tiles = [];
  for (let tz = 0; tz < divisions; tz++) for (let tx = 0; tx < divisions; tx++) {
    function makeGeometry(step) {
      const coords = [];
      for (let n = 0; n <= cells; n += step) coords.push(n);
      if (coords[coords.length - 1] !== cells) coords.push(cells);
      const count = coords.length;
      const positions = [], uvs = [], colors = [], normals = [], indices = [];
      for (const z of coords) for (const x of coords) {
        const idx = (tz * cells + z) * stride + tx * cells + x;
        positions.push(position.getX(idx), position.getY(idx), position.getZ(idx));
        uvs.push(uv.getX(idx), uv.getY(idx));
        colors.push(color.getX(idx), color.getY(idx), color.getZ(idx));
        normals.push(normal.getX(idx), normal.getY(idx), normal.getZ(idx));
      }
      for (let z = 0; z < count - 1; z++) for (let x = 0; x < count - 1; x++) {
        const a = z * count + x, b = a + count;
        indices.push(a, b, a + 1, b, b + 1, a + 1);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.computeBoundingSphere();
      return geo;
    }
    const near = new THREE.Mesh(makeGeometry(1), material);
    const far = new THREE.Mesh(makeGeometry(4), material);
    const center = near.geometry.boundingSphere.center.clone();
    for (const mesh of [near, far]) {
      mesh.receiveShadow = true;
      mesh.castShadow = false; // avoid multiplying shadow draw calls for distant terrain
      mesh.frustumCulled = true;
    }
    near.visible = true;
    far.visible = false;
    tiles.push({ near, far, center, detailed: true });
  }
  return tiles;
}
