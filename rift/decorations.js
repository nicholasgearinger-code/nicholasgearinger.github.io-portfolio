import * as THREE from "three";
import * as current from "./decorations_underwater_base.js";

export * from "./decorations_underwater_base.js";

// Mobile-safe immersive underwater lighting for Coral Shallows.
// The original decoration system stays untouched underneath. This wrapper adds
// richer volumetric shafts, moving surface shimmer and suspended micro-particles
// without another full-screen post pass.
let underwaterShaftTexture = null;
let underwaterCausticTexture = null;
let underwaterMoteTexture = null;

function getUnderwaterShaftTexture() {
  if (underwaterShaftTexture) return underwaterShaftTexture;

  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 384;
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;

  const vertical = ctx.createLinearGradient(0, 0, 0, h);
  vertical.addColorStop(0, "rgba(255,255,255,0.98)");
  vertical.addColorStop(0.08, "rgba(235,252,255,0.82)");
  vertical.addColorStop(0.34, "rgba(178,236,246,0.34)");
  vertical.addColorStop(0.72, "rgba(104,211,230,0.11)");
  vertical.addColorStop(1, "rgba(64,188,212,0)");

  const horizontal = ctx.createLinearGradient(0, 0, w, 0);
  horizontal.addColorStop(0, "rgba(255,255,255,0)");
  horizontal.addColorStop(0.28, "rgba(255,255,255,0.35)");
  horizontal.addColorStop(0.50, "rgba(255,255,255,1)");
  horizontal.addColorStop(0.72, "rgba(255,255,255,0.35)");
  horizontal.addColorStop(1, "rgba(255,255,255,0)");

  ctx.save();
  ctx.filter = "blur(6px)";
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = vertical;
  ctx.beginPath();
  ctx.moveTo(w * 0.42, 0);
  ctx.lineTo(w * 0.58, 0);
  ctx.lineTo(w * 0.86, h);
  ctx.lineTo(w * 0.14, h);
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

function getUnderwaterCausticTexture() {
  if (underwaterCausticTexture) return underwaterCausticTexture;

  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 256);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalCompositeOperation = "lighter";

  // A compact procedural caustic atlas: overlapping warped loops create the
  // broken bright-cell look of refracted sunlight without loading a new asset.
  for (let i = 0; i < 34; i++) {
    const cx = 20 + Math.random() * 216;
    const cy = 20 + Math.random() * 216;
    const rx = 10 + Math.random() * 30;
    const ry = 6 + Math.random() * 20;
    const rot = Math.random() * Math.PI;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.strokeStyle = `rgba(225,252,255,${0.10 + Math.random() * 0.12})`;
    ctx.lineWidth = 1.4 + Math.random() * 2.2;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  ctx.filter = "blur(1.8px)";
  ctx.globalAlpha = 0.45;
  ctx.drawImage(canvas, 0, 0);

  underwaterCausticTexture = new THREE.CanvasTexture(canvas);
  underwaterCausticTexture.colorSpace = THREE.SRGBColorSpace;
  underwaterCausticTexture.wrapS = THREE.RepeatWrapping;
  underwaterCausticTexture.wrapT = THREE.RepeatWrapping;
  underwaterCausticTexture.needsUpdate = true;
  return underwaterCausticTexture;
}

function getUnderwaterMoteTexture() {
  if (underwaterMoteTexture) return underwaterMoteTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 48;
  canvas.height = 48;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.18, "rgba(220,252,255,0.72)");
  g.addColorStop(0.55, "rgba(160,232,242,0.18)");
  g.addColorStop(1, "rgba(120,210,225,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 48, 48);

  underwaterMoteTexture = new THREE.CanvasTexture(canvas);
  underwaterMoteTexture.colorSpace = THREE.SRGBColorSpace;
  return underwaterMoteTexture;
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

function makeSurfaceShimmer(rand, length) {
  const texture = getUnderwaterCausticTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0xc7fbff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
    toneMapped: true,
  });
  const size = Math.max(4.5, length * (0.62 + rand() * 0.22));
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), material);
  mesh.rotation.x = -Math.PI * 0.5;
  mesh.rotation.z = rand() * Math.PI * 2;
  mesh.position.y = -0.08 - rand() * 0.08;
  return mesh;
}

function makeMotes(rand, length) {
  const count = 10 + Math.floor(rand() * 9);
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 0.4 + rand() * Math.max(1.2, length * 0.34);
    const a = rand() * Math.PI * 2;
    positions[i * 3] = Math.cos(a) * r;
    positions[i * 3 + 1] = -rand() * length * 0.9;
    positions[i * 3 + 2] = Math.sin(a) * r;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: getUnderwaterMoteTexture(),
    color: 0xc8f8ff,
    size: 0.065 + rand() * 0.045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    alphaTest: 0.02,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    fog: true,
    toneMapped: true,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  return points;
}

