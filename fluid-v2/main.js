import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { FluidSolver } from "./FluidSolver.js";
import { FluidSurface, createPoolEnvironment } from "./FluidSurface.js";
import { FluidCaustics } from "./FluidCaustics.js";
import { FluidParticles } from "./FluidParticles.js";
import { FluidSplashCrowns } from "./FluidSplashCrown.js";
import { FluidPhysics } from "./FluidPhysics.js";

const $ = (selector) => document.querySelector(selector);
const statusEl = $("#status");
const fpsEl = $("#fps");
const simEl = $("#sim-state");
const qualityEl = $("#quality-state");
const canvas = $("#fluid-canvas");

function setStatus(message, error = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", error);
}

const isTouch = matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
const url = new URL(location.href);
const qualityOverride = url.searchParams.get("quality");

const QUALITY = {
  low: { grid: 96, pressure: 6, dpr: 1.0, droplets: 56, caustics: 44, crowns: 4 },
  medium: { grid: 128, pressure: 10, dpr: 1.25, droplets: 96, caustics: 56, crowns: 6 },
  high: { grid: 192, pressure: 16, dpr: 1.5, droplets: 144, caustics: 80, crowns: 8 },
};

let qualityName = qualityOverride && QUALITY[qualityOverride]
  ? qualityOverride
  : (isTouch ? "medium" : "high");
let quality = QUALITY[qualityName];

let renderer;
let scene;
let camera;
let controls;
let solver;
let surface;
let caustics;
let particles;
let crowns;
let physics;
let timer;
let paused = false;
let vorticityEnabled = true;
let baseVorticity = 3.2;

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
let pointerDown = false;
let lastPointerWorld = null;
let lastPointerTime = 0;

let fpsFrames = 0;
let fpsStart = performance.now();

async function init() {
  if (!navigator.gpu || WebGPU.isAvailable() === false) {
    setStatus("WebGPU is required for the new fluid solver.", true);
    return;
  }

  setStatus("Initializing physical WebGPU fluid solver…");

  renderer = new THREE.WebGPURenderer({ canvas, antialias: !isTouch, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  await renderer.init();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x82c1dd);
  scene.fog = new THREE.FogExp2(0x9acddd, 0.0105);

  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.08, 180);
  camera.position.set(18, 16, 22);

  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = 8;
  controls.maxDistance = 58;
  controls.maxPolarAngle = Math.PI * 0.49;

  const hemi = new THREE.HemisphereLight(0xe8f8ff, 0x314151, 1.65);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff3d2, 4.8);
  sun.position.set(-14, 24, -8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 512 : 1024, isTouch ? 512 : 1024);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 70;
  sun.shadow.bias = -0.00035;
  scene.add(sun);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  solver = new FluidSolver(renderer, {
    size: quality.grid,
    worldSize: 34,
    pressureIterations: quality.pressure,
    gravity: 11.8,
    meanDepth: 0.82,
    vorticity: baseVorticity,
    projection: 0.82,
  });
  await solver.initialize();

  surface = new FluidSurface(solver);
  scene.add(surface.mesh);

  const environment = createPoolEnvironment(solver.worldSize);
  scene.add(environment);

  const incomingSun = new THREE.Vector3()
    .copy(sun.target.position)
    .sub(sun.position)
    .normalize();
  caustics = new FluidCaustics(solver, surface.time, {
    resolution: quality.caustics,
    lightDirection: incomingSun,
  });
  scene.add(caustics.mesh);

  particles = new FluidParticles(scene, solver, { count: quality.droplets });
  crowns = new FluidSplashCrowns(scene, solver, { count: quality.crowns });
  setStatus("Loading Rapier physics…");
  physics = await FluidPhysics.create(scene, solver, particles, crowns);
  physics.spawnBall(-4, -2);
  physics.spawnCube(4, 2);

  setupPointerInput();
  setupUI();

  timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(animate);
  addEventListener("resize", onResize);

  // Seed the actual solver, not the display material.
  solver.queueImpact({ x: 0, z: 0, radius: 1.0, verticalSpeed: 2.8, displacedVolume: 1.1 });
  solver.queueSplat({
    x: -5,
    z: 3,
    vx: 3.0,
    vz: -1.1,
    strength: -0.38,
    radius: 1.2,
    radialImpulse: 0.65,
    ringRadius: 1.55,
    ringWidth: 0.5,
    ringStrength: 0.25,
  });

  updateHUD();
  setStatus("Running — surface deformation, splash crowns and caustics are driven by the live fluid state.");

  globalThis.__fluidLab = {
    renderer,
    scene,
    solver,
    surface,
    caustics,
    particles,
    crowns,
    physics,
  };
}

