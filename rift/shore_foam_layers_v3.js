import * as THREE from "three";
import { polishShoreFoamLayers as polishDenseFoam } from "./shore_foam_layers_v2.js";

// Reference-driven foam polish: thick milky rafts with large clear-water holes
// and a separate bubble-cell overlay. This changes only ordinary mesh materials
// and CPU-generated alpha textures; the FFT/swash compute graph is untouched.

const DAY_FOAM = new THREE.Color(0xfffffb);
const NIGHT_FOAM = new THREE.Color(0xb9c4c6);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function makeRng(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function createMilkyRaftTexture(seed = 17) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const rng = makeRng(seed);
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Broad foam islands. Low repetition is intentional so the shoreline reads
  // as drifting rafts rather than a tiled strip.
  ctx.save();
  ctx.filter = "blur(7px)";
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 38; i++) {
    const x = rng() * canvas.width;
    const y = canvas.height * (0.18 + rng() * 0.64);
    const rx = 22 + rng() * 58;
    const ry = 11 + rng() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry));
    g.addColorStop(0, `rgba(255,255,255,${0.78 + rng() * 0.22})`);
    g.addColorStop(0.55, "rgba(235,235,235,0.82)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Cut irregular clear-water pockets through the foam mass.
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.filter = "blur(4px)";
  for (let i = 0; i < 24; i++) {
    const x = rng() * canvas.width;
    const y = canvas.height * (0.18 + rng() * 0.64);
    const rx = 8 + rng() * 30;
    const ry = 6 + rng() * 18;
    ctx.fillStyle = `rgba(0,0,0,${0.58 + rng() * 0.36})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rng() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Keep the ribbon edges softer than the center.
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const edge = ctx.createLinearGradient(0, 0, 0, canvas.height);
  edge.addColorStop(0, "rgba(255,255,255,0)");
  edge.addColorStop(0.12, "rgba(255,255,255,0.70)");
  edge.addColorStop(0.38, "rgba(255,255,255,1)");
  edge.addColorStop(0.72, "rgba(255,255,255,0.96)");
  edge.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(3.2, 1);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createBubbleCellTexture(seed = 43) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const rng = makeRng(seed);
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Dense bubble rings similar to suds: many small cells plus occasional large
  // bubbles. Rings are brighter at their rim, leaving translucent centers.
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 420; i++) {
    const x = rng() * canvas.width;
    const y = canvas.height * (0.12 + rng() * 0.76);
    const r = i < 32 ? 3.5 + rng() * 6.5 : 1.2 + rng() * 3.2;
    const alpha = 0.42 + rng() * 0.46;
    ctx.strokeStyle = `rgba(255,255,255,${alpha})`;
    ctx.lineWidth = Math.max(0.8, r * 0.24);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  // Fade bubbles toward the ribbon's edges.
  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const edge = ctx.createLinearGradient(0, 0, 0, canvas.height);
  edge.addColorStop(0, "rgba(255,255,255,0)");
  edge.addColorStop(0.18, "rgba(255,255,255,0.65)");
  edge.addColorStop(0.42, "rgba(255,255,255,1)");
  edge.addColorStop(0.82, "rgba(255,255,255,0.70)");
  edge.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(4.6, 1);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function ensureMilkyBody(handle) {
  if (!handle?.layers?.length || handle.__riftMilkyFoamConfigured) return;
  const body = handle.layers.find((layer) => layer.kind === "body");
  const edge = handle.layers.find((layer) => layer.kind === "edge");
  if (!body?.material || !body?.geometry) return;

  // Replace the tightly tiled v1 foam masks with large drifting rafts.
  try { body.material.alphaMap?.dispose?.(); } catch (_) {}
  body.material.alphaMap = createMilkyRaftTexture(17);
  body.material.alphaTest = 0.075;
  body.material.opacity = 0.97;
  body.material.roughness = 0.94;
  body.material.envMapIntensity = 0.025;
  body.material.needsUpdate = true;

  if (edge?.material) {
    try { edge.material.alphaMap?.dispose?.(); } catch (_) {}
    edge.material.alphaMap = createMilkyRaftTexture(29);
    if (edge.material.alphaMap) edge.material.alphaMap.repeat.set(5.2, 1);
    edge.material.alphaTest = 0.10;
    edge.material.opacity = 0.995;
    edge.material.roughness = 0.97;
    edge.material.envMapIntensity = 0.015;
    edge.material.needsUpdate = true;
  }

  // One extra ordinary draw call: a bubble-cell skin sharing the animated body
  // geometry. No extra simulation or vertex updates are needed.
  const bubbleMap = createBubbleCellTexture(43);
  if (bubbleMap) {
    const material = new THREE.MeshStandardMaterial({
      color: DAY_FOAM,
      transparent: true,
      opacity: 0.58,
      roughness: 1.0,
      metalness: 0,
      alphaMap: bubbleMap,
      alphaTest: 0.16,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    material.envMapIntensity = 0;
    material.emissive = new THREE.Color(0xffffff);
    material.emissiveIntensity = 0.045;

    const mesh = new THREE.Mesh(body.geometry, material);
    mesh.name = "rift-shore-foam-bubbles";
    mesh.frustumCulled = false;
    mesh.renderOrder = 13;
    mesh.position.y = 0.015;
    handle.group.add(mesh);
    handle.__riftBubbleOverlay = { mesh, material, texture: bubbleMap };
  }

  handle.__riftMilkyFoamConfigured = true;
}

export function polishMilkyShoreFoam(surfHandle, elapsed = 0, storm = 0, day = 1) {
  polishDenseFoam(surfHandle, storm, day);
  const handle = surfHandle?.__riftShoreFoamLayers;
  if (!handle) return;
  ensureMilkyBody(handle);

  const dayT = clamp01(day);
  const stormT = clamp01(storm);
  const body = handle.layers.find((layer) => layer.kind === "body");
  const edge = handle.layers.find((layer) => layer.kind === "edge");

  if (body?.material) {
    body.material.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
    body.material.opacity = Math.min(0.99, 0.88 + dayT * 0.09 + stormT * 0.025);
    body.material.roughness = 0.92 + stormT * 0.05;
    if (body.material.alphaMap) {
      body.material.alphaMap.offset.x = (elapsed * -0.0045) % 1;
    }
  }

  if (edge?.material) {
    edge.material.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
    edge.material.opacity = Math.min(1, 0.94 + dayT * 0.05 + stormT * 0.015);
    edge.material.roughness = 0.96 + stormT * 0.03;
    if (edge.material.alphaMap) {
      edge.material.alphaMap.offset.x = (elapsed * 0.007) % 1;
    }
  }

  const bubbles = handle.__riftBubbleOverlay;
  if (bubbles?.material) {
    bubbles.material.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
    bubbles.material.opacity = Math.min(0.72, 0.40 + dayT * 0.18 + stormT * 0.10);
    bubbles.material.emissiveIntensity = 0.018 + dayT * 0.045 + stormT * 0.010;
    if (bubbles.texture) bubbles.texture.offset.x = (elapsed * 0.009) % 1;
  }
}

export function disposeMilkyShoreFoam(surfHandle) {
  const handle = surfHandle?.__riftShoreFoamLayers;
  const bubbles = handle?.__riftBubbleOverlay;
  if (!bubbles) return;
  handle.group?.remove?.(bubbles.mesh);
  try { bubbles.texture?.dispose?.(); } catch (_) {}
  try { bubbles.material?.dispose?.(); } catch (_) {}
  handle.__riftBubbleOverlay = null;
}
