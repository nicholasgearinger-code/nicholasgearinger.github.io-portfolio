import * as THREE from "three";
import { Fn, uniform, vec2, vec3, vec4, float, texture3D, uv, dot, mix, clamp, pow, exp, normalize, smoothstep, texture, perspectiveDepthToViewZ, max as tslMax, min as tslMin } from "three/tsl";

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
        // Per "only a few big ones not the entire sky" — cells dropped
        // 4->2: only 8 possible coarse cluster cores across the whole
        // tileable volume instead of 64, so each surviving cluster
        // occupies a much larger contiguous region — genuinely big,
        // sculptural formations rather than many small puffs.
        const billowLow = 1 - worleyNoise3D(size, 2, x, y, z, 1);
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
        // Per "clouds are black" — a real, confirmed bug: this coverage
        // threshold (0.35) was FAR too permissive. Worley min-distance
        // (even inverted, even capped at 1) has a mean sitting well above
        // that for a single random point per cell — meaning most of the
        // volume was qualifying as "in cloud," not the sparse, mostly-
        // clear-with-pockets field this was meant to produce. Wall-to-
        // wall density through a 16-step accumulation is exactly what
        // drives transmittance to ~0 everywhere the camera looks upward,
        // which is what "black sky" actually was. Raised hard (0.35->0.68)
        // then further (0.68->0.74, band 0.16->0.12) per "only a few big
        // ones" — fewer clusters pass at all, each with a sharper edge.
        const coverage = smootherstep(Math.max(0, Math.min(1, (billowLow - 0.74) / 0.12)));
        let density = (billowMid * 0.55 + fbm * 0.45) * coverage;
        // Remap tightened to match (was (d-0.15)/0.6, now requires a
        // notably higher raw value before anything becomes visible at
        // all, and rarely saturates to fully opaque) — this is the other
        // half of the same fix: even within a "covered" pocket, density
        // should read as real cloud texture (soft, varied), not a flat
        // opaque block.
        density = Math.max(0, Math.min(1, (density - 0.32) / 0.42));
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
export function createVolumetricClouds(sceneDepthTexture, cameraNear, cameraFar) {
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
    stormDarken: uniform(0), // 0=normal fluffy-white clouds, 1=full storm-gray — driven live from rain intensity, see updateVolumetricClouds
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
  // Per "only a few big ones not the entire sky" — lowered (0.013->0.007):
  // combined with cells=2 above, each surviving cluster now spans a much
  // larger stretch of actual world-space, reading as one big sculptural
  // formation instead of a small puff.
  const TILE_SCALE = float(0.007);

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

    // Per "it's wrong" persisting through three straight brightness/
    // shadow tuning passes — real signal that this wasn't a tuning
    // problem at all. This shader was the ONLY place in this whole
    // project using TSL's If(), nested two levels deep, with mutable
    // .toVar() writes expected to cross both levels correctly — an
    // entirely unproven pattern here. Every OTHER effect in this file
    // (the lens droplets specifically) gates contributions with plain
    // MULTIPLICATION instead — "value * mask" naturally becomes 0
    // rather than branching around it — and that pattern has a real,
    // confirmed working track record across many rounds this session.
    // Rebuilt this whole shader to match: zero If() blocks below, only
    // multiplicative gating. Real cost: the sky-ward-only early-out and
    // the "skip empty air" density check are both gone, so every pixel
    // now runs the full fixed-step march unconditionally — a genuine
    // perf regression versus the branched version, worth re-introducing
    // carefully later, but only once this is confirmed actually correct.
    // Per this project's established pattern (the lens shader explicitly
    // avoids .select() too, for the same reason) — smoothstep() as a
    // soft step function instead, the one comparison-to-float technique
    // with an actual proven track record here.
    const skyMask = smoothstep(float(0.06), float(0.1), rayDir.y);

    const tBase = CLOUD_BASE.sub(uniforms.cameraPos.y).div(rayDir.y);
    const tTop = CLOUD_TOP.sub(uniforms.cameraPos.y).div(rayDir.y);
    const tStart = tslMax(tBase, float(0));
    let tEnd = tslMin(tTop, tStart.add(500));

    // Real depth occlusion — reads the ACTUAL rendered scene's depth at
    // this pixel, converts it to a real distance along THIS ray, and
    // clamps the march so real geometry (a tree, a mountain) genuinely
    // blocks the cloud layer behind it instead of clouds always drawing
    // on top regardless of what's really there.
    const depthSample = texture(sceneDepthTexture, screenUV).r;
    const viewZ = perspectiveDepthToViewZ(depthSample, float(cameraNear), float(cameraFar));
    const forwardDot = tslMax(dot(rayDir, uniforms.cameraForward), float(0.0001));
    const sceneDistance = viewZ.negate().div(forwardDot);
    tEnd = tslMin(tEnd, sceneDistance);

    const stepSize = tslMax(tEnd.sub(tStart), float(0)).div(STEP_COUNT).toVar();
    const t = tStart.toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    // Forward-scattering phase term — brighter looking toward the sun
    // THROUGH the cloud (the real "silver lining" / backlit sunset
    // look), dimmer looking away from it.
    const cosAngle = dot(rayDir, uniforms.sunDir);
    const phase = pow(clamp(cosAngle, 0, 1), 3).mul(2).add(0.15);

    for (let i = 0; i < STEP_COUNT; i++) {
      const pos = uniforms.cameraPos.add(rayDir.mul(t));
      const sampleUV = pos.mul(TILE_SCALE).add(uniforms.scrollOffset);
      // inRange replaces the old t<tEnd If()-gate — same reasoning,
      // multiplicative instead of branched.
      // Same smoothstep-as-soft-step technique as skyMask above, in
      // place of .select() — 1 while t is safely below tEnd, easing to 0
      // right at the occlusion boundary instead of a hard cutoff.
      const inRange = float(1).sub(smoothstep(tEnd.sub(stepSize), tEnd, t));
      const density = texture3D(densityTexture, sampleUV.fract()).r.mul(uniforms.coverage.mul(2)).mul(inRange);

      // Shadow-march and lighting now run EVERY step unconditionally
      // (no more If(density>0.01)) — density itself multiplies the
      // final contribution down to ~0 in empty air, same end result,
      // without a real branch depending on a runtime value.
      const lightAccum = float(0).toVar();
      for (let s = 0; s < SHADOW_STEP_COUNT; s++) {
        const shadowPos = pos.add(uniforms.sunDir.mul(float(6).mul(s + 1)));
        const shadowUV = shadowPos.mul(TILE_SCALE).add(uniforms.scrollOffset);
        lightAccum.addAssign(texture3D(densityTexture, shadowUV.fract()).r);
      }
      const selfShadow = exp(lightAccum.mul(-0.25));
      const ambientTerm = uniforms.ambientColor.mul(1.3);
      const sunTerm = uniforms.sunColor.mul(phase).mul(selfShadow).mul(1.5);
      const baseLitColor = sunTerm.add(ambientTerm);
      // Per "turn dark when it rains" — stormDarken (driven live from
      // rain intensity) blends the whole lit color toward a flat storm
      // gray, and makes the cloud itself more extinctive/opaque too.
      const litColor = mix(baseLitColor, vec3(0.32, 0.34, 0.4), uniforms.stormDarken);
      const flashColor = uniforms.lightningColor.mul(uniforms.lightningFlash).mul(1.4);
      const extinctionMul = mix(float(1), float(1.7), uniforms.stormDarken);
      const sampleExtinction = exp(density.mul(stepSize).mul(-0.045).mul(extinctionMul));
      const sampleLight = litColor.add(flashColor).mul(density).mul(stepSize).mul(0.6).mul(transmittance);
      scattered.addAssign(sampleLight);
      transmittance.mulAssign(sampleExtinction);
      t.addAssign(stepSize);
    }

    // skyMask applied once at the very end — ground-facing pixels get
    // transmittance forced back to 1 (fully see-through, no cloud
    // effect) and scattered forced to 0, the same net result the old
    // If(rayDir.y...) early-out gave, just via multiplication.
    const finalTransmittance = mix(float(1), transmittance, skyMask);
    const finalScattered = scattered.mul(skyMask);
    return vec4(finalScattered, finalTransmittance);
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
export function updateVolumetricClouds(handle, dt, camera, sunDirection, sunColor, ambientColor, lightningFlash, lightningColor, windX = 0, windZ = 0, rainIntensity = 0) {
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
  // Per "we also need to animate them to drift" — real, confirmed bug:
  // this multiplier (0.004) worked out to a small fraction of a
  // world-unit of equivalent shift per second — completely
  // imperceptible. Raised hard (0.004->0.05), and a small CONSTANT base
  // drift added on top of the wind-driven part (real clouds visibly
  // drift even in a near-calm breeze, not only during a squall).
  const baseDriftX = 0.6, baseDriftZ = 0.25;
  handle._scrollX = (handle._scrollX || 0) + (windX + baseDriftX) * dt * 0.05;
  handle._scrollZ = (handle._scrollZ || 0) + (windZ + baseDriftZ) * dt * 0.05;
  handle.uniforms.scrollOffset.value.set(handle._scrollX, 0, handle._scrollZ);
  // Per "turn dark when it rains" — driven straight off real rain
  // intensity (0-1, already smoothed/eased by weather.js), not the raw
  // instantaneous rain flag, so clouds darken and lighten gradually
  // along with the storm itself rather than snapping.
  handle.uniforms.stormDarken.value = rainIntensity;
}
