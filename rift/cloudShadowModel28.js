import * as THREE from "three";
import { sampleWeatherCpu } from "./cloudWeatherModel2.js";

// -----------------------------------------------------------------------------
// Cloud Model 2.8 shadow projector.
//
// The original Model 2 shadow map used only the broad meteorological coverage
// field. That was cheap, but the resulting shadows inherited the same broad,
// soft bands that made the sky clouds look flatter than the photographic target.
//
// This keeps the same tiny 128-ish CPU texture and low update rate, but adds one
// inexpensive structured lobe mask per texel. The lobe mask is driven by the
// same moving base/detail offsets as the 3D cloud field, so shadows break into
// recognizable cumulus-sized islands instead of one continuous gray sheet.
// No extra WebGPU render pass, depth texture, or compute dispatch is introduced.
// -----------------------------------------------------------------------------

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function fract(v) {
  return v - Math.floor(v);
}

function hash2(x, y) {
  return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
}

// Four-hash value noise: deliberately only ONE broad and ONE detail evaluation
// per shadow texel (not per optical sample), keeping the CPU budget small.
function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fract(x);
  const fy = fract(y);
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(a, b, ux),
    THREE.MathUtils.lerp(c, d, ux),
    uy,
  );
}

function structuredLobe(u, v, baseOffset, detailOffset, convection) {
  const bx = Number(baseOffset?.x) || 0;
  const bz = Number(baseOffset?.z) || 0;
  const dx = Number(detailOffset?.x) || 0;
  const dz = Number(detailOffset?.z) || 0;

  // Broad cells make the primary cumulus family; the second octave cuts and
  // bulges those cells so the shadow edge has the same cauliflower character as
  // the visible cloud crowns rather than reading like a blurred weather map.
  const broad = valueNoise(u * 15.5 + bx * 113.0, v * 15.5 + bz * 113.0);
  const detail = valueNoise(u * 37.0 + dx * 79.0, v * 37.0 + dz * 79.0);
  const combined = broad * 0.76 + detail * 0.24;
  const threshold = THREE.MathUtils.lerp(0.47, 0.42, clamp01(convection));
  return smooth01((combined - threshold) / 0.25);
}

export function createRiftCloudShadowMap28(size = 128) {
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
    updateInterval: 1 / 6,
    averageTransmittance: 1,
    lastArgs: null,

    // Model 2.0 calls update() before the later wrappers finish their final
    // structure tuning. Store that call but intentionally defer the expensive
    // texture rebuild until Model 2.8 calls updateAfterTune() with the FINAL
    // coverage/density/base/detail values for this frame.
    update(_dt, args = {}) {
      this.lastArgs = args;
      return false;
    },

    updateAfterTune(dt, {
      weatherPair,
      offsetA,
      offsetB,
      morph = 0,
      sunDirection,
      coverage = 0.4,
      density = 0.55,
      storm = 0,
      convection = 0.75,
      baseOffset,
      detailOffset,
    } = {}) {
      this.accumulator += Math.min(Math.max(Number(dt) || 0, 0), 0.25);
      if (this.accumulator < this.updateInterval) return false;
      this.accumulator %= this.updateInterval;

      if (!weatherPair?.a || !weatherPair?.b) return false;

      const sun = sunDirection || { x: 0, y: 1, z: 0 };
      const safeY = Math.max(0.12, Math.abs(Number(sun.y) || 0));
      const projectX = -(Number(sun.x) || 0) / safeY * 0.058;
      const projectY = -(Number(sun.z) || 0) / safeY * 0.058;
      const ax = Number(offsetA?.x) || 0;
      const ay = Number(offsetA?.y) || 0;
      const bx = Number(offsetB?.x) || 0;
      const by = Number(offsetB?.y) || 0;
      const blend = clamp01(morph);
      const globalCoverage = clamp01(coverage);
      const globalDensity = clamp01(density);
      const stormBoost = clamp01(storm);
      const conv = clamp01(convection);

      let total = 0;
      let p = 0;
      for (let y = 0; y < size; y++) {
        const v = y / size;
        for (let x = 0; x < size; x++) {
          const u = x / size;

          // One coherent structure value per projected column. In fair weather
          // this breaks the field into discrete cloud shadows; storms deliberately
          // soften the separation toward a more continuous overcast deck.
          const lobe = structuredLobe(u, v, baseOffset, detailOffset, conv);
          const stormFill = THREE.MathUtils.lerp(lobe, 0.78 + lobe * 0.22, stormBoost);

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

            // Sharper formation threshold than Model 2.0's broad shadow field.
            // Dense cores survive, but marginal weather cells become clear sky.
            const formThreshold = 0.61 - globalCoverage * 0.34;
            const formed = smooth01((cov - formThreshold) / 0.25);
            const columnShape = formed * THREE.MathUtils.lerp(0.34, 1.12, stormFill);
            optical += columnShape * (0.58 + humidity * 0.27 + stormP * 0.38);
          }

          optical /= 3;
          optical *= THREE.MathUtils.lerp(0.76, 1.48, globalDensity);
          optical *= THREE.MathUtils.lerp(1.0, 1.38, stormBoost);

          // Slightly stronger Beer extinction and contrast than the old map makes
          // the moving shadow shapes legible on bright tropical sand.
          const transmittance = Math.pow(Math.exp(-optical * 0.96), 1.08);
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
