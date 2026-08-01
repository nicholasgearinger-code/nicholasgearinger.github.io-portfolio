import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

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
    crustColor: new THREE.Color(0x1a0800), baseColor: new THREE.Color(0xdd2c00), hotColor: new THREE.Color(0xffd23f),
    emissive: 0xff5522, emissiveIntensity: 2.2, opacity: 0.96, roughness: 0.55,
    glowColor: 0xff8a1a, glowOpacity: 0.35,
  },
  verdant: {
    baseColor: new THREE.Color(0x0f4a78), frothColor: new THREE.Color(0xf2fbff),
    emissive: 0x2a8fd6, emissiveIntensity: 0.02, opacity: 0.78, roughness: 0.1, // pushed down further (was 0.06, originally 0.2) per explicit "make night more pronounced" follow-up
  },
  // Crystal Spire, redesigned as a tropical reef ocean — this is now the
  // biome's actual ground-level water (the whole landmass sits below
  // LIQUID_LEVEL.crystal in terrain.js), not a small feature within it.
  // Retuned to a deep blue with white crest highlights per an explicit
  // reference illustration — a real reversal of the earlier bright
  // tropical-turquoise direction. Opacity pushed further toward opaque
  // (was 0.74) per explicit "needs to be less transparent." frothColor
  // stays pure white — the reference's defining feature is bright white
  // lines along each wave crest against the deep blue body.
  crystal: {
    baseColor: new THREE.Color(0x214d75), frothColor: new THREE.Color(0xffffff),
    emissive: 0x2a5578, emissiveIntensity: 0.015, opacity: 0.88, roughness: 0.05,
  },
};

// -----------------------------------------------------------------------------
// Gerstner (trochoidal) wave components — Coral Shallows' ocean only. A
// real Gerstner wave displaces each vertex horizontally as well as
// vertically (walking it toward the wave crest and back), which is what
// gives an ocean surface its actual peaked, slightly-pointed crests and
// broader troughs instead of the perfectly smooth, symmetric bumps a
// plain per-vertex sine gives. Several components at different
// directions/wavelengths/speeds summed together (the standard "sum of
// Gerstner waves" ocean technique) reads as real chop layered on top of
// a big rolling swell, rather than one uniform ripple. Ember's lava and
// Verdant's river keep their existing simpler sine-based ripple — this
// is scoped to the actual open-ocean biome specifically.
//
// steepness (Q) controls how sharp the crest peak is — too high per-wave
// and neighboring vertices can cross over each other (self-intersecting
// geometry), so each is kept comfortably under 1/(k*amplitude*waveCount).
// wavelength/amplitude/speed loosely follow real deep-water dispersion
// (bigger/slower swells carry more amplitude, small wavelets are fast and
// shallow) without needing to actually simulate the physics.
const GERSTNER_WAVES_RAW = [
  { dirX: 1.0, dirZ: 0.3, wavelength: 40, amplitude: 0.42, speed: 1.75, steepness: 0.5 },  // the big rolling swell
  { dirX: 0.3, dirZ: 1.0, wavelength: 24, amplitude: 0.24, speed: 2.5, steepness: 0.45 }, // a second swell crossing at an angle
  { dirX: -0.7, dirZ: 0.5, wavelength: 13, amplitude: 0.13, speed: 3.4, steepness: 0.35 }, // finer chop
  { dirX: 0.6, dirZ: -0.65, wavelength: 7, amplitude: 0.06, speed: 4.6, steepness: 0.3 },   // fine surface texture
];
const GERSTNER_WAVES = GERSTNER_WAVES_RAW.map((w) => {
  const len = Math.hypot(w.dirX, w.dirZ) || 1;
  return { ndx: w.dirX / len, ndz: w.dirZ / len, k: (Math.PI * 2) / w.wavelength, amplitude: w.amplitude, speed: w.speed, steepness: w.steepness };
});
const GERSTNER_AMPLITUDE_SUM = GERSTNER_WAVES.reduce((sum, w) => sum + w.amplitude, 0);

// A soft mottled noise pattern, tiled — real distortion needs a
// post-process shader this project doesn't have, so instead this scrolls
// upward and wobbles sideways on a mostly-transparent overlay just above
// the lava, which is enough to read as rising heat haze without needing
// actual screen-space refraction.
function createShimmerTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 6 + Math.random() * 16;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,220,180,0.35)");
    grad.addColorStop(1, "rgba(255,220,180,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

// -----------------------------------------------------------------------------
// Flow noise — cheap value-noise fbm evaluated per-vertex per-frame, used
// only by Ember's lava. Replaces the old per-vertex-index bubble cycle
// (`(i * 12.9898) % 1`), which had no spatial correlation between
// neighboring vertices — each one popped/faded on its own independent
// clock, which is what read as "glowing squares that fade out" rather
// than a liquid surface. Sampling a continuous 2D noise field and
// scrolling the sample coordinates over time in a fixed direction makes
// brightness move ACROSS the surface, like something is actually flowing
// downhill, instead of blinking in place. Still no shader/GPU work — this
// is the same CPU per-vertex-loop approach the rest of the file already
// uses, just fed a spatially coherent field instead of an index hash.
// -----------------------------------------------------------------------------

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function valueNoise2D(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, u), THREE.MathUtils.lerp(c, d, u), v);
}

function fbm(x, y, octaves) {
  let total = 0, amp = 0.5, freq = 1, max = 0;
  for (let o = 0; o < octaves; o++) {
    total += valueNoise2D(x * freq, y * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return total / max;
}

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function normalizeFlow(dir) {
  const len = Math.hypot(dir.x, dir.z) || 1;
  return { x: dir.x / len, z: dir.z / len };
}

// Small glowing droplets drifting across the lava's surface in the flow
// direction, same technique used for the volcano's veins (landmarks.js) —
// a physically-moving bright point is a much stronger "this is flowing"
// cue than the per-vertex color animation alone, which is continuous but
// subtle. Loops each bead along the flow direction across the plane's
// full span, with a randomized perpendicular offset so they don't all
// trace the same line, fading in/out near both ends of their loop.
function createLavaFlowBeads(flowDir, size, count) {
  const perp = { x: -flowDir.z, z: flowDir.x };
  const group = new THREE.Group();
  const beads = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xfff3c8, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.55, 0), mat);
    group.add(mesh);
    beads.push({
      mesh,
      phase: i / count + Math.random() * 0.1,
      speed: 0.018 + Math.random() * 0.012,
      perpOffset: (Math.random() - 0.5) * size * 0.7,
    });
  }
  return { group, beads, flowDir, perp, size };
}

function updateLavaFlowBeads(flowBeads, elapsed, y) {
  const span = flowBeads.size * 1.3;
  for (const b of flowBeads.beads) {
    const u = (elapsed * b.speed + b.phase) % 1;
    const along = (u - 0.5) * span;
    const x = flowBeads.flowDir.x * along + flowBeads.perp.x * b.perpOffset;
    const z = flowBeads.flowDir.z * along + flowBeads.perp.z * b.perpOffset;
    b.mesh.position.set(x, y + 0.15, z);
    const fadeWindow = 0.08;
    const fade = Math.max(0, Math.min(1, u / fadeWindow, (1 - u) / fadeWindow));
    b.mesh.material.opacity = fade * 0.85;
  }
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {number} y  world-space height to place the plane at
 * @param {number} size  full width/depth to cover (should match/exceed the terrain size)
 * @param {(x:number, z:number) => number|null} [sampleHeight]  used only for Ember's floating cooled-rock chunks, to place them in genuine lava channels rather than scattering blindly across the whole plane
 * @param {{x:number, z:number}} [flowDir]  Ember only — world-space direction the lava's crust/crack pattern drifts in. Defaults to a fixed diagonal; pass a real downhill direction (e.g. sampled from terrain.js's heightfield gradient) for a more physically-grounded flow per landmark/channel.
 */
