import * as THREE from "three";
import { Fn, uniform, vec2, vec3, vec4, float, texture3D, uv, If, dot, mix, clamp, pow, exp, normalize, smoothstep, max as tslMax, min as tslMin } from "three/tsl";

// -----------------------------------------------------------------------------
// Real raymarched volumetric clouds — per explicit "in addition to the
// background we already have to have depth... 3D dense cloud with real
// dynamic ray marching shader." This is a SEPARATE, additive layer: it
// doesn't touch or replace the existing flat cloud dome (clouds.js) at
// all — it composites on top of whatever's already rendered, adding a
// genuine sense of depth (parallax as you move, real self-shadowing, real
// light scattering) that a flat sprite/dome layer structurally can't do.
//
// Two distinct halves, worth keeping straight:
// 1. A 3D density VOLUME, baked ONCE on the CPU at startup (see
//    buildCloudDensityTexture below) — Worley+value-noise FBM, the
//    standard technique for this look (the same broad approach real-time
//    cloud systems like Horizon Zero Dawn's Nubis use: bake noise once,
//    animate by SCROLLING through it, not by regenerating it every
//    frame). This is what makes it "3D dense" — an actual volume, not a
//    2D texture pretending to be one.
// 2. A per-pixel RAYMARCH through that volume, run fresh every single
//    frame in the shader below — THIS is the "real dynamic" half: real
//    lighting (sun angle/color, forward scattering, lightning), real
//    self-shadowing (density blocks light from reaching deeper parts of
//    the cloud), genuine parallax as the camera moves. The volume data
//    is static; everything about how it's LIT and traversed is fully
//    live.
// -----------------------------------------------------------------------------

// Deterministic integer hash -> [0,1). Not cryptographic — just needs to
// be fast and look uncorrelated at the scales this noise bake uses.
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967295;
}

function lerp(a, b, t) { return a + (b - a) * t; }
function smootherstep(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

// Tileable 3D value noise — frequency MUST be an integer divisor of `size`
// for this to wrap seamlessly (every octave below uses one), since lattice
// coordinates are taken mod `size` before hashing.
function valueNoise3D(size, freq, x, y, z, seed) {
  const scale = freq / size;
  const px = x * scale, py = y * scale, pz = z * scale;
  const xi = Math.floor(px), yi = Math.floor(py), zi = Math.floor(pz);
  const xf = smootherstep(px - xi), yf = smootherstep(py - yi), zf = smootherstep(pz - zi);
  const w = (a, b, c) => hash3(((a % freq) + freq) % freq + seed * 101, ((b % freq) + freq) % freq + seed * 131, ((c % freq) + freq) % freq + seed * 167);
  const c000 = w(xi, yi, zi), c100 = w(xi + 1, yi, zi), c010 = w(xi, yi + 1, zi), c110 = w(xi + 1, yi + 1, zi);
  const c001 = w(xi, yi, zi + 1), c101 = w(xi + 1, yi, zi + 1), c011 = w(xi, yi + 1, zi + 1), c111 = w(xi + 1, yi + 1, zi + 1);
  const x00 = lerp(c000, c100, xf), x10 = lerp(c010, c110, xf), x01 = lerp(c001, c101, xf), x11 = lerp(c011, c111, xf);
  const y0 = lerp(x00, x10, yf), y1 = lerp(x01, x11, yf);
  return lerp(y0, y1, zf);
}

// Tileable 3D Worley (cellular) noise — one random feature point per grid
// cell, checked against the 26 neighboring cells (with wraparound) so
// tiles seam-free. Returns normalized min-distance, 0 at a feature point
// rising toward 1 at a cell's farthest corner — inverted by the caller to
// turn this into "billowy" cloud-blob density (high near feature points).
function worleyNoise3D(size, cells, x, y, z, seed) {
  const scale = cells / size;
  const px = x * scale, py = y * scale, pz = z * scale;
  const xi = Math.floor(px), yi = Math.floor(py), zi = Math.floor(pz);
  let minDist = 999;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ((xi + dx) % cells + cells) % cells;
        const cy = ((yi + dy) % cells + cells) % cells;
        const cz = ((zi + dz) % cells + cells) % cells;
        const fx = cx + hash3(cx + seed * 17, cy + seed * 29, cz + seed * 41);
        const fy = cy + hash3(cx + seed * 53, cy + seed * 61, cz + seed * 71);
        const fz = cz + hash3(cx + seed * 89, cy + seed * 97, cz + seed * 103);
        const ddx = (xi + dx) + (fx - cx) - px, ddy = (yi + dy) + (fy - cy) - py, ddz = (zi + dz) + (fz - cz) - pz;
        const d = Math.sqrt(ddx * ddx + ddy * ddy + ddz * ddz);
        if (d < minDist) minDist = d;
      }
    }
  }
  return Math.min(1, minDist);
}

