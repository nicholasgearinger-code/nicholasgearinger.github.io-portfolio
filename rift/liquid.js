import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: lava/water rendering. A single large flat plane at a fixed
// height, per biome — simpler and far cheaper than carving actual liquid
// geometry into the terrain, and works because each biome's terrain
// shaping (terrain.js) was tuned so the plane's height only intersects the
// channel/cracks it's meant to fill (Ember's lava cracks, Verdant's river
// bed) rather than flooding the whole landmass. Per-vertex color (frothy
// white for water, glowing hot-spots for lava) is derived from the same
// ripple displacement already being computed for the geometry, not a
// second simulation — wherever the surface is most disturbed reads as
// whiter/brighter, which is what actually sells "liquid" instead of "flat
// tinted plane." Swap createLiquidPlane() for a shader-based version (real
// flow distortion) without touching terrain generation or placement.
// -----------------------------------------------------------------------------

const LIQUID_STYLE = {
  ember: {
    baseColor: new THREE.Color(0xcc2200), hotColor: new THREE.Color(0xffdd66),
    emissive: 0xff5522, emissiveIntensity: 1.3, opacity: 0.92, roughness: 0.55,
  },
  verdant: {
    baseColor: new THREE.Color(0x1f6fb0), frothColor: new THREE.Color(0xf2fbff),
    emissive: 0x2a8fd6, emissiveIntensity: 0.2, opacity: 0.78, roughness: 0.1,
  },
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

  const posAttr = geo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    style.baseColor.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, emissive: style.emissive, emissiveIntensity: style.emissiveIntensity,
    transparent: true, opacity: style.opacity, roughness: style.roughness, metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  scene.add(mesh);

  const basePositions = new Float32Array(posAttr.array); // original Y per vertex, for the ripple to animate around
  return { mesh, basePositions, biome, style };
}

function updateLiquidPlane(handle, elapsed) {
  if (!handle) return;
  const { mesh, basePositions, biome, style } = handle;
  const posAttr = mesh.geometry.attributes.position;
  const colorAttr = mesh.geometry.attributes.color;
  // Cheap per-vertex ripple — lava churns slower/heavier, water ripples
  // lighter and faster.
  const speed = biome === "ember" ? 0.6 : 1.4;
  const amp = biome === "ember" ? 0.18 : 0.1;
  const tmpColor = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const bx = basePositions[i * 3], bz = basePositions[i * 3 + 2];
    const ripple = Math.sin(bx * 0.15 + elapsed * speed) * amp + Math.cos(bz * 0.12 + elapsed * speed * 0.8) * amp;
    posAttr.setY(i, ripple);

    // Normalize ripple (-2*amp..2*amp) to 0..1 and use it to blend toward
    // the "disturbed" color — frothy crests for water, brighter glowing
    // patches for lava — rather than a flat, uniform surface.
    const disturbance = THREE.MathUtils.clamp((ripple + amp * 2) / (amp * 4), 0, 1);
    const accent = biome === "ember" ? style.hotColor : style.frothColor;
    tmpColor.copy(style.baseColor).lerp(accent, Math.pow(disturbance, 3)); // pow(3) keeps the accent rare/at true crests, not smeared across the whole surface
    tmpColor.toArray(colorAttr.array, i * 3);
  }
  posAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
}

function disposeLiquidPlane(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
}

export { createLiquidPlane, updateLiquidPlane, disposeLiquidPlane };
