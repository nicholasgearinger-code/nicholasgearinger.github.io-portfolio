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
  // Base radius factor and hot-core widthScale both bumped up (0.24->0.32,
  // 0.55->0.72) for a visibly thicker, bolder channel — was reading too
  // thin/wispy compared to the newer small surface cracks using the same
  // texture at a smaller physical scale.
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
        const r = w * 0.32 * wMul * widthScale;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }
    }
  };
  // Crust darkened further (was #3a0d00) to hold contrast against the
  // cone's new near-black violet body; core pushed toward a purer,
  // more saturated orange (was #ff5a1f, slightly muddy/brownish) — the
  // reference's lava reads as a clean, poster-flat hot orange, not a
  // naturalistic warm-brown blend.
  stampLayer("#220400", 1.0);
  stampLayer("#ff6a14", 0.72);

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

// A soft gray-warm haze puff for crater smoke — deliberately NOT additive
// (that would make it read as glowing light, not murky ash/smoke). Cached
// once like the glow texture above.
let _smokeTexture = null;
function getSmokeTexture() {
  if (_smokeTexture) return _smokeTexture;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(95,82,76,0.55)");
  grad.addColorStop(0.55, "rgba(70,60,58,0.28)");
  grad.addColorStop(1, "rgba(60,55,55,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  _smokeTexture = new THREE.CanvasTexture(canvas);
  _smokeTexture.colorSpace = THREE.SRGBColorSpace;
  return _smokeTexture;
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
// A small glowing droplet that travels down a vein's actual path —
// unlike the texture-scroll flow (subtle, easy to miss), a bright point
// physically moving down the slope is an unambiguous "this is flowing"
// cue, which is what the photoreal reference's glowing streaks and the
// flat-illustration reference's bright pooled highlights are both really
// selling. Built as a 3D blob (not a flat plane) so it reads as a glowing
// droplet from any viewing angle without needing to face the camera, plus
// a soft additive glow halo behind it (same texture the vein glow halos
// use) since a small flat-lit solid shape alone read as too faint/easy to
// miss against the already-bright vein texture underneath it.
function createFlowBead() {
  const beadGroup = new THREE.Group();

  const coreMat = new THREE.MeshBasicMaterial({
    color: 0xfff3c8, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), coreMat);
  beadGroup.add(core);

  const glowMat = new THREE.MeshBasicMaterial({
    map: getSoftGlowTexture(), color: 0xffcf7a, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), glowMat);
  beadGroup.add(glow);

  return { beadGroup, core, glow };
}

// Spawns `count` beads that loop continuously from `topPos` to `bottomPos`
// (world-space points), each with a staggered phase so they read as a
// steady stream rather than all traveling in lockstep. Pushes descriptor
// records onto `beadsOut` for updateVolcano to animate every frame.
function addFlowBeads(group, topPos, bottomPos, count, beadsOut) {
  for (let i = 0; i < count; i++) {
    const bead = createFlowBead();
    group.add(bead.beadGroup);
    beadsOut.push({
      beadGroup: bead.beadGroup, core: bead.core, glow: bead.glow, topPos, bottomPos,
      phase: i / count + Math.random() * 0.15,
      speed: 0.16 + Math.random() * 0.07,
    });
  }
}
function createLavaVeinChain(group, angle, coneH, baseR, craterR, glowsOut, beadsOut) {
  const slopeAngle = Math.atan2(baseR - craterR, coneH);
  const length = coneH * 0.9;
  const width = 4.8; // was 3.2 — thicker flow, matches the bolder channel proportion above
  const midY = coneH * 0.5;
  // Padding increased from an earlier 0.25 -> 0.6. The cone's surface
  // isn't perfectly smooth — per-vertex jitter (see the jitter loop
  // below, `jitterAmount` up to 0.32) makes it bulge in and out
  // irregularly. 0.25 was thinner than that jitter amplitude in several
  // places (verified numerically: clearance as low as 0.003 at some
  // sample points, and jitter oscillates continuously along the vein's
  // length via y-dependent sine terms, so the true worst case between
  // sampled points is likely worse still) — the vein was still getting
  // swallowed by jitter bulges even after supposedly being pushed
  // "outside" the ideal smooth-cone radius. 0.6 comfortably clears the
  // maximum possible jitter (0.32) with real margin, not a razor edge.
  const midR = baseR + (craterR - baseR) * (midY / coneH) + 0.6;
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
  // BUG FIX: setting .rotation.x and .rotation.y as properties composes
  // them via THREE's default Euler 'XYZ' order, which applies the X-tilt
  // AROUND THE FIXED WORLD X AXIS regardless of the yaw — so the tilt
  // came out wrong (and identical) for every vein regardless of its
  // angle, which is why they all rendered as parallel horizontal ribbons
  // instead of radiating down the slope at their own angles. Setting the
  // yaw first, then calling the incremental .rotateX() METHOD (not the
  // .rotation.x property) applies the tilt around the mesh's OWN current
  // local X axis — which, after the yaw, correctly points tangentially
  // at this vein's specific angle.
  glow.rotation.y = angle;
  glow.rotateX(-slopeAngle);
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
  mesh.rotation.y = angle; // same fix as the glow halo above
  mesh.rotateX(-slopeAngle);
  group.add(mesh);
  segments.push({ mesh, tex, seed });

  // Real world-space endpoints of the vein, derived from the same
  // slope/midpoint math used to place the plane above (not a
  // transform-matrix readback) — moving `halfLen` up the slope from the
  // midpoint shrinks the radius by halfLen*sin(slopeAngle) and raises the
  // height by halfLen*cos(slopeAngle); moving down does the opposite.
  const halfLen = length / 2;
  const topR = midR - halfLen * Math.sin(slopeAngle), topY = midY + halfLen * Math.cos(slopeAngle);
  const botR = midR + halfLen * Math.sin(slopeAngle), botY = midY - halfLen * Math.cos(slopeAngle);
  const topPos = { x: Math.sin(angle) * topR, y: topY, z: Math.cos(angle) * topR };
  const botPos = { x: Math.sin(angle) * botR, y: botY, z: Math.cos(angle) * botR };
  if (beadsOut) addFlowBeads(group, topPos, botPos, 2, beadsOut);

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
    // BUG FIX: same Euler-order pitfall as the main vein/glow above, plus
    // this specific combination also had its sign inverted (pointed the
    // branch backward from its intended direction). Baking the "lie
    // flat" tilt into the GEOMETRY itself (the same pattern terrain.js
    // and liquid.js already use for their ground planes) then applying a
    // single plain yaw on the mesh sidesteps the ordering issue entirely
    // — there's only one rotation left on the mesh, so there's no
    // composition order to get wrong.
    const branchGeo = new THREE.PlaneGeometry(2.8, branchLen); // was 1.8 — matches the main vein's thicker proportions
    branchGeo.rotateX(Math.PI / 2 - 0.08);
    const branch = new THREE.Mesh(branchGeo, branchMat);
    branch.position.set(baseX + Math.sin(branchAngle) * branchLen * 0.4, 0.4, baseZ + Math.cos(branchAngle) * branchLen * 0.4);
    branch.rotation.y = branchAngle;
    group.add(branch);
    segments.push({ mesh: branch, tex: branchTex, seed: branchSeed });

    if (beadsOut) {
      const branchStart = { x: baseX, y: 0.4, z: baseZ };
      const branchEnd = { x: baseX + Math.sin(branchAngle) * branchLen, y: 0.4, z: baseZ + Math.cos(branchAngle) * branchLen };
      addFlowBeads(group, branchStart, branchEnd, 1, beadsOut);
    }
  }
  return segments;
}

// A single irregular triangle — not a rectangle — with its own
// randomized base width and tip offset so each instance reads as a
// distinct jagged fragment rather than a uniform stamped-out shape.
// Vertex-colored bright yellow-white at the base fading to hot
// red-orange at the tip, the same "white-hot core, cooling to red at
// the edges" read the reference's explosion burst uses.
function createShardGeometry(length) {
  const geo = new THREE.BufferGeometry();
  const baseW = 0.16 + Math.random() * 0.14;
  const tipOffset = (Math.random() - 0.5) * length * 0.35;
  const positions = new Float32Array([
    -baseW, 0, 0,
    baseW, 0, 0,
    tipOffset, length, 0,
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const colors = new Float32Array([
    1.0, 0.95, 0.78,
    1.0, 0.95, 0.78,
    1.0, 0.33, 0.08,
  ]);
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

// A radiating burst of jagged shard fragments exploding out of the
// crater during an eruption — replaces the old tight column of thin
// vertical streaks, which read as a fountain/sparkler rather than the
// reference's wide, explosive radial burst. Each shard now launches at
// its own outward tilt (not just straight up) and tumbles as it flies,
// layered on top of the arcing debris chunks below.
function createEruptionFountain(coneH) {
  const group = new THREE.Group();
  const streaks = [];
  for (let i = 0; i < 14; i++) { // was 10 thin streaks; more + jagged + wider-radiating reads closer to an actual explosive burst
    const length = 2 + Math.random() * 3.5;
    const geo = createShardGeometry(length);
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, coneH, 0);
    group.add(mesh);
    streaks.push({
      mesh, seed: Math.random() * Math.PI * 2,
      angle: Math.random() * Math.PI * 2, radius: Math.random() * 0.8,
      tilt: Math.random() * 0.7, // radians off vertical — most shards launch steep but a good spread kicks out toward ~40deg, giving the burst real width instead of a tidy column
      spin: (Math.random() - 0.5) * 6,
      speed: 7 + Math.random() * 5, phase: Math.random(),
    });
  }
  return { group, streaks, craterY: coneH };
}

// Scatters small secondary glowing cracks across the cone's surface —
// distinct from the 4 big flowing veins, these are static (no scroll/flow
// animation) fine fissures reading as old, settled fracture lines rather
// than active channels, giving the "cracked through with old fire" look
// real volcanic rock has beyond just the main flow paths. At this small
// physical scale, the same thickened channel texture (bumped up when the
// main veins got thicker) reads as a bold solid color-block shape rather
// than a thin crack — turned out to look great and matches the flat-
// illustration reference's bold color-block style closely, so count and
// size were both bumped up to lean into it rather than dial it back.
// Reuses the EXACT surface-placement math the main veins use (same +0.6
// padding past the cone's jitter) — the vein-hiding bug earlier this
// session was caused by getting this wrong, so it's worth reusing
// verbatim rather than re-deriving a similar-but-not-identical formula.
function createSurfaceCracks(group, coneH, baseR, craterR, count) {
  const slopeAngle = Math.atan2(baseR - craterR, coneH);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const heightT = 0.08 + Math.random() * 0.89; // was 0.08-0.88, now extends to 0.97 — nearly the full height, just short of the crater pool disc itself
    const y = heightT * coneH;
    const idealR = baseR + (craterR - baseR) * (y / coneH);
    const r = idealR + 0.6;
    const len = 2.2 + Math.random() * 3.2; // was 1.8-4.4, now 2.2-5.4 — more presence
    const width = 0.5 + Math.random() * 0.45; // was 0.4-0.75, now 0.5-0.95
    const tex = createVeinIllustrationTexture(angle * 3.1 + i * 7.3);
    tex.repeat.set(1, 1.4);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75 + Math.random() * 0.2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, len), mat);
    mesh.position.set(Math.sin(angle) * r, y, Math.cos(angle) * r);
    mesh.rotation.y = angle;
    mesh.rotateX(-slopeAngle);
    group.add(mesh);
  }
}

