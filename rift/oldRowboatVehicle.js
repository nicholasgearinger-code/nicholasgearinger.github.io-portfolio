import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { emitRiftWaterImpact } from "./waterLabInteractions.js";

// This is the authored model already in the Rift repository, not a primitive
// placeholder. Load only when Coral Shallows starts (12 MB GLB).
const MODEL_URL = new URL("./models/old_rowboat.glb", import.meta.url).href;
const G = 9.81;
const RHO = 1025;
const BOARD_RADIUS = 7.0; // reachable at the spawn beach without swimming far
const MAX_STEP = 1 / 50; // stable even when mobile rendering is slow
const RIDER_MASS = 85;
let cachedModelPromise = null;

function loadModel() {
  if (!cachedModelPromise) {
    cachedModelPromise = new GLTFLoader().loadAsync(MODEL_URL).catch(error => {
      cachedModelPromise = null; // permit retry next time the biome loads
      throw error;
    });
  }
  return cachedModelPromise;
}

function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

// The ocean solves FFT displacement on the GPU; this matches its broad
// wind/swell motion on the CPU without any GPU-to-CPU stalls. Fine FFT
// detail and breaking-wave geometry are not physically sampled here.
const SWELLS = [
  [0.041, 0.014, 0.48, 0.66],
  [0.016, -0.067, 0.28, 1.14],
  [-0.082, 0.026, 0.16, 1.47],
  [0.127, 0.091, 0.085, 2.11],
];
export function sampleRowboatWater(handle, x, z, time) {
  if (!handle) return 0;
  const storm = clamp(handle.stormAmount?.value ?? 0, 0, 1);
  const amplitude = 1 + 0.28 * storm;
  let y = handle.waterY ?? 0;
  for (const wave of SWELLS) {
    const [kx, kz, a, speed] = wave;
    y += a * amplitude * Math.sin(kx * x + kz * z - time * speed);
  }
  return y;
}

/**
 * Local free-surface height, velocity, acceleration and slope.
 * Uses the same analytic wave bands as sampleRowboatWater, so the fluid
 * pressure calculation and the waterline test cannot disagree about time.
 * All four values are written into a reused cell object (no frame garbage).
 *
 * This is still a low-frequency CPU proxy of the FFT ocean. We deliberately
 * avoid reading GPU textures on iPhone, which would stall the renderer.
 */
export function sampleRowboatWaterKinematics(handle, x, z, time, out = {}) {
  const storm = clamp(handle?.stormAmount?.value ?? 0, 0, 1);
  const gain = 1 + 0.28 * storm;
  let height = handle?.waterY ?? 0;
  let velocityY = 0, accelerationY = 0, slopeX = 0, slopeZ = 0;
  for (let i = 0; i < SWELLS.length; i++) {
    const [kx, kz, amplitude, omega] = SWELLS[i];
    const phase = kx * x + kz * z - time * omega;
    const s = Math.sin(phase), co = Math.cos(phase);
    const a = amplitude * gain;
    height += a * s;
    velocityY -= a * omega * co;
    accelerationY -= a * omega * omega * s;
    slopeX += a * kx * co;
    slopeZ += a * kz * co;
  }
  out.height = height;
  out.velocityY = velocityY;
  out.accelerationY = accelerationY;
  out.slopeX = slopeX;
  out.slopeZ = slopeZ;
  return out;
}

// Align the GLB's longest horizontal dimension with boat-local +X,
// uniformly scale it to a world-sized hull, and center the physics pivot.
function buildVisual(gltf) {
  const root = new THREE.Group();
  const model = gltf.scene.clone(true);
  const visual = new THREE.Group();
  visual.add(model);
  root.add(visual);
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(visual);
  if (bounds.isEmpty()) throw new Error("Old rowboat GLB has no renderable geometry");
  const size = bounds.getSize(new THREE.Vector3());
  if (size.z > size.x * 1.15) {
    model.rotation.y += Math.PI / 2;
    model.updateMatrixWorld(true);
  }
  const straight = new THREE.Box3().setFromObject(visual);
  const maxLength = straight.getSize(new THREE.Vector3()).x;
  if (!Number.isFinite(maxLength) || maxLength < 0.00001) throw new Error("Old rowboat GLB has invalid bounds");
  visual.scale.setScalar(4.1 / maxLength);
  visual.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(visual);
  const center = scaled.getCenter(new THREE.Vector3());
  const dims = scaled.getSize(new THREE.Vector3());
  visual.position.sub(center);
  visual.updateMatrixWorld(true);
  model.traverse(node => {
    if (node.isMesh) {
      node.castShadow = true;
      node.receiveShadow = false; // cheaper on mobile, preserves glTF materials
      node.frustumCulled = true;
    }
  });
  return {
    root,
    length: clamp(dims.x, 2.5, 5.2),
    beam: clamp(dims.z, 0.9, 2.6),
    hullHeight: clamp(dims.y * 0.72, 0.45, 1.1),
    visualHeight: dims.y,
  };
}

