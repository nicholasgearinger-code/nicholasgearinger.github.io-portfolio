import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// This is the authored model already in the Rift repository, not a primitive
// placeholder. Load only when Coral Shallows starts (12 MB GLB).
const MODEL_URL = new URL("./models/old_rowboat.glb", import.meta.url).href;
const G = 9.81;
const RHO = 1025;
const BOARD_RADIUS = 7.0; // reachable at the spawn beach without swimming far
const MAX_STEP = 1 / 60;
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
      const area = shape.length * shape.beam * 0.65;
      const mass = Math.min(570, area * shape.hullHeight * RHO * 0.6);
      const draft = mass / (RHO * area);
      const bottomOffset = -shape.hullHeight * 0.5;
      shape.root.position.set(spot.x, waterY - bottomOffset - draft, spot.z);
      shape.root.rotation.y = spot.yaw; // bow points toward open water
      scene.add(shape.root);
      boat = {
        ...shape, handle: waterHandle, mass, area, bottomOffset,
        ySpeed: 0, rollSpeed: 0, pitchSpeed: 0,
        vx: 0, vz: 0, throttle: 0, steering: 0,
        lastWaveHit: 0,
        wake: makeWake(scene),
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
    dt = Math.min(0.05, Math.max(0, dt));
    const n = Math.max(1, Math.ceil(dt / MAX_STEP));
    const h = dt / n, b = boat, root = b.root;
    b.throttle = riding ? (Number(keys.forward) - Number(keys.back)) : 0;
    b.steering = riding ? (Number(keys.left) - Number(keys.right)) : 0;
    for (let tick = 0; tick < n; tick++) {
      const t = time - dt + h * (tick + 1);
      const speed = Math.hypot(b.vx, b.vz);
      const yaw = root.rotation.y;
      // Rowing: momentum and drag, not engine-like acceleration.
      const thrust = b.throttle * 1700;
      b.vx += (thrust * Math.cos(yaw) / b.mass - b.vx * (0.45 + speed * 0.12)) * h;
      b.vz += (-thrust * Math.sin(yaw) / b.mass - b.vz * (0.45 + speed * 0.12)) * h;
      b.vx = clamp(b.vx, -5.5, 5.5);
      b.vz = clamp(b.vz, -5.5, 5.5);
      root.rotation.y += b.steering * Math.min(3.3, speed) * 0.40 * h;
      const nextX = root.position.x + b.vx * h;
      const nextZ = root.position.z + b.vz * h;
      const bottom = getGroundHeight(nextX, nextZ);
      const extent = Math.hypot(nextX, nextZ);
      if (extent > 192 || (Number.isFinite(bottom) && bottom > b.handle.waterY - 0.65)) {
        b.vx *= -0.06;
        b.vz *= -0.06;
      } else {
        root.position.x = nextX;
        root.position.z = nextZ;
      }
      const cy = Math.cos(root.rotation.y), sy = Math.sin(root.rotation.y);
      let fy = -b.mass * G, tx = 0, tz = 0;
      const cellArea = b.area / 9;
      for (const ix of sampleOffsets) for (const iz of sampleOffsets) {
        const lx = ix * b.length / 3, lz = iz * b.beam / 3;
        const wx = root.position.x + cy * lx + sy * lz;
        const wz = root.position.z - sy * lx + cy * lz;
        const pointY = root.position.y + b.bottomOffset +
          root.rotation.z * lx - root.rotation.x * lz;
        const depth = clamp(sampleRowboatWater(b.handle, wx, wz, t) - pointY, 0, b.hullHeight);
        if (!depth) continue;
        const pointVy = b.ySpeed + b.pitchSpeed * lx - b.rollSpeed * lz;
        const force = RHO * G * cellArea * depth -
          2.1 * RHO * cellArea * depth * pointVy;
        fy += force;
        tx -= lz * force;
        tz += lx * force;
      }
      b.ySpeed = clamp(b.ySpeed + clamp(fy / b.mass, -22, 28) * h, -5, 5);
      root.position.y += b.ySpeed * h;
      const ix = b.mass * (b.beam * b.beam + b.hullHeight * b.hullHeight) / 12;
      const iz = b.mass * (b.length * b.length + b.hullHeight * b.hullHeight) / 12;
      b.rollSpeed = clamp(b.rollSpeed + (clamp(tx / ix, -12, 12) - b.rollSpeed * 3.5) * h, -1.2, 1.2);
      b.pitchSpeed = clamp(b.pitchSpeed + (clamp(tz / iz, -12, 12) - b.pitchSpeed * 3.5) * h, -1.2, 1.2);
      root.rotation.x = clamp(root.rotation.x + b.rollSpeed * h, -0.32, 0.32);
      root.rotation.z = clamp(root.rotation.z + b.pitchSpeed * h, -0.32, 0.32);
    }
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
