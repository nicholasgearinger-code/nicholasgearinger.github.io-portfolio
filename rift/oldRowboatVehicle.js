import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// This is the authored model already in the Rift repository, not a primitive
// placeholder. Load only when Coral Shallows starts (12 MB GLB).
const MODEL_URL = new URL("./models/old_rowboat.glb", import.meta.url).href;
const G = 9.81;
const RHO = 1025;
const BOARD_RADIUS = 5.5;
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
  viewport.append(button, hint);

  let levelVersion = 0;
  let boat = null;
  let riding = false;
  let previousYaw = 0;
  const followTarget = new THREE.Vector3();
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
    const canBoard = active && (riding || nearEnough());
    button.style.display = canBoard ? "block" : "none";
    hint.style.display = riding ? "block" : "none";
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
    // Elevated camera DIRECTLY OVER the boat, not the former aft chase view.
    followTarget.set(p.x, p.y + 3.6, p.z);
    camera.position.lerp(followTarget, instant ? 1 : 1 - Math.exp(-16 * dt));
    camera.rotation.z = 0;
  }

  function board() {
    if (!nearEnough()) return false;
    riding = true;
    previousYaw = boat.root.rotation.y;
    camera.rotation.order = "YXZ";
    camera.rotation.set(-1.16, previousYaw - Math.PI / 2, 0);
    followCamera(1, true);
    playerPhysics.verticalVelocity = 0;
    playerPhysics.grounded = false;
    window.dispatchEvent(new Event("rift-camera-reset-look"));
    onMessage?.("Rowboat boarded — use movement controls to row and steer.");
    updateHUD();
    return true;
  }

  function exit() {
    if (!riding || !boat) return false;
    riding = false;
    boat.throttle = 0;
    boat.steering = 0;
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
    button.style.display = "none";
    hint.style.display = "none";
    if (boat) {
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
    // Search nearby reachable shallow water rather than arbitrary offshore coords.
    let spot = null;
    for (const radius of [8, 12, 17, 23, 31, 42, 56, 72]) {
      for (let i = 0; i < 24; i++) {
        const a = i * Math.PI * 2 / 24;
        const x = spawnPosition.x + radius * Math.cos(a);
        const z = spawnPosition.z + radius * Math.sin(a);
        const ground = getGroundHeight(x, z);
        const depth = waterY - ground;
        if (!Number.isFinite(depth) || depth < 1.3 || depth > 12) continue;
        // Choose the first ring with navigable depth, ideally in 2-6 m water.
        if (!spot || Math.abs(depth - 3.2) < spot.score) {
          spot = { x, z, score: Math.abs(depth - 3.2) };
        }
      }
      if (spot) break;
    }
    if (!spot) {
      console.warn("[rift-rowboat] No navigable water near the spawn");
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
      shape.root.rotation.y = Math.atan2(spawnPosition.z - spot.z, spawnPosition.x - spot.x);
      scene.add(shape.root);
      boat = {
        ...shape, handle: waterHandle, mass, area, bottomOffset,
        ySpeed: 0, rollSpeed: 0, pitchSpeed: 0,
        vx: 0, vz: 0, throttle: 0, steering: 0,
        lastWaveHit: 0,
        wake: makeWake(scene),
      };
      console.info("[rift-rowboat] Loaded authored old_rowboat.glb as buoyant player vehicle", MODEL_URL);
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
