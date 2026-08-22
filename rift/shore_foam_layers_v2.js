import * as THREE from "three";

const NIGHT_FOAM = new THREE.Color(0xb7c3c6);
const DAY_FOAM = new THREE.Color(0xfffffb);
const NIGHT_EMISSIVE = new THREE.Color(0x95a8ac);
const DAY_EMISSIVE = new THREE.Color(0xffffff);
const NIGHT_WASH = new THREE.Color(0x4f7e83);
const DAY_WASH = new THREE.Color(0xa5eee7);

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function configureFoamMaterial(layer) {
  const material = layer?.material;
  if (!material || material.userData?.riftDenseFoamConfigured) return;

  material.transparent = true;
  material.depthWrite = false;
  material.blending = THREE.NormalBlending;
  material.metalness = 0;

  if (layer.kind === "wash") {
    material.roughness = 0.18;
    material.envMapIntensity = 0.34;
  } else {
    material.alphaTest = layer.kind === "body" ? 0.10 : 0.14;
    material.roughness = layer.kind === "body" ? 0.80 : 0.90;
    material.envMapIntensity = layer.kind === "body" ? 0.08 : 0.04;
    if (material.emissive?.isColor) material.emissive.copy(DAY_EMISSIVE);
  }

  material.userData = material.userData || {};
  material.userData.riftDenseFoamConfigured = true;
  material.needsUpdate = true;
}

export function polishShoreFoamLayers(surfHandle, storm = 0, day = 1) {
  const handle = surfHandle?.__riftShoreFoamLayers;
  if (!handle?.layers?.length) return;

  const dayT = clamp01(day);
  const stormT = clamp01(storm);

  for (const layer of handle.layers) {
    configureFoamMaterial(layer);
    const material = layer?.material;
    if (!material) continue;

    if (layer.kind === "wash") {
      material.color.copy(NIGHT_WASH).lerp(DAY_WASH, dayT);
      material.opacity = Math.min(0.28, 0.10 + dayT * 0.10 + stormT * 0.035);
      material.roughness = 0.16 + stormT * 0.05;
      continue;
    }

    material.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);

    if (material.emissive?.isColor) {
      material.emissive.copy(NIGHT_EMISSIVE).lerp(DAY_EMISSIVE, dayT);
    }

    if (layer.kind === "body") {
      material.opacity = Math.min(0.96, 0.78 + dayT * 0.14 + stormT * 0.04);
      material.roughness = 0.78 + stormT * 0.06;
      material.emissiveIntensity = 0.035 + dayT * 0.045 + stormT * 0.020;
    } else {
      material.opacity = Math.min(0.995, 0.86 + dayT * 0.12 + stormT * 0.03);
      material.roughness = 0.88 + stormT * 0.05;
      material.emissiveIntensity = 0.055 + dayT * 0.055 + stormT * 0.025;
    }
  }
}
