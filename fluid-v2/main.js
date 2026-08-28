import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { FluidSolver } from "./FluidSolver.js";
import { FluidSurface, createPoolEnvironment } from "./FluidSurface.js";
import { FluidCaustics } from "./FluidCaustics.js";
import { FluidParticles } from "./FluidParticles.js";
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
  low: { grid: 96, pressure: 6, dpr: 1.0, droplets: 56, caustics: 44 },
  medium: { grid: 128, pressure: 10, dpr: 1.25, droplets: 96, caustics: 56 },
  high: { grid: 192, pressure: 16, dpr: 1.5, droplets: 144, caustics: 80 },
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

  setStatus("Initializing WebGPU fluid solver…");

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

  caustics = new FluidCaustics(solver, surface.time, { resolution: quality.caustics });
  scene.add(caustics.mesh);

  particles = new FluidParticles(scene, solver, { count: quality.droplets });
  setStatus("Loading Rapier physics…");
  physics = await FluidPhysics.create(scene, solver, particles);
  physics.spawnBall(-4, -2);
  physics.spawnCube(4, 2);

  setupPointerInput();
  setupUI();

  timer = new THREE.Timer();
  timer.connect(document);
  renderer.setAnimationLoop(animate);
  addEventListener("resize", onResize);

  // Seed broad waves plus directional flow so the pool begins alive rather than
  // as a perfectly flat sheet while keeping all later disturbances physical.
  solver.queueSplat({ x: 0, z: 0, strength: -1.2, radius: 2.2 });
  solver.queueSplat({ x: -5, z: 3, vx: 3.0, vz: -1.1, strength: -0.62, radius: 1.55 });

  updateHUD();
  setStatus("Running — live caustics, capillary ripples and impact spray enabled.");

  globalThis.__fluidLab = { renderer, scene, solver, surface, caustics, particles, physics };
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
    solver.queueSplat({ x: p.x, z: p.z, strength: -0.62, radius: 1.15 });
    particles.emit(p.x, p.z, 0.5);
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

    const dragStrength = 0.22 + Math.min(0.42, Math.hypot(vx, vz) * 0.022);
    solver.queueSplat({
      x: p.x,
      z: p.z,
      vx,
      vz,
      strength: -dragStrength,
      radius: 0.88,
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
    const x = THREE.MathUtils.randFloat(-5, 5);
    const z = THREE.MathUtils.randFloat(-5, 5);
    physics.spawnBall(x, z);
  });
  $("#drop-cube").addEventListener("click", () => {
    const x = THREE.MathUtils.randFloat(-5, 5);
    const z = THREE.MathUtils.randFloat(-5, 5);
    physics.spawnCube(x, z);
  });
  $("#splash").addEventListener("click", () => {
    const x = THREE.MathUtils.randFloat(-7, 7);
    const z = THREE.MathUtils.randFloat(-7, 7);
    solver.queueSplat({
      x,
      z,
      vx: THREE.MathUtils.randFloat(-4, 4),
      vz: THREE.MathUtils.randFloat(-4, 4),
      strength: -1.45,
      radius: 2.0,
    });
    particles.emit(x, z, 1.3);
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
