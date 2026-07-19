import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// Lava vein rendering — flat 2D painted illustrations on simple planes,
// not 3D geometry. Earlier attempts built actual wavy 3D ribbon meshes
// to avoid a "flat rectangle" look, but that's solving the wrong
// problem: real flat-vector reference art (bold color bands, a winding
// channel silhouette, a few bright pooled highlights) is a *drawing*,
// not a mesh shape. A canvas-painted texture on a plain plane gets the
// actual reference style directly, is far cheaper to render (one quad
// instead of a multi-segment tri-strip per vein), and is trivial to
// re-paint/re-animate since it's 2D canvas drawing, not vertex math.
//
// NOTE: the previous version's washed-out/pale look (cream instead of
// deep red/orange) was CanvasTexture's default colorSpace — without
// `texture.colorSpace = THREE.SRGBColorSpace`, the renderer treats the
// canvas's sRGB pixel data as linear, which blows out warm colors
// toward pale yellow. Every texture below sets this explicitly.
// -----------------------------------------------------------------------------

// Paints one vein's full channel — dark crust edge, hot core, and a
// scatter of bright pooled highlights — as a single tall illustration,
// snaking left-right down the canvas so it reads as a real winding
// channel rather than a straight stripe. `seed` varies the snake shape
// and highlight placement per-vein so the four veins don't look
// identical.
function createVeinIllustrationTexture(seed) {
  const w = 96, h = 512;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  // Left fully transparent — only the painted channel itself should be
  // opaque, so the cone's black rock shows through everywhere else.

  const points = [];
  const pointCount = 10;
  for (let i = 0; i <= pointCount; i++) {
    const t = i / pointCount;
    const wob = Math.sin(t * 5 + seed * 4) * 0.5 + Math.sin(t * 9 + seed * 2.3) * 0.3;
    points.push({
      x: w / 2 + wob * w * 0.24,
      y: t * h,
      widthMul: 0.55 + 0.45 * Math.sin(t * Math.PI * 0.85 + seed),
    });
  }

  // Stamp overlapping circles along the path to build a tapered organic
  // channel shape cheaply, without hand-authoring a polygon outline.
  // Crust layer first (wider, dark), hot core layer on top (narrower,
  // bright) — the same dark-edge/bright-center read as the ground lava.
  const stampLayer = (color, widthScale) => {
    ctx.fillStyle = color;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i], b = points[i + 1];
      const steps = 8;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const x = THREE.MathUtils.lerp(a.x, b.x, u);
        const y = THREE.MathUtils.lerp(a.y, b.y, u);
        const wMul = THREE.MathUtils.lerp(a.widthMul, b.widthMul, u);
        const r = w * 0.24 * wMul * widthScale;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
  stampLayer("#3a0d00", 1.0);
  stampLayer("#ff5a1f", 0.55);

  // A handful of bright pooled highlights along the channel — the small
  // near-white spots the reference uses to sell "molten," not a uniform
  // glow.
  //
  // BUG FIX: `seed` can be negative here (branch veins get seed + spread*10
  // with spread as low as -0.4, e.g. angle 0.35 -> branchSeed -3.65).
  // JS's `%` returns a NEGATIVE result for a negative left operand (unlike
  // most languages' modulo) — `t` and `r` below were computed straight off
  // raw `seed % ...` without accounting for that, which could push `r`
  // negative. A negative radius throws a real DOMException/IndexSizeError
  // from createRadialGradient/arc in an actual browser (Node's canvas
  // stub used for verification didn't validate this, which is how it got
  // through testing) — this was the actual cause of Ember Reach failing
  // to load, not the terrain/decoration/volcano-cone work reported
  // clean earlier. Math.abs() on the seed-derived terms keeps every
  // vein's visual variety while guaranteeing non-negative math; the
  // Math.max floor on `r` is a second, redundant safety net.
  for (let i = 0; i < 5; i++) {
    const t = 0.12 + ((i + Math.abs(seed % 1)) / 5) * 0.8;
    const idx = Math.max(0, Math.min(points.length - 1, Math.floor(t * points.length)));
    const p = points[idx];
    const r = Math.max(0.5, w * 0.1 * (0.7 + Math.abs((i * 37 + seed * 13) % 10) / 10));
    const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
    grad.addColorStop(0, "#fff3c8");
    grad.addColorStop(1, "rgba(255,243,200,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// A soft, blurry radial-falloff texture for the ambient glow halo behind
// each vein — cached once, reused everywhere, since it's identical for
// every instance.
let _softGlowTexture = null;
function getSoftGlowTexture() {
  if (_softGlowTexture) return _softGlowTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,140,50,0.9)");
  grad.addColorStop(0.6, "rgba(255,90,30,0.35)");
  grad.addColorStop(1, "rgba(255,90,30,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _softGlowTexture = new THREE.CanvasTexture(canvas);
  _softGlowTexture.colorSpace = THREE.SRGBColorSpace;
  return _softGlowTexture;
}

// -----------------------------------------------------------------------------
// SWAP POINT: landmarks — exactly one massive, hand-crafted structure per
// biome, placed at a fixed position rather than scattered randomly like
// every other decoration. This is the one thing in each biome that isn't
// procedural/repeating: a genuine "you'll remember seeing that" discovery,
// dwarfing regular decorations in scale, each with its own glowing energy
// core marking it as something more than scenery. Swap
// createLandmark()'s per-biome branch for a different structure without
// touching placement/energy-core mechanics.
// -----------------------------------------------------------------------------

// Fixed position per biome (not random — a landmark you can navigate
// toward and remember is the whole point) — offset from dead-center so it
// isn't directly on top of the player's spawn point.
const LANDMARK_POSITION = { x: 55, z: -70 };

function createEnergyCore(colorHex, radius, coreHeight) {
  const group = new THREE.Group();
  const coreMat = new THREE.MeshStandardMaterial({
    color: colorHex, emissive: colorHex, emissiveIntensity: 1.1, roughness: 0.3, transparent: true, opacity: 0.85,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(radius, 0), coreMat);
  core.position.y = coreHeight;
  group.add(core);
  const light = new THREE.PointLight(colorHex, 1.4, radius * 14);
  light.position.y = coreHeight;
  group.add(light);
  return { group, core, light, pulseSeed: Math.random() * Math.PI * 2 };
}

// Ember: a massive obsidian monolith, taller and more elaborate than the
// regular obsidian formation decoration — thick glowing veins spiral up
// its full height instead of a few short cracks.
// A wide tapered volcano cone with a glowing crater pool at the top and a
// lava river flowing down one slope to the ground — replaces the old
// obsidian monolith as Ember's landmark, since an actual volcano is a far
// better fit for "the one big thing in the lava biome." Erupts on its own
// periodic timer (handled in updateLandmark below), so this function just
// builds the static structure and returns the state the eruption logic
// needs.
// One lava vein running from just below the crater down to the base at a
// given angle, plus 2 short branches fanning out where it reaches the
// ground — real lava doesn't stop in a single point at the base, it
// spreads into a shallow braided delta. Returns the flat list of segment
// records (main chain + branches) for updateVolcano to animate uniformly.
function createLavaVeinChain(group, angle, coneH, baseR, craterR, glowsOut) {
  const slopeAngle = Math.atan2(baseR - craterR, coneH);
  const length = coneH * 0.9;
  const width = 3.2;
  const midY = coneH * 0.5;
  const midR = baseR * 0.48 + 0.6;
  const seed = angle;
  const segments = [];

  // Ambient glow halo behind the vein — additive + no depth write so it
  // never competes with the sharp painted channel drawn on top of it.
  const glowMat = new THREE.MeshBasicMaterial({
    map: getSoftGlowTexture(), color: 0xff8a3a, transparent: true, opacity: 0.3,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(coneH * 0.7, coneH * 0.7), glowMat);
  glow.position.set(Math.sin(angle) * midR, midY, Math.cos(angle) * midR);
  glow.rotation.y = angle;
  glow.rotation.x = -(Math.PI / 2 - slopeAngle);
  group.add(glow);
  if (glowsOut) glowsOut.push(glow);

  // The vein itself — a single flat plane carrying the whole painted
  // channel illustration, tilted to lie against the cone's slope. One
  // quad instead of a multi-segment mesh: cheaper to draw and the
  // "shape" now comes entirely from the 2D painting, not vertex math.
  const tex = createVeinIllustrationTexture(seed);
  tex.repeat.set(1, 1.4); // slight vertical tiling headroom for the scroll animation in updateVolcano
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 1, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, length), mat);
  mesh.position.set(Math.sin(angle) * midR, midY, Math.cos(angle) * midR);
  mesh.rotation.y = angle;
  mesh.rotation.x = -(Math.PI / 2 - slopeAngle);
  group.add(mesh);
  segments.push({ mesh, tex, seed });

  // Braided fan at the base — 2 short painted offshoots peeling away
  // from where the main vein meets the ground, reading as the flow
  // spreading out once it hits flatter ground.
  const baseX = Math.sin(angle) * baseR, baseZ = Math.cos(angle) * baseR;
  for (const spread of [-0.4, 0.4]) {
    const branchAngle = angle + spread;
    const branchLen = 4 + Math.random() * 2;
    const branchSeed = seed + spread * 10;
    const branchTex = createVeinIllustrationTexture(branchSeed);
    branchTex.repeat.set(1, 1.4);
    const branchMat = new THREE.MeshBasicMaterial({ map: branchTex, transparent: true, opacity: 1, side: THREE.DoubleSide });
    const branch = new THREE.Mesh(new THREE.PlaneGeometry(1.8, branchLen), branchMat);
    branch.position.set(baseX + Math.sin(branchAngle) * branchLen * 0.4, 0.4, baseZ + Math.cos(branchAngle) * branchLen * 0.4);
    branch.rotation.x = -Math.PI / 2 + 0.08;
    branch.rotation.z = branchAngle;
    group.add(branch);
    segments.push({ mesh: branch, tex: branchTex, seed: branchSeed });
  }
  return segments;
}

// A tight vertical spray of thin bright streaks shooting up out of the
// crater during an eruption — layered on top of the arcing chunks, this
// is what actually reads as a continuous fountain rather than a few
// discrete flying rocks, matching how a real eruption's plume looks.
function createEruptionFountain(coneH) {
  const group = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0xffcf6e, transparent: true, opacity: 0 });
  const streaks = [];
  for (let i = 0; i < 10; i++) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 2.5), mat.clone());
    mesh.position.set(0, coneH, 0);
    group.add(mesh);
    streaks.push({
      mesh, seed: Math.random() * Math.PI * 2,
      angle: Math.random() * Math.PI * 2, radius: Math.random() * 0.8,
      speed: 7 + Math.random() * 5, phase: Math.random(),
    });
  }
  return { group, streaks, craterY: coneH };
}

