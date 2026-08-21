import * as THREE from "three";
import * as legacy from "./weather_legacy.js";

export * from "./weather_legacy.js";

// -----------------------------------------------------------------------------
// Lightning presentation override
// -----------------------------------------------------------------------------
// The original weather system still owns rain, wind, fog, snow, ash, etc. This
// wrapper deliberately owns ONLY lightning presentation. Two important fixes:
//
// 1) Keep this function signature identical to weather_legacy.js. main_game.js
//    calls updateWeatherSystem(handle, dt, erupting, dayAmount, playerPos).
//    The previous wrapper accidentally treated the second/third arguments as
//    elapsed/dt, so its bolt cooldown was subtracting the boolean erupting flag
//    instead of real frame dt. In a normal storm that meant the cooldown never
//    moved and a real bolt could never spawn.
//
// 2) Do not use THREE.LineBasicMaterial for the visible channel. On many
//    browsers/platforms a basic line is effectively locked to one physical
//    pixel, which made the distant bolt nearly invisible on a phone. The bolt
//    below is made from pooled instanced cylinder MESHES, so its apparent width
//    is real geometry and survives WebGPU/mobile rendering.

const MAX_BOLT_SEGMENTS = 72;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scale = new THREE.Vector3();
const _matrix = new THREE.Matrix4();

const STRIKE_COOLDOWNS = {
  ember: [24, 42],
  verdant: [22, 40],
  crystal: [20, 38],
  abyssal: [34, 58],
  ashen: [26, 46],
  frost: [38, 68],
};

