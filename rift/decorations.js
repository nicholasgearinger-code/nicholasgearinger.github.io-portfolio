import * as THREE from "three";
import * as current from "./decorations_underwater_base.js";

export * from "./decorations_underwater_base.js";

// Mobile-safe underwater god rays. The original decoration system remains
// untouched underneath; only the Coral Shallows underwater shaft is replaced
// with a two-layer sprite beam (soft volume + narrow bright core).
let underwaterShaftTexture = null;

function getUnderwaterShaftTexture() {
  if (underwaterShaftTexture) return underwaterShaftTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const vertical = ctx.createLinearGradient(0, 0, 0, h);
  vertical.addColorStop(0, "rgba(255,255,255,0.90)");
  vertical.addColorStop(0.16, "rgba(235,253,255,0.62)");
  vertical.addColorStop(0.58, "rgba(185,238,247,0.18)");
  vertical.addColorStop(1, "rgba(130,220,235,0)");

  ctx.filter = "blur(5px)";
  ctx.fillStyle = vertical;
  ctx.beginPath();
  ctx.moveTo(w * 0.45, 0);
  ctx.lineTo(w * 0.55, 0);
  ctx.lineTo(w * 0.78, h);
  ctx.lineTo(w * 0.22, h);
  ctx.closePath();
  ctx.fill();

  underwaterShaftTexture = new THREE.CanvasTexture(canvas);
  underwaterShaftTexture.colorSpace = THREE.SRGBColorSpace;
  return underwaterShaftTexture;
}

function makeRaySprite(color, opacity, rotation) {
  const material = new THREE.SpriteMaterial({
    map: getUnderwaterShaftTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fog: true,
    rotation,
    toneMapped: true,
  });
  return new THREE.Sprite(material);
}

export function createUnderwaterLightShaft(x, z, groundY, waterY, rand) {
  const depth = Math.max(1, waterY - groundY);
  const length = Math.min(depth, 8 + rand() * 10);
  const rotation = (rand() - 0.5) * 0.16;
  const group = new THREE.Group();
  group.position.set(x, waterY, z);

  const volume = makeRaySprite(0x8edbe8, 0, rotation);
  volume.center.set(0.5, 1);
  volume.scale.set(length * (0.42 + rand() * 0.12), length, 1);
  group.add(volume);

  const core = makeRaySprite(0xe5fbff, 0, rotation * 0.55);
  core.center.set(0.5, 1);
  core.scale.set(length * (0.16 + rand() * 0.05), length * 0.92, 1);
  core.position.y = -0.03;
  group.add(core);

  return {
    sprite: group,
    baseOpacity: 0.18 + rand() * 0.12,
    layers: [
      { sprite: volume, weight: 0.70 },
      { sprite: core, weight: 1.0 },
    ],
  };
}

export function updateLightShafts(shafts, dayAmount) {
  if (!shafts) return;
  const strength = Math.max(0, dayAmount);
  for (const shaft of shafts) {
    if (shaft.layers) {
      for (const layer of shaft.layers) {
        layer.sprite.material.opacity = shaft.baseOpacity * layer.weight * strength;
      }
    } else if (shaft.sprite?.material) {
      shaft.sprite.material.opacity = shaft.baseOpacity * strength;
    }
  }
}

export function disposeLightShafts(scene, shafts) {
  if (!shafts) return;
  for (const shaft of shafts) {
    scene.remove(shaft.sprite);
    if (shaft.layers) {
      for (const layer of shaft.layers) layer.sprite.material?.dispose();
    } else {
      shaft.sprite?.material?.dispose();
    }
  }
}

export function createLightShaft(...args) {
  return current.createLightShaft(...args);
}
