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
// -----------------------------------------------------------------------------
// Ember volcano — now a single huge flat 2D backdrop (a painted
// silhouette on one big plane), not real 3D cone geometry, per explicit
// request to make it "fully 2D." Individual veins/cracks/glow/flow-beads
// below are still their own small planes laid against the backdrop's
// face — their texture/scroll/flare machinery is untouched — only HOW
// they're positioned/oriented changed: everything here only ever sets
// rotation.y = yaw (the same single rotation the backdrop plane itself
// uses), since a flat, coplanar face never needs a second rotation axis
// at all. That structurally removes the whole Euler-composition-order
// bug class the old cone veins needed a rotateX() workaround for.
// -----------------------------------------------------------------------------

// Maps a fractional point on the backdrop's face (u: 0=left..1=right,
// v: 0=top..1=bottom) to a position in the landmark group's local space.
// `forwardOffset` nudges the point slightly toward the viewer (along the
// backdrop's own facing direction) so foreground effects don't z-fight
// with the painted texture behind them. This is the single Y-axis
// rotation matrix applied directly as plain algebra — not a THREE
// rotation call — so it can't accidentally compose with anything else.
function planePointToWorld(u, v, width, height, yaw, forwardOffset = 0) {
  const lx = (u - 0.5) * width;
  const ly = height * (1 - v);
  const lz = forwardOffset;
  return {
    x: lx * Math.cos(yaw) + lz * Math.sin(yaw),
    y: ly,
    z: -lx * Math.sin(yaw) + lz * Math.cos(yaw),
  };
}

