import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

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
function createEmberLandmark(colorHex) {
  const group = new THREE.Group();
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x1c130f, roughness: 0.85, flatShading: true });
  const coneH = 27, baseR = 10, craterR = 2.2;
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(craterR, baseR, coneH, 9), rockMat);
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

  // Lava river — a chain of tapered segments running down one slope from
  // just below the crater to the base, colored with the same hot gradient
  // as the ground-level lava and animated with a similar scrolling glow
  // so it reads as actively flowing, not a painted stripe.
  const riverSegCount = 7;
  const riverMat = new THREE.MeshBasicMaterial({ color: 0xff5522 });
  const riverSegments = [];
  for (let i = 0; i < riverSegCount; i++) {
    const t = i / (riverSegCount - 1);
    const segY = coneH * (1 - t) * 0.92;
    const segR = baseR * t * 0.98 + 0.6; // widens as it nears the base, like real lava does spreading out
    const w = 1.4 + t * 2.2;
    const seg = new THREE.Mesh(new THREE.PlaneGeometry(w, coneH / riverSegCount * 1.3), riverMat);
    seg.position.set(0, segY, segR);
    seg.rotation.x = -0.25;
    // Tilt the segment to roughly follow the cone's slope at this height
    // rather than standing perfectly vertical.
    const slopeAngle = Math.atan2(baseR - craterR, coneH);
    seg.rotation.x = -(Math.PI / 2 - slopeAngle);
    group.add(seg);
    riverSegments.push({ mesh: seg, seed: i * 0.7 });
  }

  const energy = createEnergyCore(colorHex, 1.4, coneH * 0.5);
  energy.group.position.set(0, 0, baseR * 0.55); // offset toward the river side rather than dead-center in the cone
  group.add(energy.group);

  const chunks = createEruptionChunks(colorHex);
  for (const chunk of chunks) group.add(chunk.mesh);

  return {
    group, energy, baseY: 0, biome: "ember",
    volcano: {
      pool, poolMat, poolBaseColor, poolHotColor, craterLight, riverSegments, craterY: coneH,
      eruptionTimer: 8 + Math.random() * 12, // first eruption arrives reasonably soon rather than making the player wait a full cycle
      eruptionPhase: 0, // 0 = dormant, ramps to 1 during an active eruption and back down
      erupting: false,
      chunks,
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
  for (const seg of v.riverSegments) {
    const flow = 0.55 + 0.45 * Math.sin(elapsed * 1.8 - seg.seed * 1.5); // negative sign on the seed term makes the brightness peak travel down the chain over time, reading as downhill flow rather than segments pulsing independently
    seg.mesh.material.opacity = flow;
  }
  // Crater pool breathes gently between eruptions, same as ground lava's
  // own idle pulse.
  const idlePulse = 0.8 + 0.2 * Math.sin(elapsed * 0.9);
  v.craterLight.intensity = v.erupting ? v.craterLight.intensity : 1.2 * idlePulse;

  v.eruptionTimer -= dt;
  if (!v.erupting && v.eruptionTimer <= 0) {
    v.erupting = true;
    v.eruptionPhase = 0;
    for (const chunk of v.chunks) {
      chunk.active = true;
      chunk.t = 0;
      const angle = Math.random() * Math.PI * 2;
      chunk.vx = Math.cos(angle) * (2 + Math.random() * 3);
      chunk.vz = Math.sin(angle) * (2 + Math.random() * 3);
      chunk.launchSpeed = 9 + Math.random() * 5;
      chunk.mesh.position.set(0, v.craterY, 0);
      chunk.mesh.scale.setScalar(0.5 + Math.random() * 0.6);
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

    for (const chunk of v.chunks) {
      if (!chunk.active) continue;
      chunk.t += dt;
      const gravity = 9;
      chunk.mesh.position.x = chunk.vx * chunk.t;
      chunk.mesh.position.z = chunk.vz * chunk.t;
      chunk.mesh.position.y = v.craterY + chunk.launchSpeed * chunk.t - 0.5 * gravity * chunk.t * chunk.t;
      chunk.mesh.rotation.x += dt * 4;
      chunk.mesh.rotation.z += dt * 3;
      if (chunk.mesh.position.y < v.craterY - 2) {
        chunk.active = false;
        chunk.mesh.scale.setScalar(0); // park it invisibly rather than removing/re-adding the mesh each eruption
      }
    }

    if (v.eruptionPhase >= 1) {
      v.erupting = false;
      v.eruptionTimer = 22 + Math.random() * 18; // next eruption 22-40s out
    }
  }
}

function disposeLandmark(scene, handle) {
  if (!handle) return;
  scene.remove(handle.group);
  handle.group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) obj.material.dispose();
  });
}

export { createLandmark, updateLandmark, disposeLandmark, LANDMARK_POSITION };
