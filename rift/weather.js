import * as THREE from "three";
import * as current from "./weather_storm_base.js";
import { LIQUID_LEVEL } from "./terrain.js";

export * from "./weather_storm_base.js";

// -----------------------------------------------------------------------------
// Realistic distant lightning presentation
// -----------------------------------------------------------------------------
// weather_storm_base.js still owns rain, fog, wind and all non-lightning
// weather behavior. This wrapper owns only the visible lightning strike.
//
// Important: lightning remains depth-tested so trees/terrain can occlude it,
// but it is intentionally NOT fogged. The full-storm fog is dense enough to
// erase a 80-120 unit emissive strike completely. We fake atmospheric distance
// with a restrained glow/opacity instead, while preserving true scene depth.

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _view = new THREE.Vector3();

const STRIKE_COOLDOWNS = {
  ember: [11, 18],
  verdant: [10, 17],
  crystal: [7, 13],
  abyssal: [18, 30],
  ashen: [13, 22],
  frost: [20, 34],
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smooth01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
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
  mesh.visible = true;
}

function configureDepthCorrectBolt(bolt) {
  if (!bolt || bolt.__riftDistantConfigured) return;

  if (bolt.coreMaterial) {
    bolt.coreMaterial.blending = THREE.NormalBlending;
    bolt.coreMaterial.depthTest = true;
    bolt.coreMaterial.depthWrite = false;
    bolt.coreMaterial.fog = false;
    bolt.coreMaterial.toneMapped = false;
    bolt.coreMaterial.opacity = 0;
    bolt.coreMaterial.needsUpdate = true;
  }

  if (bolt.glowMaterial) {
    bolt.glowMaterial.blending = THREE.AdditiveBlending;
    bolt.glowMaterial.depthTest = true;
    bolt.glowMaterial.depthWrite = false;
    bolt.glowMaterial.fog = false;
    bolt.glowMaterial.toneMapped = false;
    bolt.glowMaterial.opacity = 0;
    bolt.glowMaterial.needsUpdate = true;
  }

  if (bolt.group) bolt.group.renderOrder = 0;
  for (const segment of bolt.segments || []) {
    if (segment.core) segment.core.renderOrder = 0;
    if (segment.glow) segment.glow.renderOrder = 0;
  }

  bolt.__riftDistantConfigured = true;
}

function hideAllSegments(bolt) {
  for (const segment of bolt?.segments || []) {
    if (segment.core) segment.core.visible = false;
    if (segment.glow) segment.glow.visible = false;
  }
}

function subdivideBoltPath(a, b, depth, amplitude, out) {
  if (depth <= 0) {
    out.push(a.clone());
    return;
  }

  const midpoint = a.clone().lerp(b, 0.5);
  midpoint.x += randRange(-amplitude, amplitude);
  midpoint.z += randRange(-amplitude, amplitude);
  midpoint.y += randRange(-amplitude * 0.10, amplitude * 0.10);

  subdivideBoltPath(a, midpoint, depth - 1, amplitude * 0.54, out);
  subdivideBoltPath(midpoint, b, depth - 1, amplitude * 0.54, out);
}

function buildMainPath(start, end) {
  const points = [];
  subdivideBoltPath(start, end, 5, 3.1, points);
  points.push(end.clone());
  return points;
}

