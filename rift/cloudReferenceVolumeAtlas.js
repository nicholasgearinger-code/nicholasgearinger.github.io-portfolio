import * as THREE from "three";
import {
  REFERENCE_CLOUD_ARCHETYPE_LIST,
} from "./cloudArchetypes_reference_v1.js";

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function positiveMod(n, m) {
  return ((n % m) + m) % m;
}

function unionDensity(current, contribution) {
  return 1 - (1 - current) * (1 - contribution);
}

function voxelIndex(x, y, z, width, height) {
  return x + width * (y + height * z);
}

function rasterizeArchetype(channelData, archetype, width, height, depth) {
  const baseFloor = archetype.baseFloor ?? 0.04;
  const baseSoftness = Math.max(0.01, archetype.baseSoftness ?? 0.04);

  for (const lobe of archetype.lobes) {
    const x0 = Math.floor((lobe.x - lobe.rx) * width) - 1;
    const x1 = Math.ceil((lobe.x + lobe.rx) * width) + 1;
    const z0 = Math.floor((lobe.z - lobe.rz) * depth) - 1;
    const z1 = Math.ceil((lobe.z + lobe.rz) * depth) + 1;
    const y0 = Math.max(0, Math.floor((lobe.y - lobe.ry) * height) - 1);
    const y1 = Math.min(height - 1, Math.ceil((lobe.y + lobe.ry) * height) + 1);

    for (let zi = z0; zi <= z1; zi++) {
      const nz = (zi + 0.5) / depth;
      const dz = (nz - lobe.z) / Math.max(1e-5, lobe.rz);
      const dz2 = dz * dz;
      if (dz2 >= 1) continue;
      const zw = positiveMod(zi, depth);

      for (let yi = y0; yi <= y1; yi++) {
        const ny = (yi + 0.5) / height;
        const dy = (ny - lobe.y) / Math.max(1e-5, lobe.ry);
        const yz2 = dy * dy + dz2;
        if (yz2 >= 1) continue;

        const baseGate = smooth01((ny - baseFloor) / baseSoftness);
        const topGate = 1 - smooth01((ny - 0.92) / 0.07);
        const verticalGate = baseGate * topGate;
        if (verticalGate <= 0) continue;

        for (let xi = x0; xi <= x1; xi++) {
          const nx = (xi + 0.5) / width;
          const dx = (nx - lobe.x) / Math.max(1e-5, lobe.rx);
          const d2 = dx * dx + yz2;
          if (d2 >= 1) continue;

          const core = Math.pow(
            1 - d2,
            Math.max(0.25, lobe.power ?? 1.65),
          );
          const contribution = clamp01(
            core * (lobe.density ?? 1) * verticalGate,
          );
          const xw = positiveMod(xi, width);
          const idx = voxelIndex(xw, yi, zw, width, height);
          channelData[idx] = unionDensity(channelData[idx], contribution);
        }
      }
    }
  }
}

export function bakeReferenceCloudAtlasData({
  width = 64,
  height = 40,
  depth = 64,
} = {}) {
  const voxelCount = width * height * depth;
  const channels = [
    new Float32Array(voxelCount),
    new Float32Array(voxelCount),
    new Float32Array(voxelCount),
    new Float32Array(voxelCount),
  ];

  for (const archetype of REFERENCE_CLOUD_ARCHETYPE_LIST) {
    rasterizeArchetype(
      channels[archetype.channel],
      archetype,
      width,
      height,
      depth,
    );
  }

  const data = new Uint8Array(voxelCount * 4);
  for (let i = 0; i < voxelCount; i++) {
    for (let c = 0; c < 4; c++) {
      const density = Math.pow(clamp01(channels[c][i]), 0.82);
      data[i * 4 + c] = Math.round(density * 255);
    }
  }

  return { data, width, height, depth };
}

export function createReferenceCloudAtlas(options = {}) {
  const baked = bakeReferenceCloudAtlasData(options);
  const texture = new THREE.Data3DTexture(
    baked.data,
    baked.width,
    baked.height,
    baked.depth,
  );
  texture.name = "rift-reference-shaped-cloud-atlas";
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

  return {
    texture,
    width: baked.width,
    height: baked.height,
    depth: baked.depth,
    bytes: baked.data.byteLength,
    dispose() {
      texture.dispose();
    },
  };
}