// A tileable vertical-streak texture for the falling water sheet —
// random-width bright streaks on a translucent pale-blue base, repeated
// vertically so scrolling its offset each frame reads as continuously
// falling water rather than one static image.
let sharedWaterfallTexture = null;
function getWaterfallTexture() {
  if (sharedWaterfallTexture) return sharedWaterfallTexture;
  const w = 64, h = 128;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(210,235,255,0.55)";
  ctx.fillRect(0, 0, w, h);
  // Broken, staggered streak segments — not full-height lines, which
  // read as too clean/regular for turbulent falling water.
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * w;
    const sw = 1 + Math.random() * 3.5;
    const segH = h * (0.15 + Math.random() * 0.5);
    const segY = Math.random() * (h - segH);
    ctx.fillStyle = `rgba(255,255,255,${(0.3 + Math.random() * 0.5).toFixed(2)})`;
    ctx.fillRect(x, segY, sw, segH);
  }
  // Scattered foam-white blob clusters throughout, not just a foam pool
  // at the very bottom — real whitewater churns and breaks up along the
  // whole fall, not just where it lands.
  for (let i = 0; i < 22; i++) {
    const x = Math.random() * w, y = Math.random() * h;
    const r = 2 + Math.random() * 4;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.8)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  sharedWaterfallTexture = tex;
  return tex;
}

// A soft white foam-pool glow for where the falls hit the river below.
let sharedFoamTexture = null;
function getFoamTexture() {
  if (sharedFoamTexture) return sharedFoamTexture;
  const size = 96;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.9)");
  grad.addColorStop(0.5, "rgba(255,255,255,0.4)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedFoamTexture = new THREE.CanvasTexture(canvas);
  return sharedFoamTexture;
}

