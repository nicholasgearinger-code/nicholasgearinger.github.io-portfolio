import * as THREE from "three";
import * as legacy from "./weather_legacy.js";

export * from "./weather_legacy.js";

const MAX_BOLT_VERTICES = 192;
const TAU = Math.PI * 2;

const STRIKE_COOLDOWNS = {
  ember: [18, 34],
  verdant: [16, 30],
  crystal: [16, 32],
  abyssal: [28, 52],
  ashen: [20, 38],
  frost: [32, 64],
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function createLightningBolt(scene, color) {
  const positions = new Float32Array(MAX_BOLT_VERTICES * 3);
  const geometry = new THREE.BufferGeometry();
  const position = new THREE.BufferAttribute(positions, 3);
  position.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", position);
  geometry.setDrawRange(0, 0);

  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    fog: true,
    toneMapped: false,
  });

  const line = new THREE.LineSegments(geometry, material);
  line.visible = false;
  line.frustumCulled = false;
  line.renderOrder = 850;
  scene.add(line);

  return {
    line,
    geometry,
    material,
    life: 0,
    duration: 0.18,
    peakIntensity: 4.2,
  };
}

function writeVertex(array, vertexIndex, p) {
  const o = vertexIndex * 3;
  array[o] = p.x;
  array[o + 1] = p.y;
  array[o + 2] = p.z;
}

function spawnLightningBolt(bolt, profile, playerPos, dim = false) {
  if (!bolt) return;

  const px = Number.isFinite(playerPos?.x) ? playerPos.x : 0;
  const pz = Number.isFinite(playerPos?.z) ? playerPos.z : 0;
  const angle = Math.random() * TAU;
  const distance = randRange(70, 155);
  const skyHeight = Math.max(profile?.lightning?.height ?? 75, dim ? 52 : 82);

  const start = new THREE.Vector3(
    px + Math.cos(angle) * distance,
    skyHeight + randRange(24, 58),
    pz + Math.sin(angle) * distance,
  );
  const end = new THREE.Vector3(
    start.x + randRange(-18, 18),
    dim ? randRange(12, 28) : randRange(4, 18),
    start.z + randRange(-18, 18),
  );

  const positions = bolt.geometry.attributes.position.array;
  let vertex = 0;
  const mainSegments = dim ? 10 : 15;
  const mainPoints = [start.clone()];

  for (let i = 1; i <= mainSegments; i++) {
    const t = i / mainSegments;
    const p = new THREE.Vector3().lerpVectors(start, end, t);
    const envelope = Math.max(0.18, 1 - t * 0.72);
    p.x += randRange(-7.5, 7.5) * envelope;
    p.z += randRange(-7.5, 7.5) * envelope;
    p.y += randRange(-2.2, 2.2);
    mainPoints.push(p);
  }

  for (let i = 0; i < mainPoints.length - 1 && vertex + 2 <= MAX_BOLT_VERTICES; i++) {
    writeVertex(positions, vertex++, mainPoints[i]);
    writeVertex(positions, vertex++, mainPoints[i + 1]);

    if (!dim && i > 2 && i < mainPoints.length - 3 && Math.random() < 0.22 && vertex + 8 <= MAX_BOLT_VERTICES) {
      let branchStart = mainPoints[i + 1].clone();
      const branchSteps = 2 + Math.floor(Math.random() * 3);
      const sideAngle = angle + (Math.random() < 0.5 ? -1 : 1) * randRange(0.55, 1.15);
      for (let j = 0; j < branchSteps && vertex + 2 <= MAX_BOLT_VERTICES; j++) {
        const length = randRange(5, 11) * (1 - j / (branchSteps + 1));
        const next = branchStart.clone();
        next.x += Math.cos(sideAngle) * length + randRange(-2.5, 2.5);
        next.z += Math.sin(sideAngle) * length + randRange(-2.5, 2.5);
        next.y -= randRange(4, 9);
        writeVertex(positions, vertex++, branchStart);
        writeVertex(positions, vertex++, next);
        branchStart = next;
      }
    }
  }

  bolt.geometry.attributes.position.needsUpdate = true;
  bolt.geometry.setDrawRange(0, vertex);
  bolt.geometry.computeBoundingSphere();
  bolt.duration = dim ? 0.13 : randRange(0.16, 0.22);
  bolt.life = bolt.duration;
  bolt.peakIntensity = dim ? 1.2 : 4.4;
  bolt.material.opacity = dim ? 0.58 : 1.0;
  bolt.line.visible = true;
}

