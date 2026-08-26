import * as THREE from "three";
import { bakeReferenceCloudAtlasData } from "./cloudReferenceVolumeAtlas_v3.js";

// -----------------------------------------------------------------------------
// Rift Cloud Model 4.0 — reference-reconstructed density atlas.
//
// The legacy Model 3 atlas was authored from hand-placed lobes. Model 4 keeps
// the same runtime raymarch and single 3D atlas sample, but the macro density is
// rebuilt from the actual sky reference images in rift/textures. The texture is
// created synchronously with a Model 3 fallback payload, then its byte buffer is
// replaced in-place once the small image-analysis pass finishes. Because the
// Data3DTexture object itself never changes, already-compiled TSL nodes continue
// sampling the reconstructed data without a shader rebuild.
// -----------------------------------------------------------------------------

const REFERENCE_GROUPS = [
  {
    name: "fair-day",
    channel: 0,
    targetCoverage: 0.30,
    horizonWeight: 0.78,
    sources: [
      "./textures/sky_day_1.png",
      "./textures/sky_day_2.png",
      "./textures/sky_clouds.png",
    ],
  },
  {
    name: "broken-golden",
    channel: 1,
    targetCoverage: 0.38,
    horizonWeight: 0.94,
    sources: [
      "./textures/sky_dusk_1.png",
      "./textures/sky_dusk_2.png",
      "./textures/sky_dusk_3.png",
    ],
  },
  {
    name: "sunset-banks",
    channel: 2,
    targetCoverage: 0.44,
    horizonWeight: 1.18,
    sources: [
      "./textures/sky_dusk_4.png",
      "./textures/sky_dusk_5.png",
      "./textures/sky_dusk_6.png",
    ],
  },
  {
    name: "storm-night",
    channel: 3,
    targetCoverage: 0.66,
    horizonWeight: 1.20,
    sources: [
      "./textures/sky_storm.png",
      "./textures/sky_moonlit_sea.png",
    ],
  },
];

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function smoothstep(a, b, x) {
  return smooth01((x - a) / Math.max(1e-6, b - a));
}

function positiveMod(n, m) {
  return ((n % m) + m) % m;
}

function voxelIndex(x, y, z, width, height) {
  return x + width * (y + height * z);
}

function percentile(values, q) {
  if (!values.length) return 0;
  const copy = Array.from(values).sort((a, b) => a - b);
  const index = Math.max(0, Math.min(copy.length - 1, Math.floor((copy.length - 1) * clamp01(q))));
  return copy[index];
}

function canvas2D(width, height) {
  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return ctx ? { canvas, ctx } : null;
  }
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    return ctx ? { canvas, ctx } : null;
  }
  return null;
}

async function loadBitmap(url) {
  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
  const blob = await response.blob();
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }
  if (typeof document === "undefined") throw new Error("Image decoding unavailable");
  const imageUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = imageUrl;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(imageUrl);
  }
}

function boxBlurScalar(source, width, height, radius = 1) {
  if (radius <= 0) return source.slice();
  const temp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const span = radius * 2 + 1;

  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) {
      sum += source[y * width + positiveMod(x, width)];
    }
    for (let x = 0; x < width; x++) {
      temp[y * width + x] = sum / span;
      sum -= source[y * width + positiveMod(x - radius, width)];
      sum += source[y * width + positiveMod(x + radius + 1, width)];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) {
      const yy = Math.max(0, Math.min(height - 1, y));
      sum += temp[yy * width + x];
    }
    for (let y = 0; y < height; y++) {
      out[y * width + x] = sum / span;
      const y0 = Math.max(0, Math.min(height - 1, y - radius));
      const y1 = Math.max(0, Math.min(height - 1, y + radius + 1));
      sum -= temp[y0 * width + x];
      sum += temp[y1 * width + x];
    }
  }
  return out;
}

function rowMedian(field, width, height, y) {
  const values = [];
  const stride = width > 80 ? 3 : 2;
  for (let x = 0; x < width; x += stride) values.push(field[y * width + x]);
  return percentile(values, 0.50);
}