// Soft smoke puffs that rise from the crater and disperse — the volcano
// glows but had no atmosphere around it. Each puff independently loops
// through rise -> grow -> fade -> reset, staggered so it reads as a
// continuous drift rather than a single repeating cloud. Each puff gets
// its OWN cloned material (not a shared one) — a shared material across
// "independent" puffs would defeat their individual opacity animation,
// the same class of bug that broke this volcano's lava-river flow the
// first time it was built.
function createCraterSmoke(coneH, count) {
  const group = new THREE.Group();
  const puffs = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      map: getSmokeTexture(), transparent: true, opacity: 0,
      depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), mat);
    group.add(mesh);
    puffs.push({
      mesh,
      phase: i / count,
      speed: 0.09 + Math.random() * 0.03,
      driftX: (Math.random() - 0.5) * 1.6,
      driftZ: (Math.random() - 0.5) * 1.6,
    });
  }
  return { group, puffs, baseY: coneH };
}

function updateCraterSmoke(smoke, elapsed) {
  for (const p of smoke.puffs) {
    const t = (elapsed * p.speed + p.phase) % 1;
    const riseHeight = 1 + t * 6;
    p.mesh.position.set(p.driftX * t, smoke.baseY + riseHeight, p.driftZ * t);
    p.mesh.scale.setScalar(1 + t * 2.2);
    const fadeIn = Math.min(1, t / 0.15);
    const fadeOut = 1 - Math.pow(t, 1.5);
    p.mesh.material.opacity = fadeIn * fadeOut * 0.5;
  }
}

