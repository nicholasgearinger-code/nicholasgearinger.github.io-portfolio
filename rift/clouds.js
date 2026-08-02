import * as THREE from "three";
import { getGraphicsSettings } from "./graphicsSettings.js";

// -----------------------------------------------------------------------------
// SWAP POINT: clouds. Each cloud is a small cluster of soft circular
// billboards (the same radial-gradient technique used for the sun/moon
// glow in dayNightCycle.js) rather than a single flat sprite — one
// billboard reads as a blob, several overlapping ones at different sizes
// reads as a puffy cloud. Cheap: still just a handful of sprites per
// cloud, additive/alpha blended, no real volumetrics. Swap CLOUD_STYLE for
// a different look/density per biome without touching drift or tinting.
// -----------------------------------------------------------------------------

const CLOUD_STYLE = {
  ember: { count: 14, altitude: 88, spread: 175, puffColor: 0x4a3830, opacity: 0.55, scale: 25 },   // low, ashy, smoke-dark rather than fluffy-white — count/scale bumped further for real sky coverage, still keeps the dark ashy character rather than fluffy-white
  verdant: { count: 16, altitude: 95, spread: 165, puffColor: 0xf4f7fb, opacity: 0.85, scale: 30 },  // big, bold, dominant puffy-white clouds per the flat-illustration reference
  crystal: { count: 20, altitude: 100, spread: 170, puffColor: 0xeaf3f7, opacity: 0.8, scale: 33 }, // still pale/cool at the base since the sky-color/accent blend below is what supplies the dramatic sunset color on top of this
  abyssal: { count: 10, altitude: 80, spread: 145, puffColor: 0x2e2a3a, opacity: 0.6, scale: 18 },   // heavy, dark, low — presses down on the chasms
  ashen: { count: 5, altitude: 110, spread: 155, puffColor: 0xd6cdb8, opacity: 0.35, scale: 13 },   // thin, wispy, dust-pale — barely enough moisture in the air to call these clouds; kept sparser than the others on purpose
};

// Same cluster-of-billboards technique as sky clouds, just low, wide, and
// flattened (small vertical spread, big horizontal spread) instead of
// puffy — a visible drifting mist layer at ground level, distinct from
// the ambient fog density that already breathes in weather.js.
const GROUND_FOG_STYLE = {
  ember: { count: 4, altitude: 2, spread: 90, puffColor: 0x6b5d52, opacity: 0.3, scale: 22 },
  verdant: { count: 5, altitude: 1.5, spread: 100, puffColor: 0xe8eef0, opacity: 0.35, scale: 24 },
  crystal: { count: 3, altitude: 2, spread: 90, puffColor: 0xcfe6ee, opacity: 0.25, scale: 20 },
  abyssal: { count: 7, altitude: 1, spread: 100, puffColor: 0x342f42, opacity: 0.45, scale: 26 }, // the thickest, heaviest ground fog — rolls right through the chasms
  ashen: { count: 4, altitude: 1.5, spread: 100, puffColor: 0xb8ab90, opacity: 0.28, scale: 22 },
};

// Vibrant sunrise/sunset accent palette — each cloud is assigned ONE of
// these at creation (see createCloud) and blends toward its own color
// when the sky is actually warm (see updateClouds' "warmth" check),
// rather than every cloud in the sky showing the exact same single
// horizon color. Real sunset skies show a real mix of hues across
// different clouds at once, not one uniform tint.
const DAWN_DUSK_ACCENTS = [0xff6a3a, 0xff4d7a, 0xb056e8, 0xffb84d, 0xe83d5c, 0x8a4de0];
// Real storm clouds go genuinely dark slate gray, not just their normal
// color dimmed — see the storm blend in updateClouds. Lightning flashes
// toward this near-white during a brief random strike.
const STORM_GRAY = new THREE.Color(0x3a3f47);
const LIGHTNING_WHITE = new THREE.Color(0xf0f4ff);