function updateLightningBolt(handle, dt) {
  const bolt = handle?.realLightningBolt;
  if (!bolt) return;

  if (bolt.life <= 0) {
    bolt.line.visible = false;
    bolt.material.opacity = 0;
    if (handle.lightningLight) handle.lightningLight.intensity = 0;
    return;
  }

  bolt.life = Math.max(0, bolt.life - dt);
  const remaining = bolt.life / Math.max(0.001, bolt.duration);
  const fade = remaining > 0.68 ? 1 : Math.pow(remaining / 0.68, 1.7);
  bolt.material.opacity = fade * (handle.profile?.lightning?.dim ? 0.58 : 0.96);

  const age = bolt.duration - bolt.life;
  const flashEnvelope = age < 0.045
    ? 1
    : Math.max(0, 1 - (age - 0.045) / Math.max(0.08, bolt.duration - 0.045));
  if (handle.lightningLight) {
    handle.lightningLight.intensity = bolt.peakIntensity * flashEnvelope * flashEnvelope;
  }

  if (bolt.life <= 0) {
    bolt.line.visible = false;
    bolt.material.opacity = 0;
    if (handle.lightningLight) handle.lightningLight.intensity = 0;
  }
}

function strikeEligible(handle) {
  if (!handle) return false;
  if (handle.biome === "crystal") return !!handle.rainActive;
  const lp = handle.profile?.lightning;
  if (lp?.onlyDuringRain) return !!handle.rainActive;
  return true;
}

export function createWeatherSystem(scene, biome) {
  const handle = legacy.createWeatherSystem(scene, biome);
  if (!handle) return handle;

  handle.realLightningBolt = createLightningBolt(scene, handle.profile?.lightning?.color ?? 0xddeeff);
  const cooldown = STRIKE_COOLDOWNS[biome] ?? [20, 40];
  handle.realLightningCooldown = randRange(cooldown[0] * 0.45, cooldown[1] * 0.75);
  handle.previousLegacyFlash = 0;

  if (handle.distantLightning?.sprite?.material) {
    handle.distantLightning.sprite.material.opacity = 0;
    handle.distantLightning.sprite.visible = false;
  }
  if (handle.lightningLight) handle.lightningLight.intensity = 0;
  return handle;
}

export function updateWeatherSystem(handle, elapsed, dt, ambientLight, playerPos, eruptBoost = 0, darkness = 0, stormIntensity = 0) {
  const result = legacy.updateWeatherSystem(
    handle,
    elapsed,
    dt,
    ambientLight,
    playerPos,
    eruptBoost,
    darkness,
    stormIntensity,
  );

  if (!handle) return result;

  if (handle.distantLightning?.sprite) {
    handle.distantLightning.sprite.visible = false;
    if (handle.distantLightning.sprite.material) handle.distantLightning.sprite.material.opacity = 0;
  }

  const cooldownRange = STRIKE_COOLDOWNS[handle.biome] ?? [20, 40];
  handle.realLightningCooldown = Math.max(0, (handle.realLightningCooldown ?? 0) - dt);

  const legacyFlash = handle.lightningFlash ?? 0;
  const justTriggered = legacyFlash > 0.82 && (handle.previousLegacyFlash ?? 0) <= 0.82;
  handle.previousLegacyFlash = legacyFlash;

  if (justTriggered && handle.realLightningCooldown <= 0 && strikeEligible(handle)) {
    spawnLightningBolt(handle.realLightningBolt, handle.profile, playerPos, !!handle.profile?.lightning?.dim);
    handle.realLightningCooldown = randRange(cooldownRange[0], cooldownRange[1]);
  }

  updateLightningBolt(handle, dt);

  if ((handle.realLightningBolt?.life ?? 0) <= 0 && handle.lightningLight) {
    handle.lightningLight.intensity = 0;
  }

  return result;
}

export function disposeWeatherSystem(scene, handle) {
  const bolt = handle?.realLightningBolt;
  if (bolt) {
    scene.remove(bolt.line);
    bolt.geometry.dispose();
    bolt.material.dispose();
    handle.realLightningBolt = null;
  }
  return legacy.disposeWeatherSystem(scene, handle);
}
