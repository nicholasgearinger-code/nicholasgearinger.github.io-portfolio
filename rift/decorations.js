import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";
import * as current from "./decorations_underwater_base.js";

export * from "./decorations_underwater_base.js";

let underwaterShaftTexture = null;
let shaftOrdinal = 0;

function getUnderwaterShaftTexture() {
  if (underwaterShaftTexture) return underwaterShaftTexture;

  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 640;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const vertical = ctx.createLinearGradient(0, 0, 0, h);
  vertical.addColorStop(0.0, "rgba(255,255,255,0.70)");
  vertical.addColorStop(0.08, "rgba(235,251,255,0.50)");
  vertical.addColorStop(0.28, "rgba(175,231,242,0.22)");
  vertical.addColorStop(0.72, "rgba(110,200,220,0.08)");
  vertical.addColorStop(1.0, "rgba(90,185,210,0.00)");

  const horizontal = ctx.createLinearGradient(0, 0, w, 0);
  horizontal.addColorStop(0.0, "rgba(255,255,255,0.00)");
  horizontal.addColorStop(0.18, "rgba(255,255,255,0.06)");
  horizontal.addColorStop(0.50, "rgba(255,255,255,0.55)");
  horizontal.addColorStop(0.82, "rgba(255,255,255,0.06)");
  horizontal.addColorStop(1.0, "rgba(255,255,255,0.00)");

  ctx.save();
  ctx.filter = "blur(18px)";
  ctx.fillStyle = vertical;
  ctx.beginPath();
  ctx.moveTo(w * 0.18, 0);
  ctx.lineTo(w * 0.82, 0);
  ctx.lineTo(w * 1.04, h);
  ctx.lineTo(w * -0.04, h);
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
  return detail >= 2 ? 5 : 6;
}

export function createUnderwaterLightShaft(x, z, groundY, waterY, rand) {
  const ordinal = shaftOrdinal++;
  const group = new THREE.Group();
  group.position.set(x, waterY + 0.08, z);

  const stride = getActiveStride();

  if (ordinal % stride !== 0) {
    group.visible = false;
    return { sprite: group, disabled: true, layers: [] };
  }

  const depth = Math.max(1, waterY - groundY);
  const length = THREE.MathUtils.clamp(depth * (1.45 + rand() * 0.18), 20, 38);
  const rotation = (rand() - 0.5) * 0.06;

  // Broad outer mist beam
  const outer = makeRaySprite(0x7fd9e9, rotation);
  outer.scale.set(length * (1.75 + rand() * 0.18), length * 1.05, 1);
  group.add(outer);

  // Softer inner beam, but not a hard spotlight core
  const inner = makeRaySprite(0xdffbff, rotation * 0.65);
  inner.scale.set(length * (0.90 + rand() * 0.10), length * 0.98, 1);
  group.add(inner);

  return {
    sprite: group,
    disabled: false,
    baseOpacity: 0.12 + rand() * 0.025,
    phase: rand() * Math.PI * 2,
    drift: 0.45 + rand() * 0.25,
    layers: [
      { sprite: outer, weight: 0.85 },
      { sprite: inner, weight: 0.48 },
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
      0.96 + Math.sin(t * 0.18 * (shaft.drift || 1) + shaft.phase) * 0.04;

    for (const layer of shaft.layers) {
      layer.sprite.material.opacity =
        shaft.baseOpacity * layer.weight * strength * breathe;
    }

    shaft.layers[0].sprite.position.x =
      Math.sin(t * 0.045 + shaft.phase) * 0.06;
    shaft.layers[1].sprite.position.x =
      Math.sin(t * 0.065 + shaft.phase * 1.2) * 0.03;
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