const LIGHTNING_COLORS = {
  // Coral Shallows gets actual storm lightning now — pale white-blue,
  // rather than the old cyan "bioluminescent pulse" treatment.
  crystal: 0xe8f7ff,
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function createLightningBolt(scene, color) {
  // A six-sided cylinder is enough at lightning-strike duration and keeps the
  // mesh pool very cheap. Unit height along +Y; every instance is rotated and
  // scaled to bridge one pair of generated points.
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);

  const baseColor = new THREE.Color(color);
  const coreColor = baseColor.clone().lerp(new THREE.Color(0xffffff), 0.72);

  const coreMaterial = new THREE.MeshBasicMaterial({
    color: coreColor,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
  const glowMaterial = new THREE.MeshBasicMaterial({
    color: baseColor,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });

  const core = new THREE.InstancedMesh(geometry, coreMaterial, MAX_BOLT_SEGMENTS);
  const glow = new THREE.InstancedMesh(geometry, glowMaterial, MAX_BOLT_SEGMENTS);
  core.count = 0;
  glow.count = 0;
  core.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  glow.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  core.frustumCulled = false;
  glow.frustumCulled = false;
  core.renderOrder = 950;
  glow.renderOrder = 949;
  core.visible = false;
  glow.visible = false;
  scene.add(glow);
  scene.add(core);

  return {
    core,
    glow,
    geometry,
    coreMaterial,
    glowMaterial,
    life: 0,
    duration: 0.34,
    flash: 0,
    segmentCount: 0,
    peakLight: 1.0,
  };
}

function setSegmentInstance(mesh, index, a, b, radius) {
  _dir.subVectors(b, a);
  const length = _dir.length();
  if (length < 0.001) return false;
  _dir.multiplyScalar(1 / length);
  _mid.addVectors(a, b).multiplyScalar(0.5);
  _quat.setFromUnitVectors(Y_AXIS, _dir);
  _scale.set(radius, length, radius);
  _matrix.compose(_mid, _quat, _scale);
  mesh.setMatrixAt(index, _matrix);
  return true;
}

function spawnLightningBolt(bolt, biome, profile, playerPos) {
  if (!bolt) return;

  const px = Number.isFinite(playerPos?.x) ? playerPos.x : 0;
  const pz = Number.isFinite(playerPos?.z) ? playerPos.z : 0;
  const angle = Math.random() * Math.PI * 2;

  // Keep the strike close enough that the actual channel is readable, not a
  // one-pixel mark on the far horizon. It is still far enough away to feel like
  // sky weather rather than a strike on the player.
  const distance = randRange(38, 72);
  const baseX = px + Math.cos(angle) * distance;
  const baseZ = pz + Math.sin(angle) * distance;

  const start = new THREE.Vector3(
    baseX + randRange(-10, 10),
    randRange(82, 108),
    baseZ + randRange(-10, 10),
  );
  const end = new THREE.Vector3(
    baseX + randRange(-12, 12),
    randRange(10, 20),
    baseZ + randRange(-12, 12),
  );

  const mainSegments = 14 + Math.floor(Math.random() * 4);
  const mainPoints = [start.clone()];
  for (let i = 1; i <= mainSegments; i++) {
    const t = i / mainSegments;
    const p = new THREE.Vector3().lerpVectors(start, end, t);
    // Strong angular changes make the silhouette read as lightning instead of
    // a smooth glowing rope. The lateral envelope narrows toward the ground.
    const lateral = 6.5 * (1 - t * 0.55);
    p.x += randRange(-lateral, lateral);
    p.z += randRange(-lateral, lateral);
    p.y += randRange(-1.5, 1.5);
    mainPoints.push(p);
  }

  let segment = 0;
  function addSegment(a, b, coreRadius, glowRadius) {
    if (segment >= MAX_BOLT_SEGMENTS) return;
    setSegmentInstance(bolt.core, segment, a, b, coreRadius);
    setSegmentInstance(bolt.glow, segment, a, b, glowRadius);
    segment++;
  }

  for (let i = 0; i < mainPoints.length - 1; i++) {
    const t = i / Math.max(1, mainPoints.length - 2);
    addSegment(mainPoints[i], mainPoints[i + 1], 0.24 - t * 0.08, 0.72 - t * 0.20);

    // Sparse side branches. They are thinner than the trunk and usually die
    // after only a few steps, which reads far more naturally than a uniformly
    // branching tree shape.
    if (i > 2 && i < mainPoints.length - 3 && Math.random() < 0.24) {
      let branchStart = mainPoints[i + 1].clone();
      const branchSteps = 2 + Math.floor(Math.random() * 3);
      const branchAngle = angle + (Math.random() < 0.5 ? -1 : 1) * randRange(0.55, 1.25);
      for (let j = 0; j < branchSteps && segment < MAX_BOLT_SEGMENTS; j++) {
        const next = branchStart.clone();
        const side = randRange(5.5, 10.5) * (1 - j * 0.16);
        next.x += Math.cos(branchAngle) * side + randRange(-2.0, 2.0);
        next.z += Math.sin(branchAngle) * side + randRange(-2.0, 2.0);
        next.y -= randRange(4.5, 8.5);
        addSegment(branchStart, next, 0.095, 0.34);
        branchStart = next;
      }
    }
  }

  bolt.segmentCount = segment;
  bolt.core.count = segment;
  bolt.glow.count = segment;
  bolt.core.instanceMatrix.needsUpdate = true;
  bolt.glow.instanceMatrix.needsUpdate = true;

  // A channel stays readable for a few tenths of a second, but its associated
  // illumination is ONE smooth pulse — no multi-flash strobe sequence.
  bolt.duration = randRange(0.30, 0.42);
  bolt.life = bolt.duration;
  bolt.flash = 1;
  bolt.peakLight = biome === "crystal" ? 0.9 : 1.15;
  bolt.coreMaterial.opacity = 1;
  bolt.glowMaterial.opacity = 0.20;
  bolt.core.visible = true;
  bolt.glow.visible = true;
}

function updateLightningBolt(handle, dt) {
  const bolt = handle?.realLightningBolt;
  if (!bolt) return;

  if (bolt.life <= 0) {
    bolt.core.visible = false;
    bolt.glow.visible = false;
    bolt.coreMaterial.opacity = 0;
    bolt.glowMaterial.opacity = 0;
    bolt.flash = 0;
    if (handle.lightningLight) handle.lightningLight.intensity = 0;
    // Keep the old volumetric-cloud lightning input completely quiet between
    // real strikes. This is what removes the persistent storm strobing.
    handle.lightningFlash = 0;
    return;
  }

  bolt.life = Math.max(0, bolt.life - dt);
  const age = bolt.duration - bolt.life;
  const remaining = bolt.life / Math.max(0.001, bolt.duration);

  // Channel: immediate appearance, then a clean monotonic fade. No random
  // visibility toggles and no repeated on/off flashes inside one strike.
  const channelFade = remaining > 0.70 ? 1 : Math.pow(remaining / 0.70, 1.35);
  bolt.coreMaterial.opacity = channelFade;
  bolt.glowMaterial.opacity = channelFade * 0.20;

  // Scene illumination: one brief, soft envelope. The old system peaked at 9
  // and also drove the cloud shader; this is deliberately far lower and the
  // cloud flash input stays at zero, so the scene no longer strobes white.
  const attack = Math.min(1, age / 0.035);
  const release = Math.max(0, 1 - Math.max(0, age - 0.035) / 0.12);
  const lightPulse = attack * release;
  bolt.flash = lightPulse;
  if (handle.lightningLight) {
    handle.lightningLight.intensity = bolt.peakLight * lightPulse;
  }
  handle.lightningFlash = 0;

  if (bolt.life <= 0) {
    bolt.core.visible = false;
    bolt.glow.visible = false;
    bolt.coreMaterial.opacity = 0;
    bolt.glowMaterial.opacity = 0;
    bolt.flash = 0;
    if (handle.lightningLight) handle.lightningLight.intensity = 0;
  }
}

function strikeEligible(handle) {
  if (!handle) return false;
  const rainNow = !!handle.rainActive || (handle.rainIntensity ?? 0) > 0.18;
  if (handle.biome === "crystal") return rainNow;
  const lp = handle.profile?.lightning;
  if (lp?.onlyDuringRain) return rainNow;
  return true;
}

function suppressLegacyLightning(handle) {
  // Legacy local lightning used a full point-light flash every few seconds.
  // Leave the timers disabled so that old effect never competes with the real
  // bolt scheduler below.
  handle.lightningTimer = Number.POSITIVE_INFINITY;
  handle.lightningFlash = 0;
  if (handle.lightningLight) handle.lightningLight.intensity = 0;

  // Legacy distant lightning was a radial sprite on its own independent timer.
  // That was another source of apparent random flicker, so it is disabled too.
  const dl = handle.distantLightning;
  if (dl) {
    dl.timer = Number.POSITIVE_INFINITY;
    dl.flash = 0;
    if (dl.sprite) {
      dl.sprite.visible = false;
      if (dl.sprite.material) dl.sprite.material.opacity = 0;
    }
  }
}

function suppressCrystalStormSunFlicker(handle) {
  if (!handle || handle.biome !== "crystal") return;
  const storm = clamp01(handle.rainIntensity ?? 0);
  if (storm <= 0.03) return;

  // The Coral Shallows legacy dapple/refraction sprites intentionally pulse in
  // clear weather. During a storm that same pulsing reads like lightning
  // flicker. Storm clouds should obscure those sun shafts instead, so fade them
  // out smoothly as rain builds.
  const sunFade = Math.pow(1 - storm, 2.4);
  if (handle.crystalDapple?.rays) {
    for (const ray of handle.crystalDapple.rays) {
      ray.sprite.material.opacity *= sunFade;
    }
  }
  if (handle.crystalRefraction?.sprite?.material) {
    handle.crystalRefraction.sprite.material.opacity *= sunFade * sunFade;
  }
}

export function createWeatherSystem(scene, biome) {
  const handle = legacy.createWeatherSystem(scene, biome);
  if (!handle) return handle;

  const color = LIGHTNING_COLORS[biome] ?? handle.profile?.lightning?.color ?? 0xddeeff;
  handle.realLightningBolt = createLightningBolt(scene, color);
  handle.realLightningTimer = randRange(5, 9);
  handle.realLightningWasEligible = false;

  suppressLegacyLightning(handle);
  return handle;
}

// IMPORTANT: signature intentionally matches weather_legacy.js exactly.
export function updateWeatherSystem(handle, dt, erupting = false, dayAmount = 0, playerPos = null) {
  // Re-disable the old lightning state BEFORE the legacy update. Infinity stays
  // Infinity when legacy subtracts dt, so its own lightning path cannot fire.
  if (handle) suppressLegacyLightning(handle);

  const result = legacy.updateWeatherSystem(handle, dt, erupting, dayAmount, playerPos);
  if (!handle) return result;

  // Legacy also updates the intentionally pulsing clear-weather sun shafts;
  // suppress those only while Coral Shallows is actually stormy.
  suppressCrystalStormSunFlicker(handle);

  const eligible = strikeEligible(handle);
  const cooldownRange = STRIKE_COOLDOWNS[handle.biome] ?? [24, 44];

  // When a storm first becomes eligible, guarantee the first visible bolt soon
  // enough to actually notice/test. Subsequent strikes are intentionally much
  // farther apart so the storm is not a strobe light.
  if (eligible && !handle.realLightningWasEligible) {
    handle.realLightningTimer = randRange(2.5, 5.5);
  }
  handle.realLightningWasEligible = eligible;

  if (eligible) {
    handle.realLightningTimer = Math.max(0, (handle.realLightningTimer ?? 0) - dt);
    if (handle.realLightningTimer <= 0) {
      spawnLightningBolt(handle.realLightningBolt, handle.biome, handle.profile, playerPos);
      handle.realLightningTimer = randRange(cooldownRange[0], cooldownRange[1]);
    }
  }

  updateLightningBolt(handle, dt);

  // Final hard guarantees after all weather work for this frame: old sprite is
  // never allowed to reappear, and the cloud-shader flash channel stays zero.
  if (handle.distantLightning?.sprite) {
    handle.distantLightning.sprite.visible = false;
    if (handle.distantLightning.sprite.material) handle.distantLightning.sprite.material.opacity = 0;
  }
  handle.lightningFlash = 0;

  return result;
}

export function disposeWeatherSystem(scene, handle) {
  const bolt = handle?.realLightningBolt;
  if (bolt) {
    scene.remove(bolt.core);
    scene.remove(bolt.glow);
    bolt.geometry.dispose();
    bolt.coreMaterial.dispose();
    bolt.glowMaterial.dispose();
    handle.realLightningBolt = null;
  }
  return legacy.disposeWeatherSystem(scene, handle);
}
