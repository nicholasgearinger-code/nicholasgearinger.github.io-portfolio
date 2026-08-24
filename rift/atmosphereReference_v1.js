import * as THREE from "three";

const SKY_RADIUS = 920;
const SKY_WIDTH_SEGMENTS = 36;
const SKY_HEIGHT_SEGMENTS = 18;
const DAY_ZENITH = new THREE.Color(0x49a8e8);
const DAY_HORIZON = new THREE.Color(0xd2edf8);
const TWILIGHT_ZENITH = new THREE.Color(0x496b9d);
const TWILIGHT_HORIZON = new THREE.Color(0xffb778);
const NIGHT_ZENITH = new THREE.Color(0x07152c);
const NIGHT_HORIZON = new THREE.Color(0x18314f);
const HIGH_SUN = new THREE.Color(0xfff9e8);
const LOW_SUN = new THREE.Color(0xffad63);
const DAY_AMBIENT = new THREE.Color(0xaed2ef);
const TWILIGHT_AMBIENT = new THREE.Color(0x8b86a4);
const NIGHT_AMBIENT = new THREE.Color(0x263b61);
const MOON_LIGHT = new THREE.Color(0xb9c9ee);
const HAZE_DAY = new THREE.Color(0xe9f6fb);
const HAZE_WARM = new THREE.Color(0xffc78c);