function computeMaskFromPixels(pixels, width, height, targetCoverage, horizonWeight) {
  const count = width * height;
  const luma = new Float32Array(count);
  const sat = new Float32Array(count);
  const alpha = new Float32Array(count);
  let transparentPixels = 0;

  for (let i = 0; i < count; i++) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;
    const a = pixels[i * 4 + 3] / 255;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    luma[i] = r * 0.2126 + g * 0.7152 + b * 0.0722;
    sat[i] = mx > 1e-4 ? (mx - mn) / mx : 0;
    alpha[i] = a;
    if (a < 0.985) transparentPixels++;
  }

  if (transparentPixels > count * 0.03) {
    const direct = new Float32Array(count);
    for (let i = 0; i < count; i++) direct[i] = smoothstep(0.04, 0.82, alpha[i]);
    return boxBlurScalar(direct, width, height, 1);
  }

  const localLuma = boxBlurScalar(luma, width, height, Math.max(1, Math.round(width / 42)));
  const localSat = boxBlurScalar(sat, width, height, Math.max(1, Math.round(width / 56)));
  const score = new Float32Array(count);
  const samples = [];

  for (let y = 0; y < height; y++) {
    const baseL = rowMedian(localLuma, width, height, y);
    const baseS = rowMedian(localSat, width, height, y);
    const v = y / Math.max(1, height - 1);
    const horizon = smoothstep(0.52, 0.94, v);
    const terrainFade = 1 - smoothstep(0.90, 1.0, v);

    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const L = luma[i];
      const S = sat[i];
      const dL = Math.abs(L - baseL);
      const dS = Math.abs(S - baseS);
      const texture = Math.abs(L - localLuma[i]);
      const neutrality = 1 - S;
      const brightNeutral = Math.max(0, L - baseL) * neutrality;
      const darkMass = Math.max(0, baseL - L) * (0.55 + neutrality * 0.45);

      let s = dL * 1.16 + dS * 0.54 + texture * 1.12;
      s += brightNeutral * 0.66 + darkMass * 0.88;
      s *= THREE.MathUtils.lerp(1.0, horizonWeight, horizon);
      s *= terrainFade;

      const p = i * 4;
      const r = pixels[p] / 255;
      const g = pixels[p + 1] / 255;
      const b = pixels[p + 2] / 255;
      const clippedWarm = L > 0.965 && r > 0.94 && g > 0.82 && b < 0.90;
      if (clippedWarm) s *= 0.08;

      score[i] = s;
      if (terrainFade > 0.4) samples.push(s);
    }
  }

  const threshold = percentile(samples, 1 - clamp01(targetCoverage));
  const low = Math.max(0.006, threshold * 0.68);
  const high = Math.max(low + 0.012, threshold * 1.36);
  const mask = new Float32Array(count);
  for (let i = 0; i < count; i++) mask[i] = smoothstep(low, high, score[i]);
  return boxBlurScalar(boxBlurScalar(mask, width, height, 1), width, height, 1);
}

function maskStats(mask, width, height) {
  let sum = 0;
  let weightedY = 0;
  let weightedX = 0;
  let peak = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = mask[y * width + x];
      sum += v;
      weightedX += x * v;
      weightedY += y * v;
      peak = Math.max(peak, v);
    }
  }
  const denom = Math.max(1e-6, sum);
  return {
    coverage: sum / (width * height),
    centroidX: weightedX / denom / Math.max(1, width - 1),
    centroidY: weightedY / denom / Math.max(1, height - 1),
    peak,
  };
}

function analyzeReferenceColor(pixels, mask, width, height) {
  const cloud = [];
  const clear = [];
  let sunX = 0;
  let sunY = 0;
  let sunWeight = 0;
  let sunCount = 0;

  for (let y = 0; y < height; y++) {
    const v = y / Math.max(1, height - 1);
    if (v > 0.94) continue;
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      const r = pixels[p] / 255;
      const g = pixels[p + 1] / 255;
      const b = pixels[p + 2] / 255;
      const L = r * 0.2126 + g * 0.7152 + b * 0.0722;
      const m = mask[i];

      if (m > 0.58) cloud.push([r, g, b, L]);
      else if (m < 0.15) clear.push([r, g, b, L, v]);

      const warm = r * 0.62 + g * 0.38 - b * 0.34;
      const solar = smoothstep(0.88, 0.995, L) * smoothstep(0.18, 0.55, warm) * (1 - m);
      if (solar > 0.05) {
        sunX += x * solar;
        sunY += y * solar;
        sunWeight += solar;
        sunCount++;
      }
    }
  }

  const byLuma = (a, b) => a[3] - b[3];
  cloud.sort(byLuma);
  clear.sort(byLuma);
  const cloudShadow = cloud.length ? cloud[Math.floor(cloud.length * 0.20)] : null;
  const cloudLight = cloud.length ? cloud[Math.floor(cloud.length * 0.82)] : null;
  const horizonClear = clear.filter((v) => v[4] > 0.66);
  const horizon = horizonClear.length ? horizonClear[Math.floor(horizonClear.length * 0.55)] : null;
  const color = (v, fallback) => v ? [v[0], v[1], v[2]] : fallback;

  return {
    cloudShadow: color(cloudShadow, [0.46, 0.52, 0.63]),
    cloudLight: color(cloudLight, [0.92, 0.93, 0.94]),
    horizon: color(horizon, [0.82, 0.72, 0.66]),
    sun: sunWeight > 0.25 && sunCount >= 2
      ? {
          x: sunX / sunWeight / Math.max(1, width - 1),
          y: sunY / sunWeight / Math.max(1, height - 1),
          apparentRadius: Math.sqrt(sunCount / Math.PI) / Math.max(width, height),
          confidence: clamp01(sunWeight / Math.max(1, sunCount)),
        }
      : null,
  };
}

