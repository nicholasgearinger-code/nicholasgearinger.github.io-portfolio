import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { MLSMPMPoolSolver } from "./MLSMPMSolverPool.js";
import { FluidParticleRenderer } from "./FluidParticleRenderer.js";

const $ = (s) => document.querySelector(s);
const canvas = $('#fluid-v3-canvas');
const fpsEl = $('#fps');
const stateEl = $('#state');
const qualityEl = $('#quality');
const statusEl = $('#status');

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const requested = new URL(location.href).searchParams.get('quality');
const QUALITY = {
  low: { particles: 6144, max: 8192, grid: 32, dpr: 0.85, substeps: 1, radius: 0.18 },
  medium: { particles: 12288, max: 16384, grid: 40, dpr: 0.95, substeps: 1, radius: 0.145 },
  high: { particles: 16384, max: 16384, grid: 44, dpr: 1.15, substeps: 2, radius: 0.125 },
};
const qualityName = requested && QUALITY[requested] ? requested : (isTouch ? 'medium' : 'high');
const quality = QUALITY[qualityName];

const domainSize = new THREE.Vector3(10, 10, 10);
let renderer, scene, camera, controls, solver, waterMesh;
let paused = false;
let frameCount = 0;
let fpsStart = performance.now();
let lastPointer = null;
let pointerDown = false;

const collider = {
  mesh: null,
  position: new THREE.Vector3(0.8, 4.2, 0),
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

function createGlassTank() {
  const group = new THREE.Group();
  group.name = 'V3.1 Glass Fluid Tank';

  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xbcae8c,
    roughness: 0.58,
    metalness: 0,
  });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(domainSize.x + 0.9, 0.28, domainSize.z + 0.9),
    floorMat,
  );
  floor.position.y = -domainSize.y * 0.5 - 0.14;
  floor.receiveShadow = true;
  group.add(floor);

  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xc8f5ff,
    roughness: 0.09,
    metalness: 0,
    transmission: 0.72,
    ior: 1.46,
    thickness: 0.08,
    transparent: true,
    opacity: 0.20,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wallT = 0.10;
  const wallH = domainSize.y;
  for (const x of [-domainSize.x / 2, domainSize.x / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, domainSize.z), glass);
    wall.position.set(x, 0, 0);
    wall.renderOrder = 5;
    group.add(wall);
  }
  for (const z of [-domainSize.z / 2, domainSize.z / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(domainSize.x, wallH, wallT), glass);
    wall.position.set(0, 0, z);
    wall.renderOrder = 5;
    group.add(wall);
  }

  // Dark rails make the tank bounds readable without turning the whole scene
  // into an opaque box.
  const railMat = new THREE.MeshStandardMaterial({ color: 0x29454f, roughness: 0.35, metalness: 0.18 });
  const railY = -domainSize.y * 0.5 + 0.05;
  for (const x of [-domainSize.x / 2, domainSize.x / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, domainSize.z), railMat);
    rail.position.set(x, railY, 0);
    group.add(rail);
  }
  for (const z of [-domainSize.z / 2, domainSize.z / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(domainSize.x, 0.16, 0.12), railMat);
    rail.position.set(0, railY, z);
    group.add(rail);
  }

  return group;
}

async function init() {
  if (!navigator.gpu || WebGPU.isAvailable() === false) {
    setStatus('WebGPU is required for Fluid V3.1.', true);
    return;
  }

  setStatus('Compiling volumetric MLS-MPM pool…');
  renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: !isTouch,
    alpha: false,
    requiredLimits: { maxStorageBuffersInVertexStage: 1 },
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  await renderer.init();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7dc0d9);
  scene.fog = new THREE.FogExp2(0xa8d4e2, 0.018);

  camera = new THREE.PerspectiveCamera(47, innerWidth / innerHeight, 0.05, 100);
  camera.position.set(12.2, 4.4, 13.0);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -2.35, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 7;
  controls.maxDistance = 30;

  scene.add(new THREE.HemisphereLight(0xeafcff, 0x263d47, 1.75));
  const sun = new THREE.DirectionalLight(0xfff0d0, 5.0);
  sun.position.set(-8, 14, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 512 : 1024, isTouch ? 512 : 1024);
  sun.shadow.camera.left = -8;
  sun.shadow.camera.right = 8;
  sun.shadow.camera.top = 8;
  sun.shadow.camera.bottom = -8;
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 40;
  scene.add(sun);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
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

  const fluidRenderer = new FluidParticleRenderer(solver, {
    domainSize,
    particleRadius: quality.radius,
  });
  waterMesh = fluidRenderer.mesh;
  scene.add(waterMesh);
  scene.add(createGlassTank());

  collider.mesh = new THREE.Mesh(
    new THREE.SphereGeometry(collider.radius, 30, 18),
    new THREE.MeshPhysicalMaterial({
      color: 0xffad57,
      roughness: 0.17,
      metalness: 0.04,
      clearcoat: 0.7,
      clearcoatRoughness: 0.08,
    }),
  );
  collider.mesh.castShadow = true;
  scene.add(collider.mesh);
  resetCollider();

  setupInput();
  setupUI();
  updateHUD();
  renderer.setAnimationLoop(animate);
  addEventListener('resize', onResize);
  setStatus('LIVE — wide 3D MLS-MPM pool. Drop/throw the sphere or drag through the volume.');
  globalThis.__fluidV31 = { renderer, scene, solver, waterMesh, collider };
}

function resetCollider() {
  collider.position.set(0.8, 4.1, 0.2);
  collider.velocity.set(-0.15, -0.1, 0.05);
  collider.active = true;
  collider.mesh?.position.copy(collider.position);
}

function updateCollider(dt) {
  if (!collider.active) return;
  collider.velocity.y -= 9.81 * dt;
  collider.position.addScaledVector(collider.velocity, dt);

  const floor = -domainSize.y * 0.5 + collider.radius + 0.10;
  if (collider.position.y < floor) {
    collider.position.y = floor;
    collider.velocity.y = Math.abs(collider.velocity.y) * 0.28;
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
    ndc.set(
      ((event.clientX - r.left) / r.width) * 2 - 1,
      -((event.clientY - r.top) / r.height) * 2 + 1,
    );
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
    const forceSim = forceWorld.divide(domainSize);
    solver.setPointerRay(worldToSim(raycaster.ray.origin), raycaster.ray.direction, forceSim);
    lastPointer = { x: event.clientX, y: event.clientY, t: now };
  });

  const end = () => {
    pointerDown = false;
    lastPointer = null;
    solver?.clearPointerForce();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', end);
}

function setupUI() {
  $('#drop').addEventListener('click', resetCollider);
  $('#kick').addEventListener('click', () => {
    collider.position.set(-4.0, -1.75, 0);
    collider.velocity.set(9.0, 1.15, THREE.MathUtils.randFloat(-1.2, 1.2));
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
  stateEl.textContent = paused ? 'PAUSED' : 'LIVE 3D';
  qualityEl.textContent = `${qualityName.toUpperCase()} · ${quality.particles.toLocaleString()} particles · ${quality.grid}³ grid`;
}

function animate() {
  controls.update();
  const dt = 1 / 60;
  if (!paused) {
    updateCollider(dt);
    solver.step(quality.substeps);
  }
  renderer.render(scene, camera);

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