function clamp01(v) {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function smooth01(v) {
  const t = clamp01(v);
  return t * t * (3 - 2 * t);
}

function smoothRange(a, b, x) {
  return smooth01((x - a) / Math.max(1e-6, b - a));
}

function createSkyDome(scene) {
  const geometry = new THREE.SphereGeometry(
    SKY_RADIUS,
    SKY_WIDTH_SEGMENTS,
    SKY_HEIGHT_SEGMENTS,
  );
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "rift-reference-atmosphere-dome";
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;
  scene.add(mesh);
  return { mesh, geometry, material, position, color: geometry.getAttribute("color") };
}

export function createReferenceAtmosphere(scene, sun, ambient, moonLight) {
  const dome = createSkyDome(scene);
  return {
    scene,
    sun,
    ambient,
    moonLight,
    dome,
    sunDirection: new THREE.Vector3(0.35, 0.82, 0.2).normalize(),
    moonDirection: new THREE.Vector3(-0.35, -0.82, -0.2).normalize(),
    zenithColor: DAY_ZENITH.clone(),
    horizonColor: DAY_HORIZON.clone(),
    backgroundColor: DAY_ZENITH.clone().lerp(DAY_HORIZON, 0.45),
    hazeColor: HAZE_DAY.clone(),
    sunColor: HIGH_SUN.clone(),
    ambientColor: DAY_AMBIENT.clone(),
    moonColor: MOON_LIGHT.clone(),
    waterShallowColor: new THREE.Color(0x55d8e2),
    waterMidColor: new THREE.Color(0x1689ad),
    waterDeepColor: new THREE.Color(0x074b78),
    exposure: 0.92,
    daylight: 1,
    lowSun: 0,
    storm: 0,
  };
}

function updateSkyDome(handle) {
  const { dome, sunDirection, moonDirection } = handle;
  if (!dome?.position || !dome?.color) return;

  const pos = dome.position;
  const colors = dome.color.array;
  const dir = new THREE.Vector3();
  const c = new THREE.Color();
  const haze = handle.hazeColor;
  const day = handle.daylight;
  const lowSun = handle.lowSun;

  for (let i = 0; i < pos.count; i++) {
    dir.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
    const alt = clamp01((dir.y + 0.10) / 1.10);
    const vertical = Math.pow(alt, 0.55);
    c.copy(handle.horizonColor).lerp(handle.zenithColor, vertical);

    const horizonBand = Math.pow(1 - alt, 4.0) * (0.11 + handle.storm * 0.04);
    c.lerp(haze, horizonBand);

    const sunDot = clamp01(dir.dot(sunDirection));
    const solarAureole = Math.pow(sunDot, 14) * day * (0.12 + lowSun * 0.20);
    const solarCoreHaze = Math.pow(sunDot, 52) * day * (0.12 + lowSun * 0.12);
    c.lerp(handle.sunColor, clamp01(solarAureole + solarCoreHaze));

    const moonDot = clamp01(dir.dot(moonDirection));
    const moonHaze = Math.pow(moonDot, 34) * (1 - day) * 0.08;
    c.lerp(handle.moonColor, moonHaze);

    const j = i * 3;
    colors[j] = c.r;
    colors[j + 1] = c.g;
    colors[j + 2] = c.b;
  }
  dome.color.needsUpdate = true;
}

export function updateReferenceAtmosphere(handle, cycle, dayNightResult, weatherState = null) {
  if (!handle || !cycle) return dayNightResult;

  const sunPos = cycle.sunBody?.group?.position;
  if (sunPos?.isVector3) handle.sunDirection.copy(sunPos).normalize();
  handle.moonDirection.copy(handle.sunDirection).multiplyScalar(-1);

  const elevation = sunPos?.isVector3
    ? THREE.MathUtils.clamp((sunPos.y - 10) / 260, -1, 1)
    : 0.5;
  const daylight = smoothRange(-0.10, 0.16, elevation);
  const twilight = smoothRange(-0.22, 0.05, elevation) * (1 - daylight);
  const lowSun = daylight * (1 - smoothRange(0.08, 0.46, elevation));
  const storm = clamp01(weatherState?.stormIntensity ?? weatherState?.rainIntensity ?? 0);

  handle.daylight = daylight;
  handle.lowSun = lowSun;
  handle.storm = storm;

  const dayZenith = DAY_ZENITH.clone().lerp(new THREE.Color(0x75c9f2), storm * 0.25);
  const dayHorizon = DAY_HORIZON.clone().lerp(new THREE.Color(0xb8c9d2), storm * 0.35);
  const twilightZenith = TWILIGHT_ZENITH.clone();
  const twilightHorizon = TWILIGHT_HORIZON.clone();
  const nightZenith = NIGHT_ZENITH.clone();
  const nightHorizon = NIGHT_HORIZON.clone();

  handle.zenithColor.copy(nightZenith)
    .lerp(twilightZenith, twilight)
    .lerp(dayZenith, daylight);
  handle.horizonColor.copy(nightHorizon)
    .lerp(twilightHorizon, twilight)
    .lerp(dayHorizon, daylight);
  handle.horizonColor.lerp(TWILIGHT_HORIZON, lowSun * 0.34);

  handle.hazeColor.copy(HAZE_DAY).lerp(HAZE_WARM, lowSun * 0.70);
  handle.hazeColor.lerp(new THREE.Color(0x9aa8b6), storm * 0.48);
  handle.sunColor.copy(LOW_SUN).lerp(HIGH_SUN, smoothRange(0.04, 0.46, elevation));
  handle.ambientColor.copy(NIGHT_AMBIENT)
    .lerp(TWILIGHT_AMBIENT, twilight)
    .lerp(DAY_AMBIENT, daylight)
    .lerp(new THREE.Color(0x8797a7), storm * 0.38);

  handle.backgroundColor.copy(handle.horizonColor).lerp(handle.zenithColor, 0.58);
  handle.exposure = THREE.MathUtils.lerp(0.80, 0.94, daylight) * THREE.MathUtils.lerp(1, 0.88, storm);

  if (handle.scene?.background?.isColor) {
    handle.scene.background.copy(handle.backgroundColor);
  }
  if (handle.sun?.color?.isColor) handle.sun.color.copy(handle.sunColor);
  if (handle.ambient?.color?.isColor) handle.ambient.color.copy(handle.ambientColor);
  if (handle.moonLight?.color?.isColor) handle.moonLight.color.copy(handle.moonColor);

  if (dayNightResult?.skyZenith?.isColor) dayNightResult.skyZenith.copy(handle.zenithColor);
  if (dayNightResult?.skyHorizon?.isColor) dayNightResult.skyHorizon.copy(handle.horizonColor);
  if (dayNightResult?.sunColor?.isColor) dayNightResult.sunColor.copy(handle.sunColor);

  updateSkyDome(handle);
  globalThis.__riftReferenceAtmosphere = handle;
  return dayNightResult;
}

export function disposeReferenceAtmosphere(handle) {
  if (!handle) return;
  handle.scene?.remove(handle.dome?.mesh);
  handle.dome?.geometry?.dispose?.();
  handle.dome?.material?.dispose?.();
  if (globalThis.__riftReferenceAtmosphere === handle) {
    delete globalThis.__riftReferenceAtmosphere;
  }
}
