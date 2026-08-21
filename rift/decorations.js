import * as THREE from "three";
import * as current from "./decorations_underwater_base.js";

export * from "./decorations_underwater_base.js";

// Performance-first underwater shafts for Coral Shallows. The previous pass
// created five renderables at all 18 shaft cells (~90 extra draw calls). Keep
// only every third cell active and render each active shaft as two large,
// depth-tested sprites. This is both more cinematic and much cheaper on iOS.
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
  vertical.addColorStop(0.08, "rgba(238,253,255,0.86)");
  vertical.addColorStop(0.30, "rgba(185,239,247,0.42)");
  vertical.addColorStop(0.70, "rgba(98,207,226,0.13)");
  vertical.addColorStop(1, "rgba(70,188,211,0)");

  const horizontal = ctx.createLinearGradient(0, 0, w, 0);
  horizontal.addColorStop(0, "rgba(255,255,255,0)");
  horizontal.addColorStop(0.18, "rgba(255,255,255,0.18)");
  horizontal.addColorStop(0.50, "rgba(255,255,255,1)");
  horizontal.addColorStop(0.82, "rgba(255,255,255,0.18)");
  horizontal.addColorStop(1, "rgba(255,255,255,0)");

  ctx.save();
  ctx.filter = "blur(8px)";
  ctx.fillStyle = vertical;
  ctx.beginPath();
  ctx.moveTo(w * 0.44, 0);
  ctx.lineTo(w * 0.56, 0);
  ctx.lineTo(w * 0.94, h);
  ctx.lineTo(w * 0.06, h);
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

export function createUnderwaterLightShaft(x, z, groundY, waterY, rand) {
  const ordinal = shaftOrdinal++;
  const group = new THREE.Group();
  group.position.set(x, waterY + 0.08, z);

  // Keep the original distribution but only draw one of every three cells.
  // Inactive groups are intentionally empty, so the caller can keep its exact
  // existing handle/scene lifecycle without paying a render cost.
  if (ordinal % 3 !== 0) {
    group.visible = false;
    return { sprite: group, disabled: true, layers: [] };
  }

  const depth = Math.max(1, waterY - groundY);
  const length = THREE.MathUtils.clamp(depth * (1.18 + rand() * 0.18), 11, 27);
  const rotation = (rand() - 0.5) * 0.13;

  const volume = makeRaySprite(0x73ddec, rotation);
  volume.scale.set(length * (0.82 + rand() * 0.18), length, 1);
  group.add(volume);

  const core = makeRaySprite(0xe8fdff, rotation * 0.58);
  core.scale.set(length * (0.22 + rand() * 0.05), length * 0.88, 1);
  core.position.y = -0.04;
  group.add(core);

  return {
    sprite: group,
    disabled: false,
    baseOpacity: 0.18 + rand() * 0.07,
    phase: rand() * Math.PI * 2,
    drift: 0.65 + rand() * 0.45,
    layers: [
      { sprite: volume, weight: 0.62 },
      { sprite: core, weight: 1.00 },
    ],
  };
}

export function updateLightShafts(shafts, dayAmount) {
  if (!shafts) return;
  const strength = THREE.MathUtils.clamp(Number(dayAmount) || 0, 0, 1);
  const t = performance.now() * 0.001;

  for (const shaft of shafts) {
    if (!shaft || shaft.disabled || !shaft.layers?.length) continue;

    const breathe = 0.90 + Math.sin(t * 0.34 * (shaft.drift || 1) + shaft.phase) * 0.10;
    for (let i = 0; i < shaft.layers.length; i++) {
      const layer = shaft.layers[i];
      const pulse = 0.96 + Math.sin(t * (0.20 + i * 0.06) + shaft.phase * (1.2 + i)) * 0.04;
      layer.sprite.material.opacity = shaft.baseOpacity * layer.weight * strength * breathe * pulse;
    }

    // Broad, slow refraction-like wander. The movement is deliberately tiny;
    // the larger beam width is what creates presence, not fast billboard motion.
    shaft.layers[0].sprite.position.x = Math.sin(t * 0.10 + shaft.phase) * 0.14;
    shaft.layers[1].sprite.position.x = Math.sin(t * 0.13 + shaft.phase * 1.4) * 0.055;
  }
}

export function disposeLightShafts(scene, shafts) {
  if (!shafts) return;
  for (const shaft of shafts) {
    if (!shaft) continue;
    scene.remove(shaft.sprite);
    for (const layer of shaft.layers || []) layer.sprite.material?.dispose();
  }
}

export function createLightShaft(...args) {
  return current.createLightShaft(...args);
}