// A vein running down the backdrop's face from just below the crater
// notch to the ground, plus two short braided forks near the base.
// Built as a chain of several shorter segments that random-walk
// sideways (in u) as they descend, each tilted in-plane to lean toward
// its own direction — this is what actually reads as organic winding
// flow at a distance, not just the texture's own internal wobble on one
// long straight quad (the earlier version).
function createBackdropVein(group, u, backdropW, backdropH, craterVFrac, yaw, glowsOut, beadsOut) {
  const topV = craterVFrac + 0.03, botV = 0.97;
  const segCount = 4;
  const totalLen = (botV - topV) * backdropH;
  const segLen = totalLen / segCount;
  const width = 5.6;
  const baseSeed = u * 17;
  const segments = [];

  // Random-walk the u position segment by segment, clamped to a max
  // total drift from the vein's base column so it still reads as
  // "roughly this vein" rather than wandering into its neighbors.
  const uPoints = [u];
  for (let i = 1; i <= segCount; i++) {
    const prev = uPoints[i - 1];
    const step = (Math.sin(baseSeed * 3.1 + i * 2.7) * 0.5 + (Math.random() - 0.5) * 0.5) * 0.045;
    uPoints.push(THREE.MathUtils.clamp(prev + step, u - 0.09, u + 0.09));
  }

  // One shared ambient glow halo over the vein's full run, rather than
  // per-segment — reads as one continuous warm channel.
  const midV = (topV + botV) / 2;
  const midU = uPoints[Math.floor(segCount / 2)];
  const midPos = planePointToWorld(midU, midV, backdropW, backdropH, yaw, 0.35);
  const glowMat = new THREE.MeshBasicMaterial({
    map: getSoftGlowTexture(), color: 0xff8a3a, transparent: true, opacity: 0.32,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(totalLen * 0.6, totalLen * 0.6), glowMat);
  glow.position.set(midPos.x, midPos.y, midPos.z);
  glow.rotation.y = yaw;
  group.add(glow);
  if (glowsOut) glowsOut.push(glow);

  for (let i = 0; i < segCount; i++) {
    const v0 = topV + i * (botV - topV) / segCount;
    const v1 = topV + (i + 1) * (botV - topV) / segCount;
    const vMid = (v0 + v1) / 2;
    const u0 = uPoints[i], u1 = uPoints[i + 1];
    const uMid = (u0 + u1) / 2;
    const segSeed = baseSeed + i * 3.3;

    const tex = createVeinIllustrationTexture(segSeed);
    tex.repeat.set(1, 1.4);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 1, side: THREE.DoubleSide });
    // Slightly longer than its exact v-slice so consecutive segments'
    // painted channels visually overlap at the bend instead of leaving
    // a gap.
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, segLen * 1.15), mat);
    const p = planePointToWorld(uMid, vMid, backdropW, backdropH, yaw, 0.35);
    mesh.position.set(p.x, p.y, p.z);
    // Tilt this segment toward its own direction, worked out directly
    // in the backdrop's own LOCAL (u, v) coordinates — the horizontal
    // run over the vertical rise between this segment's endpoints.
    // Applied via the incremental .rotateZ() METHOD (not the
    // .rotation.z property) after yaw is set as a property, so the
    // twist happens around the plane's own current local normal axis
    // rather than the fixed world Z axis — the same safe pattern this
    // file already established for the old cone veins' slope tilt
    // (yaw property, then .rotateX() method), just swapped to
    // .rotateZ() for an in-plane lean instead of an out-of-plane one.
    // Cosmetic-only — an approximate lean, not exact — so a wrong-way
    // sign here is a one-line flip, not a functional bug.
    const dxLocal = (u1 - u0) * backdropW;
    const dyLocal = (v0 - v1) * backdropH;
    const tilt = Math.atan2(dxLocal, dyLocal);
    mesh.rotation.y = yaw;
    mesh.rotateZ(-tilt);
    group.add(mesh);
    segments.push({ mesh, tex, seed: segSeed });
  }

  const topPos = planePointToWorld(uPoints[0], topV, backdropW, backdropH, yaw, 0.35);
  const botPos = planePointToWorld(uPoints[segCount], botV, backdropW, backdropH, yaw, 0.35);
  if (beadsOut) addFlowBeads(group, topPos, botPos, 3, beadsOut); // one more than before — the meander adds real path length

  // Braided fan at the base — 2 short offshoots peeling sideways from
  // wherever the meander actually ended up.
  const baseU = uPoints[segCount];
  for (const spread of [-0.06, 0.06]) {
    const branchU = baseU + spread;
    const branchV = botV - 0.05;
    const branchLen = 4 + Math.random() * 2;
    const branchSeed = baseSeed + spread * 100;
    const branchTex = createVeinIllustrationTexture(branchSeed);
    branchTex.repeat.set(1, 1.4);
    const branchMat = new THREE.MeshBasicMaterial({ map: branchTex, transparent: true, opacity: 1, side: THREE.DoubleSide });
    const branch = new THREE.Mesh(new THREE.PlaneGeometry(2.8, branchLen), branchMat);
    const bp = planePointToWorld(branchU, branchV, backdropW, backdropH, yaw, 0.35);
    branch.position.set(bp.x, bp.y, bp.z);
    branch.rotation.y = yaw;
    branch.rotateZ(spread * 4); // small outward splay, same safe in-plane-twist pattern as the main segments above
    group.add(branch);
    segments.push({ mesh: branch, tex: branchTex, seed: branchSeed });

    if (beadsOut) {
      const branchStart = planePointToWorld(baseU, botV, backdropW, backdropH, yaw, 0.35);
      const branchEnd = planePointToWorld(branchU, botV, backdropW, backdropH, yaw, 0.35);
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

// A radiating burst of jagged shard fragments AND bigger rounded molten
// blobs exploding out of the crater during an eruption — replaces the
// old tight column of thin vertical streaks. The blobs are new: bigger,
// rounder, and slower-tumbling than the shards, which is what actually
// reads as real LIQUID lava being thrown, not just fire debris — the
// shards alone (however many) still read as sparks/embers, not molten
// mass. Each particle launches at its own outward tilt (not just
// straight up) and tumbles as it flies, layered on top of the arcing
// debris chunks below.
function createEruptionFountain(coneH) {
  const group = new THREE.Group();
  const streaks = [];
  const totalCount = 26; // was 22
  const blobCount = 9; // new
  for (let i = 0; i < totalCount; i++) {
    const isBlob = i < blobCount;
    let geo, mat;
    if (isBlob) {
      const size = 0.55 + Math.random() * 0.9; // genuinely large compared to the old shards — real molten chunks, not sparks
      geo = new THREE.IcosahedronGeometry(size, 0);
      mat = new THREE.MeshBasicMaterial({
        color: 0xff7a28, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
      });
    } else {
      const length = 2.5 + Math.random() * 5; // some genuinely large shards now, not just fine spray
      geo = createShardGeometry(length);
      mat = new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide,
      });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, coneH, 0);
    group.add(mesh);
    streaks.push({
      mesh, isBlob, seed: Math.random() * Math.PI * 2,
      angle: Math.random() * Math.PI * 2, radius: Math.random() * 0.8,
      tilt: Math.random() * 0.95, // was 0.7 (~40deg) — now up to ~54deg, a genuinely wide explosive fan rather than a tight column
      spin: (Math.random() - 0.5) * (isBlob ? 3 : 8), // blobs tumble lazily, like real molten mass — the shards' fast tumble is what makes THEM read as light fire debris by contrast
      speed: (isBlob ? 4.5 : 6) + Math.random() * (isBlob ? 3 : 5), // blobs arc slower/heavier
      phase: Math.random(),
    });
  }
  return { group, streaks, craterY: coneH };
}