let sharedPuffTexture = null;
function getPuffTexture() {
  if (sharedPuffTexture) return sharedPuffTexture;
  const size = 256; // was 128 — low source resolution stretched across large, heavily-overlapping sprites (see the tightened clustering in createCloud) is a likely contributor to visible dithering/noise artifacts when magnified
  const canvas = document.createElement("canvas");
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,0.97)");
  grad.addColorStop(0.55, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.78, "rgba(255,255,255,0.5)"); // added intermediate stop — the old 2-stop falloff (solid straight to fading) had a harsher transition, more prone to banding/dithering than a genuinely gradual multi-stop curve
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  sharedPuffTexture = new THREE.CanvasTexture(canvas);
  return sharedPuffTexture;
}

function createCloud(scene, style, flatten = 1) {
  const group = new THREE.Group();
  const puffCount = 5 + Math.floor(Math.random() * 5); // was 4-7, now 5-9 — fuller, chunkier cloud shapes
  const sprites = [];
  const baseColor = new THREE.Color(style.puffColor);
  const accentColor = new THREE.Color(DAWN_DUSK_ACCENTS[Math.floor(Math.random() * DAWN_DUSK_ACCENTS.length)]);
  for (let i = 0; i < puffCount; i++) {
    const mat = new THREE.SpriteMaterial({
      map: getPuffTexture(), color: style.puffColor, transparent: true, opacity: style.opacity,
      depthWrite: false, fog: true,
    });
    const sprite = new THREE.Sprite(mat);
    // Independently varied X/Y scale (was one value used for both,
    // making every puff a perfect circle) plus a random in-plane
    // rotation — elongated/squashed ellipses at random orientations
    // read as far more organic than a cluster of uniform circles.
    const sX = style.scale * (0.75 + Math.random() * 0.65); // was 0.6-1.3 — bigger minimum so puffs reliably overlap their neighbors
    const sY = style.scale * (0.6 + Math.random() * 0.7) * flatten;
    sprite.material.rotation = Math.random() * Math.PI * 2;
    // Spread was 1.4x scale — too generous relative to puff size, leaving
    // real gaps between puffs that read as a scatter of separate circles
    // rather than one cloud mass. Tightened so puffs actually overlap and
    // merge into a continuous silhouette.
    const baseLocalX = (Math.random() - 0.5) * style.scale * 0.8;
    const baseLocalZ = (Math.random() - 0.5) * style.scale * 0.8;
    sprite.userData.baseScaleX = sX;
    sprite.userData.baseScaleY = sY;
    sprite.userData.baseLocalX = baseLocalX;
    sprite.userData.baseLocalZ = baseLocalZ;
    // Real clouds reform gradually — minutes, not seconds. driftSpeed
    // this slow means a full wander cycle takes roughly 5-13 minutes, so
    // moment-to-moment it's nearly imperceptible but the cloud's actual
    // silhouette is visibly different if you look again later, which is
    // the real thing clouds do that a fast pulse/breathe never looked
    // like.
    sprite.userData.driftPhaseX = Math.random() * Math.PI * 2;
    sprite.userData.driftPhaseZ = Math.random() * Math.PI * 2;
    sprite.userData.driftSpeed = 0.008 + Math.random() * 0.012;
    sprite.userData.driftRange = style.scale * (0.1 + Math.random() * 0.12); // was 0.18-0.36 — scaled down to match the tighter base spread above, otherwise the slow wander would undo the tighter clustering over its own cycle
    // How much THIS puff swells during a storm — varies per-puff so a
    // storm-thickened cloud grows unevenly (real storm clouds bulge and
    // pile up, they don't scale uniformly like a balloon).
    sprite.userData.stormGrowth = 0.5 + Math.random() * 0.7;
    sprite.scale.set(sX, sY, 1); // flatten<1 spreads wide and low instead of puffy — this is what turns the same technique into a ground fog bank
    const localYRange = style.scale * 0.175 * flatten;
    const localY = (Math.random() - 0.5) * localYRange * 2;
    sprite.userData.localY = localY;
    sprite.userData.localYRange = localYRange || 1; // guard divide-by-zero for the fully-flat ground fog case
    sprite.position.set(baseLocalX, localY, baseLocalZ);
    group.add(sprite);
    sprites.push(sprite);
  }
  const baseY = style.altitude + (Math.random() - 0.5) * 12 * flatten;
  group.position.set((Math.random() - 0.5) * style.spread * 2, baseY, (Math.random() - 0.5) * style.spread * 2);
  scene.add(group);
  return { group, sprites, baseOpacity: style.opacity, baseColor, accentColor, baseY };
}

