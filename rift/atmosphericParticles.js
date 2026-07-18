import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: ambient atmosphere, one look per biome. Deliberately built as
// a single THREE.Points cloud (one draw call, thousands of particles for
// free) rather than individual meshes — these are purely decorative and
// numerous, so keeping them cheap matters more than per-particle detail.
// Swap PARTICLE_STYLES for different colors/motion per biome, or
// updateAtmosphericParticles()'s motion model, without touching how the
// system is created/attached.
// -----------------------------------------------------------------------------

const PARTICLE_STYLES = {
  ember: { color: 0xff8a4a, count: 260, size: 0.35, riseSpeed: 3.5, drift: 0.6 },    // embers rising off the lava
  verdant: { color: 0xbdf27a, count: 220, size: 0.22, riseSpeed: 0.4, drift: 1.1 },  // drifting pollen
  crystal: { color: 0x9fe8ff, count: 200, size: 0.18, riseSpeed: 0.6, drift: 0.5 },  // sparkling dust
  abyssal: { color: 0x8a86ff, count: 180, size: 0.28, riseSpeed: -0.3, drift: 0.7 }, // motes sinking toward the chasms
  ashen: { color: 0xcfc7b8, count: 240, size: 0.3, riseSpeed: 0.8, drift: 1.4 },     // drifting ash
};

const SPREAD = 120; // half-width of the volume particles populate, in world units around the origin
const HEIGHT_MIN = -2, HEIGHT_MAX = 40;

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 */
function createAtmosphericParticles(scene, biome) {
  const style = PARTICLE_STYLES[biome];
  if (!style) return null;

  const positions = new Float32Array(style.count * 3);
  const seeds = new Float32Array(style.count); // per-particle phase offset so they don't all drift in lockstep
  for (let i = 0; i < style.count; i++) {
    positions[i * 3] = (Math.random() - 0.5) * SPREAD * 2;
    positions[i * 3 + 1] = HEIGHT_MIN + Math.random() * (HEIGHT_MAX - HEIGHT_MIN);
    positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD * 2;
    seeds[i] = Math.random() * Math.PI * 2;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color: style.color, size: style.size, sizeAttenuation: true,
    transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);

  return { points, seeds, basePositions: positions.slice(), style, biome };
}

function updateAtmosphericParticles(handle, elapsed, dt) {
  if (!handle) return;
  const { points, seeds, basePositions, style } = handle;
  const posAttr = points.geometry.attributes.position;
  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    let y = posAttr.getY(i) + style.riseSpeed * dt;
    // Loop back around once a particle drifts past the top/bottom of the
    // volume, respawning at the opposite end rather than despawning —
    // keeps the count (and draw call) constant forever.
    if (y > HEIGHT_MAX) y = HEIGHT_MIN;
    if (y < HEIGHT_MIN) y = HEIGHT_MAX;
    posAttr.setY(i, y);

    const bx = basePositions[i * 3], bz = basePositions[i * 3 + 2];
    posAttr.setX(i, bx + Math.sin(elapsed * 0.3 + seed) * style.drift * 3);
    posAttr.setZ(i, bz + Math.cos(elapsed * 0.25 + seed) * style.drift * 3);
  }
  posAttr.needsUpdate = true;
}

function disposeAtmosphericParticles(scene, handle) {
  if (!handle) return;
  scene.remove(handle.points);
  handle.points.geometry.dispose();
  handle.points.material.dispose();
}

export { createAtmosphericParticles, updateAtmosphericParticles, disposeAtmosphericParticles };
