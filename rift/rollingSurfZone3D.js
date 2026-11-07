// Hybrid 3D surf zone for Coral Shallows.
// Three long, shoaling, rolling wave faces span the gap between FFT offshore
// water and the narrow beach swash. When they plunge, a *bounded actual 3D*
// position-based fluid volume forms whitewater droplets; the collapse also
// deposits an impulse into the existing GPU 2D shallow-water solver.
//
// Architecture: 2 macro surface meshes (3 bands, one draw each) +
// 1 instanced 3D particle mesh. CPU surface deformation max 14 Hz on iPhone.
// This is deliberately not 3D particle simulation of the entire ocean.
// Disable with ?riftSurf3D=off and compare with previous FFT+shore breakers.
import * as THREE from "three";
import { attribute } from "three/tsl";
import {
  createSurfParticlePool, emitSurfFluid, advanceSurfFluid,
  seedSurfWaveBody, injectSurfWaveBody,
} from "./surfZoneFluid3D.js";
import {
  createSurfVolumeField, buildSurfVolumeField,
} from "./surfWaveVolumeMesh.js";
import { emitRiftWaterImpact } from "./waterLabInteractions.js";

const MOBILE = typeof navigator !== "undefined" &&
  (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "") ||
    (navigator.maxTouchPoints || 0) > 0);
