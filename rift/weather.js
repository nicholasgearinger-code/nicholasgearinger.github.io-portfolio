import * as THREE from "three";
import * as current from "./weather_storm_base.js";
import { LIQUID_LEVEL } from "./terrain.js";

export * from "./weather_storm_base.js";

// -----------------------------------------------------------------------------
// Realistic distant lightning presentation
// -----------------------------------------------------------------------------
// The preserved weather_storm_base.js module still owns all weather timing,
// rain, fog, storm eligibility, and cleanup. This wrapper only replaces the
// visual presentation of each spawned bolt after the base module creates it.
//
// Goals:
//   - world-space strikes far from the player instead of a foreground overlay
//   - normal depth testing so trees/terrain can occlude the bolt
//   - thinner, vertically-biased leader with restrained side branches
//   - atmospheric fog/tone mapping so distant strikes sit inside the scene
//   - a short double-return-stroke envelope without reintroducing scene flashes

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const _mid = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _view = new THREE.Vector3();

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

  // The old bolt intentionally behaved like an overlay: additive blending,
  // depthTest=false, fog=false and renderOrder ~950. That is why it could draw
  // across palms and other foreground silhouettes. Treat it as real geometry.
  if (bolt.coreMaterial) {
    bolt.coreMaterial.blending = THREE.NormalBlending;
    bolt.coreMaterial.depthTest = true;
    bolt.coreMaterial.depthWrite = false;
    bolt.coreMaterial.fog = true;
    bolt.coreMaterial.toneMapped = true;
    bolt.coreMaterial.opacity = 0;
    bolt.coreMaterial.needsUpdate = true;
  }

  if (bolt.glowMaterial) {
    bolt.glowMaterial.blending = THREE.AdditiveBlending;
    bolt.glowMaterial.depthTest = true;
    bolt.glowMaterial.depthWrite = false;
    bolt.glowMaterial.fog = true;
    bolt.glowMaterial.toneMapped = true;
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

  // Most real cloud-to-ground leaders are strongly vertical. Keep the large
  // displacement horizontal and use only a little vertical noise so the path
  // forks naturally without turning into the old screen-filling zig-zag.
  midpoint.x += randRange(-amplitude, amplitude);
  midpoint.z += randRange(-amplitude, amplitude);
  midpoint.y += randRange(-amplitude * 0.12, amplitude * 0.12);

  subdivideBoltPath(a, midpoint, depth - 1, amplitude * 0.54, out);
  subdivideBoltPath(midpoint, b, depth - 1, amplitude * 0.54, out);
}

