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
    baseColor: new THREE.Color(0x1f6fb0), frothColor: new THREE.Color(0xf2fbff),
    emissive: 0x2a8fd6, emissiveIntensity: 0.02, opacity: 0.78, roughness: 0.1, // pushed down further (was 0.06, originally 0.2) per explicit "make night more pronounced" follow-up
  },
};

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
// A bright vertical streak with scattered flecks — real sunlight/
// moonlight glitter on water is broken into many small glints rippling
// with the surface, not one smooth gradient bar.
let sharedGlintTexture = null;
function getGlintTexture() {
  if (sharedGlintTexture) return sharedGlintTexture;
  const w = 64, h = 256;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.22)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(w * 0.28, 0, w * 0.44, h);
  for (let i = 0; i < 70; i++) {
    const gx = w * (0.12 + Math.random() * 0.76);
    const gy = Math.random() * h;
    const r = 1 + Math.random() * 2.5;
    ctx.globalAlpha = 0.35 + Math.random() * 0.5;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(gx, gy, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function createLiquidPlane(scene, biome, y, size, sampleHeight, flowDir = { x: 0.6, z: 0.35 }) {
  const style = LIQUID_STYLE[biome];
  if (!style) return null;
  const segs = getGraphicsSettings().liquidSegments;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
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

  // A bright, elongated "glitter path" streak toward whichever light
  // source (sun or moon) is currently more prominent — real water
  // reflection would need a render-to-texture pass this project doesn't
  // have, but a moving, glinting streak that tracks the actual light
  // direction each frame reads as genuinely reflective in a way the
  // existing sky-color tint alone doesn't. Water only — lava isn't
  // reflective, it's lit from within.
  let glint = null;
  if (biome === "verdant") {
    const glintGeo = new THREE.PlaneGeometry(1, 1);
    const glintMat = new THREE.MeshBasicMaterial({
      map: getGlintTexture(), transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, fog: false,
    });
    glint = new THREE.Mesh(glintGeo, glintMat);
    glint.visible = false;
    scene.add(glint);
  }

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
    mesh, glow, shimmer, rocks, glint, waterY: y, basePositions, biome, style,
    flowDir: normalizeFlow(flowDir), crustOctaves, crackOctaves, flowBeads,
  };
}

function updateLiquidPlane(handle, elapsed, skyColor, cameraY, lightInfo) {
  if (!handle) return;
  const { mesh, glow, shimmer, rocks, basePositions, biome, style, flowDir, crustOctaves, crackOctaves, flowBeads } = handle;
  const posAttr = mesh.geometry.attributes.position;
  const colorAttr = mesh.geometry.attributes.color;
  // Cheap per-vertex ripple — lava churns slower/heavier, water ripples
  // lighter and faster. A second, higher-frequency/lower-amplitude term
  // layered on top of the main swell adds finer chop instead of one
  // smooth wave shape everywhere.
  const speed = biome === "ember" ? 0.6 : 1.4;
  const amp = biome === "ember" ? 0.18 : 0.1;
  const chopAmp = amp * 0.35;
  const flowSpeed = 0.12; // noise-space units/sec the crust/crack field drifts along flowDir
  const tmpColor = new THREE.Color();
  // Water tints toward the current sky color each frame (recomputed fresh,
  // not stored — otherwise it'd drift further every frame instead of
  // tracking the actual sky) — real reflection needs a render-to-texture
  // pass this project doesn't have, but a lake visibly bluer at noon and
  // darker at night reads as "reflective" even without a literal mirror
  // image in it. Lava doesn't get this — it's not reflective, it's lit
  // from within.
  const baseColor = (biome === "verdant" && skyColor)
    ? style.baseColor.clone().lerp(skyColor, 0.4)
    : style.baseColor;
  for (let i = 0; i < posAttr.count; i++) {
    const bx = basePositions[i * 3], bz = basePositions[i * 3 + 2];
    const swell = Math.sin(bx * 0.15 + elapsed * speed) * amp + Math.cos(bz * 0.12 + elapsed * speed * 0.8) * amp;
    const chop = Math.sin(bx * 0.55 + bz * 0.4 + elapsed * speed * 2.3) * chopAmp;
    const ripple = swell + chop;

    // Normalize ripple to 0..1.
    const range = (amp + chopAmp) * 2;
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
      tmpColor.copy(baseColor).lerp(accent, Math.pow(disturbance, 3)); // pow(3) keeps froth rare/at true crests, not smeared across the whole surface
      posAttr.setY(i, ripple);
    }
    tmpColor.toArray(colorAttr.array, i * 3);
  }
  posAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  mesh.geometry.computeVertexNormals();

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

  if (handle.glint && lightInfo) {
    const { cameraPos, sunPos, moonPos, sunStrength, moonStrength } = lightInfo;
    const useSun = sunStrength >= moonStrength;
    const lightPos = useSun ? sunPos : moonPos;
    const strength = Math.max(sunStrength, moonStrength);
    if (!lightPos || strength <= 0.02 || Math.abs(cameraPos.y - handle.waterY) > 12) {
      handle.glint.visible = false;
    } else {
      const dx = lightPos.x - cameraPos.x, dz = lightPos.z - cameraPos.z;
      const dist = Math.hypot(dx, dz) || 1;
      const dir = new THREE.Vector3(dx / dist, 0, dz / dist);
      const nearOffset = 28; // pushed much further out than the last attempt (was 10) — that still wasn't enough margin against the same close-range foreshortening bug, so erring much more conservative this time
      const glintLength = 16; // substantially shorter too (was 34) — a smaller, subtler glint that's far less likely to dominate the view even if the camera ends up closer to it than expected
      const midDist = nearOffset + glintLength * 0.5;
      handle.glint.position.set(
        cameraPos.x + dir.x * midDist,
        handle.waterY + 0.06,
        cameraPos.z + dir.z * midDist
      );
      // Basis construction rather than Euler angles — local X becomes the
      // streak's width, local Y becomes its length (pointed at the
      // light), local Z becomes the surface normal (straight up), which
      // is a more direct way to express "lie flat, point at the light"
      // than composing rotation.x/y/z by hand.
      const up = new THREE.Vector3(0, 1, 0);
      const right = new THREE.Vector3().crossVectors(up, dir).normalize();
      const basis = new THREE.Matrix4().makeBasis(right, dir, up);
      handle.glint.quaternion.setFromRotationMatrix(basis);
      const widthWobble = 2.2 + Math.sin(elapsed * 1.3) * 0.4; // gentle width breathing, mimics the streak narrowing/widening as the water ripples
      handle.glint.scale.set(widthWobble, glintLength, 1);
      handle.glint.material.opacity = strength * 0.75;
      handle.glint.visible = true;
    }
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
  if (handle.glint) {
    scene.remove(handle.glint);
    handle.glint.geometry.dispose();
    handle.glint.material.dispose(); // the shared glint texture itself is pooled (getGlintTexture) and intentionally not disposed here
  }
  if (handle.flowBeads) {
    scene.remove(handle.flowBeads.group);
    for (const b of handle.flowBeads.beads) {
      b.mesh.geometry.dispose();
      b.mesh.material.dispose();
    }
  }
}

export { createLiquidPlane, updateLiquidPlane, disposeLiquidPlane };