function createEmberLandmark(colorHex) {
  const group = new THREE.Group();
  // The reference volcano reads as a COOL blue-violet silhouette against
  // the hot orange sky — high-contrast complementary colors are a big
  // part of why it pops. The old warm rock-brown (0x1c130f) fought that
  // directly, since it sat in the same warm family as everything else in
  // the biome instead of contrasting with it. vertexColors:true here
  // because the cone gets a painted height gradient below, not one flat
  // material color.
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });
  const coneH = 27, baseR = 10, craterR = 2.2;
  const coneGeo = new THREE.CylinderGeometry(craterR, baseR, coneH, 9, 4);
  // Push each ring of vertices in/out slightly at random — a perfectly
  // smooth tapered cylinder reads as a traffic cone, not a rocky
  // mountain. Scaled well down from earlier passes (0.9 -> 0.32): the
  // reference's cone silhouette is clean and deliberate with only a few
  // sharp facets/highlight streaks, not an all-over bumpy noise surface —
  // a little irregularity sells "mountain," a lot of it just looks noisy.
  // Vertices nearer the very top (the crater rim) get less jitter so the
  // crater opening itself stays roughly circular.
  const conePos = coneGeo.attributes.position;
  for (let i = 0; i < conePos.count; i++) {
    const x = conePos.getX(i), y = conePos.getY(i), z = conePos.getZ(i);
    const heightT = (y + coneH / 2) / coneH; // 0 at base, 1 at crater rim
    const jitterAmount = (1 - heightT * 0.6) * 0.32;
    const angle = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const jitter = 1 + (Math.sin(angle * 5 + y * 0.7) * 0.5 + Math.sin(angle * 11 - y * 0.3) * 0.5) * (jitterAmount / Math.max(r, 0.5));
    conePos.setX(i, x * jitter);
    conePos.setZ(i, z * jitter);
  }
  coneGeo.computeVertexNormals();

  // Painted height gradient — deep blue-violet shadowed base rising to a
  // pale lavender-gray near the crater rim, the same "flat illustration"
  // banding idea as terrain.js's HEIGHT_PALETTE, applied here as a
  // continuous gradient rather than hard bands since the cone's own
  // faceted flatShading normals already break the surface into distinct
  // flat-lit panels — real per-facet lighting response IS the "painted
  // highlight streak" look here, the same technique the reference itself
  // appears to use, so we don't need to fight it the way the obsidian
  // formation's glossy metalness did.
  const coneColors = new Float32Array(conePos.count * 3);
  const shadowColor = new THREE.Color(0x22213a);
  const rimColor = new THREE.Color(0x8f8fae);
  const tmpConeColor = new THREE.Color();
  for (let i = 0; i < conePos.count; i++) {
    const y = conePos.getY(i);
    const heightT = (y + coneH / 2) / coneH;
    tmpConeColor.copy(shadowColor).lerp(rimColor, heightT);
    coneColors[i * 3] = tmpConeColor.r; coneColors[i * 3 + 1] = tmpConeColor.g; coneColors[i * 3 + 2] = tmpConeColor.b;
  }
  coneGeo.setAttribute("color", new THREE.BufferAttribute(coneColors, 3));

  const cone = new THREE.Mesh(coneGeo, rockMat);
  cone.position.y = coneH / 2;
  group.add(cone);

  // The crater pool — a small glowing disc sitting in the flattened top
  // the tapered cylinder naturally leaves, always lit (an active volcano
  // glows even between eruptions) and flaring dramatically brighter when
  // one actually happens.
  const poolMat = new THREE.MeshBasicMaterial({ color: 0xffd23f });
  const poolBaseColor = new THREE.Color(0xffd23f);
  const poolHotColor = new THREE.Color(0xffffff);
  const pool = new THREE.Mesh(new THREE.CircleGeometry(craterR * 0.75, 10), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = coneH + 0.05;
  group.add(pool);
  const craterLight = new THREE.PointLight(0xff6a2a, 1.2, 24);
  craterLight.position.y = coneH + 1;
  group.add(craterLight);

  // Lava veins — a chain of tapered segments running down the slope from
  // just below the crater to the base, colored with the same hot gradient
  // as the ground-level lava and animated with a scrolling glow so each
  // reads as actively flowing, not a painted stripe. Several of these at
  // different angles (not just one) is what actually gives the "cracked
  // open, glowing from within" look rather than a single decorative
  // stripe down one side.
  const veinAngles = [0.35, 1.9, 3.4, 5.1]; // deliberately uneven spacing, not a perfect cross — real fracture patterns aren't symmetric
  const riverSegments = [];
  const veinGlows = [];
  for (const veinAngle of veinAngles) {
    const built = createLavaVeinChain(group, veinAngle, coneH, baseR, craterR, veinGlows);
    riverSegments.push(...built);
  }

  const energy = createEnergyCore(colorHex, 1.4, coneH * 0.5);
  energy.group.position.set(0, 0, baseR * 0.55); // offset toward one of the vein sides rather than dead-center in the cone
  group.add(energy.group);

  const chunks = createEruptionChunks(colorHex);
  for (const chunk of chunks) group.add(chunk.mesh);

  // A tighter, taller vertical fountain layered on top of the arcing
  // chunks — thin bright streaks shooting straight up out of the crater
  // and falling back, giving the continuous "spray" a real eruption has
  // instead of just a handful of discrete flying rocks.
  const fountain = createEruptionFountain(coneH);
  group.add(fountain.group);

  return {
    group, energy, baseY: 0, biome: "ember",
    volcano: {
      pool, poolMat, poolBaseColor, poolHotColor, craterLight, riverSegments, veinGlows, craterY: coneH,
      baseR, craterR, // needed by the chunk sliding phase to follow the cone's actual surface, not fall through open air
      eruptionTimer: 8 + Math.random() * 12, // first eruption arrives reasonably soon rather than making the player wait a full cycle
      eruptionPhase: 0, // 0 = dormant, ramps to 1 during an active eruption and back down
      erupting: false,
      chunks,
      fountain,
    },
  };
}