const COLUMNS = MOBILE ? 24 : 36;
const ROWS = MOBILE ? 10 : 14;
const FOAM_ROWS = 5;
const WAVES = [
  { far: 42, near: 9.5, period: 9.3, phase: 0.09, height: 2.5, width: 4.0 },
  { far: 64, near: 23, period: 11.4, phase: 0.37, height: 3.3, width: 5.4 },
  { far: 86, near: 39, period: 13.8, phase: 0.72, height: 3.8, width: 6.0 },
];
const TAU = Math.PI * 2;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const fract = v => v - Math.floor(v);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / Math.max(0.001, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * Stable observable wave profile. Height increases during shoaling,
 * the lip rolls over, then collapses. Deterministic, no frame dependency.
 */
export function surfWaveProfile(progress, depth, settings) {
  const p = clamp(progress, 0, 1);
  const shoal = clamp((11 - Math.max(0, depth)) / 9.5, 0, 1);
  const grow = smooth(0.04, 0.58, p);
  const collapse = 1 - smooth(0.80, 0.99, p);
  const amplitude = settings.height *
    (0.43 + grow * 0.65) * (0.78 + shoal * 0.43) * collapse;
  const roll = smooth(0.34, 0.71, p) *
    (1 - smooth(0.84, 0.99, p));
  const foam = smooth(0.44, 0.75, p) *
    (1 - smooth(0.91, 1.0, p));
  return { amplitude, roll, foam };
}

function createRibbon(countColumns, countRows, doubleShell) {
  const shellCount = doubleShell ? 2 : 1;
  const stride = (countRows + 1) * shellCount;
  const n = WAVES.length * (countColumns + 1) * stride;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const alpha = new Float32Array(n);
  const triangles = [];
  for (let wave = 0; wave < WAVES.length; wave++) {
    const base = wave * (countColumns + 1) * stride;
    for (let i = 0; i < countColumns; i++) {
      for (let j = 0; j < countRows; j++) {
        for (let shell = 0; shell < shellCount; shell++) {
          const a = base + i * stride + j * shellCount + shell;
          const b = a + stride, c = a + shellCount, d = b + shellCount;
          if (shell) triangles.push(a, c, b, c, d, b);
          else triangles.push(a, b, c, c, b, d);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3)
    .setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3)
    .setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("riftSurfOpacity", new THREE.BufferAttribute(alpha, 1)
    .setUsage(THREE.DynamicDrawUsage));
  geometry.setIndex(triangles);
  return { geometry, positions, colors, alpha, stride, shellCount };
}

function putVertex(target, wave, i, j, shell, rowCount,
  x, y, z, r, g, b, opacity) {
  const vertex = wave * (COLUMNS + 1) * target.stride +
    i * target.stride + j * target.shellCount + shell;
  const idx = vertex * 3;
  target.positions[idx] = x;
  target.positions[idx + 1] = y;
  target.positions[idx + 2] = z;
  target.colors[idx] = r;
  target.colors[idx + 1] = g;
  target.colors[idx + 2] = b;
  target.alpha[vertex] = clamp(opacity, 0, 1);
}

function nearestCoast(samples, camera, previousIndex = 0) {
  if (!camera) return previousIndex;
  let nearest = previousIndex, best = Infinity;
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i];
    const d = (camera.x - p.x) ** 2 + (camera.z - p.z) ** 2;
    if (d < best) { best = d; nearest = i; }
  }
  return nearest;
}

export function createVolumetricSurfZone(scene, ocean, groundHeight) {
  const samples = ocean?.fftSurfSystem?.__riftShoreFoamLayers?.samples;
  if (!scene || !ocean?.gpuFFT || !Array.isArray(samples) ||
      samples.length < 16) return null;

  const body = createRibbon(COLUMNS, ROWS, true);
  const foam = createRibbon(COLUMNS, FOAM_ROWS, false);
  const bodyMaterial = new THREE.MeshStandardNodeMaterial({
    color: 0xffffff, vertexColors: true, roughness: 0.18,
    metalness: 0.025, transparent: true, opacity: 0.85,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const foamMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0xffffff, vertexColors: true,
    transparent: true, opacity: 0.78,
    side: THREE.DoubleSide, depthWrite: false,
  });
  bodyMaterial.forceSinglePass = true;
  foamMaterial.forceSinglePass = true;
  // Each rolling band fades as it forms, crashes and resets. Without
  // per-vertex alpha the thin face would leave rectangular turquoise
  // sheets over the FFT water even when its amplitude reached zero.
  bodyMaterial.opacityNode = attribute("riftSurfOpacity", "float");
  foamMaterial.opacityNode = attribute("riftSurfOpacity", "float");
  const bodyMesh = new THREE.Mesh(body.geometry, bodyMaterial);
  const foamMesh = new THREE.Mesh(foam.geometry, foamMaterial);
  bodyMesh.name = "rift-rolling-surf-3d-water-faces";
  foamMesh.name = "rift-rolling-surf-3d-whitewater";
  bodyMesh.frustumCulled = false;
  foamMesh.frustumCulled = false;
  bodyMesh.renderOrder = 11;
  foamMesh.renderOrder = 14;
  scene.add(bodyMesh, foamMesh);

  // Legacy spray remains light. A separate, dense PBF body now provides
  // the visible overturning wave *volume*, not just disconnected droplets.
  const particlePool = createSurfParticlePool(MOBILE ? 112 : 320);
  const volumeEnabled = typeof location === "undefined" ||
    new URLSearchParams(location.search).get("riftSurfVolume") !== "off";
  const volumePool = volumeEnabled
    ? createSurfParticlePool(MOBILE ? 240 : 420, {
        supportRadius: MOBILE ? 0.95 : 0.82,
        restSpacing: MOBILE ? 0.54 : 0.45,
      })
    : null;
  const volumeField = volumePool ? createSurfVolumeField(MOBILE) : null;
  let volumeMesh = null, volumeGeometry = null, volumeMaterial = null;
  if (volumeField) {
    // One closed implicit surface from live SPH/PBF particles. The mesh is
    // reconstructed at <=9Hz on iPhone, with no GPU readback or SSFR pass.
    volumeGeometry = new THREE.BufferGeometry();
    for (const [name, values] of [
      ["position", volumeField.positions],
      ["normal", volumeField.normals],
      ["color", volumeField.colors],
    ]) {
      volumeGeometry.setAttribute(name,
        new THREE.BufferAttribute(values, 3).setUsage(THREE.DynamicDrawUsage));
    }
    volumeGeometry.setDrawRange(0, 0);
    volumeMaterial = new THREE.MeshStandardNodeMaterial({
      color: 0xffffff, vertexColors: true,
      roughness: 0.11, metalness: 0.015,
      transparent: true, opacity: 0.78, depthWrite: false,
      side: THREE.DoubleSide,
    });
    volumeMaterial.forceSinglePass = true;
    volumeMesh = new THREE.Mesh(volumeGeometry, volumeMaterial);
    volumeMesh.name = "rift-simulated-3d-breaking-wave-volume";
    volumeMesh.renderOrder = 12;
    volumeMesh.frustumCulled = false; // mutable fluid surface
    volumeMesh.visible = false;
    scene.add(volumeMesh);
  }
  const dropletGeometry = new THREE.IcosahedronGeometry(0.10, 0);
  const dropletMaterial = new THREE.MeshBasicNodeMaterial({
    color: 0xf0fffb, transparent: true, opacity: 0.76,
    depthWrite: false, side: THREE.DoubleSide,
  });
  dropletMaterial.forceSinglePass = true;
  const particleMesh = new THREE.InstancedMesh(dropletGeometry,
    dropletMaterial, particlePool.particles.length);
  particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  particleMesh.frustumCulled = false;
  particleMesh.renderOrder = 15;
  particleMesh.visible = false;
  scene.add(particleMesh);
  const dummy = new THREE.Object3D();
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  for (let i = 0; i < particlePool.particles.length; i++) {
    particleMesh.setMatrixAt(i, hidden);
  }
  particleMesh.instanceMatrix.needsUpdate = true;

  const sea = ocean.waterY ?? 0;
  // Moving breakers require seabed depth for shoaling. Fractal terrain
  // queries are expensive on iPhone, so sample each coast-normal transect
  // once at 3m spacing and reuse it for every animated crest.
  const groundProfiles = new Map();
  function coastalGround(sampleIndex, distance) {
    const sample = samples[sampleIndex];
    if (typeof groundHeight !== "function") return sea - 5;
    let profile = groundProfiles.get(sampleIndex);
    if (!profile) {
      profile = new Float32Array(34);
      profile.fill(NaN);
      groundProfiles.set(sampleIndex, profile);
    }
    const f = clamp(distance / 3, 0, profile.length - 1.001);
    const a = Math.floor(f), b = Math.min(a + 1, profile.length - 1);
    if (!Number.isFinite(profile[a])) {
      profile[a] = groundHeight(sample.x + sample.outwardX * a * 3,
        sample.z + sample.outwardZ * a * 3);
    }
    if (!Number.isFinite(profile[b])) {
      profile[b] = groundHeight(sample.x + sample.outwardX * b * 3,
        sample.z + sample.outwardZ * b * 3);
    }
    return profile[a] * (1 - (f - a)) + profile[b] * (f - a);
  }
  let lastFrameTime = null, surfaceAccum = 0;
  let centerIndex = 0, disposed = false;
  const lastEmit = [-100, -100, -100], lastContact = [-100, -100, -100];
  const lastCamera = { x: Infinity, z: Infinity };
  // Adaptive surf CPU budget. Preserve the large wave faces even if the
  // existing island/ocean falls to ~11 fps; trim droplet bursts first.
  let slowFrameCount = 0;
  const geometryPeriod = MOBILE ? (1 / 13) : (1 / 22);
  // Exactly ONE near-field wave is volumetric. Other ocean-scale wave
  // fronts remain the cheaper FFT/rolling faces; each volume collapses
  // and re-enters the existing shallow-water solver when it breaks.
  const volume = {
    active: false, band: 1, center: 0, started: 0,
    nextSpawn: 0.15, lastImpact: -10, lastInflow: -10,
    previousCount: 0,
    originX: 0, originZ: 0, centerShoreX: 0, centerShoreZ: -1,
    lastMeshUpdate: -10, initialCount: 0,
  };

  function rebuildSurface(time, camera) {
    if (camera && (Math.hypot(camera.x - lastCamera.x,
      camera.z - lastCamera.z) > 18 ||
      !Number.isFinite(lastCamera.x))) {
      centerIndex = nearestCoast(samples, camera, centerIndex);
      lastCamera.x = camera.x; lastCamera.z = camera.z;
    }

    for (let bandIndex = 0; bandIndex < WAVES.length; bandIndex++) {
      const wave = WAVES[bandIndex];
      for (let i = 0; i <= COLUMNS; i++) {
        const sampleIndex = (centerIndex + i - Math.floor(COLUMNS / 2) +
          samples.length * 3) % samples.length;
        const p = samples[sampleIndex];
        const outerX = Number(p.outwardX) || 0,
          outerZ = Number(p.outwardZ) || 0;
        const l = Math.hypot(outerX, outerZ) || 1;
        const ox = outerX / l, oz = outerZ / l;
        // Phase staggering makes a wave peel progressively along the
        // coastline, rather than an entire perfectly straight wall.
        const phase = fract(time / wave.period + wave.phase +
          (i - COLUMNS / 2) * 0.005 +
          (Number(p.liftRand) || 0) * 0.014);
        const distance = wave.far - (wave.far - wave.near) * phase;
        const x = p.x + ox * distance, z = p.z + oz * distance;
        const ground = coastalGround(sampleIndex, distance);
        const depth = Number.isFinite(ground)
          ? Math.max(0, sea - ground) : 5;
        const profile = surfWaveProfile(phase, depth, wave);
        const swell = Math.sin(i * 0.42 + time * 0.37 + bandIndex) * 0.10;
        const amplitude = profile.amplitude * (1 + swell);
        const breakRoll = profile.roll;
        const bodyWidth = wave.width;
        // Shared by body AND foam loops; fading only the area occupied by
        // the real 3D particle volume prevents double-rendered water walls.
          const volumeBlend = volume.active && bandIndex === volume.band
            ? clamp(volume.previousCount / Math.max(1, volume.initialCount),
                0, 1) *
              smooth(0.12, 0.50, time - volume.started) *
              (1 - smooth(5, 11, Math.abs(i - COLUMNS * 0.5)))
            : 0;
        // Color follows face slope, edge aeration and collapsing curl.
        // Vertex colors are interpolated across both shell faces.
        for (let j = 0; j <= ROWS; j++) {
          const v = j / ROWS;
          const rising = Math.sin(v * Math.PI * 0.5);
          const lip = smooth(0.60, 0.99, v) * breakRoll;
          const height = amplitude * rising -
            amplitude * smooth(0.84, 1, v) * breakRoll * 0.36;
          const radial = distance + (1 - v) * bodyWidth -
            lip * amplitude * 0.85;
          const foamCrest = smooth(0.63, 0.98, v) * profile.foam;
          const waveFade = smooth(0.0, 0.10, phase) *
            (1 - smooth(0.84, 0.99, phase));
          const faceAlpha = clamp(waveFade * 0.85 *
            (0.15 + smooth(0.035, 0.28, v) * 0.85) *
            (1 - volumeBlend * 0.93), 0, 0.85);
          for (let shell = 0; shell < 2; shell++) {
            const shellOffset = shell === 0 ? 0 : 0.42 +
              (1 - v) * 1.15;
            const rr = radial + shellOffset;
            const waveHeight = sea + 0.06 +
              height * (shell === 0 ? 1 : 0.92);
            // Blue-green body becomes frothy white at a plunging lip.
            const white = clamp(foamCrest * 0.97 +
              (j >= ROWS - 1 ? breakRoll * 0.18 : 0), 0, 1);
            putVertex(body, bandIndex, i, j, shell, ROWS,
              p.x + ox * rr, waveHeight, p.z + oz * rr,
              0.045 + white * 0.89,
              0.36 + white * 0.62,
              0.48 + white * 0.49,
              faceAlpha * (shell ? 0.75 : 1));
          }
        }

        // The broken crest spreads a broad, moving, aerated sheet
        // on the actual sea surface. This provides LOTS of white foam
        // without allocating thousands of mobile fluid particles.
        const trailWidth = 1.5 + profile.foam * (8 + bandIndex * 2.5);
        for (let j = 0; j <= FOAM_ROWS; j++) {
          const v = j / FOAM_ROWS;
          const rr = distance - v * trailWidth;
          const rippling = Math.sin(i * 1.37 + time * 3.2 + bandIndex) *
            Math.sin(v * 9.1 + i * 0.51 + time) * 0.11;
          const intensity = profile.foam * (0.65 +
            Math.sin(i * 1.69 + v * 10.2 + time * 1.6) * 0.21);
          // Raise collapsing foam above the conservative FFT stillwater
          // line, avoiding a flat foam decal hidden under rolling crests.
          const rippleY = sea + 0.23 + Math.max(0, amplitude * 0.13)
            + rippling * profile.foam;
          const foamColor = clamp(intensity, 0, 1);
          putVertex(foam, bandIndex, i, j, 0, FOAM_ROWS,
            p.x + ox * rr, rippleY,
            p.z + oz * rr,
            0.20 + foamColor * 0.80,
            0.48 + foamColor * 0.50,
            0.51 + foamColor * 0.48,
            clamp(profile.foam * (0.42 + 0.51 *
              Math.sin(v * Math.PI)) *
              (0.85 + Math.sin(i * 1.6 + time * 1.9) * 0.13) *
              (1 - volumeBlend * 0.60),
              0, 0.93));
        }
      }
    }
    body.geometry.attributes.position.needsUpdate = true;
    body.geometry.attributes.color.needsUpdate = true;
    body.geometry.attributes.riftSurfOpacity.needsUpdate = true;
    body.geometry.computeVertexNormals();
    foam.geometry.attributes.position.needsUpdate = true;
    foam.geometry.attributes.color.needsUpdate = true;
    foam.geometry.attributes.riftSurfOpacity.needsUpdate = true;
    // No normal recompute for unlit whitewater; preserves mobile budget.
  }

  function release3DFluid(time, camera) {
    if (!camera || !Number.isFinite(camera.x)) return;
    for (let band = 0; band < WAVES.length; band++) {
      const wave = WAVES[band];
      if (time - lastEmit[band] < (MOBILE ? 0.18 : 0.095)) continue;
      const index = Math.floor((Math.sin(time * 0.73 + band * 2.9) * 0.36 +
        0.5) * (COLUMNS - 1));
      const sampleIndex = (centerIndex + index -
        Math.floor(COLUMNS / 2) + samples.length * 3) % samples.length;
      const p = samples[sampleIndex];
      const ox = p.outwardX, oz = p.outwardZ;
      const phase = fract(time / wave.period + wave.phase +
        (index - COLUMNS / 2) * 0.005 +
        (Number(p.liftRand) || 0) * 0.014);
      if (phase < 0.48 || phase > 0.86) continue;
      const dist = wave.far - (wave.far - wave.near) * phase;
      const x = p.x + ox * dist, z = p.z + oz * dist;
      const ground = coastalGround(sampleIndex, dist);
      const profile = surfWaveProfile(phase,
        Number.isFinite(ground) ? Math.max(0, sea - ground) : 5, wave);
      if (Math.hypot(camera.x - x, camera.z - z) > 135) continue;
      lastEmit[band] = time;
      emitSurfFluid(particlePool, x, sea + profile.amplitude * 0.68, z, {
        shoreX: -ox, shoreZ: -oz,
        speed: 1.6 + profile.amplitude * 0.85,
        height: 1.2 + profile.amplitude * 0.64,
        count: MOBILE ? (slowFrameCount > 7 ? 4 : 7) : 15,
        spread: MOBILE ? 1.5 : 2.4,
      });
      // A collapsing 3D wave feeds its re-entry pressure back to the
      // existing GPU shallow-water solver. Rate-limited, one event
      // channel shared with the boat/swimmer so it cannot explode.
      if (time - lastContact[band] > 1.25 && dist < 38) {
        lastContact[band] = time;
        emitRiftWaterImpact(ocean, x - ox * 2.8, z - oz * 2.8, {
          strength: clamp(profile.amplitude * 0.47, 0.4, 1.5),
          radius: clamp(profile.amplitude * 1.1, 1.5, 4.6),
          foam: 0.19, kind: "surf",
        }, time);
      }
    }
  }

  function updateVolumetricBreaker(dt, time, camera) {
    if (!volumePool || !volumeField || !camera ||
        !Number.isFinite(camera.x)) return;

    if (!volume.active && time >= volume.nextSpawn) {
      // Attach the local volume to the wave segment nearest the player.
      // The initial shape is only the starting condition; from here its
      // geometry follows particle pressure, viscosity and gravity.
      const sample = samples[centerIndex];
      const wave = WAVES[volume.band];
      const phase = fract(time / wave.period + wave.phase +
        (Number(sample.liftRand) || 0) * 0.014);
      const distance = clamp(wave.far - (wave.far - wave.near) * phase,
        21, 43);
      const x = sample.x + sample.outwardX * distance;
      const z = sample.z + sample.outwardZ * distance;
      if (Math.hypot(camera.x - x, camera.z - z) < 118) {
        volume.centerShoreX = -sample.outwardX;
        volume.centerShoreZ = -sample.outwardZ;
        volume.originX = x; volume.originZ = z;
        volume.initialCount = seedSurfWaveBody(volumePool, x, z, {
          seaY: sea, shoreX: volume.centerShoreX,
          shoreZ: volume.centerShoreZ,
          height: MOBILE ? 3.05 : 3.65,
          width: MOBILE ? 8.1 : 11.2,
          thickness: MOBILE ? 2.3 : 2.6,
          columns: MOBILE ? 12 : 14,
          levels: MOBILE ? 5 : 6,
          layers: MOBILE ? 4 : 5,
        });
        volume.previousCount = volume.initialCount;
        volume.started = time;
        volume.active = volume.initialCount > 0;
        volume.lastMeshUpdate = -10;
        volume.lastInflow = time;
        volume.nextSpawn = time + (MOBILE ? 3.2 : 2.9);
      } else {
        volume.nextSpawn = time + 0.7;
      }
    }
    if (!volume.active) return;
    let count = advanceSurfFluid(volumePool, dt, sea, groundHeight);
    const absorbed = volume.previousCount - count;
    // Incoming FFT swells replenish the lip as its leading fluid falls
    // into the sea. Only absorbed particle slots are reused, keeping a
    // strictly bounded mass/CPU budget while making the crash sustained.
    const age = time - volume.started;
    if (age > 0.24 && age < 1.25 &&
        time - volume.lastInflow > (MOBILE ? 0.25 : 0.19)) {
      volume.lastInflow = time;
      count += injectSurfWaveBody(volumePool,
        volume.originX, volume.originZ, {
          seaY: sea,
          shoreX: volume.centerShoreX,
          shoreZ: volume.centerShoreZ,
          height: MOBILE ? 3.05 : 3.65,
          width: MOBILE ? 8.1 : 11.2,
          count: MOBILE ? 12 : 20,
        });
      volumePool.visible = count;
    }
    if (absorbed >= 8 && time - volume.lastImpact > 0.40) {
      volume.lastImpact = time;
      emitRiftWaterImpact(ocean, volume.originX +
        volume.centerShoreX * 2.6,
        volume.originZ + volume.centerShoreZ * 2.6, {
          strength: clamp(absorbed * 0.052, 0.45, 2.0),
          radius: 3.9, foam: 0.22, kind: "3d-crest-collapse",
        }, time);
    }
    volume.previousCount = count;
    if (count < 7 || time - volume.started > 2.5) {
      volume.active = false;
      volumeMesh.visible = false;
      volume.nextSpawn = Math.max(volume.nextSpawn, time + 1.5);
      volumeGeometry.setDrawRange(0, 0);
      return;
    }
    const meshPeriod = MOBILE
      ? (slowFrameCount > 7 ? 1 / 4 : 1 / 7)
      : 1 / 16;
    if (time - volume.lastMeshUpdate >= meshPeriod) {
      const result = buildSurfVolumeField(volumeField, volumePool, {
        seaY: sea, shoreX: volume.centerShoreX,
        shoreZ: volume.centerShoreZ,
      });
      volumeGeometry.setDrawRange(0, result.triangles * 3);
      volumeMesh.visible = result.triangles > 0;
      if (volumeMesh.visible) {
        for (const key of ["position", "normal", "color"]) {
          volumeGeometry.attributes[key].needsUpdate = true;
        }
      }
      volume.lastMeshUpdate = time;
    }
  }

  function drawParticles() {
    let alive = 0;
    for (let i = 0; i < particlePool.particles.length; i++) {
      const p = particlePool.particles[i];
      if (p.life > 0) {
        dummy.position.set(p.x, p.y, p.z);
        dummy.scale.setScalar(p.radius / 0.10);
        dummy.updateMatrix();
        particleMesh.setMatrixAt(i, dummy.matrix);
        alive++;
      } else {
        particleMesh.setMatrixAt(i, hidden);
      }
    }
    particleMesh.visible = alive > 0;
    if (alive) particleMesh.instanceMatrix.needsUpdate = true;
  }

  function update(dt, elapsedTime, camera, cameraY) {
    if (disposed) return;
    const underwater = Number.isFinite(cameraY) &&
      cameraY < sea - 0.12;
    bodyMesh.visible = foamMesh.visible = !underwater;
    particleMesh.visible = !underwater && particlePool.visible > 0;
    if (volumeMesh) volumeMesh.visible = !underwater &&
      volume.active && volumeField.vertexCount > 0;
    if (underwater) return;
    const time = Number.isFinite(elapsedTime)
      ? elapsedTime : (lastFrameTime ?? 0) + Math.max(0, dt);
    if (lastFrameTime !== null && time < lastFrameTime) {
      lastFrameTime = time; surfaceAccum = geometryPeriod;
    }
    lastFrameTime = time;
    slowFrameCount = MOBILE
      ? clamp(slowFrameCount + (dt > 0.055 ? 1 : -2), 0, 24) : 0;
    const period = MOBILE && slowFrameCount > 7
      ? 1 / 10 : geometryPeriod;
    surfaceAccum += Math.min(0.09, Math.max(0, dt));
    if (surfaceAccum >= period) {
      rebuildSurface(time, camera);
      surfaceAccum = 0;
    }
    updateVolumetricBreaker(dt, time, camera);
    release3DFluid(time, camera);
    const alive = advanceSurfFluid(particlePool, dt, sea, groundHeight);
    if (alive || particleMesh.visible) drawParticles();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    scene.remove(bodyMesh, foamMesh, particleMesh);
    if (volumeMesh) scene.remove(volumeMesh);
    const cleanup = () => {
      body.geometry.dispose(); foam.geometry.dispose();
      bodyMaterial.dispose(); foamMaterial.dispose();
      dropletGeometry.dispose(); dropletMaterial.dispose();
      volumeGeometry?.dispose();
      volumeMaterial?.dispose();
    };
    // Avoid freeing GPU resources still referenced by the current frame.
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => requestAnimationFrame(cleanup));
    } else cleanup();
  }

  // Initialize immediately, before first frame renders.
  rebuildSurface(0, null);
  return {
    update, dispose, particlePool, bodyMesh, foamMesh,
    waveFaceVertices: body.positions.length / 3,
    foamVertices: foam.positions.length / 3,
    volumePool, volumeField, volumeMesh, volumeState: volume,
  };
}
