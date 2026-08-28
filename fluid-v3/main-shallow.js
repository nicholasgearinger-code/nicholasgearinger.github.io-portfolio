import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { MLSMPMPoolSolver } from "./MLSMPMSolverPool.js";
import { FluidScreenSpaceRenderer } from "./FluidScreenSpaceRendererPool.js";

const $ = (s) => document.querySelector(s);
const canvas = $('#fluid-v3-canvas');
const fpsEl = $('#fps');
const stateEl = $('#state');
const qualityEl = $('#quality');
const statusEl = $('#status');

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const requested = new URL(location.href).searchParams.get('quality');
const QUALITY = {
  low:    { particles: 8192,  max: 12288, grid: 36, dpr: 0.84, substeps: 1, surfaceScale: 0.66, splatRadius: 0.40 },
  medium: { particles: 12288, max: 16384, grid: 40, dpr: 0.92, substeps: 1, surfaceScale: 0.72, splatRadius: 0.39 },
  high:   { particles: 16384, max: 16384, grid: 44, dpr: 1.05, substeps: 2, surfaceScale: 0.82, splatRadius: 0.37 },
};
const qualityName = requested && QUALITY[requested] ? requested : (isTouch ? 'medium' : 'high');
const quality = QUALITY[qualityName];

// Keep the solver isotropic in its proven 10³ world mapping. Only the visible
// basin walls are shortened so the presentation no longer looks like a huge
// mostly-empty aquarium.
const domainSize = new THREE.Vector3(10, 10, 10);
const floorY = -domainSize.y * 0.5;
const restWaterY = -2.0;
const visibleWallHeight = 3.65;
let renderer, scene, camera, controls, solver, fluidSurface;
let paused = false;
let frameCount = 0;
let fpsStart = performance.now();
let lastPointer = null;
let pointerDown = false;

const collider = {
  mesh: null,
  position: new THREE.Vector3(0.6, 1.7, 0),
  velocity: new THREE.Vector3(),
  radius: 0.72,
  active: true,
};

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function setStatus(text, error = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', error);
}

function worldToSim(v, out = new THREE.Vector3()) {
  return out.set(
    v.x / domainSize.x + 0.5,
    v.y / domainSize.y + 0.5,
    v.z / domainSize.z + 0.5,
  );
}

function createTileTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  const colors = ['#2f879f', '#397f98', '#2b718b', '#438fa3'];
  const n = 12;
  const s = c.width / n;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      ctx.fillStyle = colors[(x + y * 3) % colors.length];
      ctx.fillRect(x * s, y * s, s - 1.4, s - 1.4);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.4, 2.4);
  return tex;
}

function createPoolEnvironment() {
  const group = new THREE.Group();
  group.name = 'V3.3 Shallow Pool';

  const tileTex = createTileTexture();
  const floorMat = new THREE.MeshPhysicalMaterial({
    map: tileTex,
    color: 0xffffff,
    roughness: 0.34,
    metalness: 0,
    clearcoat: 0.20,
    clearcoatRoughness: 0.22,
  });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(domainSize.x + 0.9, 0.30, domainSize.z + 0.9),
    floorMat,
  );
  floor.position.y = floorY - 0.15;
  floor.receiveShadow = true;
  group.add(floor);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x9edcea,
    roughness: 0.035,
    metalness: 0,
    transmission: 0.92,
    ior: 1.46,
    thickness: 0.055,
    transparent: true,
    opacity: 0.10,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wallT = 0.075;
  const wallCenterY = floorY + visibleWallHeight * 0.5;
  for (const x of [-domainSize.x / 2, domainSize.x / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wallT, visibleWallHeight, domainSize.z), glass);
    wall.position.set(x, wallCenterY, 0);
    wall.renderOrder = 4;
    group.add(wall);
  }
  for (const z of [-domainSize.z / 2, domainSize.z / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(domainSize.x, visibleWallHeight, wallT), glass);
    wall.position.set(0, wallCenterY, z);
    wall.renderOrder = 4;
    group.add(wall);
  }

  const copingMat = new THREE.MeshStandardMaterial({ color: 0xe7f1ef, roughness: 0.28, metalness: 0.03 });
  const topY = floorY + visibleWallHeight;
  for (const x of [-domainSize.x / 2, domainSize.x / 2]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, domainSize.z + 0.25), copingMat);
    edge.position.set(x, topY, 0);
    group.add(edge);
  }
  for (const z of [-domainSize.z / 2, domainSize.z / 2]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(domainSize.x + 0.25, 0.12, 0.18), copingMat);
    edge.position.set(0, topY, z);
    group.add(edge);
  }

  return group;
}

