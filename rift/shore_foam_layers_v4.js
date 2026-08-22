import * as THREE from "three";
import { polishMilkyShoreFoam as polishMilkyBase } from "./shore_foam_layers_v3.js";

const DAY_FOAM = new THREE.Color(0xfffffb);
const NIGHT_FOAM = new THREE.Color(0xb7c2c5);
const DAY_WASH = new THREE.Color(0xa8eee7);
const NIGHT_WASH = new THREE.Color(0x47777d);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function cycleEnvelope(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.18) return smooth01(p / 0.18);
  if (p < 0.34) return 1;
  return 1 - smooth01((p - 0.34) / 0.66);
}

function groundY(sample, radial) {
  if (radial < 0) {
    return THREE.MathUtils.lerp(sample.shoreY, sample.landY, clamp01(-radial / 3.0));
  }
  return THREE.MathUtils.lerp(sample.shoreY, sample.seaY, clamp01(radial / 2.4));
}

function writeVertex(array, vertexIndex, sample, radial, waterY, elapsed, lift = 0) {
  const x = sample.x + sample.outwardX * radial;
  const z = sample.z + sample.outwardZ * radial;
  const ground = groundY(sample, radial);
  const waterRipple = Math.sin(elapsed * 0.82 + sample.phase + radial * 0.35) * 0.012;
  const y = radial < 0
    ? ground + 0.025 + lift
    : Math.max(ground + 0.020 + lift, waterY + waterRipple + lift * 0.35);

  const o = vertexIndex * 3;
  array[o] = x;
  array[o + 1] = y;
  array[o + 2] = z;
}

