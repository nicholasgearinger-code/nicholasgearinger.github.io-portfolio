import * as THREE from "three";
import { sampleWeatherCpu } from "./cloudWeatherModel2.js";

// Coarse cloud-shadow projector for Rift Cloud Model 2.0.
//
// This deliberately runs on the CPU only 6-10 times per second. It projects the
// broad meteorological field along the Sun direction into a 128x128 repeating
// shadow texture. The visual cloud renderer still performs its own optical-depth
// light march; this map is for terrain/ocean/underwater consumers that need cheap
// large-scale cloud shadowing without re-raymarching the volume.

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

export function createRiftCloudShadowMap(size = 128) {
  const data = new Uint8Array(size * size * 4);
  data.fill(255);

  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.unpackAlignment = 1;
  texture.needsUpdate = true;

  const state = {
    texture,
    data,
    size,
    accumulator: 0,
    updateInterval: 1 / 8,
    averageTransmittance: 1,

    update(dt, {
      weatherPair,
      offsetA,
      offsetB,
      morph = 0,
      sunDirection,
      coverage = 0.4,
      density = 0.55,
      storm = 0,
    } = {}) {
      this.accumulator += Math.min(Math.max(Number(dt) || 0, 0), 0.25);
      if (this.accumulator < this.updateInterval) return false;
      this.accumulator %= this.updateInterval;

      if (!weatherPair?.a || !weatherPair?.b) return false;

      const sun = sunDirection || { x: 0, y: 1, z: 0 };
      const safeY = Math.max(0.12, Math.abs(Number(sun.y) || 0));
      const projectX = -(Number(sun.x) || 0) / safeY * 0.055;
      const projectY = -(Number(sun.z) || 0) / safeY * 0.055;
      const ax = Number(offsetA?.x) || 0;
      const ay = Number(offsetA?.y) || 0;
      const bx = Number(offsetB?.x) || 0;
      const by = Number(offsetB?.y) || 0;
      const blend = clamp01(morph);
      const globalCoverage = clamp01(coverage);
      const globalDensity = clamp01(density);
      const stormBoost = clamp01(storm);

      let total = 0;
      let p = 0;
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;

          // Three broad samples along the projected Sun path approximate the
          // integrated column density while keeping this update extremely cheap.
          let optical = 0;
          for (let s = 0; s < 3; s++) {
            const f = (s + 0.5) / 3;
            const su = u + projectX * f;
            const sv = v + projectY * f;
            const wa = sampleWeatherCpu(weatherPair.a, su + ax, sv + ay);
            const wb = sampleWeatherCpu(weatherPair.b, su + bx, sv + by);
            const cov = THREE.MathUtils.lerp(wa[0], wb[0], blend);
            const humidity = THREE.MathUtils.lerp(wa[2], wb[2], blend);
            const stormP = THREE.MathUtils.lerp(wa[3], wb[3], blend);
            const formed = smooth01((cov - (0.58 - globalCoverage * 0.30)) / 0.34);
            optical += formed * (0.62 + humidity * 0.22 + stormP * 0.35);
          }

          optical /= 3;
          optical *= THREE.MathUtils.lerp(0.72, 1.35, globalDensity);
          optical *= THREE.MathUtils.lerp(1, 1.35, stormBoost);
          const transmittance = Math.exp(-optical * 0.82);
          total += transmittance;

          const value = Math.round(clamp01(transmittance) * 255);
          data[p++] = value;
          data[p++] = value;
          data[p++] = value;
          data[p++] = 255;
        }
      }

      this.averageTransmittance = total / (size * size);
      texture.needsUpdate = true;
      return true;
    },

    dispose() {
      texture.dispose();
    },
  };

  return state;
}
