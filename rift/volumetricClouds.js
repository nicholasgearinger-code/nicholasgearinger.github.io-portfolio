import * as THREE from "three";

// -----------------------------------------------------------------------------
// Real ray-marched volumetric clouds — a single large box the camera sits
// inside of; the fragment shader marches each pixel's view ray through a
// thin horizontal "cloud layer" slab, sampling 3D Worley+Perlin/value FBM
// noise at each step and accumulating density/light via a standard
// emission-absorption volumetric model. This is genuine per-pixel GPU
// cost — one primary march per pixel, no nested shadow marching (that
// would multiply the cost several times over, not mobile-feasible) —
// so lighting is a cheap approximation (height gradient + forward-
// scattering silver-lining) rather than real self-shadowing.
//
// Gated to High graphics tier only by the caller (main.js) — Low/Medium
// keep the existing cheap sprite-billboard clouds (clouds.js) instead.
// This is real, uncertain-cost GPU work; if it runs poorly even on High,
// the next levers are (in order of impact): STEPS, FBM_OCTAVES, or
// disabling this and falling back to clouds.js entirely.
// -----------------------------------------------------------------------------

const CLOUD_LAYER_BASE = 90;
const CLOUD_LAYER_TOP = 190;
const BOX_HALF = 900; // comfortably covers the sky dome's own 900-unit radius

const VERT = `
varying vec3 vWorldPos;
void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAG = `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform float uCoverage;   // 0..1 — how much of the sky has cloud, weather-driven
uniform float uDensity;    // overall density multiplier
uniform float uOpacityMul; // day/night fade
varying vec3 vWorldPos;
// cameraPosition is one of three.js's automatic built-in uniforms for
// ShaderMaterial (not RawShaderMaterial) — no explicit declaration needed.