/**
 * @param {THREE.Scene} scene
 * @param {string} biome
 */
function createClouds(scene, biome) {
  const style = CLOUD_STYLE[biome] || CLOUD_STYLE.verdant;
  const mult = getGraphicsSettings().cloudMultiplier;
  const clouds = [];
  const cloudCount = Math.max(1, Math.round(style.count * mult));
  for (let i = 0; i < cloudCount; i++) clouds.push(createCloud(scene, style));

  const fogStyle = GROUND_FOG_STYLE[biome] || GROUND_FOG_STYLE.verdant;
  const groundFog = [];
  const fogCount = Math.max(1, Math.round(fogStyle.count * mult));
  for (let i = 0; i < fogCount; i++) groundFog.push(createCloud(scene, fogStyle, 0.18));

  return { clouds, style, groundFog, fogStyle, biome, windOffsetX: 0, windOffsetZ: 0, elapsed: 0 };
}

const _cloudToSun = new THREE.Vector3();
const _cloudToCam = new THREE.Vector3();

/**
 * @param {{windX:number, windZ:number}} wind
 * @param {number} dayAmount  0..1, from the day/night cycle — clouds read
 *   noticeably warmer/darker at dawn/dusk than at flat noon light
 * @param {number} rainIntensity  0..1 — storm clouds darken while it's
 *   actually raining, not just sit there looking identical to a clear day
 * @param {THREE.Color} [skyHorizonColor]  the day/night cycle's own current
 *   horizon color
 * @param {THREE.Vector3} [sunPos]  the sun body's current world position —
 *   only clouds actually near this direction (as seen from the camera)
 *   pick up the horizon/accent color shift, like real clouds do (the sky
 *   glows dramatically right around the sun, not uniformly everywhere)
 * @param {THREE.Vector3} [cameraPos]
 */
