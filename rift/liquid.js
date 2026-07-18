import * as THREE from "three";

// -----------------------------------------------------------------------------
// SWAP POINT: lava/water rendering. A single large flat plane at a fixed
// height, per biome — simpler and far cheaper than carving actual liquid
// geometry into the terrain, and works because each biome's terrain
// shaping (terrain.js) was tuned so the plane's height only intersects the
// channel/cracks it's meant to fill (Ember's lava cracks, Verdant's river
// bed) rather than flooding the whole landmass. Per-vertex color (frothy
// white for water, glowing hot-spots for lava) is derived from the same
// ripple displacement already being computed for the geometry, not a
// second simulation — wherever the surface is most disturbed reads as
// whiter/brighter, which is what actually sells "liquid" instead of "flat
// tinted plane." Swap createLiquidPlane() for a shader-based version (real
// flow distortion) without touching terrain generation or placement.
// -----------------------------------------------------------------------------

const LIQUID_STYLE = {
  ember: {
    crustColor: new THREE.Color(0x1a0800), baseColor: new THREE.Color(0xdd2c00), hotColor: new THREE.Color(0xffd23f),
    emissive: 0xff5522, emissiveIntensity: 2.2, opacity: 0.96, roughness: 0.55,
    glowColor: 0xff8a1a, glowOpacity: 0.35,
  },
  verdant: {
    baseColor: new THREE.Color(0x1f6fb0), frothColor: new THREE.Color(0xf2fbff),
    emissive: 0x2a8fd6, emissiveIntensity: 0.2, opacity: 0.78, roughness: 0.1,
  },
};

// A soft mottled noise pattern, tiled — real distortion needs a
// post-process shader this project doesn't have, so instead this scrolls
// upward and wobbles sideways on a mostly-transparent overlay just above
// the lava, which is enough to read as rising heat haze without needing
// actual screen-space refraction.
function createShimmerTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 6 + Math.random() * 16;
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,220,180,0.35)");
    grad.addColorStop(1, "rgba(255,220,180,0)");
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 3);
  return texture;
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 * @param {number} y  world-space height to place the plane at
 * @param {number} size  full width/depth to cover (should match/exceed the terrain size)
 */
function createLiquidPlane(scene, biome, y, size) {
  const style = LIQUID_STYLE[biome];
  if (!style) return null;
  const geo = new THREE.PlaneGeometry(size, size, 40, 40);
  geo.rotateX(-Math.PI / 2);

  const posAttr = geo.attributes.position;
  const colors = new Float32Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    style.baseColor.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, emissive: style.emissive, emissiveIntensity: style.emissiveIntensity,
    transparent: true, opacity: style.opacity, roughness: style.roughness, metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = y;
  scene.add(mesh);

  // A separate unlit, additively-blended plane just above the surface —
  // gives lava genuine luminous "glow" the way MeshStandardMaterial's own
  // emissive can't on its own once it's subject to the renderer's
  // lighting/tone mapping alongside the day/night cycle. Water doesn't
  // get one — it isn't meant to look lit from within.
  let glow = null;
  let shimmer = null;
  if (style.glowColor !== undefined) {
    const glowGeo = new THREE.PlaneGeometry(size, size, 1, 1);
    glowGeo.rotateX(-Math.PI / 2);
    const glowMat = new THREE.MeshBasicMaterial({
      color: style.glowColor, transparent: true, opacity: style.glowOpacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
    });
    glow = new THREE.Mesh(glowGeo, glowMat);
    glow.position.y = y + 0.05;
    scene.add(glow);

    // Heat shimmer sits a few units above the surface (not on it) so it
    // reads as haze rising off the lava rather than another lava-colored
    // layer — subtle and additive, meant to be almost subliminal up close.
    const shimmerGeo = new THREE.PlaneGeometry(size, size, 1, 1);
    shimmerGeo.rotateX(-Math.PI / 2);
    const shimmerMat = new THREE.MeshBasicMaterial({
      map: createShimmerTexture(), transparent: true, opacity: 0.18,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: true,
    });
    shimmer = new THREE.Mesh(shimmerGeo, shimmerMat);
    shimmer.position.y = y + 3.5;
    scene.add(shimmer);
  }

  const basePositions = new Float32Array(posAttr.array); // original Y per vertex, for the ripple to animate around
  return { mesh, glow, shimmer, basePositions, biome, style };
}