async function extractReference(source, width, height, group) {
  const url = new URL(source, import.meta.url);
  const bitmap = await loadBitmap(url);
  const target = canvas2D(width, height);
  if (!target) throw new Error("Canvas2D unavailable for reference reconstruction");

  target.ctx.clearRect(0, 0, width, height);
  target.ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const imageData = target.ctx.getImageData(0, 0, width, height);
  const mask = computeMaskFromPixels(
    imageData.data,
    width,
    height,
    group.targetCoverage,
    group.horizonWeight,
  );

  return {
    source,
    mask,
    stats: maskStats(mask, width, height),
    color: analyzeReferenceColor(imageData.data, mask, width, height),
  };
}

function combineMasks(references, width, height) {
  const count = width * height;
  const combined = new Float32Array(count);
  if (!references.length) return combined;
  for (let i = 0; i < count; i++) {
    let peak = 0;
    let avg = 0;
    for (const reference of references) {
      const v = reference.mask[i];
      peak = Math.max(peak, v);
      avg += v;
    }
    avg /= references.length;
    combined[i] = clamp01(peak * 0.58 + avg * 0.52);
  }
  return boxBlurScalar(combined, width, height, 1);
}

function insideDistance(mask, width, height) {
  const INF = 1e6;
  const dist = new Float32Array(width * height);
  const SQRT2 = Math.SQRT2;
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] > 0.36 ? INF : 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 1);
      if (y > 0) d = Math.min(d, dist[i - width] + 1);
      if (x > 0 && y > 0) d = Math.min(d, dist[i - width - 1] + SQRT2);
      if (x + 1 < width && y > 0) d = Math.min(d, dist[i - width + 1] + SQRT2);
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      let d = dist[i];
      if (x + 1 < width) d = Math.min(d, dist[i + 1] + 1);
      if (y + 1 < height) d = Math.min(d, dist[i + width] + 1);
      if (x + 1 < width && y + 1 < height) d = Math.min(d, dist[i + width + 1] + SQRT2);
      if (x > 0 && y + 1 < height) d = Math.min(d, dist[i + width - 1] + SQRT2);
      dist[i] = d;
    }
  }
  return dist;
}

function sampleMask(mask, width, height, x, y) {
  const fx = positiveMod(x, width);
  const fy = Math.max(0, Math.min(height - 1.001, y));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = positiveMod(x0 + 1, width);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = mask[y0 * width + x0] * (1 - tx) + mask[y0 * width + x1] * tx;
  const b = mask[y1 * width + x0] * (1 - tx) + mask[y1 * width + x1] * tx;
  return a * (1 - ty) + b * ty;
}

function inflateMaskToChannel(mask, width, height, depth, channel, output) {
  const dist = insideDistance(mask, width, height);
  const distanceNorm = Math.max(4, Math.min(width, height) * 0.22);

  for (let z = 0; z < depth; z++) {
    const nz = (z + 0.5) / depth;
    const phase = nz * Math.PI * 2;
    const shiftX = Math.sin(phase * 1.00 + channel * 1.31) * width * 0.052
      + Math.sin(phase * 2.0 + 0.7) * width * 0.018;
    const shiftY = Math.cos(phase * 1.35 + channel * 0.93) * height * 0.018;

    for (let y = 0; y < height; y++) {
      const sourceY = height - 1 - y + shiftY;
      const height01 = (y + 0.5) / height;
      const baseGate = smoothstep(0.012, 0.075, height01);
      const topGate = 1 - smoothstep(0.93, 1.0, height01);

      for (let x = 0; x < width; x++) {
        const sx = x - shiftX;
        const m = sampleMask(mask, width, height, sx, sourceY);
        if (m < 0.015) continue;
        const dix = positiveMod(Math.round(sx), width);
        const diy = Math.max(0, Math.min(height - 1, Math.round(sourceY)));
        const d = clamp01(dist[diy * width + dix] / distanceNorm);
        const thickness = THREE.MathUtils.lerp(0.035, 0.37, Math.pow(d, 0.62)) + m * 0.055;
        const centerZ = 0.5
          + Math.sin((x / width) * Math.PI * 2.0 + channel * 0.7) * 0.040
          + Math.cos((y / height) * Math.PI * 3.0 + channel) * 0.018;
        let dz = Math.abs(nz - centerZ);
        dz = Math.min(dz, 1 - dz);
        const depthGate = 1 - smoothstep(thickness * 0.66, thickness, dz);
        if (depthGate <= 0) continue;
        const core = clamp01(m * (0.68 + d * 0.42) * depthGate * baseGate * topGate);
        const i = voxelIndex(x, y, z, width, height) * 4 + channel;
        output[i] = Math.max(output[i], Math.round(Math.pow(core, 0.92) * 255));
      }
    }
  }
}

