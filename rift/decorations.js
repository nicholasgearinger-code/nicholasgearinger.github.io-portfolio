import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";
import * as current from "./decorations_underwater_base.js";

export * from "./decorations_underwater_base.js";

// Mobile-first underwater shafts. The prior pass still rendered too many
// translucent layers on iPhone. Keep only a sparse subset of the original
// shaft cells active and make each active beam larger so the scene reads as
// cinematic rather than busy while cutting draw-call pressure substantially.
let underwaterShaftTexture = null;
let shaftOrdinal = 0;

function getUnderwaterShaftTexture() {
  if (underwaterShaftTexture) return underwaterShaftTexture;

  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 512;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const vertical = ctx.createLinearGradient(0, 0, 0, h);
  vertical.addColorStop(0, "rgba(255,255,255,0.98)");
  vertical.addColorStop(0.08, "rgba(238,253,255,0.88)");
  vertical.addColorStop(0.28, "rgba(188,240,248,0.44)");
  vertical.addColorStop(0.70, "rgba(108,214,231,0.14)");
  vertical.addColorStop(1, "rgba(75,190,212,0)");

  const horizontal = ctx.createLinearGradient(0, 0, w, 0);
  horizontal.addColorStop(0, "rgba(255,255,255,0)");
  horizontal.addColorStop(0.18, "rgba(255,255,255,0.16)");
  horizontal.addColorStop(0.50, "rgba(255,255,255,1)");
  horizontal.addColorStop(0.82, "rgba(255,255,255,0.16)");
  horizontal.addColorStop(1, "rgba(255,255,255,0)");

  ctx.save();
  ctx.filter = "blur(8px)";
  ctx.fillStyle = vertical;
  ctx.beginPath();
  ctx.moveTo(w * 0.43, 0);
  ctx.lineTo(w * 0.57, 0);
  ctx.lineTo(w * 0.95, h);
  ctx.lineTo(w * 0.05, h);
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = "destination-in";
  ctx.fillStyle = horizontal;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  underwaterShaftTexture = new THREE.CanvasTexture(canvas);
  underwaterShaftTexture.colorSpace = THREE.SRGBColorSpace;
  underwaterShaftTexture.needsUpdate = true;
  return underwaterShaftTexture;
}

function makeRaySprite(color, rotation) {
  const material = new THREE.SpriteMaterial({
    map: getUnderwaterShaftTexture(),
    color,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fog: true,
    rotation,
    toneMapped: true,
  });

  const sprite = new THREE.Sprite(material);
  sprite.center.set(0.5, 1);
  return sprite;
}

function getActiveStride() {
  const detail = Number(getGraphicsSettings?.().decorationDetail ?? 0);
  return detail >= 2 ? 4 : 5;
}

export function createUnderwaterLightShaft(x, z, groundY, waterY, rand) {
  const ordinal = shaftOrdinal++;
  const group = new THREE.Group();
  group.position.set(x, waterY + 0.08, z);

  const stride = getActiveStride();

  // Only a smaller subset of shafts become active. Inactive handles keep the
  // caller's lifecycle intact but contain no renderables.
  if (ordinal % stride !== 0) {
    group.visible = false;
    return { sprite: group, disabled: true, layers: [] };
  }

  const depth = Math.max(1, waterY - groundY);
  const length = THREE.MathUtils.clamp(depth * (1.35 + rand() * 0.22), 18, 34);
  const rotation = (rand() - 0.5) * 0.10;

  const volume = makeRaySprite(0x74ddec, rotation);
  volume.scale.set(length * (1.08 + rand() * 0.14), length, 1);
  group.add(volume);

  const core = makeRaySprite(0xebfdff, rotation * 0.55);
  core.scale.set(length * (0.24 + rand() * 0.05), length * 0.9, 1);
  core.position.y = -0.04;
  group.add(core);

  return {
    sprite: group,
    disabled: false,
    baseOpacity: 0.22 + rand() * 0.05,
    phase: rand() * Math.PI * 2,
    drift: 0.55 + rand() * 0.35,
    layers: [
      { sprite: volume, weight: 0.65 },
      { sprite: core, weight: 1.0 },
    ],
  };
}

export function updateLightShafts(shafts, dayAmount) {
  if (!shafts) return;

  const strength = THREE.MathUtils.clamp(Number(dayAmount) || 0, 0, 1);
  const t = performance.now() * 0.001;

  for (const shaft of shafts) {
    if (!shaft || shaft.disabled || !shaft.layers?.length) continue;

    const breathe =
      0.95 + Math.sin(t * 0.28 * (shaft.drift || 1) + shaft.phase) * 0.05;

    for (let i = 0; i < shaft.layers.length; i++) {
      const layer = shaft.layers[i];
      layer.sprite.material.opacity =
        shaft.baseOpacity * layer.weight * strength * breathe;
    }

    shaft.layers[0].sprite.position.x =
      Math.sin(t * 0.09 + shaft.phase) * 0.10;
    shaft.layers[1].sprite.position.x =
      Math.sin(t * 0.12 + shaft.phase * 1.3) * 0.04;
  }
}

export function disposeLightShafts(scene, shafts) {
  if (!shafts) return;
  for (const shaft of shafts) {
    if (!shaft) continue;
    scene.remove(shaft.sprite);
    for (const layer of shaft.layers || []) {
      layer.sprite.material?.dispose();
    }
  }
}

export function createLightShaft(...args) {
  return current.createLightShaft(...args);
}