// A small pool of magma chunks reused across every eruption rather than
// created/destroyed each time — parked out of view (scale 0) between
// eruptions, launched on an arc during one.
function createEruptionChunks(colorHex) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a0e06, emissive: 0xff5522, emissiveIntensity: 1.2, roughness: 0.5, flatShading: true });
  const geo = new THREE.IcosahedronGeometry(0.6, 0);
  const chunks = [];
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.scale.setScalar(0);
    chunks.push({ mesh, active: false, t: 0, vx: 0, vz: 0, launchSpeed: 0 });
  }
  return chunks;
}

// Verdant: an ancient stone arch, reclaimed by vines and glowing flowers —
// the one place in the whole landmass that reads as "something built
// this," not grown.
function createVerdantLandmark(colorHex) {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x5c5648, roughness: 0.9, flatShading: true });
  const pillarH = 9, archSpan = 8;
  for (const side of [-1, 1]) {
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.2, pillarH, 6), stoneMat);
    pillar.position.set(side * archSpan / 2, pillarH / 2, 0);
    group.add(pillar);
  }
  const archTop = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, archSpan + 1.5, 6), stoneMat);
  archTop.rotation.z = Math.PI / 2;
  archTop.position.y = pillarH + 0.5;
  group.add(archTop);

  // Vines climbing the pillars, flowers dotted along them.
  const vineMat = new THREE.MeshStandardMaterial({ color: 0x2d5a2a, roughness: 0.8, flatShading: true });
  const flowerColors = [0xff8fd6, 0xffd36e, 0xc9a0ff];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const segH = 1.8;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, segH, 4), vineMat);
      seg.position.set(side * (archSpan / 2 + 0.3 + Math.random() * 0.3), i * segH + 1, 0.3);
      seg.rotation.z = (Math.random() - 0.5) * 0.3;
      group.add(seg);
      const flowerMat = new THREE.MeshStandardMaterial({
        color: flowerColors[i % flowerColors.length], emissive: colorHex, emissiveIntensity: 0.2, roughness: 0.5,
      });
      const flower = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), flowerMat);
      flower.position.copy(seg.position);
      flower.position.y += segH / 2;
      group.add(flower);
    }
  }
  const energy = createEnergyCore(colorHex, 1.1, pillarH + 1.2);
  group.add(energy.group);
  return { group, energy, baseY: 0 };
}