// Small ember sparks arcing up from the crater rim between eruptions —
// ambient "spitting" life independent of the big eruption sequence, which
// only fires every 22-40s. Each spark loops its own short ballistic arc
// (launch -> peak -> fall/fade -> pause -> relaunch) on a fixed per-spark
// angle/distance, staggered by an initial delay. Uses a positive-safe
// modulo (`((x % m) + m) % m`) rather than raw `%` — this project has hit
// a real bug before from JS's sign-preserving modulo on an
// elapsed-minus-delay term that can go negative early on.
function createEmberSparks(craterR, coneH, count) {
  const group = new THREE.Group();
  const sparks = [];
  for (let i = 0; i < count; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffb35a, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), mat);
    group.add(mesh);
    sparks.push({
      mesh,
      angle: Math.random() * Math.PI * 2,
      distFactor: 0.6 + Math.random() * 1.8, // was 0.6-1.8, now 0.6-2.4 — reads closer to the reference's sparks scattered well beyond the crater rim, not clustered tight to it
      arcHeight: 2 + Math.random() * 4, // was 2-5, now 2-6
      duration: 1.1 + Math.random() * 0.9,
      pause: 1.5 + Math.random() * 2.5,
      delay: Math.random() * 5,
    });
  }
  return { group, sparks, craterR, coneH };
}