function createSheetTexture(seed = 11) {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  let s = seed >>> 0;
  const rnd = () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };

  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.filter = "blur(5px)";
  for (let i = 0; i < 42; i++) {
    const x = rnd() * canvas.width;
    const y = canvas.height * (0.14 + rnd() * 0.72);
    const rx = 13 + rnd() * 48;
    const ry = 4 + rnd() * 15;
    ctx.fillStyle = `rgba(0,0,0,${0.52 + rnd() * 0.40})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, (rnd() - 0.5) * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  ctx.filter = "blur(1.8px)";
  ctx.strokeStyle = "rgba(0,0,0,0.48)";
  ctx.lineWidth = 2.0;
  for (let i = 0; i < 26; i++) {
    const y0 = canvas.height * (0.12 + rnd() * 0.76);
    ctx.beginPath();
    ctx.moveTo(-20, y0);
    for (let x = 0; x <= canvas.width + 20; x += 28) {
      const y = y0 + Math.sin(x * (0.010 + rnd() * 0.008) + rnd() * 6.28) * (4 + rnd() * 8);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "destination-in";
  const edge = ctx.createLinearGradient(0, 0, 0, canvas.height);
  edge.addColorStop(0.00, "rgba(255,255,255,0)");
  edge.addColorStop(0.06, "rgba(255,255,255,0.45)");
  edge.addColorStop(0.18, "rgba(255,255,255,0.92)");
  edge.addColorStop(0.78, "rgba(255,255,255,1)");
  edge.addColorStop(0.96, "rgba(255,255,255,0.60)");
  edge.addColorStop(1.00, "rgba(255,255,255,0)");
  ctx.fillStyle = edge;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.repeat.set(1.9, 1);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function configureSheetMaterials(handle) {
  if (!handle?.layers?.length || handle.__riftSwashSheetConfigured) return;
  const wash = handle.layers.find((layer) => layer.kind === "wash");
  const body = handle.layers.find((layer) => layer.kind === "body");
  const edge = handle.layers.find((layer) => layer.kind === "edge");

  if (body?.material) {
    try { body.material.alphaMap?.dispose?.(); } catch (_) {}
    body.material.alphaMap = createSheetTexture(31);
    body.material.alphaTest = 0.07;
    body.material.opacity = 0.965;
    body.material.roughness = 0.96;
    body.material.envMapIntensity = 0.015;
    body.material.needsUpdate = true;
  }

  if (edge?.material) {
    try { edge.material.alphaMap?.dispose?.(); } catch (_) {}
    edge.material.alphaMap = createSheetTexture(47);
    if (edge.material.alphaMap) edge.material.alphaMap.repeat.set(2.6, 1);
    edge.material.alphaTest = 0.09;
    edge.material.opacity = 0.995;
    edge.material.roughness = 0.98;
    edge.material.envMapIntensity = 0.01;
    edge.material.needsUpdate = true;
  }

  if (wash?.material) {
    wash.material.opacity = 0.16;
    wash.material.roughness = 0.16;
    wash.material.envMapIntensity = 0.28;
  }

  const bubbles = handle.__riftBubbleOverlay;
  if (bubbles?.material) {
    bubbles.material.opacity = 0.22;
    bubbles.material.alphaTest = 0.20;
    bubbles.material.emissiveIntensity = 0.018;
  }

  handle.__riftSwashSheetConfigured = true;
}

function animateLayerGeometry(handle, elapsed, storm = 0) {
  if (!handle?.layers?.length || !handle.samples?.length) return;
  const stormT = clamp01(storm);
  const count = handle.samples.length;
  const period = Math.max(3.9, 5.8 - stormT * 1.35);
  const basePhase = elapsed / period;

  const wash = handle.layers.find((layer) => layer.kind === "wash");
  const body = handle.layers.find((layer) => layer.kind === "body");
  const edge = handle.layers.find((layer) => layer.kind === "edge");

  for (const layer of [wash, body, edge]) {
    if (!layer?.geometry?.attributes?.position) continue;
    const arr = layer.geometry.attributes.position.array;

    for (let i = 0; i <= count; i++) {
      const s = handle.samples[i % count];
      const u = (i % count) / count;
      const localPhase =
        Math.sin(u * Math.PI * 2 * 1.7 + 0.6) * 0.022 +
        Math.sin(u * Math.PI * 2 * 3.1 + 2.0) * 0.010;
      const surge = cycleEnvelope(basePhase + localPhase);
      const secondary = cycleEnvelope(basePhase + 0.47 + localPhase * 0.55) * 0.20;
      const runup = clamp01(surge + secondary);
      const frontNoise =
        Math.sin(u * Math.PI * 2 * 5.0 + elapsed * 0.16 + s.phase * 0.10) * 0.075 +
        Math.sin(u * Math.PI * 2 * 9.0 - elapsed * 0.11) * 0.035;

      const front = -0.16 - runup * (1.78 + stormT * 0.78) + frontNoise;
      const v0 = i * 2;

      if (layer.kind === "wash") {
        const landEdge = front - 0.34 - runup * 0.20;
        const seaEdge = 1.30 - runup * 0.22;
        writeVertex(arr, v0, s, seaEdge, handle.waterY, elapsed, 0.008);
        writeVertex(arr, v0 + 1, s, landEdge, handle.waterY, elapsed, 0.010);
      } else if (layer.kind === "body") {
        const seaEdge = 1.10 - runup * 0.10;
        const landEdge = front + 0.08;
        writeVertex(arr, v0, s, seaEdge, handle.waterY, elapsed, 0.042);
        writeVertex(arr, v0 + 1, s, landEdge, handle.waterY, elapsed, 0.030);
      } else {
        const width = 0.16 + runup * 0.16 + stormT * 0.05;
        const landEdge = front - 0.025;
        const seaEdge = landEdge + width;
        writeVertex(arr, v0, s, seaEdge, handle.waterY, elapsed, 0.070);
        writeVertex(arr, v0 + 1, s, landEdge, handle.waterY, elapsed, 0.052);
      }
    }

    layer.geometry.attributes.position.needsUpdate = true;
    layer.geometry.computeBoundingSphere();
  }
}

export function updateReferenceSwashSheet(surfHandle, elapsed = 0, storm = 0, day = 1) {
  polishMilkyBase(surfHandle, elapsed, storm, day);
  const handle = surfHandle?.__riftShoreFoamLayers;
  if (!handle) return;

  configureSheetMaterials(handle);
  animateLayerGeometry(handle, Number.isFinite(elapsed) ? elapsed : 0, storm);

  const dayT = clamp01(day);
  const stormT = clamp01(storm);
  const wash = handle.layers.find((layer) => layer.kind === "wash");
  const body = handle.layers.find((layer) => layer.kind === "body");
  const edge = handle.layers.find((layer) => layer.kind === "edge");

  if (wash?.material) {
    wash.material.color.copy(NIGHT_WASH).lerp(DAY_WASH, dayT);
    wash.material.opacity = 0.10 + dayT * 0.08 + stormT * 0.03;
  }

  if (body?.material) {
    body.material.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
    body.material.opacity = Math.min(0.99, 0.90 + dayT * 0.07 + stormT * 0.02);
    if (body.material.alphaMap) body.material.alphaMap.offset.x = (elapsed * -0.0015) % 1;
  }

  if (edge?.material) {
    edge.material.color.copy(NIGHT_FOAM).lerp(DAY_FOAM, dayT);
    edge.material.opacity = Math.min(1, 0.95 + dayT * 0.045 + stormT * 0.015);
    if (edge.material.alphaMap) edge.material.alphaMap.offset.x = (elapsed * 0.0020) % 1;
  }

  const bubbles = handle.__riftBubbleOverlay;
  if (bubbles?.material) {
    bubbles.material.opacity = Math.min(0.34, 0.13 + dayT * 0.10 + stormT * 0.08);
    if (bubbles.texture) bubbles.texture.offset.x = (elapsed * 0.0035) % 1;
  }
}