// Builds the actual density volume. size=48 keeps the one-time CPU bake
// well under a second while still giving real 3D detail once scrolled
// through slowly by the raymarch below — this data is scrolled/animated,
// not regenerated, so it doesn't need to be large to read as "dense."
function buildCloudDensityTexture(size = 48) {
  const data = new Uint8Array(size * size * size);
  for (let z = 0; z < size; z++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        // Coarse Worley layer, inverted: the big billowy cloud-cluster
        // shape (real cumulus reads as rounded blobs, not uniform haze).
        const billowLow = 1 - worleyNoise3D(size, 4, x, y, z, 1);
        const billowMid = 1 - worleyNoise3D(size, 8, x, y, z, 2);
        // Value-noise FBM for wispy fine detail layered on top of the
        // billowy base — 3 octaves, each an integer frequency divisor of
        // `size` so every octave still tiles seamlessly.
        let fbm = 0, amp = 0.5, freq = 4;
        for (let o = 0; o < 3; o++) {
          fbm += valueNoise3D(size, freq, x, y, z, o + 10) * amp;
          amp *= 0.5;
          freq *= 2;
        }
        // Coverage mask — a real gap between cloud clusters instead of
        // wall-to-wall haze, per "3D dense cloud" reading as distinct
        // formations rather than an even fog layer.
        const coverage = smootherstep(Math.max(0, Math.min(1, (billowLow - 0.35) / 0.4)));
        let density = (billowMid * 0.55 + fbm * 0.45) * coverage;
        density = Math.max(0, Math.min(1, (density - 0.15) / 0.6)); // remap/sharpen edges
        data[x + y * size + z * size * size] = Math.round(density * 255);
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, size, size, size);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Creates the whole layer: bakes the density volume once, sets up every
// uniform the raymarch needs, and builds the actual TSL shader graph.
// Returns { node, uniforms } — `node` is a vec4 (rgb = in-scattered light
// already weighted by density/phase/shadowing, a = transmittance, i.e.
// how much of whatever's BEHIND the clouds still shows through) meant to
// be composited as: finalRGB = backgroundRGB * node.a + node.rgb — the
// standard physically-based volumetric-over-background blend. `uniforms`
// is what the per-frame update call (see updateVolumetricClouds below)
// actually writes into.
export function createVolumetricClouds() {
  const densityTexture = buildCloudDensityTexture(48);

  const uniforms = {
    cameraForward: uniform(vec3(0, 0, -1)),
    cameraRight: uniform(vec3(1, 0, 0)),
    cameraUp: uniform(vec3(0, 1, 0)),
    cameraPos: uniform(vec3(0, 0, 0)),
    tanHalfFov: uniform(0.7),
    aspect: uniform(1.6),
    sunDir: uniform(vec3(0, 1, 0)),
    sunColor: uniform(vec3(1, 0.95, 0.85)),
    ambientColor: uniform(vec3(0.4, 0.48, 0.6)),
    lightningFlash: uniform(0),
    lightningColor: uniform(vec3(0.8, 0.87, 1)),
    scrollOffset: uniform(vec3(0, 0, 0)),
    coverage: uniform(0.5), // overall sky coverage, 0=clear 1=overcast — biome/weather can drive this later without touching the shader
  };

  const CLOUD_BASE = float(130);
  const CLOUD_TOP = float(220);
  // Per real concern about shader compile cost — this project has no
  // precedent anywhere yet for TSL's Loop() construct (a genuine
  // GPU-side runtime loop), only JS-level `for` loops that get fully
  // UNROLLED into the compiled shader at build time (the same technique
  // already proven working in this file's own lens-rain shader, ROWS_PER_LANE).
  // Since that's the only pattern with a track record in this exact
  // codebase, it's what's used here too — but unrolling is real,
  // multiplying instruction count directly, so both step counts are kept
  // deliberately conservative (16 main x 3 shadow = 48 texture3D samples
  // baked into the shader, not 140) rather than guessing higher without
  // a way to check actual compile time/mobile behavior first. Raise
  // these only after confirming on real hardware that there's headroom.
  const STEP_COUNT = 16;
  const SHADOW_STEP_COUNT = 3;
  const TILE_SCALE = float(0.006); // world-units -> noise-volume UV scale; bigger clouds = smaller number

  const node = Fn(() => {
    const screenUV = uv();
    const ndcX = screenUV.x.mul(2).sub(1);
    // Per this project's own established convention (re-derived and
    // confirmed several times already this session, see the lens shader's
    // own notes): increasing screenUV.y reads as visually DOWN here, so
    // going "up" on screen needs a NEGATED y term — flipped directly per
    // that same confirmed convention rather than re-guessing it.
    const ndcY = screenUV.y.mul(2).sub(1).negate();
    const rayDir = normalize(
      uniforms.cameraForward
        .add(uniforms.cameraRight.mul(ndcX).mul(uniforms.tanHalfFov).mul(uniforms.aspect))
        .add(uniforms.cameraUp.mul(ndcY).mul(uniforms.tanHalfFov))
    );

    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    // Real early-out — a ray pointed anywhere near level or downward
    // essentially never reaches the cloud band (base is 130 units up),
    // so skip the whole march for the (typically majority of on-screen)
    // pixels looking at terrain/water/trees instead of sky. This is a
    // genuine cost saving, not a cosmetic branch — TSL's If() compiles to
    // real shader-level branching.
    If(rayDir.y.greaterThan(0.02), () => {
      // Ray/slab intersection with the cloud band's two horizontal
      // planes — where the march actually starts and ends along this ray.
      const tBase = CLOUD_BASE.sub(uniforms.cameraPos.y).div(rayDir.y);
      const tTop = CLOUD_TOP.sub(uniforms.cameraPos.y).div(rayDir.y);
      const tStart = tslMax(tBase, float(0));
      const tEnd = tTop;
      const stepSize = tEnd.sub(tStart).div(STEP_COUNT).toVar();
      const t = tStart.toVar();

      // Forward-scattering phase term — brighter looking toward the sun
      // THROUGH the cloud (the real "silver lining" / backlit sunset
      // look), dimmer looking away from it. A simplified single-lobe
      // Henyey-Greenstein-style term rather than the full physical
      // function — visually convincing at a fraction of the cost.
      const cosAngle = dot(rayDir, uniforms.sunDir);
      const phase = pow(clamp(cosAngle, 0, 1), 3).mul(2).add(0.15);

      for (let i = 0; i < STEP_COUNT; i++) {
        const pos = uniforms.cameraPos.add(rayDir.mul(t));
        const sampleUV = pos.mul(TILE_SCALE).add(uniforms.scrollOffset);
        const density = texture3D(densityTexture, sampleUV.fract()).r.mul(uniforms.coverage.add(0.5));

        If(density.greaterThan(0.01), () => {
          // Real self-shadowing — a short secondary march TOWARD the sun
          // from this sample point, so density genuinely blocks light
          // from reaching deeper/darker parts of the cloud instead of
          // every sample being lit identically regardless of what's
          // between it and the sun.
          const shadowSteps = SHADOW_STEP_COUNT;
          const shadowStepSize = float(6);
          const lightAccum = float(0).toVar();
          for (let s = 0; s < shadowSteps; s++) {
            const shadowPos = pos.add(uniforms.sunDir.mul(shadowStepSize.mul(s + 1)));
            const shadowUV = shadowPos.mul(TILE_SCALE).add(uniforms.scrollOffset);
            lightAccum.addAssign(texture3D(densityTexture, shadowUV.fract()).r);
          }
          const selfShadow = exp(lightAccum.mul(-1.2));
          const litColor = uniforms.sunColor.mul(phase).mul(selfShadow).add(uniforms.ambientColor.mul(0.5));
          const flashColor = uniforms.lightningColor.mul(uniforms.lightningFlash).mul(1.4);
          const sampleExtinction = exp(density.mul(stepSize).mul(-0.09));
          const sampleLight = litColor.add(flashColor).mul(density).mul(stepSize).mul(0.045).mul(transmittance);
          scattered.addAssign(sampleLight);
          transmittance.mulAssign(sampleExtinction);
        });

        t.addAssign(stepSize);
      }
    });

    return vec4(scattered, transmittance);
  })();

  return { node, uniforms, densityTexture };
}

// Per-frame JS-side push — camera basis vectors (for the ray-reconstruction
// math above), sun direction/color, and the current lightning flash. Wind
// drift is folded into scrollOffset so the SAME baked volume reads as
// continuously moving clouds without ever needing to be regenerated.
const _forward = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
export function updateVolumetricClouds(handle, dt, camera, sunDirection, sunColor, ambientColor, lightningFlash, lightningColor, windX = 0, windZ = 0) {
  if (!handle) return;
  camera.getWorldDirection(_forward);
  _right.crossVectors(_forward, camera.up).normalize();
  _up.crossVectors(_right, _forward).normalize();
  handle.uniforms.cameraForward.value.copy(_forward);
  handle.uniforms.cameraRight.value.copy(_right);
  handle.uniforms.cameraUp.value.copy(_up);
  handle.uniforms.cameraPos.value.copy(camera.position);
  handle.uniforms.tanHalfFov.value = Math.tan((camera.fov * Math.PI) / 360);
  handle.uniforms.aspect.value = camera.aspect;
  handle.uniforms.sunDir.value.copy(sunDirection);
  handle.uniforms.sunColor.value.copy(sunColor);
  handle.uniforms.ambientColor.value.copy(ambientColor);
  handle.uniforms.lightningFlash.value = lightningFlash;
  if (lightningColor) handle.uniforms.lightningColor.value.copy(lightningColor);
  handle._scrollX = (handle._scrollX || 0) + windX * dt * 0.004;
  handle._scrollZ = (handle._scrollZ || 0) + windZ * dt * 0.004;
  handle.uniforms.scrollOffset.value.set(handle._scrollX, 0, handle._scrollZ);
}