// Crystal: a colossal crystal spire, dwarfing the regular crystal
// clusters, faceted rather than a single smooth shape so light catches it
// from every angle.
function createCrystalLandmark(colorHex) {
  const group = new THREE.Group();
  const mainMat = new THREE.MeshStandardMaterial({
    color: colorHex, emissive: colorHex, emissiveIntensity: 0.5, roughness: 0.1, metalness: 0.15, transparent: true, opacity: 0.92,
  });
  const spire = new THREE.Mesh(new THREE.OctahedronGeometry(3.5, 0), mainMat);
  spire.scale.set(1, 3.2, 1);
  spire.position.y = 11;
  group.add(spire);
  // Smaller shards clustered at the base, same pattern as the regular
  // crystal cluster but scaled up and denser.
  for (let i = 0; i < 6; i++) {
    const s = 1.2 + Math.random() * 1.5;
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(s, 0), mainMat);
    const angle = (i / 6) * Math.PI * 2;
    shard.position.set(Math.cos(angle) * 2.2, s * 0.8, Math.sin(angle) * 2.2);
    shard.rotation.set(Math.random(), Math.random() * Math.PI, Math.random());
    group.add(shard);
  }
  const energy = createEnergyCore(colorHex, 1.6, 11);
  group.add(energy.group);
  return { group, energy, baseY: 0 };
}