// A cascading waterfall — Verdant only, one fixed feature at the river's
// carved cliff. topY/bottomY/x/z come from SAMPLING the actual rendered
// terrain height on both sides of that cliff (main.js does this via
// terrainHeightAt/WATERFALL_Z from terrain.js) rather than this file
// duplicating terrain.js's noise math — so it's always correctly aligned
// regardless of the exact noise values at that point.
function createWaterfall(scene, topY, bottomY, x, z, width) {
  const height = THREE.MathUtils.clamp(topY - bottomY, 0, 16); // clamped — an unlucky extreme terrain sample right at the cliff could otherwise produce a wildly oversized panel
  if (height < 2) return null; // not enough of a cliff here to bother with
  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({
    map: getWaterfallTexture(), color: 0xdfeeff, transparent: true, side: THREE.DoubleSide,
    depthWrite: false, opacity: 0.8, fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, bottomY + height / 2, z);
  scene.add(mesh);

  const foamMat = new THREE.SpriteMaterial({ map: getFoamTexture(), transparent: true, opacity: 0.7, depthWrite: false, fog: true });
  const foam = new THREE.Sprite(foamMat);
  foam.scale.set(width * 1.5, width * 0.75, 1);
  foam.position.set(x, bottomY + 0.15, z);
  scene.add(foam);

  // A burst of small splash particles at the base — arcing outward and
  // falling back, continuously recycled, rather than a static foam glow
  // standing in for actual splashing.
  const splashCount = 36;
  const splashPositions = new Float32Array(splashCount * 3);
  const splashVel = new Float32Array(splashCount * 3);
  const splashLife = new Float32Array(splashCount);
  for (let i = 0; i < splashCount; i++) splashLife[i] = 1; // start "dead" so the update loop's reset logic spawns them staggered on the first few frames, not all at once
  const splashGeo = new THREE.BufferGeometry();
  splashGeo.setAttribute("position", new THREE.BufferAttribute(splashPositions, 3));
  const splashMat = new THREE.PointsMaterial({
    map: getFoamTexture(), color: 0xffffff, size: 0.4, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const splash = new THREE.Points(splashGeo, splashMat);
  scene.add(splash);

  return { mesh, foam, splash, splashVel, splashLife, baseX: x, baseY: bottomY, baseZ: z, width };
}

function updateWaterfall(handle, dt, elapsed) {
  if (!handle) return;
  handle.mesh.material.map.offset.y += dt * 2.2; // was -= — that direction scrolled the texture upward instead of down, per direct observation
  handle.foam.material.opacity = 0.55 + Math.sin(elapsed * 2.2) * 0.15; // gentle churn, not a static glow

  const posAttr = handle.splash.geometry.attributes.position;
  for (let i = 0; i < handle.splashLife.length; i++) {
    handle.splashLife[i] += dt * 0.45; // slowed from 0.9 — the boosted upward velocity needs more time to complete its arc before respawning
    if (handle.splashLife[i] >= 1) {
      // Respawn — a fresh outward-and-up burst from a random point along
      // the base of the falls.
      handle.splashLife[i] = 0;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.8 + Math.random() * 1.8;
      posAttr.setXYZ(i,
        handle.baseX + (Math.random() - 0.5) * handle.width * 0.8,
        handle.baseY + 0.1,
        handle.baseZ + (Math.random() - 0.5) * handle.width * 0.4
      );
      handle.splashVel[i * 3] = Math.cos(angle) * speed * 0.35;
      handle.splashVel[i * 3 + 1] = 4 + Math.random() * 3; // was 1.6-3.2 — much higher arc, visibly above the water surface per explicit request
      handle.splashVel[i * 3 + 2] = Math.sin(angle) * speed * 0.35;
    } else {
      // Simple ballistic arc — rises, gravity pulls it back down.
      const t = handle.splashLife[i];
      const gravity = 3.2;
      posAttr.setX(i, posAttr.getX(i) + handle.splashVel[i * 3] * dt);
      posAttr.setY(i, posAttr.getY(i) + (handle.splashVel[i * 3 + 1] - gravity * t) * dt);
      posAttr.setZ(i, posAttr.getZ(i) + handle.splashVel[i * 3 + 2] * dt);
    }
  }
  posAttr.needsUpdate = true;
  handle.splash.material.opacity = 0.7 + Math.sin(elapsed * 3.1) * 0.15;
}

// A genuine flowing current along the river's actual winding path —
// particles travel downstream (increasing Z) while tracking the river's
// curve via the SAME riverCenterX formula terrain.js uses (replicated
// here with the same seed derivation) rather than a straight flow
// direction, since a straight direction wouldn't follow a winding
// channel. This is what actually reads as "the river has a current,"
// distinct from the ambient wave/ripple system.
// Same formula terrain.js's verdant shaper uses for its river's
// meandering centerline, replicated here (not imported — liquid.js
// doesn't depend on terrain.js) so anything needing to follow the
// river's actual path stays correctly aligned with the real carved
// channel.
function riverCenterXAt(z, terrainSeed) {
  return Math.sin(z * 0.035 + terrainSeed * 0.01) * 28 + Math.sin(z * 0.013 + terrainSeed * 0.02) * 14;
}

// A horizontally-tiling streak texture for the river's surface — same
// painting technique as the waterfall texture, but wrapped for a
// sideways/downstream scroll instead of a vertical fall.
let sharedRiverSurfaceTexture = null;
function getRiverSurfaceTexture() {
  if (sharedRiverSurfaceTexture) return sharedRiverSurfaceTexture;
  const w = 128, h = 48;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 30; i++) {
    const y = Math.random() * h;
    const sh = 1 + Math.random() * 2.5;
    const segW = w * (0.15 + Math.random() * 0.4);
    const segX = Math.random() * (w - segW);
    ctx.fillStyle = `rgba(255,255,255,${(0.2 + Math.random() * 0.35).toFixed(2)})`;
    ctx.fillRect(segX, y, segW, sh);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  sharedRiverSurfaceTexture = tex;
  return tex;
}

// A series of flat textured segments laid along the river's actual
// winding path (not one single straight mesh, which couldn't follow a
// curve), each oriented to the local tangent direction so the seams
// between segments stay reasonably aligned with the river's own bend —
// gives the water's surface the same kind of visible "flowing texture"
// look the waterfall already has, distinct from the current's particles.
function createRiverFlowStrip(scene, terrainSeed, waterY, zMin, zMax, width, segmentCount) {
  const group = new THREE.Group();
  const tex = getRiverSurfaceTexture();
  const segLength = (zMax - zMin) / segmentCount;
  for (let i = 0; i < segmentCount; i++) {
    const zStart = zMin + i * segLength;
    const zEnd = zStart + segLength;
    const zMid = (zStart + zEnd) / 2;
    const xStart = riverCenterXAt(zStart, terrainSeed);
    const xEnd = riverCenterXAt(zEnd, terrainSeed);
    const xMid = riverCenterXAt(zMid, terrainSeed);
    const geo = new THREE.PlaneGeometry(width, segLength * 1.15); // slight overlap between segments so bends don't leave a visible gap
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: tex, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: true,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(xMid, waterY + 0.03, zMid);
    mesh.rotation.y = Math.atan2(xEnd - xStart, zEnd - zStart); // aligns each segment with the river's local bend
    group.add(mesh);
  }
  scene.add(group);
  return { group, texture: tex };
}

function updateRiverFlowStrip(handle, dt) {
  if (!handle) return;
  handle.texture.offset.x -= dt * 0.5; // scrolls sideways across each segment for a flowing-surface look
}

function disposeRiverFlowStrip(scene, handle) {
  if (!handle) return;
  scene.remove(handle.group);
  handle.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose(); // the shared pooled texture itself intentionally not disposed
  });
}

function createRiverCurrent(scene, terrainSeed, waterY, zMin, zMax, count) {
  const mat = new THREE.PointsMaterial({
    map: getFoamTexture(), color: 0xffffff, size: 0.55, transparent: true, opacity: 0.65,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const positions = new Float32Array(count * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  const zPositions = new Float32Array(count);
  const speeds = new Float32Array(count);
  const perpOffsets = new Float32Array(count); // fixed sideways scatter within the channel width, set once (not re-randomized every frame, which would look like static)
  for (let i = 0; i < count; i++) {
    zPositions[i] = zMin + Math.random() * (zMax - zMin);
    speeds[i] = 9 + Math.random() * 5;
    perpOffsets[i] = (Math.random() - 0.5) * 7;
  }
  return { points, zPositions, speeds, perpOffsets, terrainSeed, waterY, zMin, zMax, count };
}

function updateRiverCurrent(handle, dt) {
  if (!handle) return;
  const posAttr = handle.points.geometry.attributes.position;
  const span = handle.zMax - handle.zMin;
  for (let i = 0; i < handle.count; i++) {
    handle.zPositions[i] += handle.speeds[i] * dt;
    if (handle.zPositions[i] > handle.zMax) handle.zPositions[i] -= span; // wraps back to the upstream end, preserving overflow instead of snapping to a fixed value
    const z = handle.zPositions[i];
    const riverX = riverCenterXAt(z, handle.terrainSeed);
    posAttr.setXYZ(i, riverX + handle.perpOffsets[i], handle.waterY + 0.08, z);
  }
  posAttr.needsUpdate = true;
}

function disposeRiverCurrent(scene, handle) {
  if (!handle) return;
  scene.remove(handle.points);
  handle.points.geometry.dispose();
  handle.points.material.dispose();
}

// A wide craggy rock wall spanning the whole cliff face the waterfall
// falls from — the cliff itself is just terrain (grass-colored, matching
// the rest of the hillside), so without this the "cliff" only reads as
// a rock formation right where the small scattered boulders happen to
// sit, not as a genuine rock FACE. A segmented plane with per-vertex
// jitter (forward/back AND up/down) reads as a jagged rock surface
// rather than a flat card, with a real vertex-color gradient (dark stone
// low down, blending toward a mossy tint near the top where it meets
// the grass) using the same technique this project's other rock props
// already use.
function createCliffWall(scene, topY, bottomY, x, z, width, seedRand) {
  const height = THREE.MathUtils.clamp(topY - bottomY, 0, 16) + 3; // a bit taller than the falls itself so the rock face visibly extends past both edges of the water
  const segsX = 40, segsY = 10; // was 26,6 — bumped further per explicit "higher poly count everywhere" request
  const geo = new THREE.PlaneGeometry(width, height, segsX, segsY); // caller passes the exact total width directly now (no internal multiplier)
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const stoneLow = new THREE.Color(0x3a3a34);
  const stoneHigh = new THREE.Color(0x5c6b4a);
  for (let i = 0; i < pos.count; i++) {
    const jitter = (seedRand() - 0.5) * 1.1;
    pos.setZ(i, pos.getZ(i) + jitter); // forward/back — the actual jagged-rock read
    pos.setY(i, pos.getY(i) + (seedRand() - 0.5) * 0.4);
    const t = THREE.MathUtils.clamp((pos.getY(i) + height / 2) / height, 0, 1); // 0 at the base, 1 near the top
    const c = stoneLow.clone().lerp(stoneHigh, t);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // Stays facing +Z by default (a standard PlaneGeometry's normal), which
  // is the direction the player approaches from downstream — no rotation
  // needed.
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, bottomY + height / 2 - 1.5, z - 2.5); // was z+0.3 — that positive offset actually placed it IN FRONT of the waterfall (closer to the player, who approaches from the south/higher Z), occluding it entirely; negative offset genuinely sits it behind, matching the cave mouth's convention
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh };
}

function disposeCliffWall(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
}

// The pond feeding the waterfall from above — without this the falls had
// no visible source at all. The `radius` passed in must be small enough
// that this SQUARE plane's CORNERS (which reach radius*sqrt(2), not
// radius) stay within terrain.js's guaranteed core radius (0.55 *
// POND_RADIUS, where the basin floor is an absolute guarantee
// independent of the surrounding hill noise) — verified numerically at
// the main.js call site, not just assumed from the plane's nominal size.
function createSourcePond(scene, x, z, y, radius) {
  const segs = 20;
  const geo = new THREE.PlaneGeometry(radius * 2, radius * 2, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const basePositions = pos.array.slice();
  // Soft circular fade at the edges (via vertex alpha isn't available on
  // a single opaque material, so this fades the OPACITY of the whole
  // material toward the edges isn't possible per-vertex either) — instead
  // the mesh is kept comfortably smaller than the actual guaranteed-flat
  // basin floor, so its straight edges sit over flat, water-colored
  // terrain rather than a visible seam against a slope.
  const mat = new THREE.MeshStandardMaterial({
    color: 0x0f4a78, roughness: 0.25, metalness: 0.05, transparent: true, opacity: 0.9,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return { mesh, basePositions };
}

function updateSourcePond(handle, elapsed) {
  if (!handle) return;
  const pos = handle.mesh.geometry.attributes.position;
  const base = handle.basePositions;
  // Same two-layer swell+chop technique as the main water plane's wave
  // system, just a gentler amplitude — a small still pond shouldn't churn
  // as much as the river/waterfall below it, but it should still read as
  // real moving water rather than a static painted disc.
  for (let i = 0; i < pos.count; i++) {
    const bx = base[i * 3], bz = base[i * 3 + 2];
    const swell = Math.sin(bx * 0.25 + elapsed * 0.7) * 0.05 + Math.cos(bz * 0.22 + elapsed * 0.55) * 0.05;
    const chop = Math.sin(bx * 0.6 + bz * 0.45 + elapsed * 1.6) * 0.02;
    pos.setY(i, swell + chop);
  }
  pos.needsUpdate = true;
}

function disposeSourcePond(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
}

function disposeWaterfall(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose(); // shared pooled texture itself intentionally not disposed
  scene.remove(handle.foam);
  handle.foam.material.dispose();
  scene.remove(handle.splash);
  handle.splash.geometry.dispose();
  handle.splash.material.dispose();
}

function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }, excludeRegions = []) {
  const style = LIQUID_STYLE[biome];
  if (!style) return null;
  const segs = getGraphicsSettings().liquidSegments; // reverted the earlier ×1.4 workaround — liquidSegments itself is now increased directly in graphicsSettings.js
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  // Punches real holes in the water plane for any excluded region (e.g.
  // a chasm that should read as genuinely dry, not flooded) — this flat
  // plane otherwise covers the WHOLE map uniformly at one fixed height,
  // with no awareness of what's actually been carved beneath it, so a
  // deep pit anywhere below `y` would always appear flooded regardless
  // of intent. Removes any triangle whose centroid falls within an
  // excluded region's radius; vertex colors are untouched since they're
  // still valid for the remaining boundary triangles that reference them.
  if (excludeRegions.length > 0) {
    const posAttr = geo.attributes.position;
    const oldIndex = geo.index.array;
    const newIndex = [];
    for (let i = 0; i < oldIndex.length; i += 3) {
      const a = oldIndex[i], b = oldIndex[i + 1], c = oldIndex[i + 2];
      const cx = (posAttr.getX(a) + posAttr.getX(b) + posAttr.getX(c)) / 3;
      const cz = (posAttr.getZ(a) + posAttr.getZ(b) + posAttr.getZ(c)) / 3;
      const excluded = excludeRegions.some((r) => Math.hypot(cx - r.x, cz - r.z) < r.radius);
      if (!excluded) newIndex.push(a, b, c);
    }
    geo.setIndex(newIndex);
  }

  const posAttr = geo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  // Depth-based base color — Crystal only. Real oceans read lighter over
  // a shallow reef/shoreline and darker over open deep water; a single
  // flat baseColor everywhere (what every other biome's water still
  // uses) can't capture that. Computed once here from the actual terrain
  // height under each vertex (same sampleHeight technique the ember
  // rocks above already use), stored on the handle so the per-frame wave
  // update below blends wave disturbance on TOP of this instead of one
  // uniform starting color.
  let depthColors = null;
  if (biome === "crystal" && sampleHeight) {
    depthColors = new Float32Array(posAttr.count * 3);
    const shallow = new THREE.Color(0x5fa8c4); // lighter, more turquoise — reef crests and the shoreline
    const deep = style.baseColor; // the deep blue tuned in LIQUID_STYLE.crystal
    const tmpDepth = new THREE.Color();
    const MAX_DEPTH = 7; // beyond this the water reads as fully "deep" — matches the reef's own real depth range from terrain.js
    for (let i = 0; i < posAttr.count; i++) {
      const vx = posAttr.getX(i), vz = posAttr.getZ(i);
      const groundY = sampleHeight(vx, vz);
      const depth = groundY === null ? MAX_DEPTH : Math.max(0, y - groundY);
      const t = Math.min(1, depth / MAX_DEPTH);
      tmpDepth.copy(shallow).lerp(deep, t);
      tmpDepth.toArray(depthColors, i * 3);
      tmpDepth.toArray(colors, i * 3);
    }
  } else {
    for (let i = 0; i < posAttr.count; i++) {
      style.baseColor.toArray(colors, i * 3);
    }
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const matOptions = {
    vertexColors: true, emissive: style.emissive, emissiveIntensity: style.emissiveIntensity,
    transparent: true, opacity: style.opacity, roughness: style.roughness, metalness: 0.1,
    // Crystal is the one biome where the whole landmass sits below the
    // water — the player is normally looking UP at this surface, not
    // down at it, so the default single-sided (front-face-only, facing
    // up) plane would be invisible from below entirely. Every other
    // biome's water is only ever seen from above, so left untouched.
    side: biome === "crystal" ? THREE.DoubleSide : THREE.FrontSide,
  };
  // MeshPhysicalMaterial (MeshStandardMaterial plus a real clearcoat
  // layer) for the ocean specifically — a water surface's specular
  // highlight really is a thin, near-flat reflective film sitting on top
  // of the bulk-colored water beneath it, which clearcoat models
  // properly instead of just faking it by cranking the base material's
  // own roughness down. Ember's lava and Verdant's river keep plain
  // MeshStandardMaterial, unchanged.
  const mat = biome === "crystal"
    ? new THREE.MeshPhysicalMaterial({ ...matOptions, clearcoat: 1.0, clearcoatRoughness: 0.06 })
    : new THREE.MeshStandardMaterial(matOptions);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  scene.add(mesh);

  // A separate unlit, additively-blended plane just above the surface —
  // gives lava genuine luminous "glow" the way MeshStandardMaterial's own
  // emissive can't on its own once it's subject to the renderer's
  // lighting/tone mapping alongside the day/night cycle. Water doesn't
  // get one — it isn't meant to look lit from within.
  let glow = null;
  let shimmer = null;
  if (style.glowColor !== undefined) {
    const glowGeo = new THREE.PlaneGeometry(size, size, 1, 1);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: style.glowColor, transparent: true, opacity: style.glowOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = y + 0.05;
    scene.add(glow);

    // Heat shimmer sits a few units above the surface (not on it) so it
    // reads as haze rising off the lava rather than another lava-colored
    // layer — subtle and additive, meant to be almost subliminal up close.
    const shimmerGeo = new THREE.PlaneGeometry(size, size, 1, 1);
    shimmerGeo.rotateX(-Math.PI / 2);
    const shimmerMat = new THREE.MeshBasicMaterial({
      map: createShimmerTexture(), transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    });
    shimmer = new THREE.Mesh(shimmerGeo, shimmerMat);
    shimmer.position.y = y + 3.5;
    scene.add(shimmer);
  }

  // Small cooled-obsidian chunks drifting on the lava's surface — placed
  // by sampling real terrain height (like grass/flowers/landmarks already
  // do), so they only ever land in spots genuinely low enough to be
  // covered by the lava plane, never floating visibly over solid ground.
  let rocks = null;
  if (biome === "ember" && sampleHeight) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x120a08, roughness: 0.6, flatShading: true, emissive: 0xff5522, emissiveIntensity: 0.15 });
    const rockGeo = new THREE.IcosahedronGeometry(1, 0); // unit size — actual scale applied per-instance
    const maxRocks = 26;
    const rockMesh = new THREE.InstancedMesh(rockGeo, rockMat, maxRocks);
    const dummy = new THREE.Object3D();
    const rockData = [];
    let attempts = 0, placed = 0;
    while (placed < maxRocks && attempts < maxRocks * 12) {
      attempts++;
      const rx = (Math.random() - 0.5) * size * 0.42, rz = (Math.random() - 0.5) * size * 0.42;
      const groundY = sampleHeight(rx, rz);
      if (groundY === null || groundY >= y - 0.3) continue; // only genuinely submerged spots, not right at the lava's edge
      const s = 0.3 + Math.random() * 0.5;
      dummy.position.set(rx, y + 0.05, rz);
      dummy.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      rockMesh.setMatrixAt(placed, dummy.matrix);
      rockData.push({ x: rx, z: rz, seed: Math.random() * Math.PI * 2, bobAmp: 0.03 + Math.random() * 0.04, scale: s });
      placed++;
    }
    rockMesh.count = placed;
    rockMesh.instanceMatrix.needsUpdate = true;
    scene.add(rockMesh);
    rocks = { mesh: rockMesh, data: rockData, baseY: y };
  }

  // Flow-noise octave counts scale with segment density (itself already
  // tier-gated by graphicsSettings) rather than reading a tier name
  // directly — fewer segments already means coarser geometry, so this
  // just keeps the noise detail proportionate instead of spending 3
  // octaves of fbm per vertex on a Low-tier mesh that has few vertices
  // to show it on anyway.
  const crustOctaves = segs >= 40 ? 2 : 1;
  const crackOctaves = segs >= 40 ? 3 : (segs >= 24 ? 2 : 1);

  // Traveling flow-bead droplets — Ember only, same visual language as
  // the volcano's own vein beads for a consistent "the whole biome is
  // alive" feel rather than the volcano being the only thing that
  // visibly flows.
  let flowBeads = null;
  if (biome === "ember") {
    flowBeads = createLavaFlowBeads(normalizeFlow(flowDir), size, 10);
    scene.add(flowBeads.group);
  }

  const basePositions = new Float32Array(posAttr.array); // original Y per vertex, for the ripple to animate around

  return {
    mesh, glow, shimmer, rocks, waterY: y, basePositions, biome, style, depthColors,
    flowDir: normalizeFlow(flowDir), crustOctaves, crackOctaves, flowBeads,
  };
}

function updateLiquidPlane(handle, elapsed, skyColor, cameraY, playerPos, sunDir) {
  if (!handle) return;
  const { mesh, glow, shimmer, rocks, basePositions, biome, style, flowDir, crustOctaves, crackOctaves, flowBeads, waterY } = handle;
  const posAttr = mesh.geometry.attributes.position;
  const colorAttr = mesh.geometry.attributes.color;
  // Crystal writes real analytic Gerstner normals straight into this
  // attribute each frame (see the per-vertex loop below) instead of
  // calling geometry.computeVertexNormals() afterward — the analytic
  // formula is exact for the current frame's exact displacement, where
  // computeVertexNormals() would only be geometrically approximate and
  // (since it'd run after this loop) a frame behind. Every other biome
  // still gets the normal geometric method, called at the end of this
  // function as before.
  const normalAttr = mesh.geometry.attributes.normal;
  // Sun direction is passed as sun.position (a world position far from
  // the scene, not a literal direction) — normalizing it directly is a
  // fine approximation of "direction toward the sun" at this distance,
  // the same approximation the old mirror-water reflection used.
  const sunDirUnit = (biome === "crystal" && sunDir) ? sunDir.clone().normalize() : null;
  // Cheap per-vertex ripple for ember/verdant — lava churns slower/
  // heavier, water ripples lighter and faster. A second, higher-
  // frequency/lower-amplitude term layered on top of the main swell adds
  // finer chop instead of one smooth wave shape everywhere. Crystal no
  // longer uses these — its ocean surface is driven by the Gerstner wave
  // sum above instead (see GERSTNER_WAVES).
  const speed = biome === "ember" ? 0.6 : 1.4;
  const amp = biome === "ember" ? 0.18 : 0.16;
  const chopAmp = amp * 0.35;
  const swell2Amp = amp * 0.55;
  const flowSpeed = 0.12; // noise-space units/sec the crust/crack field drifts along flowDir
  const tmpColor = new THREE.Color();
  const tmpDepthColor = new THREE.Color();
  // Subsurface-scattering crest tint and Fresnel grazing-angle rim —
  // Crystal only. Real water isn't opaque: light entering a wave crest
  // scatters inside it and exits toward the viewer tinted by the water
  // itself, brightest right where the crest faces the sun — a bright
  // aqua-green rather than the deep-water base blue. Fresnel is the
  // separate, purely geometric effect of any surface reflecting more of
  // its environment at a grazing viewing angle than head-on; blended
  // toward a pale sky tint here since there's no environment map to
  // literally reflect.
  const sssColor = new THREE.Color(0x39e6b5);
  const fresnelColor = new THREE.Color(0xe8f6ff);
  // Water tints toward the current sky color each frame (recomputed fresh,
  // not stored — otherwise it'd drift further every frame instead of
  // tracking the actual sky) — real reflection needs a render-to-texture
  // pass this project doesn't have, but a lake visibly bluer at noon and
  // darker at night reads as "reflective" even without a literal mirror
  // image in it. Lava doesn't get this — it's not reflective, it's lit
  // from within.
  const baseColor = ((biome === "verdant" || biome === "crystal") && skyColor)
    ? style.baseColor.clone().lerp(skyColor, 0.4)
    : style.baseColor;
  for (let i = 0; i < posAttr.count; i++) {
    const bx = basePositions[i * 3], bz = basePositions[i * 3 + 2];
    let ripple, range, gerstnerX = bx, gerstnerZ = bz, nx = 0, ny = 1, nz = 0;
    if (biome === "crystal") {
      // Real Gerstner (trochoidal) displacement — each wave component
      // pulls the vertex horizontally toward the crest as well as
      // pushing it up, which is what makes real ocean waves look peaked
      // rather than a symmetric sine bump. Summed across several
      // directional components (see GERSTNER_WAVES above the function)
      // for a genuine rolling-swell-plus-chop ocean surface. The normal
      // (nx, ny, nz) is accumulated analytically alongside the
      // displacement using the standard closed-form Gerstner normal
      // formula, rather than derived after the fact from triangle
      // geometry — exact for this frame's precise wave shape, and what
      // feeds the material's real specular highlights and the Fresnel/
      // SSS terms below.
      let dx = 0, dz = 0, dy = 0, nyTerm = 0;
      for (const w of GERSTNER_WAVES) {
        const f = w.k * (w.ndx * bx + w.ndz * bz) - w.speed * elapsed;
        const s = Math.sin(f), c = Math.cos(f);
        dx += w.steepness * w.amplitude * w.ndx * c;
        dz += w.steepness * w.amplitude * w.ndz * c;
        dy += w.amplitude * s;
        const WA = w.k * w.amplitude;
        nx -= w.ndx * WA * c;
        nz -= w.ndz * WA * c;
        nyTerm += w.steepness * WA * s;
      }
      ny = 1 - nyTerm;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      nx /= nLen; ny /= nLen; nz /= nLen;
      gerstnerX = bx + dx;
      gerstnerZ = bz + dz;
      ripple = dy;
      range = GERSTNER_AMPLITUDE_SUM * 2;
    } else {
      // Cheap per-vertex ripple — lava churns slower/heavier, water
      // ripples lighter and faster. A second, higher-frequency/
      // lower-amplitude term layered on top of the main swell adds
      // finer chop instead of one smooth wave shape everywhere.
      const swell = Math.sin(bx * 0.15 + elapsed * speed) * amp + Math.cos(bz * 0.12 + elapsed * speed * 0.8) * amp;
      const chop = Math.sin(bx * 0.55 + bz * 0.4 + elapsed * speed * 2.3) * chopAmp;
      // A slow, large-scale diagonal swell — water only (lava's existing
      // 2-layer churn feeds its own crust/crack heat pattern and stays
      // untouched). Different angle and much lower frequency than the
      // other two layers, so it reads as a genuine second wave system
      // moving through the water rather than just a bigger version of the
      // same ripple.
      const swell2 = biome !== "ember" ? Math.sin((bx + bz) * 0.045 + elapsed * speed * 0.35) * swell2Amp : 0;
      ripple = swell + chop + swell2;
      range = (amp + chopAmp + (biome !== "ember" ? swell2Amp : 0)) * 2;
    }
    // A real reactive ripple around wherever the player currently is —
    // water only, not ambient wave motion. Expanding concentric rings
    // (dist*frequency - elapsed*speed) rather than one static bump, so
    // it reads as a wake propagating outward from them as they move.
    if (playerPos && biome !== "ember") {
      const pdx = bx - playerPos.x, pdz = bz - playerPos.z;
      const pDistSq = pdx * pdx + pdz * pdz;
      const RIPPLE_RADIUS = 4.5;
      if (pDistSq < RIPPLE_RADIUS * RIPPLE_RADIUS) {
        const pDist = Math.sqrt(pDistSq);
        const wave = Math.sin(pDist * 2.4 - elapsed * 6.5) * (1 - pDist / RIPPLE_RADIUS);
        ripple += wave * 0.14;
      }
    }

    // Normalize ripple to 0..1.
    const disturbance = THREE.MathUtils.clamp((ripple + range / 2) / range, 0, 1);

    if (biome === "ember" && style.crustColor) {
      // Sample coordinates drift over time along flowDir — this is what
      // makes the pattern actually flow instead of animating in place.
      const fx = bx * 0.045 - elapsed * flowSpeed * flowDir.x;
      const fz = bz * 0.045 - elapsed * flowSpeed * flowDir.z;

      // Low-frequency layer = cooled dark crust. High-frequency layer,
      // warped by the crust value itself (fx*2.6 + crust*1.6), = the
      // molten cracks running through it — the warp is what keeps the
      // cracks from looking like a generic tiled pattern and gives them
      // the branching, uneven look real fracture networks have.
      const crust = fbm(fx, fz, crustOctaves);
      const cracks = fbm(fx * 2.6 + crust * 1.6, fz * 2.6, crackOctaves);
      let heat = smoothstep(0.46, 0.58, cracks) * (1 - THREE.MathUtils.clamp(crust * 0.8, 0, 1));
      // A touch of the physical ripple folded back in keeps the surface
      // feeling like it's genuinely churning, not just a static crack
      // pattern sliding past.
      heat = THREE.MathUtils.clamp(heat + disturbance * 0.12, 0, 1);

      // 3-band gradient, now driven by heat instead of ripple-disturbance:
      // dark crust -> molten red -> white-hot, with crust dominating at
      // rest and the hot band reserved for genuinely open cracks.
      tmpColor.copy(style.crustColor).lerp(baseColor, THREE.MathUtils.clamp(heat * 1.4, 0, 1));
      if (heat > 0.55) tmpColor.lerp(style.hotColor, (heat - 0.55) / 0.45);

      // Bubbling — a faster, higher-frequency noise layer that also
      // evolves in time (elapsed*0.4 inside the sample), so pockets of
      // extra brightness well up and pop as they drift along with the
      // flow, correlated with their neighbors, instead of each vertex
      // flickering on its own independent clock like before.
      const bubblePulse = fbm(fx * 6 + elapsed * 0.4, fz * 6, 2);
      if (bubblePulse > 0.66) {
        const pop = (bubblePulse - 0.66) / 0.34;
        tmpColor.lerp(style.hotColor, pop * 0.9);
      }

      // Hot cracks bulge very slightly — thinner crust over rising
      // pressure reads as a subtle raised ridge, not just a flat color
      // change.
      posAttr.setY(i, ripple + heat * 0.15);
    } else {
      const accent = style.frothColor;
      const frothPower = biome === "crystal" ? 1.9 : 3; // nudged lower (was 2.2) for more visible white crest banding per the deep-blue-with-white reference — the earlier "too much distortion" complaint was mainly the separate screen-space distortAmp, not this
      let localBase = baseColor;
      if (handle.depthColors) {
        // Crystal's own per-vertex depth color (lighter over the reef/
        // shoreline, deep blue over open water) — same sky-reflection
        // blend the flat baseColor gets elsewhere, just applied per
        // vertex here instead of once globally.
        tmpDepthColor.fromArray(handle.depthColors, i * 3);
        if (skyColor) tmpDepthColor.lerp(skyColor, 0.4);
        localBase = tmpDepthColor;
      }
      tmpColor.copy(localBase).lerp(accent, Math.pow(disturbance, frothPower));
      if (biome === "crystal") {
        // Subsurface scattering — brightest where a wave crest faces the
        // sun (positive normal·sunDir) and only near an actual crest
        // (disturbance close to 1, squared to keep it from washing out
        // the troughs too). Real light passing through thin water at a
        // crest exits tinted aqua-green rather than the deep base blue.
        if (sunDirUnit) {
          const nDotL = Math.max(0, nx * sunDirUnit.x + ny * sunDirUnit.y + nz * sunDirUnit.z);
          const sss = nDotL * disturbance * disturbance;
          if (sss > 0) tmpColor.lerp(sssColor, Math.min(1, sss) * 0.65);
        }
        // Fresnel — the classic grazing-angle brightening every real
        // surface shows, computed from the actual view vector (camera
        // minus this vertex's current world position) against the exact
        // analytic normal above. No environment map to literally
        // reflect, so blended toward a pale sky tint instead — reads as
        // "more reflective at a shallow viewing angle" without one.
        if (playerPos) {
          const wx = gerstnerX, wyWorld = waterY + ripple, wz = gerstnerZ;
          let vx = playerPos.x - wx, vy = (cameraY !== undefined ? cameraY : playerPos.y) - wyWorld, vz = playerPos.z - wz;
          const vLen = Math.hypot(vx, vy, vz) || 1;
          vx /= vLen; vy /= vLen; vz /= vLen;
          const viewDot = Math.abs(nx * vx + ny * vy + nz * vz);
          const fresnel = Math.pow(THREE.MathUtils.clamp(1 - viewDot, 0, 1), 3);
          tmpColor.lerp(fresnelColor, fresnel * 0.55);
        }
        posAttr.setXYZ(i, gerstnerX, ripple, gerstnerZ);
        normalAttr.setXYZ(i, nx, ny, nz);
      } else {
        posAttr.setY(i, ripple);
      }
    }
    tmpColor.toArray(colorAttr.array, i * 3);
  }
  posAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  if (biome === "crystal") {
    normalAttr.needsUpdate = true; // written analytically above, per-frame — skip the geometric recompute below
  } else {
    mesh.geometry.computeVertexNormals();
  }

  // Lava also gets a slow overall "breathing" pulse in its base emissive
  // intensity, independent of the spatial hot-spot pattern above — reads
  // as the whole surface swelling with heat, not just individual crests
  // glinting. The separate glow overlay pulses in sync, a touch more
  // strongly, since it's what actually sells "this is a light source."
  if (biome === "ember") {
    const pulse = 0.85 + 0.25 * Math.sin(elapsed * 0.9);
    mesh.material.emissiveIntensity = style.emissiveIntensity * pulse;
    // Proximity — standing right at a crack's edge should feel hotter
    // than glancing at lava from across the terrain. cameraY vs. the
    // lava plane's own Y is a cheap but effective proxy: the closer the
    // player's actual height is to the lava's level, the more likely
    // they're standing right at (or leaning over) a crack.
    const heightDiff = cameraY !== undefined ? Math.abs(cameraY - mesh.position.y) : 20;
    const proximity = THREE.MathUtils.clamp(1 - heightDiff / 10, 0, 1);
    if (glow) glow.material.opacity = style.glowOpacity * (0.75 + 0.4 * Math.sin(elapsed * 0.9)) * (1 + proximity * 0.8);
    if (shimmer) {
      shimmer.material.map.offset.set(Math.sin(elapsed * 0.25) * 0.3, (elapsed * 0.12) % 1); // upward scroll + gentle sideways wobble, not a static texture
      shimmer.material.opacity = 0.18 + proximity * 0.35;
    }
    if (flowBeads) updateLavaFlowBeads(flowBeads, elapsed, mesh.position.y);
  }

  // Cooled rock chunks bob gently with the same ripple rhythm the lava
  // itself uses, plus a slow lazy drift — floating debris, not glued to
  // a fixed point.
  if (rocks) {
    const dummy = new THREE.Object3D();
    for (let i = 0; i < rocks.data.length; i++) {
      const r = rocks.data[i];
      const bob = Math.sin(elapsed * 0.7 + r.seed) * r.bobAmp;
      const driftX = r.x + Math.sin(elapsed * 0.08 + r.seed) * 0.6;
      const driftZ = r.z + Math.cos(elapsed * 0.08 + r.seed) * 0.6;
      dummy.position.set(driftX, rocks.baseY + 0.05 + bob, driftZ);
      dummy.rotation.set(r.seed, elapsed * 0.15 + r.seed, r.seed * 0.5);
      dummy.scale.setScalar(r.scale);
      dummy.updateMatrix();
      rocks.mesh.setMatrixAt(i, dummy.matrix);
    }
    rocks.mesh.instanceMatrix.needsUpdate = true;
  }

}

function disposeLiquidPlane(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
  if (handle.glow) {
    scene.remove(handle.glow);
    handle.glow.geometry.dispose();
    handle.glow.material.dispose();
  }
  if (handle.shimmer) {
    scene.remove(handle.shimmer);
    handle.shimmer.geometry.dispose();
    handle.shimmer.material.map.dispose();
    handle.shimmer.material.dispose();
  }
  if (handle.rocks) {
    scene.remove(handle.rocks.mesh);
    handle.rocks.mesh.geometry.dispose();
    handle.rocks.mesh.material.dispose();
  }
  if (handle.flowBeads) {
    scene.remove(handle.flowBeads.group);
    for (const b of handle.flowBeads.beads) {
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
  }
}

export { createLiquidPlane, updateLiquidPlane, disposeLiquidPlane, createWaterfall, updateWaterfall, disposeWaterfall, createRiverCurrent, updateRiverCurrent, disposeRiverCurrent, createRiverFlowStrip, updateRiverFlowStrip, disposeRiverFlowStrip, createCliffWall, disposeCliffWall, createSourcePond, updateSourcePond, disposeSourcePond, createOceanSpray, updateOceanSpray, disposeOceanSpray, createOceanSurfaceDetail, updateOceanSurfaceDetail, disposeOceanSurfaceDetail };

// Ocean surface detail — Coral Shallows only: sun glitter (small, sharp,
// independently-flickering bright points) and whitecaps/foam texture
// (real mottled foam-blob patches scattered across the water, not just
// flat vertex color) covering the whole visible ocean. Real sun glitter
// is thousands of tiny wave facets catching light at slightly different
// angles at once — this project's single flat-shaded water plane can't
// reproduce that exactly, so independently-twinkling bright points
// scattered across the surface is the standard cheap approximation.
// Whitecap density uses a sqrt-biased radius (even coverage per unit
// area, not clustered at center) so the water reads as genuinely choppy
// stretching out toward the edges rather than only near the middle.
function createOceanSurfaceDetail(scene, y, size) {
  // Sun glitter.
  const glitterCount = 220;
  const glitterPos = new Float32Array(glitterCount * 3);
  const glitterColors = new Float32Array(glitterCount * 3);
  const glitterSeeds = new Float32Array(glitterCount);
  const glitterSpeeds = new Float32Array(glitterCount);
  for (let i = 0; i < glitterCount; i++) {
    glitterPos[i * 3] = (Math.random() * 2 - 1) * size * 0.48;
    glitterPos[i * 3 + 1] = y + 0.08;
    glitterPos[i * 3 + 2] = (Math.random() * 2 - 1) * size * 0.48;
    glitterColors[i * 3] = glitterColors[i * 3 + 1] = glitterColors[i * 3 + 2] = 1; // updateOceanSurfaceDetail scales brightness via this each frame
    glitterSeeds[i] = Math.random() * Math.PI * 2;
    glitterSpeeds[i] = 1.2 + Math.random() * 2.2; // fast, sharp twinkle — real sun glitter flickers quickly, not a slow breathing pulse
  }
  const glitterGeo = new THREE.BufferGeometry();
  glitterGeo.setAttribute("position", new THREE.BufferAttribute(glitterPos, 3));
  glitterGeo.setAttribute("color", new THREE.BufferAttribute(glitterColors, 3));
  const glitterMat = new THREE.PointsMaterial({
    vertexColors: true, color: 0xfff8e0, size: 0.4, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const glitter = new THREE.Points(glitterGeo, glitterMat);
  scene.add(glitter);

  // Whitecaps / foam texture — real mottled patches (reusing the same
  // soft-radial foam texture the waterfall already uses), scattered
  // across the whole surface. Bigger/more opaque than the glitter points
  // and using NormalBlending (not additive) so they read as solid white
  // foam clumps rather than another glowing light source.
  const whitecapCount = 150;
  const whitecapPos = new Float32Array(whitecapCount * 3);
  for (let i = 0; i < whitecapCount; i++) {
    const r = Math.sqrt(Math.random()) * size * 0.48;
    const angle = Math.random() * Math.PI * 2;
    whitecapPos[i * 3] = Math.cos(angle) * r;
    whitecapPos[i * 3 + 1] = y + 0.1;
    whitecapPos[i * 3 + 2] = Math.sin(angle) * r;
  }
  const whitecapGeo = new THREE.BufferGeometry();
  whitecapGeo.setAttribute("position", new THREE.BufferAttribute(whitecapPos, 3));
  const whitecapMat = new THREE.PointsMaterial({
    map: getFoamTexture(), color: 0xffffff, size: 2.8, transparent: true, opacity: 0.5,
    depthWrite: false, sizeAttenuation: true,
  });
  const whitecaps = new THREE.Points(whitecapGeo, whitecapMat);
  scene.add(whitecaps);

  // Shore break — a tight ring of foam right where the ocean meets the
  // island, synced to the same angle-phased crash cycle updateOceanSpray
  // uses, so there's an actual visible break-line at the water instead of
  // only the airborne mist above it. Reuses the same foam texture as the
  // ambient whitecaps but concentrated in an annulus around SHORE_RADIUS
  // instead of scattered across the whole ocean. vertexColors drives
  // brightness per point each frame (PointsMaterial has no per-vertex
  // opacity), so it can fade instead of just being permanently onscreen.
  const shoreFoamCount = 90;
  const shoreFoamPos = new Float32Array(shoreFoamCount * 3);
  const shoreFoamColors = new Float32Array(shoreFoamCount * 3);
  const shoreFoamAngle = new Float32Array(shoreFoamCount);
  for (let i = 0; i < shoreFoamCount; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = SHORE_RADIUS + (Math.random() - 0.5) * 4;
    shoreFoamPos[i * 3] = ISLAND_CENTER.x + Math.cos(angle) * r;
    shoreFoamPos[i * 3 + 1] = y + 0.12;
    shoreFoamPos[i * 3 + 2] = ISLAND_CENTER.z + Math.sin(angle) * r;
    shoreFoamAngle[i] = angle;
  }
  const shoreFoamGeo = new THREE.BufferGeometry();
  shoreFoamGeo.setAttribute("position", new THREE.BufferAttribute(shoreFoamPos, 3));
  shoreFoamGeo.setAttribute("color", new THREE.BufferAttribute(shoreFoamColors, 3));
  const shoreFoamMat = new THREE.PointsMaterial({
    map: getFoamTexture(), vertexColors: true, color: 0xffffff, size: 3.4, transparent: true, opacity: 0.9,
    depthWrite: false, sizeAttenuation: true,
  });
  const shoreFoam = new THREE.Points(shoreFoamGeo, shoreFoamMat);
  scene.add(shoreFoam);

  return { glitter, glitterSeeds, glitterSpeeds, glitterCount, whitecaps, shoreFoam, shoreFoamAngle, shoreFoamCount };
}

function updateOceanSurfaceDetail(handle, elapsed) {
  if (!handle) return;
  const colorAttr = handle.glitter.geometry.attributes.color;
  for (let i = 0; i < handle.glitterCount; i++) {
    // Cubed (not linear) sine — a sharper, narrower bright peak than a
    // plain sine gives, closer to how a real specular glint pops on and
    // fades rather than breathing smoothly in and out.
    const s = 0.5 + 0.5 * Math.sin(elapsed * handle.glitterSpeeds[i] + handle.glitterSeeds[i]);
    const flicker = Math.pow(s, 3);
    colorAttr.setXYZ(i, flicker, flicker, flicker);
  }
  colorAttr.needsUpdate = true;
  // Whitecaps breathe very slowly and subtly — real chop doesn't flicker,
  // it just varies gradually in how much foam is visible at once.
  handle.whitecaps.material.opacity = 0.42 + Math.sin(elapsed * 0.3) * 0.08;
  if (handle.shoreFoam) {
    const shoreColorAttr = handle.shoreFoam.geometry.attributes.color;
    for (let i = 0; i < handle.shoreFoamCount; i++) {
      // Same phase formula as updateOceanSpray's crash cycle — this ring
      // and the spray above it break at the same point at the same time.
      const wavePhase = elapsed * 1.8 + handle.shoreFoamAngle[i] * 2.4;
      const crash = Math.pow(0.5 + 0.5 * Math.sin(wavePhase), 4);
      const bright = 0.15 + crash * 0.85; // never fully invisible between crashes — a faint tideline, not on/off
      shoreColorAttr.setXYZ(i, bright, bright, bright);
    }
    shoreColorAttr.needsUpdate = true;
  }
}

function disposeOceanSurfaceDetail(scene, handle) {
  if (!handle) return;
  scene.remove(handle.glitter);
  handle.glitter.geometry.dispose();
  handle.glitter.material.dispose();
  scene.remove(handle.whitecaps);
  handle.whitecaps.geometry.dispose();
  handle.whitecaps.material.dispose();
  if (handle.shoreFoam) {
    scene.remove(handle.shoreFoam);
    handle.shoreFoam.geometry.dispose();
    handle.shoreFoam.material.dispose();
  }
}

// Ocean spray — Coral Shallows only. Mist/foam kicked up where waves
// break against the emergent island's shoreline, per explicit "ocean
// spray" follow-up. Reuses createWaterfall's exact same proven
// arc-and-fall particle technique (position/velocity/life arrays,
// staggered respawn so bursts don't pulse in unison) rather than
// inventing a new one — several shoreline emitter points instead of one
// waterfall base, and a gentler arc since this is ambient shore mist,
// not a dramatic waterfall burst.
const ISLAND_CENTER = { x: 55, z: -70 }; // must match terrain.js's own island center
const SHORE_RADIUS = 17; // sits right around where the island's dome crosses LIQUID_LEVEL.crystal — see terrain.js's numeric verification of the crossing point
function createOceanSpray(scene, waterLevel) {
  const emitterCount = 10;
  const emitters = [];
  for (let i = 0; i < emitterCount; i++) {
    const angle = (i / emitterCount) * Math.PI * 2 + Math.random() * 0.2;
    emitters.push({ x: ISLAND_CENTER.x + Math.cos(angle) * SHORE_RADIUS, z: ISLAND_CENTER.z + Math.sin(angle) * SHORE_RADIUS, angle });
  }
  const particlesPerEmitter = 5;
  const count = emitterCount * particlesPerEmitter;
  const positions = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const life = new Float32Array(count);
  const emitterIndex = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    life[i] = 1; // start "dead" — staggers the first spawn wave instead of firing all at once
    emitterIndex[i] = Math.floor(i / particlesPerEmitter);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    map: getFoamTexture(), color: 0xffffff, size: 0.5, transparent: true, opacity: 0.75,
    blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  return { points, vel, life, emitterIndex, emitters, waterLevel };
}

function updateOceanSpray(handle, dt, elapsed) {
  if (!handle) return;
  const posAttr = handle.points.geometry.attributes.position;
  for (let i = 0; i < handle.life.length; i++) {
    const em = handle.emitters[handle.emitterIndex[i]];
    // A traveling crash pulse swept around the shoreline by each emitter's
    // angle, rather than constant ambient mist — real surf builds, breaks
    // sharply, then recedes. The 4th-power sine gives a brief bright spike
    // (most of the cycle sits low) instead of a smooth breathing pulse, and
    // offsetting phase by angle makes the break travel around the island
    // instead of every point crashing in unison. Matches the phase formula
    // updateOceanSurfaceDetail uses for its shore-foam ring, so the visible
    // foam line and the airborne spray above it break together.
    const wavePhase = elapsed * 1.8 + em.angle * 2.4;
    const crash = Math.pow(0.5 + 0.5 * Math.sin(wavePhase), 4);
    handle.life[i] += dt * (0.35 + crash * 1.6); // faster respawn at the crash peak, slower during the lull
    if (handle.life[i] >= 1) {
      handle.life[i] = 0;
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.3 + crash * 1.1) * (0.6 + Math.random() * 0.8);
      const spread = 2.5 + crash * 2.5; // wider scatter when the wave actually breaks
      posAttr.setXYZ(i, em.x + (Math.random() - 0.5) * spread, handle.waterLevel + 0.1, em.z + (Math.random() - 0.5) * spread);
      handle.vel[i * 3] = Math.cos(angle) * speed;
      handle.vel[i * 3 + 1] = 1.2 + crash * 2.8 + Math.random() * 1.2; // crash peaks launch spray noticeably higher than the idle drizzle
      handle.vel[i * 3 + 2] = Math.sin(angle) * speed;
    } else {
      const t = handle.life[i];
      const gravity = 3.2;
      posAttr.setX(i, posAttr.getX(i) + handle.vel[i * 3] * dt);
      posAttr.setY(i, posAttr.getY(i) + (handle.vel[i * 3 + 1] - gravity * t) * dt);
      posAttr.setZ(i, posAttr.getZ(i) + handle.vel[i * 3 + 2] * dt);
    }
  }
  posAttr.needsUpdate = true;
  handle.points.material.opacity = 0.55 + Math.sin(elapsed * 2.6) * 0.1; // gentle churn, matching the waterfall foam's own idle shimmer
}

function disposeOceanSpray(scene, handle) {
  if (!handle) return;
  scene.remove(handle.points);
  handle.points.geometry.dispose();
  handle.points.material.dispose();
}