async function init() {
  if (!navigator.gpu || WebGPU.isAvailable() === false) {
    setStatus('WebGPU is required for Fluid V3.3.', true);
    return;
  }

  setStatus('Compiling MLS-MPM + dense continuous water surface…');
  renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    alpha: false,
    requiredLimits: { maxStorageBuffersInVertexStage: 1 },
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  await renderer.init();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x89c8da);
  scene.fog = new THREE.FogExp2(0xa8d8e3, 0.011);

  camera = new THREE.PerspectiveCamera(44, innerWidth / innerHeight, 0.05, 100);
  camera.position.set(10.2, 0.5, 11.1);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, restWaterY - 0.15, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 6.2;
  controls.maxDistance = 23;

  scene.add(new THREE.HemisphereLight(0xeaffff, 0x17394a, 1.35));
  const sun = new THREE.DirectionalLight(0xfff1d5, 4.8);
  sun.position.set(-7, 12, -5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 384 : 768, isTouch ? 384 : 768);
  sun.shadow.camera.left = -7;
  sun.shadow.camera.right = 7;
  sun.shadow.camera.top = 7;
  sun.shadow.camera.bottom = -7;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 35;
  scene.add(sun);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  solver = new MLSMPMPoolSolver(renderer, {
    particleCount: quality.particles,
    maxParticles: quality.max,
    gridResolution: quality.grid,
    dt: qualityName === 'high' ? 1 / 120 : 1 / 90,
    stiffness: 44,
    restDensity: 1.28,
    viscosity: 0.13,
  });
  await solver.compile();
  scene.add(createPoolEnvironment());

  collider.mesh = new THREE.Mesh(
    new THREE.SphereGeometry(collider.radius, 30, 18),
    new THREE.MeshPhysicalMaterial({
      color: 0xffad57,
      roughness: 0.13,
      metalness: 0.02,
      clearcoat: 0.82,
      clearcoatRoughness: 0.06,
    }),
  );
  collider.mesh.castShadow = true;
  collider.mesh.receiveShadow = true;
  scene.add(collider.mesh);
  resetCollider();

  fluidSurface = new FluidScreenSpaceRenderer(renderer, solver, camera, {
    domainSize,
    surfaceScale: quality.surfaceScale,
    splatRadius: quality.splatRadius,
  });

  setupInput();
  setupUI();
  updateHUD();
  addEventListener('resize', onResize);
  renderer.setAnimationLoop(animate);
  setStatus('LIVE — shallow basin presentation with true MLS-MPM volume underneath.');
  globalThis.__fluidV33 = { renderer, scene, solver, fluidSurface, collider };
}

function resetCollider() {
  collider.position.set(0.8, 1.8, 0.2);
  collider.velocity.set(-0.12, -0.15, 0.04);
  collider.active = true;
  collider.mesh?.position.copy(collider.position);
}

