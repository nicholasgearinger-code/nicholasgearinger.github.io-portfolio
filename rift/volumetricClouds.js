import * as THREE from "three";
import { Fn, uniform, vec3, vec4, float, texture3D, dot, mix, clamp, pow, exp, normalize, Loop, positionWorld, cameraPosition, max as tslMax, min as tslMin } from "three/tsl";

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

// Creates the whole layer: bakes the density volume once, and builds a
// real 3D mesh (a big box spanning the cloud altitude band) with a
// raymarching node material — per explicit "here's what we need," this
// replaces the earlier full-screen post-process version with an actual
// mesh in the scene. That's a genuinely better architecture, not just a
// different one: because it's real geometry, Three.js's normal
// depth-tested transparent-object rendering handles occlusion against
// trees/terrain automatically — no manual depth-texture sampling needed
// at all, which is what the "clouds pass in front of trees" bug actually
// needed. Ray reconstruction is simpler too: positionWorld (the actual
// fragment being rasterized on the box's surface) and the built-in
// cameraPosition give the ray directly, no manual camera-basis-vector/
// FOV/aspect uniforms required.
export function createVolumetricClouds(scene) {
  const densityTexture = buildCloudDensityTexture(48);

  const uniforms = {
    sunDir: uniform(vec3(0, 1, 0)),
    sunColor: uniform(vec3(1, 0.95, 0.85)),
    ambientColor: uniform(vec3(0.4, 0.48, 0.6)),
    lightningFlash: uniform(0),
    lightningColor: uniform(vec3(0.8, 0.87, 1)),
    scrollOffset: uniform(vec3(0, 0, 0)),
    coverage: uniform(0.5), // overall sky coverage, 0=clear 1=overcast — biome/weather can drive this later without touching the shader
    stormDarken: uniform(0), // 0=normal fluffy-white clouds, 1=full storm-gray — driven live from rain intensity, see updateVolumetricClouds
  };

  const CLOUD_BASE = 130;
  const CLOUD_TOP = 220;
  const STEP_COUNT = 20; // real GPU-side loop now (Loop(), not a JS-unrolled for), so this doesn't multiply compiled shader size the way it did before — real per-frame cost, but not a compile-time one
  const SHADOW_STEP_COUNT = 3;
  // Per "only a few big ones not the entire sky" — each surviving
  // cluster spans a large stretch of world-space, reading as one big
  // sculptural formation instead of a small puff.
  const TILE_SCALE = float(0.007);

  const material = new THREE.MeshBasicNodeMaterial();
  material.transparent = true;
  material.depthWrite = false; // never occludes anything ITSELF (it's translucent) — but depthTest (on by default) is what makes real geometry correctly occlude the cloud box, which is the actual fix here
  material.side = THREE.BackSide; // camera is meant to sit INSIDE this box (it's sized to comfortably contain the whole visible sky) — render its inner surface, not the outer one

  material.colorNode = Fn(() => {
    const rayOrigin = positionWorld;
    const rayDir = normalize(positionWorld.sub(cameraPosition));

    // Ray/slab intersection with the cloud band's two horizontal planes,
    // referenced from THIS fragment's own world position (already on the
    // box surface) rather than the camera — min/max instead of assuming
    // a sign on rayDir.y, since a box can be entered through any face.
    const tToBase = float(CLOUD_BASE).sub(rayOrigin.y).div(rayDir.y);
    const tToTop = float(CLOUD_TOP).sub(rayOrigin.y).div(rayDir.y);
    const tStart = tslMax(tslMin(tToBase, tToTop), float(0));
    const tEnd = tslMin(tslMax(tToBase, tToTop), tStart.add(500));

    const stepSize = tslMax(tEnd.sub(tStart), float(0)).div(STEP_COUNT).toVar();
    const t = tStart.toVar();
    const transmittance = float(1).toVar();
    const scattered = vec3(0, 0, 0).toVar();

    // Forward-scattering phase term — brighter looking toward the sun
    // THROUGH the cloud (the real "silver lining" / backlit sunset
    // look), dimmer looking away from it.
    const cosAngle = dot(rayDir, uniforms.sunDir);
    const phase = pow(clamp(cosAngle, 0, 1), 3).mul(2).add(0.15);

    Loop(STEP_COUNT, () => {
      const pos = rayOrigin.add(rayDir.mul(t));
      const sampleUV = pos.mul(TILE_SCALE).add(uniforms.scrollOffset);
      const density = texture3D(densityTexture, sampleUV.fract()).r.mul(uniforms.coverage.mul(2));

      const lightAccum = float(0).toVar();
      Loop(SHADOW_STEP_COUNT, ({ i }) => {
        const shadowPos = pos.add(uniforms.sunDir.mul(float(6).mul(float(i).add(1))));
        const shadowUV = shadowPos.mul(TILE_SCALE).add(uniforms.scrollOffset);
        lightAccum.addAssign(texture3D(densityTexture, shadowUV.fract()).r);
      });
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
    });

    return vec4(scattered, float(1).sub(transmittance));
  })();
  // colorNode above returns straight RGBA (alpha = how much cloud is
  // there, not transmittance) — MeshBasicNodeMaterial's normal alpha
  // blending (src*alpha + dst*(1-alpha), the standard transparent-object
  // blend) does the actual background compositing for us here, since
  // this is real geometry now — no manual "scene * transmittance +
  // scattered" math needed the way the post-process version required.

  // Sized to comfortably contain the whole visible sky from anywhere the
  // player can stand, and re-centered on the camera's XZ every frame
  // (see updateVolumetricClouds) — the box itself doesn't need to span
  // the whole world, just always surround the camera.
  const geometry = new THREE.BoxGeometry(3000, CLOUD_TOP - CLOUD_BASE, 3000);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = (CLOUD_BASE + CLOUD_TOP) / 2;
  mesh.frustumCulled = false; // it's meant to always surround the camera; never legitimately off-screen
  scene.add(mesh);

  return { mesh, uniforms, densityTexture };
}

// Per-frame JS-side push — sun direction/color, storm/lightning state,
// and re-centering the box on the camera so it always contains the sky
// regardless of where the player roams. Wind drift is folded into
// scrollOffset so the SAME baked volume reads as continuously moving
// clouds without ever needing to be regenerated.
export function updateVolumetricClouds(handle, dt, camera, sunDirection, sunColor, ambientColor, lightningFlash, lightningColor, windX = 0, windZ = 0, rainIntensity = 0) {
  if (!handle) return;
  handle.mesh.position.x = camera.position.x;
  handle.mesh.position.z = camera.position.z;
  handle.uniforms.sunDir.value.copy(sunDirection);
  handle.uniforms.sunColor.value.copy(sunColor);
  handle.uniforms.ambientColor.value.copy(ambientColor);
  handle.uniforms.lightningFlash.value = lightningFlash;
  if (lightningColor) handle.uniforms.lightningColor.value.copy(lightningColor);
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