float hash3(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float valueNoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash3(i + vec3(0.0,0.0,0.0)), n100 = hash3(i + vec3(1.0,0.0,0.0));
  float n010 = hash3(i + vec3(0.0,1.0,0.0)), n110 = hash3(i + vec3(1.0,1.0,0.0));
  float n001 = hash3(i + vec3(0.0,0.0,1.0)), n101 = hash3(i + vec3(1.0,0.0,1.0));
  float n011 = hash3(i + vec3(0.0,1.0,1.0)), n111 = hash3(i + vec3(1.0,1.0,1.0));
  float nx00 = mix(n000, n100, f.x), nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x), nx11 = mix(n011, n111, f.x);
  float nxy0 = mix(nx00, nx10, f.y), nxy1 = mix(nx01, nx11, f.y);
  return mix(nxy0, nxy1, f.z);
}
// 3 octaves — a real cost/quality tradeoff. This is the first knob to
// cut (down to 2) if performance is a problem.
float fbm3(vec3 p) {
  float sum = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 3; i++) {
    sum += valueNoise3(p * freq) * amp;
    freq *= 2.02;
    amp *= 0.5;
  }
  return sum;
}
// Cheap 3D Worley (F1) — a 2x2x2 neighbor search (not the mathematically
// complete 3x3x3) is a real approximation, not exact, but visually very
// close for this purpose at roughly a third of the cost.
vec3 hash3v(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
float worley3(vec3 p) {
  vec3 ip = floor(p), fp = fract(p);
  float minDist = 1.0;
  for (int z = 0; z <= 1; z++) {
    for (int y = 0; y <= 1; y++) {
      for (int x = 0; x <= 1; x++) {
        vec3 neighbor = vec3(float(x), float(y), float(z));
        vec3 point = hash3v(ip + neighbor);
        float d = length(neighbor + point - fp);
        minDist = min(minDist, d);
      }
    }
  }
  return minDist;
}

// Cloud density at a given world position — Worley carves cauliflower-
// like cavities out of a value-noise FBM base shape (the standard
// "billowy" cloud look), shaped by a vertical falloff so density is 0 at
// the very top/bottom of the layer and peaks mid-layer (a real cumulus
// silhouette, not a uniform haze slab), and masked by a large-scale
// coverage noise so clouds cluster into formations instead of filling
// the whole sky evenly.
float cloudDensity(vec3 p) {
  float layerT = (p.y - ${CLOUD_LAYER_BASE.toFixed(1)}) / ${(CLOUD_LAYER_TOP - CLOUD_LAYER_BASE).toFixed(1)};
  if (layerT < 0.0 || layerT > 1.0) return 0.0;
  float heightShape = smoothstep(0.0, 0.18, layerT) * (1.0 - smoothstep(0.55, 1.0, layerT));

  vec3 windP = p + vec3(uTime * 1.6, 0.0, uTime * 0.9);
  float coverageMask = fbm3(windP * 0.012);
  coverageMask = smoothstep(1.0 - uCoverage, 1.0, coverageMask);
  if (coverageMask <= 0.0) return 0.0;

  float base = fbm3(windP * 0.05);
  float worley = worley3(windP * 0.09 + 11.0);
  float shape = base - worley * 0.55;
  shape = clamp(shape, 0.0, 1.0);

  return shape * heightShape * coverageMask * uDensity;
}

void main() {
  vec3 rayDir = normalize(vWorldPos - cameraPosition);
  vec3 rayOrigin = cameraPosition;

  // Analytic ray/slab intersection — only march the actual thin cloud
  // layer, not the whole (much larger) bounding box.
  float tNear, tFar;
  if (abs(rayDir.y) < 0.0005) {
    if (rayOrigin.y < ${CLOUD_LAYER_BASE.toFixed(1)} || rayOrigin.y > ${CLOUD_LAYER_TOP.toFixed(1)}) discard;
    tNear = 0.0; tFar = 3000.0;
  } else {
    float t0 = (${CLOUD_LAYER_BASE.toFixed(1)} - rayOrigin.y) / rayDir.y;
    float t1 = (${CLOUD_LAYER_TOP.toFixed(1)} - rayOrigin.y) / rayDir.y;
    tNear = min(t0, t1);
    tFar = max(t0, t1);
  }
  tNear = max(tNear, 0.0);
  tFar = min(tFar, 3000.0);
  if (tFar <= tNear) discard;

  // 24 steps — the single biggest cost/quality lever in this whole
  // shader. Cut this first if performance is a problem.
  const int STEPS = 24;
  float stepSize = (tFar - tNear) / float(STEPS);
  // Dithered start offset (a cheap screen-space hash) — breaks up visible
  // banding between fixed march steps, standard ray-march trick.
  float t = tNear + stepSize * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  vec3 accumColor = vec3(0.0);
  float accumAlpha = 0.0;

  for (int i = 0; i < STEPS; i++) {
    if (accumAlpha >= 0.985) break;
    vec3 samplePos = rayOrigin + rayDir * t;
    float density = cloudDensity(samplePos);
    if (density > 0.001) {
      float layerT = (samplePos.y - ${CLOUD_LAYER_BASE.toFixed(1)}) / ${(CLOUD_LAYER_TOP - CLOUD_LAYER_BASE).toFixed(1)};
      // Cheap fake lighting — no secondary shadow march toward the sun
      // (real self-shadowing, but multiplies the cost several times
      // over — not mobile-feasible in a single pass): brighter toward
      // the cloud top (closer to open sky) and a forward-scattering
      // boost when the view ray points toward the sun, the real
      // "silver lining" look around a sun behind cloud edges.
      float heightLight = mix(0.55, 1.15, layerT);
      float forwardScatter = pow(max(dot(rayDir, uSunDir), 0.0), 3.0) * 0.6;
      vec3 litColor = mix(uAmbientColor, uSunColor, clamp(heightLight * 0.6 + forwardScatter, 0.0, 1.0));

      float stepAlpha = clamp(density * stepSize * 0.06, 0.0, 1.0);
      accumColor += litColor * stepAlpha * (1.0 - accumAlpha);
      accumAlpha += stepAlpha * (1.0 - accumAlpha);
    }
    t += stepSize;
  }

  if (accumAlpha < 0.01) discard;
  gl_FragColor = vec4(accumColor, accumAlpha * uOpacityMul);
}
`;

function createVolumetricClouds(scene) {
  const geo = new THREE.BoxGeometry(BOX_HALF * 2, (CLOUD_LAYER_TOP - CLOUD_LAYER_BASE) + 40, BOX_HALF * 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(0xfff4e0) },
      uAmbientColor: { value: new THREE.Color(0x8899bb) },
      uCoverage: { value: 0.55 },
      uDensity: { value: 1.0 },
      uOpacityMul: { value: 1.0 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide, // the camera sits INSIDE this box (half-width 900 vs. WORLD_BOUND_RADIUS ~112) — only the inner surface is ever visible
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, (CLOUD_LAYER_BASE + CLOUD_LAYER_TOP) / 2, 0);
  mesh.renderOrder = 10; // after opaque terrain/water, so depth-testing against them works correctly while this itself stays transparent
  scene.add(mesh);
  return { mesh, mat };
}

/**
 * @param {THREE.Vector3} sunDirection  world-space position/direction toward
 *   the sun (e.g. the scene's directional light position) — normalized here
 * @param {THREE.Color} sunColor
 * @param {number} dayAmount  0..1
 * @param {number} [coverage]  0..1, optional — defaults to the value already set
 */
function updateVolumetricClouds(handle, elapsed, sunDirection, sunColor, dayAmount, coverage) {
  if (!handle) return;
  handle.mat.uniforms.uTime.value = elapsed;
  if (sunDirection) handle.mat.uniforms.uSunDir.value.copy(sunDirection).normalize();
  if (sunColor) handle.mat.uniforms.uSunColor.value.copy(sunColor);
  handle.mat.uniforms.uOpacityMul.value = 0.35 + dayAmount * 0.65; // dimmer at night, same spirit as clouds.js's own lightFactor
  if (coverage !== undefined) handle.mat.uniforms.uCoverage.value = coverage;
}

function disposeVolumetricClouds(scene, handle) {
  if (!handle) return;
  scene.remove(handle.mesh);
  handle.mesh.geometry.dispose();
  handle.mesh.material.dispose();
}

export { createVolumetricClouds, updateVolumetricClouds, disposeVolumetricClouds };