// Abyssal: a broken platform hovering at a fixed height, anchored by
// nothing visible — unsettling in exactly the way the rest of the biome
// already is, just at landmark scale.
function createAbyssalLandmark(colorHex) {
  const group = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x241f30, roughness: 0.85, flatShading: true, emissive: colorHex, emissiveIntensity: 0.05 });
  const platform = new THREE.Mesh(new THREE.IcosahedronGeometry(4.5, 0), rockMat);
  platform.scale.set(1.4, 0.35, 1.4);
  platform.position.y = 9; // hovering — deliberately not touching the ground
  group.add(platform);
  // A few smaller chunks drifting near it, echoing the ambient debris
  // decoration but tethered visually to this one spot.
  for (let i = 0; i < 4; i++) {
    const s = 0.6 + Math.random() * 0.7;
    const chunk = new THREE.Mesh(new THREE.IcosahedronGeometry(s, 0), rockMat);
    const angle = Math.random() * Math.PI * 2, dist = 3 + Math.random() * 3;
    chunk.position.set(Math.cos(angle) * dist, 9 + (Math.random() - 0.5) * 4, Math.sin(angle) * dist);
    group.add(chunk);
  }
  const energy = createEnergyCore(colorHex, 1.3, 9);
  group.add(energy.group);
  return { group, energy, baseY: 9, floats: true }; // baseY used by the update loop for its own gentle hover bob
}

