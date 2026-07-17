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
 * @param {{forward,back,left,right}} keys  same object main.js reads every frame
 * @param {() => void} onFire
 * @param {() => void} onJump  called once per tap, not held — main.js edge-triggers a jump from this the same way it does for the Space key
 * @param {HTMLElement} viewport
 * @param {() => boolean} isActive
 */
function createTouchControls({ camera, keys, onFire, onJump, viewport, isActive }) {
  const joystickBase = document.getElementById("rift-touch-joystick");
  const joystickKnob = document.getElementById("rift-touch-joystick-knob");
  const fireButton = document.getElementById("rift-touch-fire");
  const jumpButton = document.getElementById("rift-touch-up");

  if (!joystickBase || !joystickKnob || !fireButton || !jumpButton) {
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
    // This is a document-level listener (see the bottom of this function) —
    // it used to be safe to claim any touch anywhere as a "look" drag
    // because this game WAS the whole page. Now that it's embedded in a
    // larger scrollable portfolio, an unguarded catch-all here would grab
    // every touch on the entire site (including normal scrolling) and
    // preventDefault() it in handleTouchMove below. Gate on both the game
    // actually being active and the touch actually starting inside the
    // game's own viewport, so scrolling the rest of the page is untouched.
    if (!isActive()) return;
    for (const touch of e.changedTouches) {
      const joyRect = expandRect(joystickBase.getBoundingClientRect(), TOUCH_CAPTURE_MARGIN);
      const fireRect = expandRect(fireButton.getBoundingClientRect(), TOUCH_CAPTURE_MARGIN);
      const viewportRect = viewport.getBoundingClientRect();

      if (joystickTouchId === null && pointInRect(touch.clientX, touch.clientY, joyRect)) {
        joystickTouchId = touch.identifier;
        const rect = joystickBase.getBoundingClientRect();
        joystickOrigin = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
        setJoystickVector(touch.clientX - joystickOrigin.x, touch.clientY - joystickOrigin.y);
      } else if (pointInRect(touch.clientX, touch.clientY, fireRect)) {
        onFire();
      } else if (lookTouchId === null && pointInRect(touch.clientX, touch.clientY, viewportRect)) {
        lookTouchId = touch.identifier;
        lastLook = { x: touch.clientX, y: touch.clientY };
      }
    }
  }

  function handleTouchMove(e) {
    if (!isActive()) return;
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

  // Jump is a discrete tap, not a hold — matches how Space is edge-triggered
  // on desktop (see main.js), rather than the old hold-to-ascend flight
  // behavior this button used to have.
  function bindTapButton(button, onTap) {
    const start = (e) => { e.preventDefault(); onTap(); };
    button.addEventListener("touchstart", start, { passive: false });
  }
  bindTapButton(jumpButton, onJump);
}

export { createTouchControls };
