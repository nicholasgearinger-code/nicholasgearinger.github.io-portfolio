import * as THREE from "three";
import * as current from "./weather_lightning_visible_base.js";

export * from "./weather_lightning_visible_base.js";

// -----------------------------------------------------------------------------
// Lightning cadence + environmental flash layer
// -----------------------------------------------------------------------------
// The preserved base module owns the distant, depth-tested bolt itself. This
// wrapper only makes strikes less frequent and adds a short spatial light pulse
// that illuminates nearby geometry plus a soft sky glow behind the bolt.

const STRIKE_COOLDOWNS = {
  ember: [25, 40],
  verdant: [23, 38],
  crystal: [18, 30],
  abyssal: [34, 52],
  ashen: [28, 44],
  frost: [38, 58],
};

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function createRadialGlowTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  const half = (size - 1) * 0.5;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const r = Math.min(1, Math.hypot(dx, dy));
      const alpha = Math.pow(1 - r, 2.2);
      const i = (y * size + x) * 4;
      data[i] = 235;
      data[i + 1] = 248;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createLightningFlashRig(scene) {
  const strikeLight = new THREE.PointLight(0xeaf8ff, 0, 260, 2);
  strikeLight.castShadow = false;
  scene.add(strikeLight);

  // A subtle sky-fill component makes faces, leaves and terrain react to the
  // strike even when the local point light is behind them. It is intentionally
  // much weaker than the point light so the flash still feels directional.
  const skyFill = new THREE.HemisphereLight(0xf2fbff, 0x526073, 0);
  scene.add(skyFill);

  const glowTexture = createRadialGlowTexture();
  const glowMaterial = new THREE.SpriteMaterial({
    map: glowTexture,
    color: 0xdff4ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  const skyGlow = new THREE.Sprite(glowMaterial);
  skyGlow.visible = false;
  scene.add(skyGlow);

  return { strikeLight, skyFill, skyGlow, glowMaterial, glowTexture };
}

function positionFlashRig(handle) {
  const bolt = handle?.realLightningBolt;
  const rig = handle?.__riftLightningFlashRig;
  const end = bolt?.__riftStrikeEnd;
  if (!rig || !end) return;

  rig.strikeLight.position.copy(end);
  rig.strikeLight.position.y += 22;

  rig.skyGlow.position.copy(end);
  rig.skyGlow.position.y += 34;

  const strikeDistance = Number(bolt.__riftStrikeDistance) || 90;
  const size = THREE.MathUtils.clamp(strikeDistance * 0.82, 62, 96);
  rig.skyGlow.scale.set(size, size * 0.82, 1);
  rig.skyGlow.visible = true;
}

function updateEnvironmentalFlash(handle) {
  const rig = handle?.__riftLightningFlashRig;
  const bolt = handle?.realLightningBolt;
  if (!rig || !bolt) return;

  const active = !!(bolt.group?.visible && bolt.life > 0);
  if (!active) {
    rig.strikeLight.intensity = 0;
    rig.skyFill.intensity = 0;
    rig.glowMaterial.opacity = 0;
    rig.skyGlow.visible = false;
    return;
  }

  // Follow the bolt's own return-stroke envelope. The late return stroke still
  // lights the world, but much less than the initial discharge.
  const boltIntensity = clamp01(bolt.coreMaterial?.opacity);
  const age = Math.max(0, Number(bolt.__riftVisualAge) || 0);
  const returnStrokeScale = age < 0.12 ? 1 : 0.48;
  const flash = Math.pow(boltIntensity, 1.18) * returnStrokeScale;

  // Modern Three.js point lights use physically-based intensity units, so this
  // needs to be high enough to read from an 80-120 unit distant strike.
  rig.strikeLight.intensity = 15000 * flash;
  rig.skyFill.intensity = 0.58 * flash;
  rig.glowMaterial.opacity = 0.24 * flash;
  rig.skyGlow.visible = flash > 0.005;
}

function disposeLightningFlashRig(scene, rig) {
  if (!rig) return;
  scene.remove(rig.strikeLight);
  scene.remove(rig.skyFill);
  scene.remove(rig.skyGlow);
  rig.glowMaterial.dispose();
  rig.glowTexture.dispose();
}

export function createWeatherSystem(scene, biome) {
  const handle = current.createWeatherSystem(scene, biome);
  if (handle) handle.__riftLightningFlashRig = createLightningFlashRig(scene);
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
  const isVisible = !!(bolt?.group?.visible && bolt.life > 0);
  if (isVisible && !wasVisible) {
    positionFlashRig(handle);

    // The base module intentionally makes Crystal strikes easy to test. After
    // each actual strike, stretch the next interval so an ongoing storm feels
    // natural instead of producing lightning every few seconds.
    const range = STRIKE_COOLDOWNS[handle?.biome] ?? [24, 40];
    handle.__riftDistantStrikeTimer = randRange(range[0], range[1]);
  }

  updateEnvironmentalFlash(handle);
  return result;
}

export function disposeWeatherSystem(scene, handle) {
  disposeLightningFlashRig(scene, handle?.__riftLightningFlashRig);
  if (handle) handle.__riftLightningFlashRig = null;
  return current.disposeWeatherSystem(scene, handle);
}