function updateClouds(handle, dt, wind, dayAmount, rainIntensity, skyHorizonColor, sunPos, cameraPos) {
  if (!handle) return;
  const { clouds, style, groundFog, fogStyle, biome } = handle;
  handle.elapsed += dt;
  const lightFactor = 0.55 + dayAmount * 0.45; // dimmer/moodier at dawn/dusk/night, brightest at noon
  const storm = rainIntensity || 0; // 0..1
  // Storm clouds are darker AND visibly bigger/denser — real ones pile
  // up and thicken, they don't just dim in place at the same shape.
  const stormDarken = 1 - storm * 0.35;
  // How warm the sky currently is — a real sunset horizon color has red
  // well above blue; a clear midday or night sky doesn't. This peaks
  // naturally during the actual dawn/dusk transition without needing to
  // duplicate dayNightCycle.js's own elevation-based timing here.
  const warmth = skyHorizonColor ? THREE.MathUtils.clamp((skyHorizonColor.r - skyHorizonColor.b) * 1.8, 0, 1) : 0;
  // Verdant-only — clouds fade out entirely as true night sets in, not
  // just dim, since a sky full of visible clouds fights the "near-total
  // darkness, lit only by the moon and bioluminescence" goal this biome
  // is going for. Other biomes are untouched (nightFade stays 1).
  const nightFade = biome === "verdant" ? Math.max(0, Math.min(1, (dayAmount - 0.05) / 0.25)) : 1;
  for (const cloud of clouds) {
    cloud.group.position.x += (wind?.windX || 0) * dt * 0.6;
    cloud.group.position.z += (wind?.windZ || 0) * dt * 0.6;
    // Wrap back around once a cloud drifts past the scattering radius —
    // clouds drift slower than ground-level particles since they're much
    // further away, so the same wind speed reads as more sluggish motion.
    if (Math.abs(cloud.group.position.x) > style.spread) cloud.group.position.x = -Math.sign(cloud.group.position.x) * style.spread;
    if (Math.abs(cloud.group.position.z) > style.spread) cloud.group.position.z = -Math.sign(cloud.group.position.z) * style.spread;
    // How close THIS cloud is to the sun's actual current direction, as
    // seen from the camera — 0 well away from it, ramping to 1 dead-on.
    // A fairly wide cone (not a pinpoint) so a real cluster of clouds
    // "surrounding" the sun lights up together, not just one lucky cloud
    // exactly in the crosshair.
    let sunProximity = 0;
    if (sunPos && cameraPos) {
      _cloudToCam.subVectors(cloud.group.position, cameraPos);
      const distToCam = _cloudToCam.length();
      if (distToCam > 1) {
        _cloudToCam.multiplyScalar(1 / distToCam);
        _cloudToSun.subVectors(sunPos, cameraPos).normalize();
        const alignment = _cloudToCam.dot(_cloudToSun);
        sunProximity = THREE.MathUtils.clamp((alignment - 0.25) / 0.55, 0, 1); // widened from 0.45/0.5 — more clouds around the sun visibly react, not just the one or two dead-center
      }
    }
    // Lightning — a rare, brief flash to near-white across a whole cloud
    // at once, only during real storms. One random roll per CLOUD per
    // frame (not per puff — that would multiply the effective
    // probability by however many puffs a cloud has). Cheap: no new
    // render pass or shader, just a color lerp already happening below.
    if (storm > 0.3 && Math.random() < storm * 0.0006) {
      cloud.lightningUntil = handle.elapsed + 0.12;
    }
    const flashing = cloud.lightningUntil && handle.elapsed < cloud.lightningUntil;
    for (const sprite of cloud.sprites) {
      sprite.material.opacity = cloud.baseOpacity * lightFactor * stormDarken * nightFade;
      // Slow wander within the cloud — each puff drifts around its own
      // starting spot on a multi-minute cycle (see driftSpeed at
      // creation), rather than the whole cloud pulsing in place. This is
      // what actually reads as "reforming over time" instead of an
      // animation loop.
      const u = handle.elapsed * sprite.userData.driftSpeed;
      sprite.position.x = sprite.userData.baseLocalX + Math.sin(u + sprite.userData.driftPhaseX) * sprite.userData.driftRange;
      sprite.position.z = sprite.userData.baseLocalZ + Math.cos(u * 0.8 + sprite.userData.driftPhaseZ) * sprite.userData.driftRange;
      // Real shape response to weather — storms swell each puff
      // unevenly (stormGrowth varies per-puff, set at creation) so the
      // whole cloud visibly thickens and piles up rather than uniformly
      // scaling like a balloon. Settles back to its base shape as the
      // storm passes.
      const stormGrow = 1 + storm * sprite.userData.stormGrowth * 0.5;
      sprite.scale.set(sprite.userData.baseScaleX * stormGrow, sprite.userData.baseScaleY * stormGrow, 1);
      // Only clouds actually near the sun shift color at all — real
      // atmospheric glow is concentrated around the sun's own position,
      // not a flat tint applied to the entire sky uniformly. Clouds
      // elsewhere just stay their base color.
      sprite.material.color.copy(cloud.baseColor);
      if (skyHorizonColor && sunProximity > 0) {
        sprite.material.color.lerp(skyHorizonColor, 0.7 * sunProximity); // was 0.55
        // Extra vibrant push right around the sun during actual dawn/
        // dusk — each cloud blends toward its OWN assigned accent color
        // (see DAWN_DUSK_ACCENTS), so the glow around the sun shows real
        // purple/orange/red/pink variety rather than one uniform tint.
        // Inert (warmth=0) outside the actual dawn/dusk window.
        if (warmth > 0) sprite.material.color.lerp(cloud.accentColor, warmth * sunProximity * 0.9); // was 0.75
        // Real backlit brightness right at the sun — clouds directly
        // around it often look almost lit from within (thin edges are
        // genuinely translucent to direct sunlight), not just tinted a
        // different color at the same brightness.
        sprite.material.color.multiplyScalar(1 + sunProximity * warmth * 0.5);
      }
      // Cheap fake self-shadowing — real clouds are lit from above/the
      // sun's side and darker underneath; a flat-tinted billboard cluster
      // doesn't show that at all. No shader, no extra render cost — just
      // a brightness multiply on a color already being written this
      // frame, using each puff's own fixed local height (set once at
      // creation) to know whether it's near the top or bottom.
      const heightT = (sprite.userData.localY / sprite.userData.localYRange + 1) / 2; // 0 at the bottom, 1 at the top
      sprite.material.color.multiplyScalar(0.8 + heightT * 0.35);
      // Real storm clouds go genuinely dark gray, not just their normal
      // color dimmed — the old stormDarken only touched opacity. Blended
      // in on top of everything else above (including the sun-lit
      // brightness), so a storm rolling in visibly desaturates a cloud
      // toward slate gray even if it was glowing pink a moment before.
      if (storm > 0) sprite.material.color.lerp(STORM_GRAY, storm * 0.7);
      if (flashing) sprite.material.color.lerp(LIGHTNING_WHITE, 0.85);
      // Clamp — the multiplies above can genuinely push channel values
      // past 1.0 (e.g. the backlit boost near the sun combined with the
      // top-of-cloud brightness), and feeding out-of-range color values
      // to the GPU is what was very likely behind the staticky/
      // chromatic-noise texture artifact.
      sprite.material.color.r = Math.min(1, sprite.material.color.r);
      sprite.material.color.g = Math.min(1, sprite.material.color.g);
      sprite.material.color.b = Math.min(1, sprite.material.color.b);
    }
  }

  // Ground fog drifts at full wind speed (it's right there at head height,
  // not far off like sky clouds) and isn't storm-darkened — it's mist,
  // not a rain cloud, so it stays the same regardless of whether it's
  // raining.
  for (const bank of groundFog) {
    bank.group.position.x += (wind?.windX || 0) * dt;
    bank.group.position.z += (wind?.windZ || 0) * dt;
    if (Math.abs(bank.group.position.x) > fogStyle.spread) bank.group.position.x = -Math.sign(bank.group.position.x) * fogStyle.spread;
    if (Math.abs(bank.group.position.z) > fogStyle.spread) bank.group.position.z = -Math.sign(bank.group.position.z) * fogStyle.spread;
    for (const sprite of bank.sprites) {
      sprite.material.opacity = bank.baseOpacity * lightFactor;
    }
  }
}