function rebuildAsDistantStrike(handle, playerPos) {
  const bolt = handle?.realLightningBolt;
  if (!bolt) return;

  configureDepthCorrectBolt(bolt);
  hideAllSegments(bolt);

  const px = Number.isFinite(playerPos?.x) ? playerPos.x : 0;
  const py = Number.isFinite(playerPos?.y) ? playerPos.y : 10;
  const pz = Number.isFinite(playerPos?.z) ? playerPos.z : 0;
  const camera = bolt.camera;

  let forwardX = 0;
  let forwardZ = -1;
  if (camera) {
    camera.getWorldDirection(_view);
    const horizontalLength = Math.hypot(_view.x, _view.z);
    if (horizontalLength > 0.001) {
      forwardX = _view.x / horizontalLength;
      forwardZ = _view.z / horizontalLength;
    }
  }

  // Far enough to sit behind foreground vegetation, but close enough to stay
  // readable on a phone. Clamp against the camera far plane as a safety net.
  const cameraFar = Number.isFinite(camera?.far) ? camera.far : 500;
  const maxDistance = Math.max(82, Math.min(118, cameraFar * 0.36));
  const minDistance = Math.max(68, Math.min(82, maxDistance * 0.72));
  const distance = randRange(minDistance, maxDistance);

  const yaw = randRange(-0.30, 0.30);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const strikeDirX = forwardX * c - forwardZ * s;
  const strikeDirZ = forwardX * s + forwardZ * c;
  const rightX = -strikeDirZ;
  const rightZ = strikeDirX;
  const lateral = randRange(-11, 11);

  const strikeX = px + strikeDirX * distance + rightX * lateral;
  const strikeZ = pz + strikeDirZ * distance + rightZ * lateral;

  const liquidY = LIQUID_LEVEL?.[handle.biome];
  const strikeY = Number.isFinite(liquidY)
    ? liquidY + 0.4
    : py - randRange(2.0, 6.0);

  // Keep the full channel more likely to fit inside the phone's vertical FOV.
  // At ~80-115 units away a 48-62 unit channel still reads as a tall, distant
  // cloud-to-ground strike without putting its entire upper half off-screen.
  const channelHeight = randRange(48, 62);
  const cloudY = Math.max(strikeY + channelHeight, py + 44);

  const start = new THREE.Vector3(
    strikeX + randRange(-1.8, 1.8),
    cloudY,
    strikeZ + randRange(-1.8, 1.8),
  );
  const end = new THREE.Vector3(
    strikeX + randRange(-1.0, 1.0),
    strikeY,
    strikeZ + randRange(-1.0, 1.0),
  );
  const points = buildMainPath(start, end);

  let segmentIndex = 0;
  const addSegment = (a, b, coreRadius, glowRadius) => {
    if (segmentIndex >= (bolt.segments?.length || 0)) return false;
    const segment = bolt.segments[segmentIndex++];
    setCylinderBetween(segment.glow, a, b, glowRadius);
    setCylinderBetween(segment.core, a, b, coreRadius);
    return true;
  };

  for (let i = 0; i < points.length - 1; i++) {
    const t = i / Math.max(1, points.length - 2);
    const coreRadius = THREE.MathUtils.lerp(0.125, 0.060, t);
    addSegment(points[i], points[i + 1], coreRadius, coreRadius * 3.0);
  }

  const branchCount = 3 + Math.floor(Math.random() * 3);
  for (let branch = 0; branch < branchCount && segmentIndex < bolt.segments.length; branch++) {
    const minIndex = Math.floor(points.length * 0.25);
    const maxIndex = Math.floor(points.length * 0.76);
    const anchorIndex = minIndex + Math.floor(Math.random() * Math.max(1, maxIndex - minIndex));
    let cursor = points[anchorIndex].clone();
    const branchAngle = Math.atan2(strikeDirZ, strikeDirX) +
      (Math.random() < 0.5 ? -1 : 1) * randRange(0.72, 1.24);
    const steps = 3 + Math.floor(Math.random() * 3);
    const totalReach = randRange(9, 19);

    for (let step = 0; step < steps && segmentIndex < bolt.segments.length; step++) {
      const next = cursor.clone();
      const stepReach = totalReach / steps;
      const taper = 1 - step / Math.max(1, steps);
      next.x += Math.cos(branchAngle) * stepReach + randRange(-0.9, 0.9);
      next.z += Math.sin(branchAngle) * stepReach + randRange(-0.9, 0.9);
      next.y -= randRange(2.1, 4.4);
      const branchRadius = 0.040 * (0.68 + taper * 0.32);
      addSegment(cursor, next, branchRadius, branchRadius * 2.7);
      cursor = next;
    }
  }

  bolt.__riftVisualAge = 0;
  bolt.__riftStrikeDistance = distance;
  bolt.__riftStrikeEnd = end.clone();
  bolt.duration = 0.52;
  bolt.life = bolt.duration;
  bolt.group.visible = true;
}

