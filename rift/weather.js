import * as THREE from "three";
import * as legacy from "./weather_legacy.js";

export * from "./weather_legacy.js";

// -----------------------------------------------------------------------------
// Lightning presentation override
// -----------------------------------------------------------------------------
// The legacy weather module still owns rain, wind, fog, snow, ash, etc. This
// wrapper owns lightning presentation only. It deliberately avoids dynamic
// InstancedMesh counts on WebGPU: a lightning strike is so short-lived that a
// small pool of ordinary cylinder meshes is both safer and easily cheap enough.

const MAX_BOLT_SEGMENTS = 56;
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _viewDir = new THREE.Vector3();

const STRIKE_COOLDOWNS = {
  ember: [18, 30],
  verdant: [16, 28],
  crystal: [12, 22],
  abyssal: [28, 48],
  ashen: [20, 34],
  frost: [32, 56],
};

const LIGHTNING_COLORS = {
  crystal: 0xf2fbff,
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function createLightningBolt(scene, color) {
  const geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
  const baseColor = new THREE.Color(color);

  const coreMaterial = new THREE.MeshBasicMaterial({
    color: baseColor.clone().lerp(new THREE.Color(0xffffff), 0.92),
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

  const group = new THREE.Group();
  group.visible = false;
  group.renderOrder = 950;
  scene.add(group);

  const segments = [];
  for (let i = 0; i < MAX_BOLT_SEGMENTS; i++) {
    const glow = new THREE.Mesh(geometry, glowMaterial);
    const core = new THREE.Mesh(geometry, coreMaterial);
    glow.visible = false;
    core.visible = false;
    glow.frustumCulled = false;
    core.frustumCulled = false;
    glow.renderOrder = 949;
    core.renderOrder = 950;
    group.add(glow, core);
    segments.push({ glow, core });
  }

  // Capture whichever camera is actually rendering Rift without changing the
  // existing weather API. The mesh writes no color/depth and exists solely so
  // onBeforeRender receives the active camera. This lets strikes be placed in
  // front of the player's view instead of randomly somewhere behind them.
  const captureGeometry = new THREE.PlaneGeometry(0.001, 0.001);
  const captureMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false,
  });
  captureMaterial.colorWrite = false;
  const cameraCapture = new THREE.Mesh(captureGeometry, captureMaterial);
  cameraCapture.frustumCulled = false;
  cameraCapture.renderOrder = -1000;
  scene.add(cameraCapture);

  const bolt = {
    group,
    segments,
    geometry,
    coreMaterial,
    glowMaterial,
    cameraCapture,
    captureGeometry,
    captureMaterial,
    camera: null,
    life: 0,
    duration: 0.5,
  };
  cameraCapture.onBeforeRender = (_renderer, _scene, camera) => {
    bolt.camera = camera;
  };
  return bolt;
}

function setCylinderBetween(mesh, a, b, radius) {
  _dir.subVectors(b, a);
  const length = _dir.length();
  if (length < 0.001) {
    mesh.visible = false;
    return;
  }
  _dir.multiplyScalar(1 / length);
  _mid.addVectors(a, b).multiplyScalar(0.5);
  mesh.position.copy(_mid);
  mesh.quaternion.setFromUnitVectors(Y_AXIS, _dir);
  mesh.scale.set(radius, length, radius);
}

function hideBoltSegments(bolt) {
  for (const segment of bolt.segments) {
    segment.core.visible = false;
    segment.glow.visible = false;
  }
}

function spawnLightningBolt(bolt, playerPos) {
  if (!bolt) return;
  hideBoltSegments(bolt);

  const px = Number.isFinite(playerPos?.x) ? playerPos.x : 0;
  const py = Number.isFinite(playerPos?.y) ? playerPos.y : 8;
  const pz = Number.isFinite(playerPos?.z) ? playerPos.z : 0;

  // Prefer the active camera's horizontal look direction so the bolt is almost
  // guaranteed to appear in the player's current field of view. Fall back to a
  // random azimuth only before the capture mesh has rendered once.
  let forwardX = 0;
  let forwardZ = -1;
  if (bolt.camera) {
    bolt.camera.getWorldDirection(_viewDir);
    const horizontalLength = Math.hypot(_viewDir.x, _viewDir.z);
    if (horizontalLength > 0.01) {
      forwardX = _viewDir.x / horizontalLength;
      forwardZ = _viewDir.z / horizontalLength;
    }
  } else {
    const fallbackAngle = Math.random() * Math.PI * 2;
    forwardX = Math.cos(fallbackAngle);
    forwardZ = Math.sin(fallbackAngle);
  }

  const yawJitter = randRange(-0.22, 0.22);
  const c = Math.cos(yawJitter);
  const s = Math.sin(yawJitter);
  const strikeDirX = forwardX * c - forwardZ * s;
  const strikeDirZ = forwardX * s + forwardZ * c;
  const distance = randRange(34, 50);
  const lateral = randRange(-8, 8);
  const rightX = -strikeDirZ;
  const rightZ = strikeDirX;
  const baseX = px + strikeDirX * distance + rightX * lateral;
  const baseZ = pz + strikeDirZ * distance + rightZ * lateral;

  const start = new THREE.Vector3(
    baseX + randRange(-3, 3),
    py + randRange(42, 56),
    baseZ + randRange(-3, 3),
  );
  const end = new THREE.Vector3(
    baseX + randRange(-5, 5),
    py + randRange(4, 10),
    baseZ + randRange(-5, 5),
  );

  const mainSegments = 15;
  const points = [start.clone()];
  for (let i = 1; i <= mainSegments; i++) {
    const t = i / mainSegments;
    const p = new THREE.Vector3().lerpVectors(start, end, t);
    const jag = 5.2 * (1 - t * 0.48);
    p.x += randRange(-jag, jag);
    p.z += randRange(-jag, jag);
    p.y += randRange(-1.6, 1.6);
    points.push(p);
  }

  let segmentIndex = 0;
  const addSegment = (a, b, coreRadius, glowRadius) => {
    if (segmentIndex >= MAX_BOLT_SEGMENTS) return;
    const segment = bolt.segments[segmentIndex++];
    setCylinderBetween(segment.glow, a, b, glowRadius);
    setCylinderBetween(segment.core, a, b, coreRadius);
    segment.glow.visible = true;
    segment.core.visible = true;
  };

  for (let i = 0; i < points.length - 1; i++) {
    const t = i / Math.max(1, points.length - 2);
    addSegment(points[i], points[i + 1], 0.20 - t * 0.07, 0.56 - t * 0.18);

    if (i > 2 && i < points.length - 3 && Math.random() < 0.24) {
      let branchStart = points[i + 1].clone();
      const branchSteps = 2 + Math.floor(Math.random() * 3);
      const branchAngle = Math.atan2(strikeDirZ, strikeDirX) +
        (Math.random() < 0.5 ? -1 : 1) * randRange(0.55, 1.15);
      for (let j = 0; j < branchSteps && segmentIndex < MAX_BOLT_SEGMENTS; j++) {
        const next = branchStart.clone();
        const side = randRange(4.5, 8.5) * (1 - j * 0.18);
        next.x += Math.cos(branchAngle) * side + randRange(-1.5, 1.5);
        next.z += Math.sin(branchAngle) * side + randRange(-1.5, 1.5);
        next.y -= randRange(3.5, 7.0);
        addSegment(branchStart, next, 0.08, 0.25);
        branchStart = next;
      }
    }
  }

  bolt.duration = randRange(0.48, 0.68);
  bolt.life = bolt.duration;
  bolt.coreMaterial.opacity = 1;
  bolt.glowMaterial.opacity = 0.18;
  bolt.group.visible = true;
}

function updateLightningBolt(handle, dt) {
  const bolt = handle?.realLightningBolt;
  if (!bolt) return;

  // Lightning no longer changes the whole scene brightness at all. The storm
  // stays steadily dark; the visible bolt is the only fast lightning event.
  handle.lightningFlash = 0;
  if (handle.lightningLight) handle.lightningLight.intensity = 0;

  if (bolt.life <= 0) {
    bolt.group.visible = false;
    return;
  }

  bolt.life = Math.max(0, bolt.life - dt);
  const remaining = bolt.life / Math.max(0.001, bolt.duration);
  const fade = remaining > 0.62 ? 1 : Math.pow(remaining / 0.62, 1.45);
  bolt.coreMaterial.opacity = fade;
  bolt.glowMaterial.opacity = fade * 0.18;

  if (bolt.life <= 0) bolt.group.visible = false;
}

function strikeEligible(handle) {
  if (!handle) return false;
  const rainNow = !!handle.rainActive || (handle.rainIntensity ?? 0) > 0.10;
  if (handle.biome === "crystal") return rainNow;
  const lp = handle.profile?.lightning;
  if (lp?.onlyDuringRain) return rainNow;
  return true;
}

function suppressLegacyLightning(handle) {
  if (!handle) return;
  handle.lightningTimer = Number.POSITIVE_INFINITY;
  handle.lightningFlash = 0;
  if (handle.lightningLight) handle.lightningLight.intensity = 0;

  const distant = handle.distantLightning;
  if (distant) {
    distant.timer = Number.POSITIVE_INFINITY;
    distant.flash = 0;
    if (distant.sprite) {
      distant.sprite.visible = false;
      if (distant.sprite.material) distant.sprite.material.opacity = 0;
    }
  }
}

function suppressCrystalStormFlicker(handle) {
  if (!handle || handle.biome !== "crystal") return;
  const storming = !!handle.rainActive || (handle.rainIntensity ?? 0) > 0.08;

  // The old reef dapple/refraction effects pulse on sine waves. In clear
  // weather they read as moving sunlight; during a storm they read exactly like
  // the rapid lightning flicker the user is seeing. Hide them completely for
  // the full storm rather than multiplying a still-pulsing opacity by a fade.
  if (handle.crystalDapple?.rays) {
    for (const ray of handle.crystalDapple.rays) {
      ray.sprite.visible = !storming;
      if (storming) ray.sprite.material.opacity = 0;
    }
  }

  if (handle.crystalRefraction?.sprite) {
    handle.crystalRefraction.sprite.visible = !storming;
    if (storming) {
      if (handle.crystalRefraction.sprite.material) {
        handle.crystalRefraction.sprite.material.opacity = 0;
      }
      handle.crystalRefraction.flash = 0;
      handle.crystalRefraction.timer = Math.max(handle.crystalRefraction.timer ?? 0, 4);
    }
  }
}

export function createWeatherSystem(scene, biome) {
  const handle = legacy.createWeatherSystem(scene, biome);
  if (!handle) return handle;

  const color = LIGHTNING_COLORS[biome] ?? handle.profile?.lightning?.color ?? 0xddeeff;
  handle.realLightningBolt = createLightningBolt(scene, color);
  handle.realLightningTimer = randRange(3, 6);
  handle.realLightningWasEligible = false;
  suppressLegacyLightning(handle);
  return handle;
}

// Signature intentionally matches weather_legacy.js.
export function updateWeatherSystem(handle, dt, erupting = false, dayAmount = 0, playerPos = null) {
  if (handle) suppressLegacyLightning(handle);

  const result = legacy.updateWeatherSystem(handle, dt, erupting, dayAmount, playerPos);
  if (!handle) return result;

  // Legacy has just run, so hard-disable every old lightning channel again.
  suppressLegacyLightning(handle);
  suppressCrystalStormFlicker(handle);

  const eligible = strikeEligible(handle);
  const cooldownRange = STRIKE_COOLDOWNS[handle.biome] ?? [20, 36];

  if (eligible && !handle.realLightningWasEligible) {
    handle.realLightningTimer = randRange(1.2, 2.8);
  }
  handle.realLightningWasEligible = eligible;

  if (eligible) {
    handle.realLightningTimer = Math.max(0, (handle.realLightningTimer ?? 0) - dt);
    if (handle.realLightningTimer <= 0) {
      spawnLightningBolt(handle.realLightningBolt, playerPos);
      handle.realLightningTimer = randRange(cooldownRange[0], cooldownRange[1]);
    }
  }

  updateLightningBolt(handle, dt);
  suppressLegacyLightning(handle);
  return result;
}

export function disposeWeatherSystem(scene, handle) {
  const bolt = handle?.realLightningBolt;
  if (bolt) {
    scene.remove(bolt.group);
    scene.remove(bolt.cameraCapture);
    bolt.geometry.dispose();
    bolt.coreMaterial.dispose();
    bolt.glowMaterial.dispose();
    bolt.captureGeometry.dispose();
    bolt.captureMaterial.dispose();
    handle.realLightningBolt = null;
  }
  return legacy.disposeWeatherSystem(scene, handle);
}