function disposeClouds(scene, handle) {
  if (!handle) return;
  for (const cloud of handle.clouds) {
    scene.remove(cloud.group);
    for (const sprite of cloud.sprites) sprite.material.dispose();
  }
  for (const bank of handle.groundFog) {
    scene.remove(bank.group);
    for (const sprite of bank.sprites) sprite.material.dispose();
  }
}

const _occToTarget = new THREE.Vector3();
const _occToCloud = new THREE.Vector3();
/**
 * Returns 0..1 — how much a cloud currently sits between the camera and
 * a given sky target (the sun or moon's own position), for a cheap
 * "clouds sometimes drift in front of the sun/moon" effect. Not real
 * per-pixel depth occlusion — these are alpha-blended, depthWrite:false
 * sprites, and relying on transparent-object sort order against the
 * sun/moon's own sprite-based glow would be unpredictable rather than
 * intentional-looking. This is a deliberate angular-alignment check
 * instead: cheap (a handful of dot products, not a render pass), and
 * looks like real occlusion because it only fires when a cloud is
 * genuinely between the camera and that exact direction.
 * @param {THREE.Vector3} cameraPos
 * @param {THREE.Vector3} targetPos  the sun or moon body's world position
 */
function getCloudOcclusionFactor(handle, cameraPos, targetPos) {
  if (!handle) return 0;
  _occToTarget.subVectors(targetPos, cameraPos).normalize();
  let occlusion = 0;
  for (const cloud of handle.clouds) {
    _occToCloud.subVectors(cloud.group.position, cameraPos);
    const dist = _occToCloud.length();
    if (dist < 1) continue;
    _occToCloud.multiplyScalar(1 / dist);
    const alignment = _occToCloud.dot(_occToTarget); // 1.0 = dead-on the same direction
    if (alignment > 0.9975) { // tight threshold — the sun/moon disc is visually small, only a near-dead-on cloud should count
      occlusion = Math.max(occlusion, cloud.baseOpacity);
    }
  }
  return Math.min(0.92, occlusion); // never fully hides it — a thin bright edge/glow through a cloud is how the real thing looks too
}

export { createClouds, updateClouds, disposeClouds, getCloudOcclusionFactor };