function makeWake(scene) {
  return [-1, 1].map(side => {
    const positions = new Float32Array(10 * 3);
    const geometry = new THREE.BufferGeometry();
    const attribute = new THREE.BufferAttribute(positions, 3);
    attribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("position", attribute);
    const material = new THREE.LineBasicMaterial({
      color: 0xd6fffa, transparent: true, opacity: 0.45, depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    line.renderOrder = 3;
    scene.add(line);
    return { side, positions, geometry, attribute, material, line };
  });
}

function clearWake(scene, wake) {
  for (const w of wake || []) {
    scene.remove(w.line);
    w.geometry.dispose();
    w.material.dispose();
  }
}

/**
 * Locate the shoreline that is approached from the actual player start.
 * Coral Shallows' beach cove opens in +Z from spawn; prefer this beach
 * and only search other directions when it is not a viable shoreline.
 *
 * Returns the boat center in safely submerged water, 5-10 m from the
 * waterline, rather than an arbitrary deep-water ring around the player.
 * Terrain is sampled only once on level load, never during rendering.
 */
export function findRowboatSpawnNearShore(getGroundHeight, waterY, spawnX, spawnZ) {
  if (typeof getGroundHeight !== "function" ||
      ![waterY, spawnX, spawnZ].every(Number.isFinite)) return null;

  // Boat aligns lengthwise with the waterward direction. Check the stern
  // and both sides so the submerged hull cannot spawn halfway into sand.
  function hullHasClearance(x, z, dx, dz) {
    const sideX = -dz, sideZ = dx;
    let minDepth = Infinity;
    for (const fore of [-2.35, 0, 2.35]) {
      for (const side of [-1.05, 0, 1.05]) {
        const h = getGroundHeight(x + dx * fore + sideX * side,
          z + dz * fore + sideZ * side);
        if (!Number.isFinite(h)) return false;
        minDepth = Math.min(minDepth, waterY - h);
      }
    }
    return minDepth >= 0.95;
  }

  function tryDirection(dx, dz) {
    const startY = getGroundHeight(spawnX, spawnZ);
    if (!Number.isFinite(startY) || startY <= waterY - 0.15) return null;
    const step = 2.5;
    let prevDistance = 0, prevHeight = startY;
    let steepness = 0;

    for (let distance = step; distance <= 105; distance += step) {
      const x = spawnX + dx * distance, z = spawnZ + dz * distance;
      const height = getGroundHeight(x, z);
      if (!Number.isFinite(height)) break;
      // Prefer approachable beach paths over steep, cliff-like dropoffs.
      if (prevHeight > waterY && height > waterY) {
        steepness += Math.max(0, Math.abs(prevHeight - height) / step - 0.35);
      }
      if (prevHeight >= waterY && height < waterY - 0.15) {
        // Refine the land/water crossing for a stable center offset.
        let low = prevDistance, high = distance;
        for (let i = 0; i < 5; i++) {
          const middle = (low + high) * 0.5;
          const h = getGroundHeight(spawnX + dx * middle, spawnZ + dz * middle);
          if (!Number.isFinite(h)) return null;
          if (h >= waterY) low = middle;
          else high = middle;
        }
        const shoreDistance = (low + high) * 0.5;
        for (const offshore of [4.5, 5.2, 5.8, 6.8, 8, 10, 12]) {
          const cx = spawnX + dx * (shoreDistance + offshore);
          const cz = spawnZ + dz * (shoreDistance + offshore);
          if (Math.hypot(cx, cz) > 190) continue;
          if (!hullHasClearance(cx, cz, dx, dz)) continue;
          const depth = waterY - getGroundHeight(cx, cz);
          return {
            x: cx, z: cz, shoreDistance, offshore, depth,
            // Hull local +X is its forward direction; aim out to sea.
            yaw: Math.atan2(-dz, dx),
            score: shoreDistance + offshore * 0.8 + steepness * 12,
          };
        }
        return null;
      }
      prevDistance = distance;
      prevHeight = height;
    }
    return null;
  }

  // The guaranteed beach opening is toward +Z, directly ahead of the
  // Coral Shallows spawn camera, so use it when navigable.
  const cove = tryDirection(0, 1);
  if (cove) return cove;
  let nearest = null;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const candidate = tryDirection(Math.cos(a), Math.sin(a));
    if (candidate && (!nearest || candidate.score < nearest.score)) nearest = candidate;
  }
  return nearest;
}

/**
 * Conservative minimum pivot height for a floating hull, not a substitute
 * for FFT readback. The near-shore GPU solver can generate crests up to
 * roughly 0.95 world units above its static waterline. The previous CPU
 * swell approximation could fall below that and let the entire gunwale
 * disappear. This enforces freeboard at the LOWEST side of the angled rim.
 *
 * The hull is still partly immersed: the floor sits near the visual keel at
 * calm water, rather than artificially lifting the whole boat far offshore.
 */
export function minimumRowboatPivotHeight({
  waterY, sampleMax, visualHeight, length, beam, pitch, roll, storm = 0,
  minFreeboard = 0.16,
}) {
  const safeSurface = Math.max(
    Number.isFinite(sampleMax) ? sampleMax : waterY,
    waterY + 0.70 + clamp(storm, 0, 1) * 0.17,
  );
  // Lower of the two side gunwales / bow-stern corners in rough seas.
  const uprightRim = visualHeight * 0.5 * Math.cos(pitch) * Math.cos(roll);
  const lowerRim = uprightRim -
    Math.abs(Math.sin(pitch)) * length * 0.39 -
    Math.abs(Math.sin(roll)) * beam * 0.41;
  return safeSurface + minFreeboard - lowerRim;
}

export function createOldRowboatVehicle({
  scene, camera, viewport, keys, isActive, isTouchDevice,
  getGroundHeight, eyeHeight, playerPhysics, onMessage, isDroneMode,
}) {
  if (getComputedStyle(viewport).position === "static") viewport.style.position = "relative";
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.riftRowboatAction = "";
  button.style.cssText = [
    "display:none", "position:absolute", "left:50%", "bottom:84px",
    "transform:translateX(-50%)", "z-index:92", "touch-action:manipulation",
    "pointer-events:auto", "padding:13px 22px", "min-height:50px",
    "color:#ecfffa", "background:rgba(8,47,64,.94)",
    "border:2px solid #b0e8df", "border-radius:999px",
    "font:700 15px system-ui,sans-serif", "box-shadow:0 5px 20px #0009",
  ].join(";");
  const hint = document.createElement("div");
  hint.dataset.riftRowboatAction = "";
  hint.style.cssText = [
    "display:none", "position:absolute", "left:50%", "top:70px",
    "transform:translateX(-50%)", "z-index:91", "pointer-events:none",
    "font:600 12px/1.4 system-ui,sans-serif", "text-align:center",
    "padding:8px 12px", "border-radius:12px", "white-space:nowrap",
    "background:rgba(9,42,58,.85)", "color:#eafff6",
  ].join(";");
  // Dedicated, large touch controls while rowing. The walking joystick,
  // jump and fire HUD are hidden only during this mode, not removed.
  const controlStyle = document.createElement("style");
  controlStyle.textContent = `
    .rift-rowboat-driving #rift-touch-joystick,
    .rift-rowboat-driving #rift-touch-fire,
    .rift-rowboat-driving #rift-touch-up,
    .rift-rowboat-driving #rift-touch-down { opacity:0!important; pointer-events:none!important; }
    .rift-rowboat-hud { display:none; position:absolute; left:0; right:0; bottom:12px;
      z-index:95; pointer-events:none; align-items:end; justify-content:space-between;
      gap:8px; padding:0 12px; font:600 12px system-ui,sans-serif; color:white; }
    .rift-rowboat-pad { display:flex; flex-direction:column; gap:5px; min-width:0; pointer-events:none; }
    .rift-rowboat-pad > span { text-align:center; color:#d8fff8; text-shadow:0 1px 3px #000; }
    .rift-rowboat-keys { display:flex; gap:6px; pointer-events:none; }
    .rift-rowboat-keys button { display:flex; align-items:center; justify-content:center;
      touch-action:none; pointer-events:auto; border:1px solid #a7f4ef;
      border-radius:15px; min-width:61px; height:62px; padding:0 9px;
      background:rgba(9,48,61,.88); color:#ecffff; font:700 15px system-ui,sans-serif;
      box-shadow:0 3px 12px #0008; user-select:none; -webkit-user-select:none; }
    .rift-rowboat-keys button:active, .rift-rowboat-keys button[data-held="1"] {
      background:rgba(52,157,161,.98); transform:scale(.97); }
    .rift-rowboat-speed { align-self:end; pointer-events:none; white-space:nowrap;
      text-align:center; margin-bottom:8px; color:#e8fffa; font-size:11px; }
    @media (max-width:370px) {
      .rift-rowboat-hud { padding:0 6px; gap:4px; }
      .rift-rowboat-keys button { min-width:53px; height:58px; font-size:13px; }
    }
  `;
  document.head.appendChild(controlStyle);
  const controlsHUD = document.createElement("div");
  controlsHUD.className = "rift-rowboat-hud";
  controlsHUD.dataset.riftRowboatAction = "";
  const leftPad = document.createElement("div");
  leftPad.className = "rift-rowboat-pad";
  const leftCaption = document.createElement("span");
  leftCaption.textContent = "STEER";
  const leftButtons = document.createElement("div");
  leftButtons.className = "rift-rowboat-keys";
  const rightPad = document.createElement("div");
  rightPad.className = "rift-rowboat-pad";
  const rightCaption = document.createElement("span");
  rightCaption.textContent = "ROW";
  const rightButtons = document.createElement("div");
  rightButtons.className = "rift-rowboat-keys";
  const speedDisplay = document.createElement("div");
  speedDisplay.className = "rift-rowboat-speed";
  speedDisplay.textContent = "0.0 m/s";
  leftPad.append(leftCaption, leftButtons);
  rightPad.append(rightCaption, rightButtons);
  controlsHUD.append(leftPad, speedDisplay, rightPad);
  const held = { left: false, right: false, forward: false, back: false };
  const clearHeld = () => {
    for (const key of Object.keys(held)) held[key] = false;
    for (const element of controlsHUD.querySelectorAll("button")) element.removeAttribute("data-held");
  };
  function createHoldButton(group, label, key, description) {
    const target = document.createElement("button");
    target.type = "button";
    target.textContent = label;
    target.setAttribute("aria-label", description);
    const release = event => {
      if (event) event.preventDefault();
      held[key] = false;
      target.removeAttribute("data-held");
    };
    target.addEventListener("pointerdown", event => {
      event.preventDefault();
      event.stopPropagation();
      if (!isActive()) return;
      held[key] = true;
      target.dataset.held = "1";
      target.setPointerCapture?.(event.pointerId);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      target.addEventListener(type, release);
    }
    group.appendChild(target);
  }
  createHoldButton(leftButtons, "◀", "left", "Turn rowboat left");
  createHoldButton(leftButtons, "▶", "right", "Turn rowboat right");
  createHoldButton(rightButtons, "▲", "forward", "Row forward");
  createHoldButton(rightButtons, "▼", "back", "Row backward");
  viewport.append(button, hint, controlsHUD);

  let levelVersion = 0;
  let boat = null;
  let riding = false;
  let previousYaw = 0;
  const followTarget = new THREE.Vector3();
  const seatOffset = new THREE.Vector3();
  const sampleOffsets = [-1, 0, 1];
  const sampleTimeFallback = () => performance.now() * 0.001;

  function nearEnough() {
    if (!boat || !isActive() || isDroneMode()) return false;
    const p = boat.root.position;
    const dx = camera.position.x - p.x;
    const dz = camera.position.z - p.z;
    return dx * dx + dz * dz < BOARD_RADIUS * BOARD_RADIUS &&
      Math.abs(camera.position.y - p.y) < 4.3;
  }

  function updateHUD() {
    const active = boat && isActive() && !isDroneMode();
    controlsHUD.style.display = riding && active && isTouchDevice ? "flex" : "none";
    document.documentElement.classList.toggle("rift-rowboat-driving", !!(riding && active && isTouchDevice));
    const canBoard = active && (riding || nearEnough());
    button.style.display = canBoard ? "block" : "none";
    hint.style.display = riding && !isTouchDevice ? "block" : "none";
    if (riding && boat) {
      const speed = Math.hypot(boat.vx, boat.vz);
      speedDisplay.textContent = speed.toFixed(1) + " m/s";
    }
    button.style.bottom = riding ? (isTouchDevice ? "156px" : "28px") : (isTouchDevice ? "150px" : "30px");
    if (canBoard) {
      const label = riding ? "Exit Rowboat" : (isTouchDevice ? "Ride Rowboat" : "Ride Rowboat [E]");
      if (button.textContent !== label) button.textContent = label;
    }
    if (riding) {
      const label = isTouchDevice
        ? "ROWBOAT  •  Joystick ↑↓ row  ←→ turn"
        : "ROWBOAT  •  W/S row  A/D steer  E exit";
      if (hint.textContent !== label) hint.textContent = label;
    }
  }

  function followCamera(dt, instant = false) {
    if (!riding || !boat) return;
    const p = boat.root.position;
    const yaw = boat.root.rotation.y;
    const deltaYaw = yaw - previousYaw;
    camera.rotation.y += deltaYaw;
    previousYaw = yaw;
    // Occupant's viewpoint from inside the hull, just above the gunwale.
    // The seat follows heave and a fraction of pitch/roll without a floating
    // chase view or uncomfortable full camera roll.
    seatOffset.set(-boat.length * 0.19, Math.max(0.62, boat.visualHeight * 0.66), 0);
    seatOffset.applyEuler(boat.root.rotation);
    followTarget.copy(p).add(seatOffset);
    camera.position.lerp(followTarget, instant ? 1 : 1 - Math.exp(-12 * dt));
    camera.rotation.z = clamp(boat.root.rotation.x * 0.12, -0.045, 0.045);
  }

  function board() {
    if (!nearEnough()) return false;
    riding = true;
    previousYaw = boat.root.rotation.y;
    camera.rotation.order = "YXZ";
    camera.rotation.set(-0.13, previousYaw - Math.PI / 2, 0);
    followCamera(1, true);
    playerPhysics.verticalVelocity = 0;
    playerPhysics.grounded = false;
    clearHeld();
    window.dispatchEvent(new Event("rift-camera-reset-look"));
    onMessage?.("In rowboat — face forward and row with the controls.");
    updateHUD();
    return true;
  }

  function exit() {
    if (!riding || !boat) return false;
    riding = false;
    boat.throttle = 0;
    boat.steering = 0;
    boat.handle.__riftRowboatWake = null;
    clearHeld();
    const p = boat.root.position, yaw = boat.root.rotation.y;
    const side = boat.beam / 2 + 1.7;
    const points = [1, -1].map(s => {
      const x = p.x + Math.sin(yaw) * side * s;
      const z = p.z + Math.cos(yaw) * side * s;
      return { x, z, ground: getGroundHeight(x, z) };
    });
    points.sort((a, b) => b.ground - a.ground);
    const spot = points[0];
    const sea = boat.handle.waterY;
    const shore = Number.isFinite(spot.ground) && spot.ground >= sea - 0.35;
    camera.position.set(spot.x, shore ? spot.ground + eyeHeight + 0.12 : sea - 0.22, spot.z);
    camera.rotation.x = -0.12;
    camera.rotation.z = 0;
    playerPhysics.verticalVelocity = 0;
    playerPhysics.grounded = false;
    window.dispatchEvent(new Event("rift-camera-reset-look"));
    onMessage?.("Exited rowboat.");
    updateHUD();
    return true;
  }

  function toggleRide() {
    return riding ? exit() : board();
  }

  function stopLevel() {
    levelVersion++;
    riding = false;
    clearHeld();
    document.documentElement.classList.remove("rift-rowboat-driving");
    controlsHUD.style.display = "none";
    button.style.display = "none";
    hint.style.display = "none";
    if (boat) {
      boat.handle.__riftRowboatWake = null;
      scene.remove(boat.root);
      clearWake(scene, boat.wake);
      // GLTFLoader's cached geometry/materials remain shared and reusable.
      boat = null;
    }
  }

  async function startLevel(biome, waterHandle, spawnPosition) {
    stopLevel();
    if (biome !== "crystal" || !waterHandle?.gpuFFT) return;
    const thisLevel = levelVersion;
    const waterY = Number(waterHandle.waterY) || 0;
    // Place the boat just offshore of the actual spawn-side beach.
    const spot = findRowboatSpawnNearShore(
      getGroundHeight, waterY, spawnPosition.x, spawnPosition.z,
    );
    if (!spot) {
      console.warn("[rift-rowboat] No safe, reachable shoreline found near player spawn");
      onMessage?.("Rowboat could not find a safe shoreline.");
      return;
    }
    try {
      const gltf = await loadModel();
      if (levelVersion !== thisLevel) return; // level changed during download
      const shape = buildVisual(gltf);
      // A narrow wooden keel displaces less water than a solid box. Match
      // the buoyant volume's bottom to the ACTUAL visible model bottom;
      // the old higher collision bottom placed the gunwale too deep.
      const area = shape.length * shape.beam * 0.45;
      const mass = Math.min(300, Math.max(180, area * shape.hullHeight * RHO * 0.27));
      const draft = mass / (RHO * area);
      const bottomOffset = -shape.visualHeight * 0.5 + 0.045;
      // An initial freeboard check prevents the boat from appearing sunk
      // during the first frame while the GLB is being attached to the scene.
      const initialSurface = sampleRowboatWater(waterHandle, spot.x, spot.z, 0);
      const initialY = Math.max(
        waterY - bottomOffset - draft,
        minimumRowboatPivotHeight({
          waterY, sampleMax: initialSurface, visualHeight: shape.visualHeight,
          length: shape.length, beam: shape.beam, pitch: 0, roll: 0,
        }),
      );
      shape.root.position.set(spot.x, initialY, spot.z);
      shape.root.rotation.y = spot.yaw; // bow points toward open water
      scene.add(shape.root);
      boat = {
        ...shape, handle: waterHandle, mass, dryMass: mass, area, bottomOffset,
        ySpeed: 0, rollSpeed: 0, pitchSpeed: 0,
        vx: 0, vz: 0, throttle: 0, steering: 0,
        lastWaveHit: 0,
        wake: makeWake(scene),
        wakeImpulse: { riding: false, x: 0, z: 0, strength: 0, radius: 2 },
        labLastStroke: -100, labStrokeSide: 1, labLastSlap: -100,
        // Lab M5.1 concept: relative fluid/rigid velocity at each hull cell
        // creates independent contact pressure and pitch/roll torque.
        cellWater: Array.from({ length: 9 }, () => ({
          height: 0, velocityY: 0, accelerationY: 0, slopeX: 0, slopeZ: 0,
        })),
        waveImpact: 0, impactX: spot.x, impactZ: spot.z,
      };
      console.info("[rift-rowboat] Spawned near player beach", {
        model: MODEL_URL, x: spot.x, z: spot.z,
        shoreDistance: spot.shoreDistance, offshore: spot.offshore,
      });
      updateHUD();
    } catch (error) {
      console.error("[rift-rowboat] Model failed to load", error);
      onMessage?.("Old rowboat failed to load — check the console.");
    }
  }

  function updatePhysics(dt, time) {
    if (!boat) return;
    // In heavy iOS scenes the game can render around 10-15 fps. Advance the
    // whole real frame with bounded substeps instead of silently dropping the
    // extra 40-50 ms and making the boat move in slow motion.
    dt = Math.min(0.09, Math.max(0, dt));
    if (!dt) return;
    const n = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / n, b = boat, root = b.root;
    // The rider contributes actual displaced weight, so the boat settles
    // slightly deeper when boarded and rises again when unloaded.
    b.mass = b.dryMass + (riding ? RIDER_MASS : 0);
    const targetThrottle = riding
      ? (Number(keys.forward || held.forward) - Number(keys.back || held.back)) : 0;
    const targetSteering = riding
      ? (Number(keys.left || held.left) - Number(keys.right || held.right)) : 0;
    const inertiaX = b.mass * (b.beam ** 2 + b.hullHeight ** 2) / 12;
    const inertiaZ = b.mass * (b.length ** 2 + b.hullHeight ** 2) / 12;
    const hydroK = RHO * G * b.area;
    // The prior damping was applied to the hull as a whole, making waves
    // look disconnected. Retain a smaller global stabilizer; most of the
    // resistance now comes from each cell's motion RELATIVE to its water.
    const heaveDamping = 2 * 0.38 * Math.sqrt(hydroK * b.mass);
    const rollK = hydroK * b.beam * b.beam / 9;
    const pitchK = hydroK * b.length * b.length / 9;
    const rollDamping = 2 * 0.52 * Math.sqrt(rollK * inertiaX);
    const pitchDamping = 2 * 0.55 * Math.sqrt(pitchK * inertiaZ);
    let peakImpact = 0, impactX = root.position.x, impactZ = root.position.z;

    for (let tick = 0; tick < n; tick++) {
      const t = time - dt + h * (tick + 1);
      b.throttle += (targetThrottle - b.throttle) * Math.min(1, h * 5.2);
      b.steering += (targetSteering - b.steering) * Math.min(1, h * 6);
      const speed = Math.hypot(b.vx, b.vz);
      const yaw = root.rotation.y;
      // Shape-aware hydrodynamic drag from Fluid Lab M5.1's principle:
      // a long narrow hull slips more easily forward than sideways. Keep
      // this on CPU; transferring the lab's particle-neighbour GPU passes
      // would cost far too much on iPhone.
      const thrust = b.throttle * 880;
      const fx = Math.cos(yaw), fz = -Math.sin(yaw);
      const sx = Math.sin(yaw), sz = Math.cos(yaw);
      const forwardSpeed = b.vx * fx + b.vz * fz;
      const sideSpeed = b.vx * sx + b.vz * sz;
      const forwardDrag = forwardSpeed * (0.16 + 0.09 * Math.abs(forwardSpeed));
      const lateralDrag = sideSpeed * (1.05 + 0.26 * Math.abs(sideSpeed));
      b.vx += (thrust * fx / b.mass - fx * forwardDrag - sx * lateralDrag) * h;
      b.vz += (thrust * fz / b.mass - fz * forwardDrag - sz * lateralDrag) * h;
      const maxSpeed = 3.8;
      const v = Math.hypot(b.vx, b.vz);
      if (v > maxSpeed) { b.vx *= maxSpeed / v; b.vz *= maxSpeed / v; }
      // Allow slow maneuvering and turning in either direction.
      const reverse = b.throttle < -0.15 ? -1 : 1;
      root.rotation.y += b.steering * reverse *
        (0.28 + Math.min(2.6, speed) * 0.28) * h;

      const nextX = root.position.x + b.vx * h;
      const nextZ = root.position.z + b.vz * h;
      const bottom = getGroundHeight(nextX, nextZ);
      const extent = Math.hypot(nextX, nextZ);
      if (extent > 192 ||
          (Number.isFinite(bottom) && bottom > b.handle.waterY - 0.72)) {
        // Run aground without exploding the velocity or drilling through
        // the sandy shoreline.
        b.vx *= -0.04;
        b.vz *= -0.04;
      } else {
        root.position.x = nextX;
        root.position.z = nextZ;
      }

      const cy = Math.cos(root.rotation.y), sy = Math.sin(root.rotation.y);
      let fy = -b.mass * G, tx = 0, tz = 0;
      let maxSurface = -Infinity;
      const cellArea = b.area / 9;
      // Fluid Lab M5.1-inspired *pressure response*: nine wetted columns
      // receive hydrostatic lift plus fluid-relative drag, water vertical
      // acceleration and a capped slamming impulse when a crest catches up.
      // Opposing sides therefore produce real roll and pitch torques.
      let cellIndex = 0;
      for (const ix of sampleOffsets) {
        for (const iz of sampleOffsets) {
          const lx = ix * b.length / 3, lz = iz * b.beam / 3;
          const wx = root.position.x + cy * lx + sy * lz;
          const wz = root.position.z - sy * lx + cy * lz;
          const pointY = root.position.y + b.bottomOffset +
            root.rotation.z * lx - root.rotation.x * lz;
          const surface = sampleRowboatWaterKinematics(
            b.handle, wx, wz, t, b.cellWater[cellIndex++],
          );
          if (surface.height > maxSurface) maxSurface = surface.height;
          const depth = clamp(surface.height - pointY, 0, b.hullHeight);
          if (depth <= 0) continue;

          const pointVy = b.ySpeed + b.pitchSpeed * lx - b.rollSpeed * lz;
          // Encounter velocity: travelling into a rising slope increases
          // relative water contact even if the wave itself barely moves.
          const encounterVelocity = surface.velocityY +
            b.vx * surface.slopeX + b.vz * surface.slopeZ;
          const closingSpeed = encounterVelocity - pointVy;
          const hydrostatic = RHO * G * cellArea * depth;
          // Motion relative to water matters more than motion relative
          // to an arbitrary stationary world frame.
          const contactDrag = clamp(
            RHO * cellArea * depth * closingSpeed * 1.60,
            -hydrostatic * 0.72, hydrostatic * 0.85,
          );
          const waveInertia = clamp(
            RHO * cellArea * depth * surface.accelerationY * 0.20,
            -hydrostatic * 0.15, hydrostatic * 0.15,
          );
          const wetFraction = clamp(depth / (b.hullHeight * 0.30), 0, 1);
          const slam = closingSpeed > 0.55
            ? Math.min(
              RHO * cellArea * closingSpeed * closingSpeed * 0.32 * wetFraction,
              RHO * G * cellArea * b.hullHeight * 0.55,
            )
            : 0;
          // Water never pulls on a hull that is leaving the free surface.
          const lift = Math.max(0, hydrostatic + contactDrag + waveInertia + slam);
          fy += lift;
          tx -= lz * lift;
          tz += lx * lift;

          // Keep only the strongest discrete impact for this frame.
          // It seeds the existing shallow-water interaction slot, not a
          // second solver or an unbounded particle emitter.
          if (slam > peakImpact && closingSpeed > 0.70) {
            peakImpact = slam;
            impactX = wx;
            impactZ = wz;
          }
        }
      }
      fy -= heaveDamping * b.ySpeed;
      tx -= rollDamping * b.rollSpeed;
      tz -= pitchDamping * b.pitchSpeed;
      b.ySpeed = clamp(b.ySpeed + clamp(fy / b.mass, -20, 26) * h, -4, 4);
      root.position.y += b.ySpeed * h;
      b.rollSpeed = clamp(b.rollSpeed + clamp(tx / inertiaX, -13, 13) * h, -1.0, 1.0);
      b.pitchSpeed = clamp(b.pitchSpeed + clamp(tz / inertiaZ, -11, 11) * h, -1.0, 1.0);
      root.rotation.x = clamp(root.rotation.x + b.rollSpeed * h, -0.29, 0.29);
      root.rotation.z = clamp(root.rotation.z + b.pitchSpeed * h, -0.29, 0.29);
      // Safety constraint AFTER buoyancy and angular integration: the hull
      // retains heave/pitch/roll inertia but its low gunwale can't be dragged
      // underneath a passing crest, even after a large mobile frame hitch.
      const minPivotY = minimumRowboatPivotHeight({
        waterY: b.handle.waterY,
        sampleMax: maxSurface,
        visualHeight: b.visualHeight, length: b.length, beam: b.beam,
        pitch: root.rotation.z, roll: root.rotation.x,
        storm: b.handle.stormAmount?.value ?? 0,
      });
      if (root.position.y < minPivotY) {
        root.position.y = minPivotY;
        if (b.ySpeed < 0) b.ySpeed = 0;
      }
    }
    // Use force normalized by hull weight, so the impact signal adapts
    // if a rider boards or the boat mass changes.
    b.waveImpact = clamp(peakImpact / Math.max(1, b.mass * G), 0, 1);
    b.impactX = impactX;
    b.impactZ = impactZ;
  }

  function updateWake(time) {
    if (!boat) return;
    const { root, handle, wake, vx, vz, length, beam } = boat;
    const speed = Math.hypot(vx, vz);
    const yaw = root.rotation.y, fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const sx = Math.sin(yaw), sz = Math.cos(yaw);
    const active = speed > 0.75;
    for (const item of wake) {
      item.line.visible = active;
      if (!active) continue;
      item.material.opacity = clamp(speed * 0.14, 0.13, 0.6);
      for (let i = 0; i < 10; i++) {
        const u = i / 9, behind = length * 0.5 + u * (2 + speed * 2.4);
        const side = item.side * (beam * 0.48 + u * speed * 1.15);
        const x = root.position.x - fx * behind + sx * side;
        const z = root.position.z - fz * behind + sz * side;
        const index = i * 3;
        item.positions[index] = x;
        item.positions[index + 1] = sampleRowboatWater(handle, x, z, time) + 0.08;
        item.positions[index + 2] = z;
      }
      item.attribute.needsUpdate = true;
    }
  }

  function update(dt, time = sampleTimeFallback()) {
    if (!boat) { updateHUD(); return; }
    if (riding && (!isActive() || isDroneMode())) exit();
    updatePhysics(dt, time);
    updateWake(time);
    // Feed the existing GPU shallow-water solver with a single compact
    // boat disturbance. No extra compute pass or GPU readback is needed.
    const speed = Math.hypot(boat.vx, boat.vz);
    const wake = boat.wakeImpulse;
    wake.riding = riding;
    wake.x = boat.root.position.x - Math.cos(boat.root.rotation.y) * boat.length * 0.48;
    wake.z = boat.root.position.z + Math.sin(boat.root.rotation.y) * boat.length * 0.48;
    wake.strength = riding && speed > 0.22 ? clamp(speed * 0.34, 0.1, 1.3) : 0;
    wake.radius = clamp(boat.beam * 1.3 + speed * 0.18, 1.5, 3.4);
    boat.handle.__riftRowboatWake = riding ? wake : null;

    // Fluid Lab M5.7 principle: real contact events seed the fluid,
    // not continuously spawned decorative particle clouds. A rower strikes
    // alternate port/starboard oars in a bounded ~0.45s rhythm.
    if (riding && Math.abs(boat.throttle) > 0.27 &&
        time - boat.labLastStroke > 0.46) {
      boat.labLastStroke = time;
      boat.labStrokeSide *= -1;
      const yaw = boat.root.rotation.y, side = boat.labStrokeSide;
      const x = boat.root.position.x + Math.cos(yaw) * boat.length * -0.09
        + Math.sin(yaw) * side * (boat.beam * 0.78);
      const z = boat.root.position.z - Math.sin(yaw) * boat.length * -0.09
        + Math.cos(yaw) * side * (boat.beam * 0.78);
      emitRiftWaterImpact(boat.handle, x, z, {
        strength: 0.6 + Math.abs(boat.throttle) * 0.54,
        radius: 1.35 + Math.abs(boat.throttle) * 0.4,
        foam: 0.17, kind: "oar",
      }, time);
    }
    // Real relative water/hull contact pressure, rather than world-space
    // downward velocity, triggers the hull slap. A rising wave can hit a
    // stationary boat; a boat descending with the water does NOT splash.
    if (boat.waveImpact > 0.018 && time - boat.labLastSlap > 0.85) {
      boat.labLastSlap = time;
      emitRiftWaterImpact(boat.handle, boat.impactX, boat.impactZ, {
        strength: clamp(0.35 + boat.waveImpact * 3.0, 0.4, 1.7),
        radius: clamp(boat.beam * (0.9 + boat.waveImpact), 1.2, 2.5),
        foam: clamp(boat.waveImpact * 0.32, 0.04, 0.20),
        kind: "hull",
      }, time);
    }
    if (riding) followCamera(dt);
    updateHUD();
  }

  button.addEventListener("click", event => {
    event.preventDefault();
    event.stopPropagation();
    toggleRide();
  });
  button.addEventListener("touchstart", event => event.stopPropagation(), { passive: true });
  button.addEventListener("pointerdown", event => event.stopPropagation());
  window.addEventListener("keydown", event => {
    if (event.code !== "KeyE" || event.repeat || !isActive() || isDroneMode() ||
        event.target?.closest?.("input,textarea,select")) return;
    if (riding || nearEnough()) {
      event.preventDefault();
      toggleRide();
    }
  });
  return { startLevel, stopLevel, update, isRiding: () => riding, exit };
}