// Scatters small secondary glowing cracks across the backdrop's face —
// distinct from the 4 big flowing veins, these are static (no
// scroll/flow animation) fine fissures reading as old, settled fracture
// lines. Placed by random (u, v) on the flat face — the old cone's
// "+0.6 padding past the jitter" clearance math is gone entirely along
// with the irregular 3D surface it existed to clear.
function createBackdropCracks(group, backdropW, backdropH, craterVFrac, yaw, count) {
  for (let i = 0; i < count; i++) {
    const u = 0.08 + Math.random() * 0.84;
    const v = craterVFrac + 0.08 + Math.random() * (0.85 - craterVFrac);
    const len = 2.2 + Math.random() * 3.2;
    const width = 0.5 + Math.random() * 0.45;
    const tex = createVeinIllustrationTexture(u * 31 + i * 7.3);
    tex.repeat.set(1, 1.4);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.75 + Math.random() * 0.2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, len), mat);
    const p = planePointToWorld(u, v, backdropW, backdropH, yaw, 0.3);
    mesh.position.set(p.x, p.y, p.z);
    mesh.rotation.y = yaw;
    group.add(mesh);
  }
}

// Paints the entire mountain as one big silhouette illustration: a
// jagged low-poly peak with a crater notch cut into it, a dark-to-light
// vertical gradient body (the same ground/body/rim palette the old 3D
// cone used), faceted highlight/shadow triangles overlaid for an angular
// low-poly read, and a bright crater burst glow painted LAST and
// unclipped so it can spill slightly above the silhouette itself, the
// way the reference's flare does. This one texture is now the entire
// "shape" of the volcano — there's no more 3D geometry underneath it at
// all, just this plus the small foreground planes (veins/cracks/FX)
// layered in front of it.
function createVolcanoBackdropTexture(craterVFrac) {
  const w = 640, h = 800;
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");

  // More edge steps (20 -> 28) plus a second, finer noise layer on top
  // of the old single broad wave — the old single-layer noise was too
  // low-amplitude/low-frequency to read as jagged at real viewing
  // distance and came across as a nearly clean two-line triangle.
  const edgeSteps = 28;
  const craterStep = Math.round(edgeSteps * 0.5);
  const points = [];
  for (let i = 0; i <= edgeSteps; i++) {
    const t = i / edgeSteps;
    const nBroad = Math.sin(t * Math.PI * 3 + 1.7) * 0.5 + Math.sin(t * 7 + 4.2) * 0.28;
    const nFine = Math.sin(t * 23 + 2.1) * 0.09 + Math.sin(t * 37 - 1.4) * 0.06;
    const n = nBroad + nFine;
    // Exponent lowered (0.55 -> 0.38) broadens the hump into a wide-
    // shouldered mass instead of a tall narrow point, and the floor
    // (Math.max(0.22, ...)) keeps real foothill height across the FULL
    // width rather than pinching to a clean point at the very edges —
    // together this is most of what was reading as "boxy."
    const peak = Math.max(0.22, Math.pow(Math.sin(t * Math.PI), 0.38));
    let yTop = h * (1 - peak * (0.7 + n * 0.26));
    // Crater notch: a sharp V dip right at the peak, not a smooth summit.
    const distFromCrater = Math.abs(i - craterStep);
    if (distFromCrater <= 2) {
      yTop += h * craterVFrac * 0.5 * (1 - distFromCrater / 2);
    }
    points.push({ x: t * w, y: Math.max(h * 0.04, yTop) });
  }

  const tracePath = () => {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const p of points) ctx.lineTo(p.x, p.y);
    ctx.lineTo(w, h);
    ctx.closePath();
  };

  tracePath();
  const grad = ctx.createLinearGradient(0, h, 0, 0);
  grad.addColorStop(0, "#3a2030");
  grad.addColorStop(0.4, "#241833");
  grad.addColorStop(1, "#453a5e");
  ctx.fillStyle = grad;
  ctx.fill();

  // Faceted highlight/shadow overlay — more triangles, stronger
  // contrast, and now a thin dark stroke on each so the panels read as
  // crisp graphic-novel facets rather than a soft blend (was 16
  // triangles capped at 0.12 opacity with no outline — too subtle to
  // break up the smooth gradient at real viewing size).
  ctx.save();
  tracePath();
  ctx.clip();
  for (let i = 0; i < 30; i++) {
    const cx = Math.random() * w, cy = h * (0.08 + Math.random() * 0.87);
    const size = w * (0.07 + Math.random() * 0.16);
    const rot = Math.random() * Math.PI * 2;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = rot + (k / 3) * Math.PI * 2;
      const px = cx + Math.cos(a) * size, py = cy + Math.sin(a) * size * 1.3;
      if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = Math.random() < 0.5 ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.18)";
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  // Crater burst — a jagged radiating starburst instead of a plain soft
  // circle, painted LAST and unclipped so its spikes shoot up past the
  // silhouette itself. Angle is parameterized around "straight up in
  // canvas space" (-Y) rather than a full circle, so the burst fans
  // upward/outward the way an eruption plume actually would, not evenly
  // in every direction including back down into the rock.
  const craterX = w / 2, craterY = h * craterVFrac;
  const burstR = Math.max(1, w * 0.3); // was 0.22 — bigger, more dramatic

  const glowGrad = ctx.createRadialGradient(craterX, craterY, 0, craterX, craterY, burstR);
  glowGrad.addColorStop(0, "#fff3c8");
  glowGrad.addColorStop(0.35, "#ff8a3a");
  glowGrad.addColorStop(1, "rgba(255,90,30,0)");
  ctx.fillStyle = glowGrad;
  ctx.beginPath(); ctx.arc(craterX, craterY, burstR, 0, Math.PI * 2); ctx.fill();

  const spikeCount = 14;
  const sweep = Math.PI * 1.15; // ~207 degrees — a wide upward fan, not a full circle
  ctx.beginPath();
  for (let i = 0; i <= spikeCount; i++) {
    const t2 = i / spikeCount;
    const a = -Math.PI / 2 + (t2 - 0.5) * sweep; // centered on straight-up
    const r = burstR * (0.5 + Math.random() * 0.85);
    const px = craterX + Math.cos(a) * r;
    const py = craterY + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.closePath();
  const spikeGrad = ctx.createRadialGradient(craterX, craterY, 0, craterX, craterY, burstR * 1.6);
  spikeGrad.addColorStop(0, "#fff3c8");
  spikeGrad.addColorStop(0.4, "#ff6a2a");
  spikeGrad.addColorStop(1, "rgba(255,60,20,0)");
  ctx.fillStyle = spikeGrad;
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
    // A mix of big billowing "trunk" puffs and smaller trailing wisps —
    // a real plume is dominated by a few large rolling masses with
    // finer wisps around them, not one repeated size drifting up thinly
    // (the old version: 5 puffs, fixed 1-unit base size, capped at
    // ~0.5 opacity — reads as light haze, not a real plume).
    const isBig = Math.random() < 0.4;
    const baseSize = isBig ? 4.5 + Math.random() * 3.5 : 1.8 + Math.random() * 1.8;
    const gray = 0.16 + Math.random() * 0.22; // dark ash to lighter smoke, not one flat gray
    const mat = new THREE.MeshBasicMaterial({
      map: getSmokeTexture(), color: new THREE.Color(gray, gray, gray * 1.03),
      transparent: true, opacity: 0,
      depthWrite: false, fog: true, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), mat);
    group.add(mesh);
    puffs.push({
      mesh,
      phase: i / count,
      speed: 0.045 + Math.random() * 0.035, // was 0.09-0.12 — slower: a huge plume billows upward, it doesn't zip
      driftX: (Math.random() - 0.5) * 4.5, // was 1.6 — spreads much wider as it climbs
      driftZ: (Math.random() - 0.5) * 4.5,
      baseSize,
      riseMax: isBig ? 24 + Math.random() * 16 : 11 + Math.random() * 11, // was a flat "1 + t*6" (max ~7 units) — now towers well above the crater
      maxOpacity: isBig ? 0.62 : 0.4,
    });
  }
  return { group, puffs, baseY: coneH };
}

