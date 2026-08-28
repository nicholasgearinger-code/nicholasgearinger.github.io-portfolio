import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { FluidSolver } from "./FluidSolver.js";
import { FluidSurface, createPoolEnvironment } from "./FluidSurface.js";
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
  low: { grid: 96, pressure: 6, dpr: 1.0, droplets: 56 },
  medium: { grid: 128, pressure: 10, dpr: 1.25, droplets: 96 },
  high: { grid: 192, pressure: 16, dpr: 1.5, droplets: 144 },
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
  renderer.toneMappingExposure = 1.08;
  await renderer.init();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x79b8d6);
  scene.fog = new THREE.FogExp2(0x8fc4d9, 0.012);

  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.08, 180);
  camera.position.set(18, 16, 22);

  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.2, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.065;
  controls.minDistance = 8;
  controls.maxDistance = 58;
  controls.maxPolarAngle = Math.PI * 0.49;

  const hemi = new THREE.HemisphereLight(0xdff4ff, 0x314151, 1.8);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2cf, 4.4);
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
    gravity: 10.5,
    meanDepth: 0.72,
    vorticity: baseVorticity,
    projection: 0.82,
  });
  await solver.initialize();

  surface = new FluidSurface(solver);
  scene.add(surface.mesh);
  scene.add(createPoolEnvironment(solver.worldSize));

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

  solver.queueSplat({ x: 0, z: 0, strength: 1.25, radius: 2.1 });
  solver.queueSplat({ x: -5, z: 3, vx: 2.4, vz: -0.8, strength: 0.6, radius: 1.5 });

  updateHUD();
  setStatus("Running — drag the water or drop rigid bodies into it.");

  globalThis.__fluidLab = { renderer, scene, solver, surface, particles, physics };
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
    solver.queueSplat({ x: p.x, z: p.z, strength: 0.75, radius: 1.15 });
    particles.emit(p.x, p.z, 0.45);
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

    solver.queueSplat({
      x: p.x,
      z: p.z,
      vx,
      vz,
      strength: 0.28 + Math.min(0.42, Math.hypot(vx, vz) * 0.022),
      radius: 0.92,
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
    solver.queueSplat({ x, z, vx: THREE.MathUtils.randFloat(-4, 4), vz: THREE.MathUtils.randFloat(-4, 4), strength: 1.3, radius: 2.0 });
    particles.emit(x, z, 1.1);
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