function buildMainPath(start, end) {
  const points = [];
  subdivideBoltPath(start, end, 5, 3.4, points);
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

  // Keep strikes inside the active camera's far plane while pushing them well
  // past nearby vegetation. On normal Rift camera settings this yields roughly
  // 95-150 world units, versus the old 34-50 units.
  const cameraFar = Number.isFinite(camera?.far) ? camera.far : 500;
  const maxDistance = Math.max(82, Math.min(150, cameraFar * 0.42));
  const minDistance = Math.max(68, Math.min(96, maxDistance * 0.72));
  const distance = randRange(minDistance, maxDistance);

  // Keep the strike somewhere in the current field of view but not pinned to
  // screen center. A little lateral offset makes repeated strikes feel spatial.
  const yaw = randRange(-0.34, 0.34);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const strikeDirX = forwardX * c - forwardZ * s;
  const strikeDirZ = forwardX * s + forwardZ * c;
  const rightX = -strikeDirZ;
  const rightZ = strikeDirX;
  const lateral = randRange(-14, 14);

  const strikeX = px + strikeDirX * distance + rightX * lateral;
  const strikeZ = pz + strikeDirZ * distance + rightZ * lateral;

  const liquidY = LIQUID_LEVEL?.[handle.biome];
  const strikeY = Number.isFinite(liquidY)
    ? liquidY + 0.35
    : py - randRange(2.5, 7.5);
  const cloudY = Math.max(strikeY + randRange(68, 88), py + randRange(58, 74));

  const start = new THREE.Vector3(
    strikeX + randRange(-2.0, 2.0),
    cloudY,
    strikeZ + randRange(-2.0, 2.0),
  );
  const end = new THREE.Vector3(
    strikeX + randRange(-1.2, 1.2),
    strikeY,
    strikeZ + randRange(-1.2, 1.2),
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

  // Thin trunk that tapers toward the ground. The faint halo stays only a few
  // times wider than the core, closer to the photographic reference.
  for (let i = 0; i < points.length - 1; i++) {
    const t = i / Math.max(1, points.length - 2);
    const coreRadius = THREE.MathUtils.lerp(0.095, 0.050, t);
    addSegment(points[i], points[i + 1], coreRadius, coreRadius * 2.8);
  }

  // Add a small number of thin side leaders. They grow outward and downward
  // from the middle/lower trunk rather than forming large symmetric zig-zags.
  const branchCount = 2 + Math.floor(Math.random() * 3);
  for (let branch = 0; branch < branchCount && segmentIndex < bolt.segments.length; branch++) {
    const minIndex = Math.floor(points.length * 0.28);
    const maxIndex = Math.floor(points.length * 0.78);
    const anchorIndex = minIndex + Math.floor(Math.random() * Math.max(1, maxIndex - minIndex));
    let cursor = points[anchorIndex].clone();
    const branchAngle = Math.atan2(strikeDirZ, strikeDirX) +
      (Math.random() < 0.5 ? -1 : 1) * randRange(0.72, 1.28);
    const steps = 3 + Math.floor(Math.random() * 3);
    const totalReach = randRange(10, 22);

    for (let step = 0; step < steps && segmentIndex < bolt.segments.length; step++) {
      const next = cursor.clone();
      const stepReach = totalReach / steps;
      const taper = 1 - step / Math.max(1, steps);
      next.x += Math.cos(branchAngle) * stepReach + randRange(-1.1, 1.1);
      next.z += Math.sin(branchAngle) * stepReach + randRange(-1.1, 1.1);
      next.y -= randRange(2.4, 5.0);
      const branchRadius = 0.034 * (0.7 + taper * 0.3);
      addSegment(cursor, next, branchRadius, branchRadius * 2.5);
      cursor = next;
    }
  }

  bolt.__riftVisualAge = 0;
  bolt.__riftStrikeDistance = distance;
  bolt.__riftStrikeEnd = end.clone();

  // Keep the visible channel brief. The base timer still owns the cadence;
  // this only shortens the already-spawned geometry's presentation lifetime.
  bolt.duration = Math.min(Number(bolt.duration) || 0.42, 0.42);
  bolt.life = Math.min(Number(bolt.life) || bolt.duration, bolt.duration);
  bolt.group.visible = true;
}

function applyReturnStrokeEnvelope(handle, dt) {
  const bolt = handle?.realLightningBolt;
  if (!bolt || !bolt.group?.visible || !(bolt.life > 0)) return;

  bolt.__riftVisualAge = (bolt.__riftVisualAge || 0) + Math.max(0, Number(dt) || 0);
  const age = bolt.__riftVisualAge;

  // A bright initial leader, a tiny dip, then one weaker return stroke and a
  // fast decay. Only the bolt materials pulse; scene lighting remains steady.
  let intensity;
  if (age < 0.035) {
    intensity = smooth01(age / 0.018);
  } else if (age < 0.080) {
    intensity = THREE.MathUtils.lerp(1.0, 0.28, smooth01((age - 0.035) / 0.045));
  } else if (age < 0.125) {
    intensity = THREE.MathUtils.lerp(0.28, 0.68, smooth01((age - 0.080) / 0.045));
  } else {
    intensity = 0.68 * (1 - smooth01((age - 0.125) / 0.22));
  }
  intensity = clamp01(intensity);

  if (bolt.coreMaterial) bolt.coreMaterial.opacity = intensity * 0.88;
  if (bolt.glowMaterial) bolt.glowMaterial.opacity = intensity * 0.105;
}

export function createWeatherSystem(scene, biome) {
  const handle = current.createWeatherSystem(scene, biome);
  configureDepthCorrectBolt(handle?.realLightningBolt);
  return handle;
}

export function updateWeatherSystem(
  handle,
  dt,
  erupting = false,
  dayAmount = 0,
  playerPos = null,
) {
  const boltBefore = handle?.realLightningBolt;
  const wasVisible = !!(boltBefore?.group?.visible && boltBefore.life > 0);

  const result = current.updateWeatherSystem(handle, dt, erupting, dayAmount, playerPos);

  const bolt = handle?.realLightningBolt;
  if (!bolt) return result;
  configureDepthCorrectBolt(bolt);

  const isVisible = !!(bolt.group?.visible && bolt.life > 0);
  if (isVisible && !wasVisible) {
    rebuildAsDistantStrike(handle, playerPos);
  }

  if (bolt.group?.visible && bolt.life > 0) {
    applyReturnStrokeEnvelope(handle, dt);
  } else {
    bolt.__riftVisualAge = 0;
  }

  // Never re-enable the old whole-scene lightning flash. The photographic
  // realism comes from spatial depth, fog, shape and the bolt's own return
  // stroke rather than flashing the entire frame.
  handle.lightningFlash = 0;
  if (handle.lightningLight) handle.lightningLight.intensity = 0;

  return result;
}

export function disposeWeatherSystem(scene, handle) {
  return current.disposeWeatherSystem(scene, handle);
}