function updateEmberSparks(emberSparks, elapsed) {
  for (const s of emberSparks.sparks) {
    const cycle = s.duration + s.pause;
    const raw = elapsed - s.delay;
    const localT = ((raw % cycle) + cycle) % cycle; // positive-safe modulo
    if (localT > s.duration) {
      s.mesh.material.opacity = 0;
      continue;
    }
    const t = localT / s.duration;
    const dist = emberSparks.craterR * s.distFactor;
    s.mesh.position.set(
      Math.cos(s.angle) * dist * t,
      emberSparks.coneH + Math.sin(t * Math.PI) * s.arcHeight,
      Math.sin(s.angle) * dist * t
    );
    s.mesh.material.opacity = Math.sin(t * Math.PI) * 0.9;
  }
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
  const coneH = 27, baseR = 18, craterR = 2.2;
  // Moved up from further below so the cone-carving loop right below and
  // the actual vein/crack placement code later in this function share
  // this exact array — the channels carved into the rock and the lava
  // painted into them need to line up, not two separately-tuned copies
  // that could drift apart.
  const veinAngles = [0.35, 1.9, 3.4, 5.1]; // deliberately uneven spacing, not a perfect cross — real fracture patterns aren't symmetric
  const coneGeo = new THREE.CylinderGeometry(craterR, baseR, coneH, 9, 4);
  // Push each ring of vertices in/out slightly at random — a perfectly
  // smooth tapered cylinder reads as a traffic cone, not a rocky
  // mountain. Scaled well down from earlier passes (0.9 -> 0.32): the
  // reference's cone silhouette is clean and deliberate with only a few
  // sharp facets/highlight streaks, not an all-over bumpy noise surface —
  // a little irregularity sells "mountain," a lot of it just looks noisy.
  // Vertices nearer the very top (the crater rim) get less jitter so the
  // crater opening itself stays roughly circular.
  //
  // On top of that general jitter, real channels are now carved into the
  // geometry at the same 4 angles the lava veins sit at — a painted plane
  // floating over an otherwise-smooth cone read as a decal stuck on top;
  // an actual groove in the rock is what makes the lava look like it's
  // running THROUGH the mountain. The cone only has 9 radial segments
  // (deliberately low-poly, matching the rest of this project's blocky
  // rock aesthetic), so a vein's exact angle can sit up to ~20 degrees
  // from the nearest vertex column (verified numerically) — the falloff
  // width below (0.5 rad ≈ 28.6 degrees) is chosen wide enough to
  // reliably reach at least that nearest column in every case, not just
  // the lucky ones where a vein happens to land close to a column.
  const channelHalfWidth = 0.5; // radians
  const channelDepth = 1.6; // world units, at full strength before height-tapering
  const conePos = coneGeo.attributes.position;
  for (let i = 0; i < conePos.count; i++) {
    const x = conePos.getX(i), y = conePos.getY(i), z = conePos.getZ(i);
    const heightT = (y + coneH / 2) / coneH; // 0 at base, 1 at crater rim
    const heightTaper = 1 - heightT * 0.6; // shared by jitter and channel depth — both ease off near the crater so its opening stays roughly circular
    const jitterAmount = heightTaper * 0.32;
    const angle = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const jitterDeviation = (Math.sin(angle * 5 + y * 0.7) * 0.5 + Math.sin(angle * 11 - y * 0.3) * 0.5) * (jitterAmount / Math.max(r, 0.5));

    let channelStrength = 0;
    for (const va of veinAngles) {
      const diff = Math.atan2(Math.sin(angle - va), Math.cos(angle - va)); // wrapped angular distance, [-pi, pi]
      const absDiff = Math.abs(diff);
      if (absDiff < channelHalfWidth) {
        const s = Math.cos((absDiff / channelHalfWidth) * (Math.PI / 2)); // 1 at the vein's exact angle, smoothly down to 0 at the falloff edge
        if (s > channelStrength) channelStrength = s;
      }
    }
    const channelPull = (channelStrength * channelDepth * heightTaper) / Math.max(r, 0.5); // always inward (a groove), unlike the bidirectional jitter above

    const jitter = 1 + jitterDeviation - channelPull;
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
  // 3-stop gradient, not 2 — the flat-vector reference's cone reads as
  // near-black violet overall (far darker/more saturated than the old
  // 0x22213a->0x8f8fae pair, which was closer to a lit gray-purple rock
  // than the reference's ink-dark silhouette), with a warm dark
  // maroon-brown flush low on the slopes where it blends into the
  // reddish background mountain silhouettes, rising through deep violet
  // and staying a cool, only slightly lighter violet near the rim
  // (the crater glow does the actual brightening up there, not the rock
  // itself lightening toward gray).
  const coneColors = new Float32Array(conePos.count * 3);
  const groundColor = new THREE.Color(0x3a2030);
  const bodyColor = new THREE.Color(0x241833);
  const rimColor = new THREE.Color(0x453a5e);
  const tmpConeColor = new THREE.Color();
  for (let i = 0; i < conePos.count; i++) {
    const y = conePos.getY(i);
    const heightT = (y + coneH / 2) / coneH;
    if (heightT < 0.4) {
      tmpConeColor.copy(groundColor).lerp(bodyColor, heightT / 0.4);
    } else {
      tmpConeColor.copy(bodyColor).lerp(rimColor, (heightT - 0.4) / 0.6);
    }
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
  // stripe down one side. `veinAngles` itself is declared earlier now,
  // right before the cone-carving loop, and reused here unchanged — the
  // carved channels and the painted lava need to share the same angles.
  const riverSegments = [];
  const veinGlows = [];
  const flowBeads = [];
  for (const veinAngle of veinAngles) {
    const built = createLavaVeinChain(group, veinAngle, coneH, baseR, craterR, veinGlows, flowBeads);
    riverSegments.push(...built);
  }

  // Secondary fine cracks scattered across the whole cone — see the note
  // above createSurfaceCracks for why these are static and distinct from
  // the 4 main flowing veins.
  createSurfaceCracks(group, coneH, baseR, craterR, 26); // was 14

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

  const smoke = createCraterSmoke(coneH, 5);
  group.add(smoke.group);

  const emberSparks = createEmberSparks(craterR, coneH, 12); // was 7
  group.add(emberSparks.group);

  return {
    group, energy, baseY: 0, biome: "ember",
    volcano: {
      pool, poolMat, poolBaseColor, poolHotColor, craterLight, riverSegments, veinGlows, flowBeads, craterY: coneH,
      baseR, craterR, // needed by the chunk sliding phase to follow the cone's actual surface, not fall through open air
      eruptionTimer: 8 + Math.random() * 12, // first eruption arrives reasonably soon rather than making the player wait a full cycle
      eruptionPhase: 0, // 0 = dormant, ramps to 1 during an active eruption and back down
      erupting: false,
      chunks,
      fountain,
      smoke,
      emberSparks,
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

  updateCraterSmoke(v.smoke, elapsed);
  updateEmberSparks(v.emberSparks, elapsed);

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

  // Flow beads — small glowing droplets physically traveling down each
  // vein/branch's real path, looping continuously. This is the main
  // "lava is actually flowing" cue; the texture-scroll on the vein
  // segments above is a subtler supporting layer underneath it.
  for (const b of v.flowBeads) {
    const t = (elapsed * b.speed + b.phase) % 1;
    b.beadGroup.position.set(
      THREE.MathUtils.lerp(b.topPos.x, b.bottomPos.x, t),
      THREE.MathUtils.lerp(b.topPos.y, b.bottomPos.y, t),
      THREE.MathUtils.lerp(b.topPos.z, b.bottomPos.z, t)
    );
    const fadeWindow = 0.12;
    const fade = Math.max(0, Math.min(1, t / fadeWindow, (1 - t) / fadeWindow));
    b.core.material.opacity = fade;
    b.glow.material.opacity = fade * 0.6;
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
      // Outward radius now grows from the shard's own launch tilt (real
      // radial spread), not just the old small drift term — this is what
      // makes the burst read as exploding outward from the crater rather
      // than a straight column with a slight lean.
      const outward = height * Math.sin(s.tilt) * 1.5;
      const r = s.radius * (1 + height * 0.15) + outward;
      s.mesh.position.set(Math.cos(s.angle) * r, v.fountain.craterY + height * Math.cos(s.tilt), Math.sin(s.angle) * r);
      s.mesh.rotation.z = s.seed + elapsed * s.spin; // tumble, so a flat triangle still reads as a chunky fragment rather than a flat card
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
