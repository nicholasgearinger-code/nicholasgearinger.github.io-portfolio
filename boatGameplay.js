// Driveable-boat player mode for Rift Islands.
// Keeps camera/look input in the existing game; reuses WASD/touch joystick.
// This module owns only HUD nodes, never the boat or the water simulation.
import * as THREE from "three";
import { setBoatControls } from "./waterInteractions.js";

const BOARD_RANGE = 5.5;
const CAMERA_AFT = 3.8;
const CAMERA_HEIGHT = 2.2;

export function createBoatGameplay({
  viewport, camera, keys, isActive, isTouchDevice, getInteractions,
  getGroundHeight, eyeHeight, playerPhysics, onMessage,
}) {
  if (getComputedStyle(viewport).position === "static") viewport.style.position = "relative";
  const action = document.createElement("button");
  action.type = "button";
  action.dataset.riftBoatControl = "";
  action.setAttribute("aria-label", "Board boat");
  action.style.cssText = [
    "display:none", "position:absolute", "left:50%", "bottom:18px",
    "transform:translateX(-50%)", "z-index:75", "touch-action:manipulation",
    "pointer-events:auto", "padding:12px 21px", "min-height:46px",
    "border:1px solid rgba(220,255,252,.75)", "border-radius:999px",
    "color:#f4fffa", "background:rgba(8,44,57,.9)", "box-shadow:0 5px 20px #0008",
    "font:600 15px system-ui,sans-serif", "letter-spacing:.02em",
  ].join(";");
  const hud = document.createElement("div");
  hud.dataset.riftBoatControl = "";
  hud.style.cssText = [
    "display:none", "position:absolute", "left:50%", "top:50px",
    "transform:translateX(-50%)", "z-index:74", "pointer-events:none",
    "padding:7px 12px", "border-radius:10px", "max-width:90%",
    "background:rgba(6,39,51,.76)", "color:#e8fffa",
    "text-align:center", "font:600 12px/1.5 system-ui,sans-serif",
    "text-shadow:0 1px 3px #000", "white-space:nowrap",
  ].join(";");
  viewport.append(action, hud);

  let riding = null;
  let previousYaw = 0;
  let uiLabel = "";
  const goal = new THREE.Vector3();

  const groundAt = (x, z) => {
    const value = getGroundHeight(x, z);
    return Number.isFinite(value) ? value : -Infinity;
  };

  function nearbyBoat() {
    const state = getInteractions();
    if (!state) return null;
    let nearest = null, best = BOARD_RANGE * BOARD_RANGE;
    for (const body of state.objects) {
      if (!body.boat || !body.mesh?.parent) continue;
      const dx = camera.position.x - body.mesh.position.x;
      const dz = camera.position.z - body.mesh.position.z;
      const horizontalSq = dx * dx + dz * dz;
      if (horizontalSq >= best || Math.abs(camera.position.y - body.mesh.position.y) > 3.5) continue;
      best = horizontalSq;
      nearest = body;
    }
    return nearest;
  }

  function setLabel(label, hint) {
    if (label !== uiLabel) {
      uiLabel = label;
      action.textContent = label;
      action.setAttribute("aria-label", label);
    }
    if (hint !== hud.textContent) hud.textContent = hint;
  }

  function board(body) {
    if (!body || !isActive()) return false;
    riding = body;
    body.boat = true;
    body.maxThrust = 9000;
    body.waterDrag = 0.5;
    setBoatControls(body, { throttle: 0, rudder: 0 });
    previousYaw = body.mesh.rotation.y;
    camera.rotation.y = previousYaw - Math.PI / 2;
    camera.rotation.x = -0.18;
    camera.rotation.z = 0;
    followCamera(1);
    playerPhysics.verticalVelocity = 0;
    playerPhysics.grounded = false;
    onMessage?.("Boat boarded — use W/S and A/D or the touch joystick.");
    return true;
  }

  function exit() {
    if (!riding) return false;
    const body = riding;
    riding = null;
    setBoatControls(body, { throttle: 0, rudder: 0 });
    const yaw = body.mesh.rotation.y;
    // Prefer the side with shallower terrain. Spawn clear of the hull.
    const sides = [1, -1].map(side => {
      const x = body.mesh.position.x + Math.sin(yaw) * side * (body.beam * 0.5 + 2.1);
      const z = body.mesh.position.z + Math.cos(yaw) * side * (body.beam * 0.5 + 2.1);
      return { x, z, ground: groundAt(x, z) };
    });
    sides.sort((a, b) => b.ground - a.ground);
    const land = sides[0];
    const surface = getInteractions()?.handle?.waterY ?? body.mesh.position.y;
    const safeEyeY = land.ground >= surface - 0.5
      ? land.ground + eyeHeight + 0.12
      : surface - 0.15; // resume swimming near the surface, not on the seabed
    camera.position.set(land.x, safeEyeY, land.z);
    camera.rotation.z = 0;
    playerPhysics.verticalVelocity = 0;
    playerPhysics.grounded = false;
    onMessage?.("Exited boat");
    refreshHUD();
    return true;
  }

  function toggle() {
    if (!isActive()) return false;
    if (riding) return exit();
    const body = nearbyBoat();
    return body ? board(body) : false;
  }

  function updateControls() {
    if (!riding || !isActive()) return;
    const throttle = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
    const rudder = (keys.left ? 1 : 0) - (keys.right ? 1 : 0);
    setBoatControls(riding, { throttle, rudder });
  }

  function followCamera(dt) {
    if (!riding) return;
    const { position, rotation } = riding.mesh;
    // Keep the player's independent mouse/touch look relative to turning.
    const deltaYaw = rotation.y - previousYaw;
    camera.rotation.y += deltaYaw;
    previousYaw = rotation.y;
    goal.set(
      position.x - Math.cos(rotation.y) * CAMERA_AFT,
      position.y + CAMERA_HEIGHT,
      position.z + Math.sin(rotation.y) * CAMERA_AFT,
    );
    camera.position.lerp(goal, dt >= 1 ? 1 : 1 - Math.exp(-12 * dt));
    camera.rotation.z = 0;
  }

  function refreshHUD() {
    if (!isActive() || !getInteractions()) {
      action.style.display = "none";
      hud.style.display = "none";
      return;
    }
    const nearby = riding || nearbyBoat();
    action.style.display = nearby ? "block" : "none";
    hud.style.display = riding ? "block" : "none";
    if (riding) {
      setLabel("Exit Boat", isTouchDevice
        ? "BOAT • Joystick ↑↓ throttle  ←→ steer"
        : "BOAT • W/S throttle · A/D steer · E exit");
    } else if (nearby) {
      setLabel(isTouchDevice ? "Board Boat" : "Board Boat [E]", "");
    }
  }

  function afterPhysics(dt) {
    if (riding && (!getInteractions() || !isActive())) {
      reset();
    } else if (riding) {
      followCamera(dt);
    }
    refreshHUD();
  }

  function reset() {
    if (riding) setBoatControls(riding, { throttle: 0, rudder: 0 });
    riding = null;
    previousYaw = 0;
    action.style.display = "none";
    hud.style.display = "none";
  }

  action.addEventListener("click", e => {
    e.preventDefault();
    e.stopPropagation();
    toggle();
  });
  // Suppress touch-to-look capture on the dedicated HUD button.
  action.addEventListener("pointerdown", e => e.stopPropagation());
  return { isRiding: () => !!riding, toggle, updateControls, afterPhysics, reset };
}