function averageTriples(values, fallback) {
  if (!values.length) return fallback.slice();
  const out = [0, 0, 0];
  for (const v of values) {
    out[0] += v[0];
    out[1] += v[1];
    out[2] += v[2];
  }
  out[0] /= values.length;
  out[1] /= values.length;
  out[2] /= values.length;
  return out;
}

function summarizeCalibration(groups) {
  const frames = groups.flatMap((g) => g.references);
  const suns = frames.map((f) => f.color.sun).filter(Boolean);
  return {
    frameCount: frames.length,
    cloudLight: averageTriples(frames.map((f) => f.color.cloudLight), [0.92, 0.93, 0.94]),
    cloudShadow: averageTriples(frames.map((f) => f.color.cloudShadow), [0.42, 0.49, 0.61]),
    horizon: averageTriples(frames.map((f) => f.color.horizon), [0.82, 0.72, 0.66]),
    sun: suns.length
      ? {
          x: suns.reduce((a, s) => a + s.x, 0) / suns.length,
          y: suns.reduce((a, s) => a + s.y, 0) / suns.length,
          apparentRadius: suns.reduce((a, s) => a + s.apparentRadius, 0) / suns.length,
          confidence: suns.reduce((a, s) => a + s.confidence, 0) / suns.length,
        }
      : null,
  };
}

async function rebuildAtlas(handle) {
  const { width, height, depth } = handle;
  const output = new Uint8Array(width * height * depth * 4);
  const analyzedGroups = [];

  for (const group of REFERENCE_GROUPS) {
    const references = [];
    for (const source of group.sources) {
      try {
        references.push(await extractReference(source, width, height, group));
      } catch (error) {
        console.warn(`[rift-model4] Reference reconstruction skipped ${source}`, error);
      }
    }
    if (!references.length) continue;
    const combined = combineMasks(references, width, height);
    inflateMaskToChannel(combined, width, height, depth, group.channel, output);
    analyzedGroups.push({ ...group, references, combinedStats: maskStats(combined, width, height) });
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (!analyzedGroups.length) throw new Error("No reference sky images could be reconstructed");
  handle.texture.image.data = output;
  handle.texture.needsUpdate = true;
  handle.bytes = output.byteLength;
  handle.ready = true;
  handle.groups = analyzedGroups;
  handle.calibration = summarizeCalibration(analyzedGroups);

  globalThis.__riftReferenceReconstruction = {
    active: true,
    ready: true,
    version: "4.0-reference-reconstructed-volume",
    width,
    height,
    depth,
    bytes: output.byteLength,
    groups: analyzedGroups.map((group) => ({
      name: group.name,
      channel: group.channel,
      references: group.references.map((ref) => ({ source: ref.source, stats: ref.stats, sun: ref.color.sun })),
      combinedStats: group.combinedStats,
    })),
    calibration: handle.calibration,
  };
  return handle;
}

export function createReferenceReconstructedCloudAtlas({ width = 64, height = 46, depth = 64 } = {}) {
  const fallback = bakeReferenceCloudAtlasData({ width, height, depth });
  const texture = new THREE.Data3DTexture(fallback.data, width, height, depth);
  texture.name = "rift-reference-reconstructed-cloud-atlas-v40";
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.wrapR = THREE.RepeatWrapping;
  texture.unpackAlignment = 1;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;

  const handle = {
    texture,
    width,
    height,
    depth,
    bytes: fallback.data.byteLength,
    ready: false,
    groups: null,
    calibration: null,
    error: null,
    promise: null,
    dispose() { texture.dispose(); },
  };

  globalThis.__riftReferenceReconstruction = {
    active: true,
    ready: false,
    version: "4.0-reference-reconstructed-volume",
    width,
    height,
    depth,
    bytes: fallback.data.byteLength,
  };

  handle.promise = rebuildAtlas(handle).catch((error) => {
    handle.error = error;
    console.warn("[rift-model4] Falling back to Model 3.3 authored atlas data", error);
    globalThis.__riftReferenceReconstruction = {
      ...(globalThis.__riftReferenceReconstruction || {}),
      active: true,
      ready: false,
      fallback: true,
      error: String(error?.message || error),
    };
    return handle;
  });

  return handle;
}