export function createUnderwaterLightShaft(x, z, groundY, waterY, rand) {
  const depth = Math.max(1, waterY - groundY);
  const length = Math.min(depth, 9 + rand() * 12);
  const rotation = (rand() - 0.5) * 0.18;
  const group = new THREE.Group();
  group.position.set(x, waterY, z);

  const volume = makeRaySprite(0x65d1e4, 0, rotation);
  volume.center.set(0.5, 1);
  volume.scale.set(length * (0.56 + rand() * 0.16), length, 1);
  group.add(volume);

  const mid = makeRaySprite(0xa8edf4, 0, rotation * 0.72);
  mid.center.set(0.5, 1);
  mid.scale.set(length * (0.30 + rand() * 0.08), length * 0.96, 1);
  mid.position.y = -0.02;
  group.add(mid);

  const core = makeRaySprite(0xf3ffff, 0, rotation * 0.45);
  core.center.set(0.5, 1);
  core.scale.set(length * (0.115 + rand() * 0.035), length * 0.86, 1);
  core.position.y = -0.05;
  group.add(core);

  const shimmer = makeSurfaceShimmer(rand, length);
  group.add(shimmer);

  const motes = makeMotes(rand, length);
  group.add(motes);

  return {
    sprite: group,
    baseOpacity: 0.17 + rand() * 0.10,
    phase: rand() * Math.PI * 2,
    drift: 0.55 + rand() * 0.65,
    shimmer,
    motes,
    layers: [
      { sprite: volume, weight: 0.50 },
      { sprite: mid, weight: 0.72 },
      { sprite: core, weight: 1.0 },
    ],
  };
}

export function updateLightShafts(shafts, dayAmount) {
  if (!shafts) return;
  const strength = THREE.MathUtils.clamp(Number(dayAmount) || 0, 0, 1);
  const t = performance.now() * 0.001;

  for (const shaft of shafts) {
    if (shaft.layers) {
      const breathe = 0.86 + Math.sin(t * 0.52 * (shaft.drift || 1) + (shaft.phase || 0)) * 0.14;
      for (let i = 0; i < shaft.layers.length; i++) {
        const layer = shaft.layers[i];
        const layerPulse = 1 + Math.sin(t * (0.31 + i * 0.08) + (shaft.phase || 0) * (i + 1)) * (0.05 + i * 0.025);
        layer.sprite.material.opacity =
          shaft.baseOpacity * layer.weight * strength * breathe * layerPulse;
      }

      // Very slow motion keeps the beams alive without obvious "billboard wobble."
      shaft.layers[0].sprite.position.x = Math.sin(t * 0.16 + shaft.phase) * 0.08;
      shaft.layers[1].sprite.position.x = Math.sin(t * 0.19 + shaft.phase * 1.3) * 0.045;
      shaft.layers[2].sprite.position.x = Math.sin(t * 0.23 + shaft.phase * 1.7) * 0.022;
    } else if (shaft.sprite?.material) {
      shaft.sprite.material.opacity = shaft.baseOpacity * strength;
    }

    if (shaft.shimmer?.material) {
      const shimmerPulse = 0.70 + Math.sin(t * 0.75 + shaft.phase) * 0.18
        + Math.sin(t * 1.31 + shaft.phase * 0.63) * 0.12;
      shaft.shimmer.material.opacity = Math.max(0, 0.085 * strength * shimmerPulse);
      shaft.shimmer.rotation.z += 0.0009 * (shaft.drift || 1);
      const s = 1 + Math.sin(t * 0.29 + shaft.phase) * 0.035;
      shaft.shimmer.scale.setScalar(s);
    }

    if (shaft.motes?.material) {
      shaft.motes.material.opacity = 0.16 * strength;
      shaft.motes.rotation.y = t * 0.035 * (shaft.drift || 1) + shaft.phase;
      shaft.motes.position.x = Math.sin(t * 0.13 + shaft.phase) * 0.08;
      shaft.motes.position.z = Math.cos(t * 0.11 + shaft.phase) * 0.08;
      shaft.motes.position.y = Math.sin(t * 0.17 + shaft.phase) * 0.05;
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

    if (shaft.shimmer) {
      shaft.shimmer.geometry?.dispose();
      shaft.shimmer.material?.dispose();
    }

    if (shaft.motes) {
      shaft.motes.geometry?.dispose();
      shaft.motes.material?.dispose();
    }
  }
}

export function createLightShaft(...args) {
  return current.createLightShaft(...args);
}