// `eruptBoost` (0 normally, 1 while erupting) thickens and brightens the
// plume during an actual eruption on top of its constant ambient
// presence — a volcano this size should look like it's *always* venting
// smoke, with the eruption adding to that rather than being the only
// time smoke exists.
function updateCraterSmoke(smoke, elapsed, eruptBoost = 0) {
  for (const p of smoke.puffs) {
    const t = (elapsed * p.speed + p.phase) % 1;
    const riseHeight = 1 + t * p.riseMax * (1 + eruptBoost * 0.5);
    p.mesh.position.set(p.driftX * t, smoke.baseY + riseHeight, p.driftZ * t);
    p.mesh.scale.setScalar(p.baseSize * (1 + t * 2.6));
    const fadeIn = Math.min(1, t / 0.12);
    const fadeOut = 1 - Math.pow(t, 1.4);
    p.mesh.material.opacity = Math.min(1, fadeIn * fadeOut * p.maxOpacity * (1 + eruptBoost * 0.45));
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

  // Fully 2D now, per explicit request: no cone geometry at all, just one
  // huge painted plane facing the map's center from the landmark's fixed
  // position — whichever direction the player approaches from, this is
  // the face they'll see, since the whole thing is meaningless from
  // behind (there's nothing back there but a blank plane edge).
  const yaw = Math.atan2(-LANDMARK_POSITION.x, -LANDMARK_POSITION.z);
  const backdropW = 95, backdropH = 118; // huge — this single plane IS the landmark now
  const craterVFrac = 0.14; // near the top of the painted silhouette

  const backdropTex = createVolcanoBackdropTexture(craterVFrac);
  const backdropMat = new THREE.MeshBasicMaterial({ map: backdropTex, transparent: true, side: THREE.DoubleSide });
  const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(backdropW, backdropH), backdropMat);
  backdrop.position.y = backdropH / 2;
  backdrop.rotation.y = yaw;
  group.add(backdrop);

  const craterPos = planePointToWorld(0.5, craterVFrac, backdropW, backdropH, yaw, 0.4);

  // Crater glow — a small additive halo plane sitting just in front of
  // the painted burst, animated (idle breathing + eruption flare) since
  // the baked texture itself is static. Replaces the old flat disc that
  // used to sit on the cone's real flattened top.
  const poolBaseColor = new THREE.Color(0xffd23f);
  const poolHotColor = new THREE.Color(0xffffff);
  const poolMat = new THREE.MeshBasicMaterial({
    map: getSoftGlowTexture(), color: poolBaseColor, transparent: true, opacity: 0.9,
    blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(backdropW * 0.16, backdropW * 0.16), poolMat);
  pool.position.set(craterPos.x, craterPos.y, craterPos.z);
  pool.rotation.y = yaw;
  group.add(pool);
  const craterLight = new THREE.PointLight(0xff6a2a, 1.2, 42); // was 30 — bigger falloff radius to match the larger eruption
  craterLight.position.set(craterPos.x, craterPos.y, craterPos.z);
  group.add(craterLight);

  // 4 lava veins running straight down the face, plus scattered
  // secondary cracks — same overall composition as before, just placed
  // by (u, v) on the flat face instead of by angle around a cone.
  const veinUs = [0.3, 0.41, 0.59, 0.7]; // deliberately uneven spacing, not a perfect cross
  const riverSegments = [];
  const veinGlows = [];
  const flowBeads = [];
  for (const u of veinUs) {
    const built = createBackdropVein(group, u, backdropW, backdropH, craterVFrac, yaw, veinGlows, flowBeads);
    riverSegments.push(...built);
  }
  createBackdropCracks(group, backdropW, backdropH, craterVFrac, yaw, 26);

  const energyPos = planePointToWorld(0.32, 0.42, backdropW, backdropH, yaw, 2.5);
  const energy = createEnergyCore(colorHex, 1.4, 0);
  energy.group.position.set(energyPos.x, energyPos.y, energyPos.z);
  group.add(energy.group);

  const chunks = createEruptionChunks(colorHex);
  for (const chunk of chunks) group.add(chunk.mesh);

  // Fountain/smoke/ember-sparks all build their internal geometry
  // relative to their OWN group-local origin — unchanged from before —
  // so passing 0 for their old "coneH" origin and offsetting the whole
  // sub-group's position to the crater's new world point reproduces the
  // exact same local behavior at the new location.
  const fountain = createEruptionFountain(0);
  fountain.group.position.set(craterPos.x, craterPos.y, craterPos.z);
  group.add(fountain.group);

  const smoke = createCraterSmoke(0, 20); // was 5 — a real towering plume, not a light haze
  smoke.group.position.set(craterPos.x, craterPos.y, craterPos.z);
  group.add(smoke.group);

  const emberSparks = createEmberSparks(2.4, 0, 12);
  emberSparks.group.position.set(craterPos.x, craterPos.y, craterPos.z);
  group.add(emberSparks.group);

  return {
    group, energy, baseY: 0, biome: "ember",
    volcano: {
      pool, poolMat, poolBaseColor, poolHotColor, craterLight, riverSegments, veinGlows, flowBeads,
      craterPos, backdropW, backdropH, craterVFrac, yaw, // needed by the chunk slide phase to move across the flat face
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
  const mat = new THREE.MeshStandardMaterial({ color: 0x2a0e06, emissive: 0xff5522, emissiveIntensity: 1.3, roughness: 0.5, flatShading: true });
  const geo = new THREE.IcosahedronGeometry(1.0, 0); // was 0.6 — genuinely large molten chunks now
  const chunks = [];
  for (let i = 0; i < 10; i++) { // was 6
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

  updateCraterSmoke(v.smoke, elapsed, v.erupting ? 1 : 0);
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
      // Launch direction constrained to a forward arc around the
      // backdrop's own facing angle (yaw), not a full circle — a chunk
      // launched "backward" would fly out behind a flat plane with
      // nothing there to land on.
      const angle = v.yaw + (Math.random() - 0.5) * Math.PI * 0.75;
      chunk.dirX = Math.sin(angle);
      chunk.dirZ = Math.cos(angle);
      chunk.vx = chunk.dirX * (2.5 + Math.random() * 4);
      chunk.vz = chunk.dirZ * (2.5 + Math.random() * 4);
      chunk.launchSpeed = 10 + Math.random() * 6;
      chunk.mesh.position.set(v.craterPos.x, v.craterPos.y, v.craterPos.z);
      chunk.baseScale = 0.8 + Math.random() * 1.1; // was 0.5-1.1 — noticeably larger molten chunks
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
    v.craterLight.intensity = 1.2 + flare * 9; // was *6 — bigger flare
    v.poolMat.color.copy(v.poolBaseColor).lerp(v.poolHotColor, flare);
    v.pool.scale.setScalar(1 + flare * 2.2); // the glow itself visibly swells during an eruption, not just brightens

    for (const s of v.fountain.streaks) {
      const cycle = ((elapsed * s.speed + s.phase * 3) % 1.4); // most of the cycle is the rise, a short reset gap after
      const rising = cycle < 1;
      const riseSpan = s.isBlob ? 12 : 9; // blobs are heavier/slower but launch further, arcing higher before falling back
      const height = rising ? cycle * riseSpan : 0;
      // Outward radius now grows from the shard's own launch tilt (real
      // radial spread), not just the old small drift term — this is what
      // makes the burst read as exploding outward from the crater rather
      // than a straight column with a slight lean.
      const outward = height * Math.sin(s.tilt) * 1.5;
      const r = s.radius * (1 + height * 0.15) + outward;
      s.mesh.position.set(Math.cos(s.angle) * r, v.fountain.craterY + height * Math.cos(s.tilt), Math.sin(s.angle) * r);
      s.mesh.rotation.z = s.seed + elapsed * s.spin; // tumble, so a flat triangle still reads as a chunky fragment rather than a flat card
      const peakOpacity = s.isBlob ? 1 : 0.9; // blobs read as solid molten mass, pushed to full opacity at their peak
      s.mesh.material.opacity = rising ? flare * (1 - height / riseSpan) * peakOpacity : 0;
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
      chunk.mesh.position.x = v.craterPos.x + chunk.vx * chunk.t;
      chunk.mesh.position.z = v.craterPos.z + chunk.vz * chunk.t;
      const y = v.craterPos.y + chunk.launchSpeed * chunk.t - 0.5 * gravity * chunk.t * chunk.t;
      chunk.mesh.position.y = y;
      chunk.mesh.rotation.x += dt * 4;
      chunk.mesh.rotation.z += dt * 3;
      // Switch to sliding once the arc brings it back down to roughly
      // crater height — from here it rides the flat backdrop's face
      // down to the base instead of continuing to fall through open air.
      if (y <= v.craterPos.y) {
        chunk.phase = "sliding";
        // Project the landing point onto the backdrop's own (unrotated)
        // local u-axis — the inverse of the single rotation
        // planePointToWorld applies — so the slide starts wherever the
        // ballistic arc actually landed rather than snapping to
        // dead-center.
        const lx = chunk.mesh.position.x * Math.cos(v.yaw) - chunk.mesh.position.z * Math.sin(v.yaw);
        chunk.slideStartU = THREE.MathUtils.clamp(lx / v.backdropW + 0.5, 0.05, 0.95);
        chunk.slideEndU = THREE.MathUtils.clamp(chunk.slideStartU + (Math.random() - 0.5) * 0.4, 0.05, 0.95);
        chunk.slideV = v.craterVFrac;
      }
    } else if (chunk.phase === "sliding") {
      // Descend at a steady rate across the face (in v-fraction/sec,
      // tuned to roughly match the old 3D slide's pacing) while drifting
      // sideways in u from where it landed toward its random end point.
      const slideVSpeed = 0.17;
      const endV = 0.97;
      chunk.slideV += slideVSpeed * dt;
      const t = THREE.MathUtils.clamp((chunk.slideV - v.craterVFrac) / (endV - v.craterVFrac), 0, 1);
      const u = THREE.MathUtils.lerp(chunk.slideStartU, chunk.slideEndU, t);
      const p = planePointToWorld(u, chunk.slideV, v.backdropW, v.backdropH, v.yaw, 0.4);
      chunk.mesh.position.set(p.x, p.y, p.z);
      chunk.mesh.rotation.x += dt * 2;
      // Shrinks only in the final stretch — reads as the chunk breaking
      // apart and merging into the flow rather than simply switching off
      // partway down.
      const shrink = t < 0.7 ? 1 : THREE.MathUtils.clamp(1 - (t - 0.7) / 0.3, 0, 1);
      chunk.mesh.scale.setScalar(chunk.baseScale * shrink);

      if (t >= 1) {
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