function updateCollider(dt) {
  if (!collider.active) return;
  collider.velocity.y -= 9.81 * dt;
  collider.position.addScaledVector(collider.velocity, dt);
  const floor = floorY + collider.radius + 0.10;
  if (collider.position.y < floor) {
    collider.position.y = floor;
    collider.velocity.y = Math.abs(collider.velocity.y) * 0.25;
    collider.velocity.x *= 0.86;
    collider.velocity.z *= 0.86;
  }
  const xLim = domainSize.x * 0.5 - collider.radius - 0.18;
  const zLim = domainSize.z * 0.5 - collider.radius - 0.18;
  if (Math.abs(collider.position.x) > xLim) {
    collider.position.x = THREE.MathUtils.clamp(collider.position.x, -xLim, xLim);
    collider.velocity.x *= -0.52;
  }
  if (Math.abs(collider.position.z) > zLim) {
    collider.position.z = THREE.MathUtils.clamp(collider.position.z, -zLim, zLim);
    collider.velocity.z *= -0.52;
  }
  collider.mesh.position.copy(collider.position);
  const simCenter = worldToSim(collider.position);
  const simVelocity = new THREE.Vector3(
    collider.velocity.x / domainSize.x * quality.grid,
    collider.velocity.y / domainSize.y * quality.grid,
    collider.velocity.z / domainSize.z * quality.grid,
  );
  solver.setCollider(simCenter, collider.radius / domainSize.x, simVelocity, true);
}

function setupInput() {
  const updateRay = (event) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((event.clientX - r.left) / r.width) * 2 - 1, -((event.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
  };
  canvas.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    pointerDown = true;
    lastPointer = { x: event.clientX, y: event.clientY, t: performance.now() };
    updateRay(event);
    solver.setPointerRay(worldToSim(raycaster.ray.origin), raycaster.ray.direction, new THREE.Vector3(0, 0.028, 0));
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!pointerDown) return;
    updateRay(event);
    const now = performance.now();
    const dt = Math.max(0.012, (now - (lastPointer?.t || now)) / 1000);
    const dx = THREE.MathUtils.clamp((event.clientX - (lastPointer?.x || event.clientX)) / Math.max(innerWidth, 1), -0.08, 0.08) / dt;
    const dy = THREE.MathUtils.clamp((event.clientY - (lastPointer?.y || event.clientY)) / Math.max(innerHeight, 1), -0.08, 0.08) / dt;
    const cameraRight = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
    const cameraUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    const forceWorld = cameraRight.multiplyScalar(dx * 0.042).add(cameraUp.multiplyScalar(-dy * 0.042));
    solver.setPointerRay(worldToSim(raycaster.ray.origin), raycaster.ray.direction, forceWorld.divide(domainSize));
    lastPointer = { x: event.clientX, y: event.clientY, t: now };
  });
  const end = () => { pointerDown = false; lastPointer = null; solver?.clearPointerForce(); };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
}

function setupUI() {
  $('#drop').addEventListener('click', resetCollider);
  $('#kick').addEventListener('click', () => {
    collider.position.set(-4.0, restWaterY + 0.25, 0);
    collider.velocity.set(9.0, 0.85, THREE.MathUtils.randFloat(-1.1, 1.1));
    collider.active = true;
  });
  $('#pause').addEventListener('click', (e) => {
    paused = !paused;
    e.currentTarget.textContent = paused ? 'Resume' : 'Pause';
    updateHUD();
  });
  $('#reset').addEventListener('click', () => location.reload());
}

function updateHUD() {
  stateEl.textContent = paused ? 'PAUSED' : 'SHALLOW 3D';
  qualityEl.textContent = `${qualityName.toUpperCase()} · ${quality.particles.toLocaleString()} particles · ${quality.grid}³ · ${Math.round(quality.surfaceScale * 100)}% surface`;
}

function animate() {
  controls.update();
  const dt = 1 / 60;
  if (!paused) {
    updateCollider(dt);
    solver.step(quality.substeps);
  }
  fluidSurface.render(scene, camera);
  frameCount++;
  const now = performance.now();
  if (now - fpsStart > 800) {
    fpsEl.textContent = `${Math.round(frameCount * 1000 / (now - fpsStart))} FPS`;
    frameCount = 0;
    fpsStart = now;
  }
}

function onResize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  fluidSurface?.resize();
}

addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  setStatus(`Runtime error: ${event.reason?.message || event.reason}`, true);
});
addEventListener('error', (event) => {
  console.error(event.error || event.message);
  setStatus(`Runtime error: ${event.error?.message || event.message}`, true);
});

init().catch((error) => {
  console.error(error);
  setStatus(`Initialization failed: ${error.message || error}`, true);
});