function updateLiquidPlane(handle, elapsed) {
  if (!handle) return;
  const { mesh, glow, shimmer, basePositions, biome, style } = handle;
  const posAttr = mesh.geometry.attributes.position;
  const colorAttr = mesh.geometry.attributes.color;
  // Cheap per-vertex ripple — lava churns slower/heavier, water ripples
  // lighter and faster. A second, higher-frequency/lower-amplitude term
  // layered on top of the main swell adds finer chop instead of one
  // smooth wave shape everywhere.
  const speed = biome === "ember" ? 0.6 : 1.4;
  const amp = biome === "ember" ? 0.18 : 0.1;
  const chopAmp = amp * 0.35;
  const tmpColor = new THREE.Color();
  for (let i = 0; i < posAttr.count; i++) {
    const bx = basePositions[i * 3], bz = basePositions[i * 3 + 2];
    const swell = Math.sin(bx * 0.15 + elapsed * speed) * amp + Math.cos(bz * 0.12 + elapsed * speed * 0.8) * amp;
    const chop = Math.sin(bx * 0.55 + bz * 0.4 + elapsed * speed * 2.3) * chopAmp;
    const ripple = swell + chop;
    posAttr.setY(i, ripple);

    // Normalize ripple to 0..1.
    const range = (amp + chopAmp) * 2;
    const disturbance = THREE.MathUtils.clamp((ripple + range / 2) / range, 0, 1);

    if (biome === "ember" && style.crustColor) {
      // Real lava is dark cooled crust laced with glowing cracks, not a
      // uniform orange — a genuine 3-band gradient (dark crust -> molten
      // red -> white-hot glow) instead of a 2-color lerp gives that
      // texture. Crust dominates at rest, glow only right at true crests,
      // with a full red band carrying most of the surface in between.
      if (disturbance < 0.55) tmpColor.copy(style.crustColor).lerp(style.baseColor, disturbance / 0.55);
      else tmpColor.copy(style.baseColor).lerp(style.hotColor, (disturbance - 0.55) / 0.45);
    } else {
      const accent = style.frothColor;
      tmpColor.copy(style.baseColor).lerp(accent, Math.pow(disturbance, 3)); // pow(3) keeps froth rare/at true crests, not smeared across the whole surface
    }
    tmpColor.toArray(colorAttr.array, i * 3);
  }
  posAttr.needsUpdate = true;
  colorAttr.needsUpdate = true;
  mesh.geometry.computeVertexNormals();

  // Lava also gets a slow overall "breathing" pulse in its base emissive
  // intensity, independent of the spatial hot-spot pattern above — reads
  // as the whole surface swelling with heat, not just individual crests
  // glinting. The separate glow overlay pulses in sync, a touch more
  // strongly, since it's what actually sells "this is a light source."
  if (biome === "ember") {
    const pulse = 0.85 + 0.25 * Math.sin(elapsed * 0.9);
    mesh.material.emissiveIntensity = style.emissiveIntensity * pulse;
    if (glow) glow.material.opacity = style.glowOpacity * (0.75 + 0.4 * Math.sin(elapsed * 0.9));
    if (shimmer) {
      shimmer.material.map.offset.set(Math.sin(elapsed * 0.25) * 0.3, (elapsed * 0.12) % 1); // upward scroll + gentle sideways wobble, not a static texture
    }
  }
}

function disposeLiquidPlane(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
  if (handle.glow) {
    scene.remove(handle.glow);
    handle.glow.geometry.dispose();
    handle.glow.material.dispose();
  }
  if (handle.shimmer) {
    scene.remove(handle.shimmer);
    handle.shimmer.geometry.dispose();
    handle.shimmer.material.map.dispose();
    handle.shimmer.material.dispose();
  }
}

export { createLiquidPlane, updateLiquidPlane, disposeLiquidPlane };