function applyReturnStrokeEnvelope(handle, dt) {
  const bolt = handle?.realLightningBolt;
  if (!bolt || !bolt.group?.visible || !(bolt.life > 0)) return;

  bolt.__riftVisualAge = (bolt.__riftVisualAge || 0) + Math.max(0, Number(dt) || 0);
  const age = bolt.__riftVisualAge;

  let intensity;
  if (age < 0.045) {
    intensity = smooth01(age / 0.018);
  } else if (age < 0.095) {
    intensity = THREE.MathUtils.lerp(1.0, 0.24, smooth01((age - 0.045) / 0.050));
  } else if (age < 0.155) {
    intensity = THREE.MathUtils.lerp(0.24, 0.72, smooth01((age - 0.095) / 0.060));
  } else {
    intensity = 0.72 * (1 - smooth01((age - 0.155) / 0.30));
  }
  intensity = clamp01(intensity);

  if (bolt.coreMaterial) bolt.coreMaterial.opacity = intensity;
  if (bolt.glowMaterial) bolt.glowMaterial.opacity = intensity * 0.16;
}

function strikeEligible(handle) {
  if (!handle) return false;
  const rainNow = !!handle.rainActive || (handle.rainIntensity ?? 0) > 0.10;
  if (handle.biome === "crystal") return rainNow;
  const lp = handle.profile?.lightning;
  return lp?.onlyDuringRain ? rainNow : !!lp;
}

function disableBaseVisibleBoltTimer(handle) {
  if (!handle) return;
  handle.realLightningTimer = Number.POSITIVE_INFINITY;
  // Prevent weather_storm_base.js from treating this frame as a new eligibility
  // edge and overwriting Infinity with its own timer. This wrapper owns cadence.
  handle.realLightningWasEligible = true;
}

export function createWeatherSystem(scene, biome) {
  const handle = current.createWeatherSystem(scene, biome);
  configureDepthCorrectBolt(handle?.realLightningBolt);
  if (handle) {
    handle.__riftDistantStrikeTimer = randRange(0.9, 1.7);
    handle.__riftDistantStrikeWasEligible = false;
  }
  return handle;
}

export function updateWeatherSystem(
  handle,
  dt,
  erupting = false,
  dayAmount = 0,
  playerPos = null,
) {
  disableBaseVisibleBoltTimer(handle);

  const result = current.updateWeatherSystem(handle, dt, erupting, dayAmount, playerPos);

  const bolt = handle?.realLightningBolt;
  if (!bolt) return result;
  configureDepthCorrectBolt(bolt);

  const eligible = strikeEligible(handle);
  if (eligible && !handle.__riftDistantStrikeWasEligible) {
    // Guarantee a visible strike soon after the storm starts. This makes the
    // effect testable and avoids depending on the legacy 12-22 second timer.
    handle.__riftDistantStrikeTimer = randRange(0.8, 1.6);
  }
  handle.__riftDistantStrikeWasEligible = eligible;

  const active = !!(bolt.group?.visible && bolt.life > 0);
  if (eligible && !active) {
    handle.__riftDistantStrikeTimer = Math.max(
      0,
      (Number(handle.__riftDistantStrikeTimer) || 0) - Math.max(0, Number(dt) || 0),
    );

    if (handle.__riftDistantStrikeTimer <= 0) {
      rebuildAsDistantStrike(handle, playerPos);
      const range = STRIKE_COOLDOWNS[handle.biome] ?? [11, 20];
      handle.__riftDistantStrikeTimer = randRange(range[0], range[1]);
    }
  }

  if (bolt.group?.visible && bolt.life > 0) {
    applyReturnStrokeEnvelope(handle, dt);
  } else {
    bolt.__riftVisualAge = 0;
  }

  // Keep the old whole-scene flash disabled. Only the spatial bolt changes
  // rapidly, so the reflection/flicker fix remains intact.
  handle.lightningFlash = 0;
  if (handle.lightningLight) handle.lightningLight.intensity = 0;

  return result;
}

export function disposeWeatherSystem(scene, handle) {
  return current.disposeWeatherSystem(scene, handle);
}
