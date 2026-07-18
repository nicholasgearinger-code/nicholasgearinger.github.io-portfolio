import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: lava/water rendering. A single large flat plane at a fixed
// height, per biome — simpler and far cheaper than carving actual liquid
// geometry into the terrain, and works because each biome's terrain
// shaping (terrain.js) was tuned so the plane's height only intersects the
// channel/cracks it's meant to fill (Ember's lava cracks, Verdant's river
// bed) rather than flooding the whole landmass. Swap createLiquidPlane()
// for a shader-based version (real ripple/flow distortion) without
// touching terrain generation or placement.
// -----------------------------------------------------------------------------

const LIQUID_STYLE = {
  ember: { color: 0xff6b2a, emissive: 0xff6b2a, emissiveIntensity: 1.1, opacity: 0.85 },
  verdant: { color: 0x2a8fd6, emissive: 0x2a8fd6, emissiveIntensity: 0.25, opacity: 0.72 },
};

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {number} y  world-space height to place the plane at
 * @param {number} size  full width/depth to cover (should match/exceed the terrain size)
 */
function createLiquidPlane(scene, biome, y, size) {
  const style = LIQUID_STYLE[biome];
  if (!style) return null;
  const geo = new THREE.PlaneGeometry(size, size, 24, 24);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshStandardMaterial({
    color: style.color, emissive: style.emissive, emissiveIntensity: style.emissiveIntensity,
    transparent: true, opacity: style.opacity, roughness: biome === 'ember' ? 0.6 : 0.15, metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  scene.add(mesh);

  const posAttr = geo.attributes.position;
  const basePositions = new Float32Array(posAttr.array); // original Y per vertex, for the ripple to animate around

  return { mesh, basePositions, biome };
}

function updateLiquidPlane(handle, elapsed) {
  if (!handle) return;
  const { mesh, basePositions } = handle;
  const posAttr = mesh.geometry.attributes.position;
  // Cheap per-vertex ripple — lava churns slower/heavier, water ripples
  // lighter and faster.
  const speed = handle.biome === 'ember' ? 0.6 : 1.4;
  const amp = handle.biome === 'ember' ? 0.18 : 0.1;
  for (let i = 0; i < posAttr.count; i++) {
    const bx = basePositions[i * 3], bz = basePositions[i * 3 + 2];
    posAttr.setY(i, Math.sin(bx * 0.15 + elapsed * speed) * amp + Math.cos(bz * 0.12 + elapsed * speed * 0.8) * amp);
  }
  posAttr.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function disposeLiquidPlane(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
}

export { createLiquidPlane, updateLiquidPlane, disposeLiquidPlane };