// Ashen: a fossilized skeleton on a scale nothing else in this landmass
// suggests — the ribcage motif from the regular fossil-remains decoration,
// but unmistakably something enormous once lived (or fell) here.
function createAshenLandmark(colorHex) {
  const group = new THREE.Group();
  const boneMat = new THREE.MeshStandardMaterial({ color: 0xd8cdb8, roughness: 0.9, flatShading: true });
  const spineLen = 14;
  const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, spineLen, 6), boneMat);
  spine.rotation.x = Math.PI / 2;
  spine.position.y = 1;
  group.add(spine);
  const ribCount = 8;
  for (let i = 0; i < ribCount; i++) {
    const t = i / (ribCount - 1);
    const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.22, 4 + Math.sin(t * Math.PI) * 2.5, 5), boneMat);
    rib.position.set(0, 1.2, (t - 0.5) * spineLen);
    rib.rotation.z = Math.PI / 2.5 * (i % 2 === 0 ? 1 : -1);
    rib.rotation.y = (Math.random() - 0.5) * 0.2;
    group.add(rib);
  }
  const energy = createEnergyCore(colorHex, 1.0, 4);
  energy.group.position.z = -spineLen * 0.3; // sits within the ribcage rather than centered on the spine
  group.add(energy.group);
  return { group, energy, baseY: 0 };
}

const LANDMARK_BUILDERS = {
  ember: createEmberLandmark,
  verdant: createVerdantLandmark,
  crystal: createCrystalLandmark,
  abyssal: createAbyssalLandmark,
  ashen: createAshenLandmark,
};

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {number} colorHex  the biome's own accent color, used for the energy core/glow
 * @param {(x:number, z:number) => number|null} sampleHeight
 */
function createLandmark(scene, biome, colorHex, sampleHeight) {
  const builder = LANDMARK_BUILDERS[biome];
  if (!builder) return null;
  const built = builder(colorHex);
  const groundY = sampleHeight(LANDMARK_POSITION.x, LANDMARK_POSITION.z) ?? 0;
  built.group.position.set(LANDMARK_POSITION.x, groundY, LANDMARK_POSITION.z);
  built.baseY += groundY;
  built.group.traverse((obj) => {
    if (obj.isMesh) { obj.castShadow = true; obj.receiveShadow = true; }
  });
  scene.add(built.group);
  return built;
}

