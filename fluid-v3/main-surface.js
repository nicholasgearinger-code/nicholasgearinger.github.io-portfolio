import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { MLSMPMPoolSolver } from "./MLSMPMSolverPool.js";
import { FluidScreenSpaceRenderer } from "./FluidScreenSpaceRenderer.js";

const $ = (s) => document.querySelector(s);
const canvas = $('#fluid-v3-canvas');
const fpsEl = $('#fps');
const stateEl = $('#state');
const qualityEl = $('#quality');
const statusEl = $('#status');

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const requested = new URL(location.href).searchParams.get('quality');
const QUALITY = {
  low: {
    particles: 6144, max: 8192, grid: 32, dpr: 0.82, substeps: 1,
    surfaceScale: 0.46, splatRadius: 0.265,
  },
  medium: {
    particles: 12288, max: 16384, grid: 40, dpr: 0.90, substeps: 1,
    surfaceScale: 0.54, splatRadius: 0.235,
  },
  high: {
    particles: 16384, max: 16384, grid: 44, dpr: 1.05, substeps: 2,
    surfaceScale: 0.68, splatRadius: 0.205,
  },
};
const qualityName = requested && QUALITY[requested] ? requested : (isTouch ? 'medium' : 'high');
const quality = QUALITY[qualityName];

const domainSize = new THREE.Vector3(10, 10, 10);
let renderer, scene, camera, controls, solver, fluidSurface;
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

function createPoolEnvironment() {
  const group = new THREE.Group();
  group.name = 'V3.2 Screen Space Pool';

  // Pool floor: tile-scale roughness/color contrast makes refraction and moving
  // silhouettes much easier to read than the old flat white receiver.
  const floorMat = new THREE.MeshPhysicalMaterial({
    color: 0x4e9db3,
    roughness: 0.38,
    metalness: 0,
    clearcoat: 0.18,
    clearcoatRoughness: 0.25,
  });
  const floor = new THREE.Mesh(
    new THREE.BoxGeometry(domainSize.x + 0.9, 0.30, domainSize.z + 0.9),
    floorMat,
  );
  floor.position.y = -domainSize.y * 0.5 - 0.15;
  floor.receiveShadow = true;
  group.add(floor);

  // A shallow inset gives the eye a stable reference for water thickness.
  const insetMat = new THREE.MeshStandardMaterial({
    color: 0x2f778f,
    roughness: 0.44,
    metalness: 0,
  });
  const inset = new THREE.Mesh(
    new THREE.BoxGeometry(domainSize.x * 0.93, 0.025, domainSize.z * 0.93),
    insetMat,
  );
  inset.position.y = -domainSize.y * 0.5 + 0.012;
  inset.receiveShadow = true;
  group.add(inset);

  // Glass walls are kept depth-write-free so the screen-space water can be
  // composited correctly in front of or behind their transparent color.
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0xbfefff,
    roughness: 0.055,
    metalness: 0,
    transmission: 0.86,
    ior: 1.46,
    thickness: 0.065,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wallT = 0.08;
  const wallH = domainSize.y;
  for (const x of [-domainSize.x / 2, domainSize.x / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(wallT, wallH, domainSize.z), glass);
    wall.position.set(x, 0, 0);
    wall.renderOrder = 4;
    group.add(wall);
  }
  for (const z of [-domainSize.z / 2, domainSize.z / 2]) {
    const wall = new THREE.Mesh(new THREE.BoxGeometry(domainSize.x, wallH, wallT), glass);
    wall.position.set(0, 0, z);
    wall.renderOrder = 4;
    group.add(wall);
  }

  const railMat = new THREE.MeshStandardMaterial({ color: 0x173b48, roughness: 0.31, metalness: 0.18 });
  const railY = -domainSize.y * 0.5 + 0.06;
  for (const x of [-domainSize.x / 2, domainSize.x / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.18, domainSize.z), railMat);
    rail.position.set(x, railY, 0);
    group.add(rail);
  }
  for (const z of [-domainSize.z / 2, domainSize.z / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(domainSize.x, 0.18, 0.11), railMat);
    rail.position.set(0, railY, z);
    group.add(rail);
  }

  return group;
}

async function init() {
  if (!navigator.gpu || WebGPU.isAvailable() === false) {
    setStatus('WebGPU is required for Fluid V3.2.', true);
    return;
  }

  setStatus('Compiling MLS-MPM + screen-space water reconstruction…');
  renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    alpha: false,
    requiredLimits: { maxStorageBuffersInVertexStage: 1 },
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  await renderer.init();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x79bfd8);
  scene.fog = new THREE.FogExp2(0xa7d7e5, 0.016);

  camera = new THREE.PerspectiveCamera(47, innerWidth / innerHeight, 0.05, 100);
  camera.position.set(11.6, 3.8, 12.8);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -2.55, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 6.5;
  controls.maxDistance = 27;

  scene.add(new THREE.HemisphereLight(0xe8fbff, 0x183947, 1.55));
  const sun = new THREE.DirectionalLight(0xfff0cf, 4.4);
  sun.position.set(-8, 14, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(isTouch ? 384 : 768, isTouch ? 384 : 768);
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

  scene.add(createPoolEnvironment());

  collider.mesh = new THREE.Mesh(
    new THREE.SphereGeometry(collider.radius, 30, 18),
    new THREE.MeshPhysicalMaterial({
      color: 0xffad57,
      roughness: 0.16,
      metalness: 0.03,
      clearcoat: 0.78,
      clearcoatRoughness: 0.07,
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
    thicknessPerParticle: qualityName === 'low' ? 0.050 : 0.040,
  });

  setupInput();
  setupUI();
  updateHUD();
  renderer.setAnimationLoop(animate);
  addEventListener('resize', onResize);
  setStatus('LIVE — MLS-MPM physics + continuous screen-space fluid surface. Drag through it or throw the sphere.');
  globalThis.__fluidV32 = { renderer, scene, solver, fluidSurface, collider };
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
  stateEl.textContent = paused ? 'PAUSED' : 'SURFACED 3D';
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