function setupPointerInput() {
  const updateHit = (event) => {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    return raycaster.ray.intersectPlane(waterPlane, hit) ? hit : null;
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    pointerDown = true;
    lastPointerTime = performance.now();
    const p = updateHit(event);
    if (!p) return;
    lastPointerWorld = p.clone();
    solver.queueImpact({ x: p.x, z: p.z, radius: 0.42, verticalSpeed: 2.1, displacedVolume: 0.12 });
    particles.emit(p.x, p.z, 0.42);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!pointerDown) return;
    const p = updateHit(event);
    if (!p) return;

    const now = performance.now();
    const dt = Math.max(0.012, (now - lastPointerTime) / 1000);
    let vx = 0;
    let vz = 0;
    if (lastPointerWorld) {
      vx = THREE.MathUtils.clamp((p.x - lastPointerWorld.x) / dt, -12, 12);
      vz = THREE.MathUtils.clamp((p.z - lastPointerWorld.z) / dt, -12, 12);
    }

    const dragStrength = 0.18 + Math.min(0.34, Math.hypot(vx, vz) * 0.018);
    solver.queueSplat({
      x: p.x,
      z: p.z,
      vx,
      vz,
      strength: -dragStrength,
      radius: 0.78,
      radialImpulse: Math.hypot(vx, vz) * 0.025,
      ringRadius: 0.92,
      ringWidth: 0.28,
      ringStrength: dragStrength * 0.25,
      foam: Math.hypot(vx, vz) * 0.02,
    });
    lastPointerWorld?.copy(p);
    lastPointerTime = now;
  });

  const endPointer = () => {
    pointerDown = false;
    lastPointerWorld = null;
  };
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", endPointer);
}

function setupUI() {
  $("#drop-ball").addEventListener("click", () => {
    physics.spawnBall(THREE.MathUtils.randFloat(-5, 5), THREE.MathUtils.randFloat(-5, 5));
  });
  $("#drop-cube").addEventListener("click", () => {
    physics.spawnCube(THREE.MathUtils.randFloat(-5, 5), THREE.MathUtils.randFloat(-5, 5));
  });
  $("#splash").addEventListener("click", () => {
    const x = THREE.MathUtils.randFloat(-7, 7);
    const z = THREE.MathUtils.randFloat(-7, 7);
    const impactSpeed = THREE.MathUtils.randFloat(5.0, 8.0);
    solver.queueImpact({
      x,
      z,
      radius: 0.85,
      verticalSpeed: impactSpeed,
      vx: THREE.MathUtils.randFloat(-2.5, 2.5),
      vz: THREE.MathUtils.randFloat(-2.5, 2.5),
      displacedVolume: 1.25,
    });
    particles.emit(x, z, impactSpeed * 0.17);
    crowns.emit(x, z, 0.85, impactSpeed);
  });
  $("#pause").addEventListener("click", (event) => {
    paused = !paused;
    event.currentTarget.textContent = paused ? "Resume" : "Pause";
    updateHUD();
  });
  $("#vorticity").addEventListener("click", (event) => {
    vorticityEnabled = !vorticityEnabled;
    solver.vorticityStrength.value = vorticityEnabled ? baseVorticity : 0;
    event.currentTarget.classList.toggle("off", !vorticityEnabled);
    updateHUD();
  });
  $("#reset").addEventListener("click", () => {
    physics.clear();
    crowns.clear();
    solver.reset();
    physics.spawnBall(-4, -2);
    physics.spawnCube(4, 2);
    setStatus("Simulation reset.");
  });
  $("#pressure").addEventListener("click", () => {
    const levels = [6, 10, 16, 22];
    const current = solver.pressureIterations;
    const index = levels.findIndex((n) => n > current);
    solver.setPressureIterations(index >= 0 ? levels[index] : levels[0]);
    updateHUD();
  });
}

function updateHUD() {
  simEl.textContent = paused ? "PAUSED" : "LIVE";
  qualityEl.textContent = `${qualityName.toUpperCase()} · ${solver.size}² · P${solver.pressureIterations}`;
  $("#vorticity").textContent = vorticityEnabled ? "Vorticity ON" : "Vorticity OFF";
}

function animate(timestamp) {
  timer.update(timestamp);
  const dt = Math.min(timer.getDelta(), 1 / 24);
  controls.update();

  if (!paused) {
    physics.update(dt);
    particles.update(dt);
    crowns.update(dt);
    solver.step(dt);
    surface.update(dt);
  }

  renderer.render(scene, camera);

  fpsFrames++;
  const now = performance.now();
  if (now - fpsStart >= 750) {
    const fps = fpsFrames * 1000 / (now - fpsStart);
    fpsEl.textContent = `${fps.toFixed(0)} FPS`;
    fpsFrames = 0;
    fpsStart = now;
  }
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
}

addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  setStatus(`Runtime error: ${event.reason?.message || event.reason}`, true);
});
addEventListener("error", (event) => {
  console.error(event.error || event.message);
  setStatus(`Runtime error: ${event.error?.message || event.message}`, true);
});

init().catch((error) => {
  console.error(error);
  setStatus(`Initialization failed: ${error.message || error}`, true);
});