function updateLandmark(handle, elapsed, dt) {
  if (!handle) return;
  const { energy, baseY, group } = handle;
  const pulse = 0.6 + 0.4 * Math.sin(elapsed * 1.1 + energy.pulseSeed);
  energy.core.material.emissiveIntensity = 0.7 + pulse * 0.6;
  energy.light.intensity = 0.9 + pulse * 0.9;
  energy.core.rotation.y = elapsed * 0.3;
  // Abyssal's platform gently hovers up and down — everything else stays
  // put, the ground-anchored biomes shouldn't have their landmark visibly
  // floating.
  if (handle.floats) group.position.y = baseY + Math.sin(elapsed * 0.4) * 0.6;

  if (handle.volcano) updateVolcano(handle.volcano, elapsed, dt || 0);
}

// River segments get a continuous scrolling brightness pulse (reads as
// flow direction, downhill) regardless of whether an eruption is
// currently happening — a volcano's slopes are hot all the time, the
// eruption itself is the separate, rarer event layered on top.
function updateVolcano(v, elapsed, dt) {
  // Crater pool breathes gently between eruptions, same as ground lava's
  // own idle pulse.
  const idlePulse = 0.8 + 0.2 * Math.sin(elapsed * 0.9);

  for (const seg of v.riverSegments) {
    // The texture's own gradient/heat-pocket pattern scrolls down the
    // segment's length (staggered per-segment by seed) — THIS is what
    // reads as flow now, not the segment's overall visibility. Opacity
    // only gets a small idle wobble, so a vein never dips toward
    // invisible and "blinks off" the way a full 0.1-1.0 opacity swing
    // used to.
    seg.tex.offset.y = (elapsed * 0.35 + seg.seed * 0.4) % 1;
    const idle = 0.88 + 0.12 * Math.sin(elapsed * 1.3 - seg.seed * 1.2);
    seg.arrivalFlare = Math.max(0, (seg.arrivalFlare || 0) - dt * 1.2); // fades out over ~0.8s rather than cutting off instantly
    seg.mesh.material.opacity = Math.min(1, idle + seg.arrivalFlare);
  }

  // Glow halos pulse gently in sync with the crater's own idle breathing
  // — a volcano's slopes radiate heat all the time, this is the same
  // "lit from within" ambience liquid.js's lava glow overlay uses.
  for (const g of v.veinGlows) {
    g.material.opacity = 0.22 + 0.15 * idlePulse;
  }

  v.craterLight.intensity = v.erupting ? v.craterLight.intensity : 1.2 * idlePulse;

  v.eruptionTimer -= dt;
  if (!v.erupting && v.eruptionTimer <= 0) {
    v.erupting = true;
    v.eruptionPhase = 0;
    for (const chunk of v.chunks) {
      chunk.active = true;
      chunk.phase = "ballistic";
      chunk.t = 0;
      const angle = Math.random() * Math.PI * 2;
      chunk.dirX = Math.cos(angle); // fixed slide direction for this chunk's whole journey — the ballistic hop just picks which way down the slope it'll travel
      chunk.dirZ = Math.sin(angle);
      chunk.vx = chunk.dirX * (2 + Math.random() * 3);
      chunk.vz = chunk.dirZ * (2 + Math.random() * 3);
      chunk.launchSpeed = 9 + Math.random() * 5;
      chunk.slideY = v.craterY;
      chunk.mesh.position.set(0, v.craterY, 0);
      chunk.baseScale = 0.5 + Math.random() * 0.6;
      chunk.mesh.scale.setScalar(chunk.baseScale);
    }
  }

  if (v.erupting) {
    v.eruptionPhase += dt * 0.6;
    // Ramp up fast, hold, ramp down — not a symmetric triangle, since a
    // real eruption flares suddenly and subsides more gradually.
    const flare = v.eruptionPhase < 0.15
      ? v.eruptionPhase / 0.15
      : Math.max(0, 1 - (v.eruptionPhase - 0.15) / 0.85);
    v.craterLight.intensity = 1.2 + flare * 6;
    v.poolMat.color.copy(v.poolBaseColor).lerp(v.poolHotColor, flare);

    for (const s of v.fountain.streaks) {
      const cycle = ((elapsed * s.speed + s.phase * 3) % 1.4); // most of the cycle is the rise, a short reset gap after
      const rising = cycle < 1;
      const height = rising ? cycle * 9 : 0;
      const r = s.radius * (1 + height * 0.15); // streaks drift slightly outward as they rise, not a perfectly straight column
      s.mesh.position.set(Math.cos(s.angle) * r, v.fountain.craterY + height, Math.sin(s.angle) * r);
      s.mesh.material.opacity = rising ? flare * (1 - height / 9) * 0.9 : 0;
    }

    if (v.eruptionPhase >= 1) {
      v.erupting = false;
      v.eruptionTimer = 22 + Math.random() * 18; // next eruption 22-40s out
    }
  }

  // Chunk flight runs independently of the flare above — the flare itself
  // is brief (~1.5s), but a chunk's full ballistic-arc-then-slide-down
  // journey takes several seconds longer than that, so it needs to keep
  // animating well after "erupting" itself has already gone back to
  // false, not freeze in place the moment the flare ends.
  for (const chunk of v.chunks) {
    if (!chunk.active) continue;
    chunk.t += dt;
    const gravity = 9;

    if (chunk.phase === "ballistic") {
      chunk.mesh.position.x = chunk.vx * chunk.t;
      chunk.mesh.position.z = chunk.vz * chunk.t;
      const y = v.craterY + chunk.launchSpeed * chunk.t - 0.5 * gravity * chunk.t * chunk.t;
      chunk.mesh.position.y = y;
      chunk.mesh.rotation.x += dt * 4;
      chunk.mesh.rotation.z += dt * 3;
      // Switch to sliding once the arc brings it back down to roughly
      // crater height, rather than continuing to fall through open air
      // — from here it rides the actual slope down instead.
      if (y <= v.craterY) {
        chunk.phase = "sliding";
        chunk.slideY = v.craterY;
        chunk.slideDist = Math.hypot(chunk.mesh.position.x, chunk.mesh.position.z);
      }
    } else if (chunk.phase === "sliding") {
      // Descend at a steady rate, following the cone's actual
      // radius-at-height so the chunk visibly rides the slope's surface
      // all the way to the base instead of just dropping straight down.
      const slideSpeed = 5.5;
      chunk.slideY -= slideSpeed * dt;
      chunk.slideDist += slideSpeed * dt * 0.6; // drifts outward as it descends, following the cone widening toward its base
      const clampedY = Math.max(0, chunk.slideY);
      const t = clampedY / v.craterY;
      const surfaceR = v.baseR + (v.craterR - v.baseR) * t;
      const r = Math.max(chunk.slideDist, surfaceR); // never sink inside the cone's own surface
      chunk.mesh.position.set(chunk.dirX * r, clampedY, chunk.dirZ * r);
      chunk.mesh.rotation.x += dt * 2;
      // Shrinks as it nears the base — reads as the chunk breaking apart
      // and merging into the general lava flow rather than simply
      // switching off.
      const shrink = THREE.MathUtils.clamp(chunk.slideY / (v.craterY * 0.3), 0, 1);
      chunk.mesh.scale.setScalar(chunk.baseScale * shrink);

      if (chunk.slideY <= 0.5) {
        chunk.active = false;
        chunk.mesh.scale.setScalar(0);
        // Arriving at the base flares the nearest river segment bright
        // for a moment — the chunk visibly becomes part of the flow
        // rather than just disappearing.
        let nearest = null, nearestDist = Infinity;
        for (const seg of v.riverSegments) {
          const d = Math.hypot(seg.mesh.position.x - chunk.mesh.position.x, seg.mesh.position.z - chunk.mesh.position.z);
          if (d < nearestDist) { nearestDist = d; nearest = seg; }
        }
        if (nearest) nearest.arrivalFlare = 1;
      }
    }
  }
}

function disposeLandmark(scene, handle) {
  if (!handle) return;
  scene.remove(handle.group);
  handle.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      // Each vein/branch now owns a unique painted texture (no longer a
      // clone of a shared base) — dispose it, but leave the cached soft
      // glow texture alone since other landmarks/rebuilds still use it.
      if (obj.material.map && obj.material.map !== _softGlowTexture) {
        obj.material.map.dispose();
      }
      obj.material.dispose();
    }
  });
}

export { createLandmark, updateLandmark, disposeLandmark, LANDMARK_POSITION };
