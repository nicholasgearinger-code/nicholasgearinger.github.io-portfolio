// touchControls.js
// -----------------------------------------------------------------------------
// Touch input for mobile/tablet: a virtual joystick for movement, drag-to-look
// on the rest of the screen, and dedicated buttons for vertical movement and
// firing. This is a parallel input path alongside the desktop WASD+mouse
// controls in main.js — it mutates the same `keys` object and rotates the
// same camera, so movement simulation and shooting downstream are identical
// no matter which input scheme produced them.
//
// Multi-touch is handled by tracking touch identifiers: the joystick "grabs"
// whichever touch started on it and follows that finger until it lifts,
// regardless of what other fingers are doing elsewhere on screen (looking,
// tapping fire) at the same time.
// -----------------------------------------------------------------------------

const LOOK_SENSITIVITY = 0.0028;
const MAX_PITCH = Math.PI / 2 - 0.05;
const JOYSTICK_MAX_RADIUS = 40; // px the knob can travel from center
const JOYSTICK_DEADZONE = 0.15; // fraction of max radius before a direction registers
const TOUCH_CAPTURE_MARGIN = 30; // px of extra grab area around small controls

function expandRect(rect, px) {
  return {
    left: rect.left - px,
    right: rect.right + px,
    top: rect.top - px,
    bottom: rect.bottom + px,
  };
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * @param {THREE.PerspectiveCamera} camera
 * @param {{forward,back,left,right,up,down}} keys  same object main.js reads every frame
 * @param {() => void} onFire
 */
function createTouchControls({ camera, keys, onFire }) {
  const joystickBase = document.getElementById("rift-touch-joystick");
  const joystickKnob = document.getElementById("rift-touch-joystick-knob");
  const fireButton = document.getElementById("rift-touch-fire");
  const upButton = document.getElementById("rift-touch-up");
  const downButton = document.getElementById("rift-touch-down");

  if (!joystickBase || !joystickKnob || !fireButton || !upButton || !downButton) {
    return; // touch HUD not present — nothing to wire up
  }

  // Drive camera rotation directly (no PointerLockControls involved here).
  // rotation.order is set to 'YXZ' once at camera creation in main.js, which
  // keeps yaw (rotation.y) clean and independent of pitch — exactly what
  // the movement code expects.
  let pitch = camera.rotation.x;

  let joystickTouchId = null;
  let joystickOrigin = { x: 0, y: 0 };
  let lookTouchId = null;
  let lastLook = { x: 0, y: 0 };

  function setJoystickVector(dx, dy) {
    const mag = Math.sqrt(dx * dx + dy * dy);
    const clampedMag = Math.min(mag, JOYSTICK_MAX_RADIUS);
    const scale = mag > 0 ? clampedMag / mag : 0;
    joystickKnob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;

    const nx = (dx * scale) / JOYSTICK_MAX_RADIUS;
    const ny = (dy * scale) / JOYSTICK_MAX_RADIUS;

    keys.forward = ny < -JOYSTICK_DEADZONE;
    keys.back = ny > JOYSTICK_DEADZONE;
    keys.left = nx < -JOYSTICK_DEADZONE;
    keys.right = nx > JOYSTICK_DEADZONE;
  }

  function resetJoystick() {
    joystickKnob.style.transform = "translate(0px, 0px)";
    keys.forward = false;
    keys.back = false;
    keys.left = false;
    keys.right = false;
  }

  function handleTouchStart(e) {
    for (const touch of e.changedTouches) {
      const joyRect = expandRect(joystickBase.getBoundingClientRect(), TOUCH_CAPTURE_MARGIN);
      const fireRect = expandRect(fireButton.getBoundingClientRect(), TOUCH_CAPTURE_MARGIN);

      if (joystickTouchId === null && pointInRect(touch.clientX, touch.clientY, joyRect)) {
        joystickTouchId = touch.identifier;
        const rect = joystickBase.getBoundingClientRect();
        joystickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        setJoystickVector(touch.clientX - joystickOrigin.x, touch.clientY - joystickOrigin.y);
      } else if (pointInRect(touch.clientX, touch.clientY, fireRect)) {
        onFire();
      } else if (lookTouchId === null) {
        lookTouchId = touch.identifier;
        lastLook = { x: touch.clientX, y: touch.clientY };
      }
    }
  }

  function handleTouchMove(e) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === joystickTouchId) {
        e.preventDefault();
        setJoystickVector(touch.clientX - joystickOrigin.x, touch.clientY - joystickOrigin.y);
      } else if (touch.identifier === lookTouchId) {
        e.preventDefault();
        const dx = touch.clientX - lastLook.x;
        const dy = touch.clientY - lastLook.y;
        lastLook = { x: touch.clientX, y: touch.clientY };

        camera.rotation.y -= dx * LOOK_SENSITIVITY;
        pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch - dy * LOOK_SENSITIVITY));
        camera.rotation.x = pitch;
      }
    }
  }

  function handleTouchEnd(e) {
    for (const touch of e.changedTouches) {
      if (touch.identifier === joystickTouchId) {
        joystickTouchId = null;
        resetJoystick();
      } else if (touch.identifier === lookTouchId) {
        lookTouchId = null;
      }
    }
  }

  document.addEventListener("touchstart", handleTouchStart, { passive: true });
  document.addEventListener("touchmove", handleTouchMove, { passive: false });
  document.addEventListener("touchend", handleTouchEnd, { passive: true });
  document.addEventListener("touchcancel", handleTouchEnd, { passive: true });

  // Vertical movement buttons are simple hold-while-touching controls.
  // Touch events keep targeting their original element even if the finger
  // drags off it, so a plain touchstart/touchend pair per button is reliable.
  function bindHoldButton(button, key) {
    const start = (e) => { e.preventDefault(); keys[key] = true; };
    const end = (e) => { e.preventDefault(); keys[key] = false; };
    button.addEventListener("touchstart", start, { passive: false });
    button.addEventListener("touchend", end, { passive: false });
    button.addEventListener("touchcancel", end, { passive: false });
  }
  bindHoldButton(upButton, "up");
  bindHoldButton(downButton, "down");
}

export { createTouchControls };
