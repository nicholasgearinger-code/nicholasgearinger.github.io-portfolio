import * as THREE from "three/webgpu";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import WebGPU from "three/addons/capabilities/WebGPU.js";
import { MLSMPMSolver } from "./MLSMPMSolver.js";
import { FluidParticleRenderer, createV3Tank } from "./FluidParticleRenderer.js";

const $ = (s) => document.querySelector(s);
const canvas = $('#fluid-v3-canvas');
const fpsEl = $('#fps');
const stateEl = $('#state');
const qualityEl = $('#quality');
const statusEl = $('#status');

const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
const requested = new URL(location.href).searchParams.get('quality');
const QUALITY = {
  low: { particles: 4096, max: 8192, grid: 32, dpr: 0.9, substeps: 1 },
  medium: { particles: 8192, max: 12288, grid: 40, dpr: 1.0, substeps: 1 },
  high: { particles: 16384, max: 16384, grid: 48, dpr: 1.25, substeps: 2 },
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

// One real 3D collider used to demonstrate water wrapping around a moving body.
const collider = {
  mesh: null,
  position: new THREE.Vector3(0.8, 6.5, 0),
  velocity: new THREE.Vector3(0, 0, 0),
  radius: 0.82,
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

async function init() {
  if (!navigator.gpu || WebGPU.isAvailable() === false) {
    setStatus('WebGPU is required for Fluid V3.', true);
    return;
  }

  setStatus('Compiling 3D MLS-MPM compute kernels…');
  renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: !isTouch,
    alpha: false,
    requiredLimits: { maxStorageBuffersInVertexStage: 1 },
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, quality.dpr));
  renderer.setSize(innerWidth, innerHeight, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  await renderer.init();

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8bc8de);
  scene.fog = new THREE.FogExp2(0xa8d4e2, 0.022);

  camera = new THREE.PerspectiveCamera(48, innerWidth / innerHeight, 0.05, 100);
  camera.position.set(13.5, 9.0, 14.5);
  controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.8, 0);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 8;
  controls.maxDistance = 34;

  const hemi = new THREE.HemisphereLight(0xe9faff, 0x344754, 2.0);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff0d0, 5.5);
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

  solver = new MLSMPMSolver(renderer, {
    particleCount: quality.particles,
    maxParticles: quality.max,
    gridResolution: quality.grid,
    dt: qualityName === 'high' ? 1 / 120 : 1 / 90,
    stiffness: 50,
    restDensity: 1.55,
    viscosity: 0.11,
  });
  await solver.compile();

  const fluidRenderer = new FluidParticleRenderer(solver, {
    domainSize,
    particleRadius: qualityName === 'low' ? 0.135 : (qualityName === 'medium' ? 0.112 : 0.088),
  });
  waterMesh = fluidRenderer.mesh;
  scene.add(waterMesh);
  scene.add(createV3Tank(domainSize));

  collider.mesh = new THREE.Mesh(
    new THREE.SphereGeometry(collider.radius, 32, 20),
    new THREE.MeshPhysicalMaterial({
      color: 0xffad57,
      roughness: 0.18,
      metalness: 0.05,
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
  setStatus('LIVE — true 3D particle/grid fluid. Drag through the water or drop the sphere.');
  globalThis.__fluidV3 = { renderer, scene, solver, waterMesh, collider };
}

function resetCollider() {
  collider.position.set(0.7, 6.6, 0.2);
  collider.velocity.set(-0.25, -0.2, 0.1);
  collider.active = true;
  collider.mesh?.position.copy(collider.position);
}

function updateCollider(dt) {
  if (!collider.active) return;
  collider.velocity.y -= 9.81 * dt;
  collider.position.addScaledVector(collider.velocity, dt);

  // Tank collision for the demonstration body. The water itself is solved in
  // MLS-MPM; this sphere is only an external moving solid boundary.
  const floor = -domainSize.y * 0.5 + collider.radius + 0.12;
  if (collider.position.y < floor) {
    collider.position.y = floor;
    collider.velocity.y = Math.abs(collider.velocity.y) * 0.32;
    collider.velocity.x *= 0.86;
    collider.velocity.z *= 0.86;
  }
  const xLim = domainSize.x * 0.5 - collider.radius - 0.2;
  const zLim = domainSize.z * 0.5 - collider.radius - 0.2;
  if (Math.abs(collider.position.x) > xLim) {
    collider.position.x = THREE.MathUtils.clamp(collider.position.x, -xLim, xLim);
    collider.velocity.x *= -0.55;
  }
  if (Math.abs(collider.position.z) > zLim) {
    collider.position.z = THREE.MathUtils.clamp(collider.position.z, -zLim, zLim);
    collider.velocity.z *= -0.55;
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
    const simOrigin = worldToSim(raycaster.ray.origin);
    solver.setPointerRay(simOrigin, raycaster.ray.direction, new THREE.Vector3(0, 0.025, 0));
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
    const forceWorld = cameraRight.multiplyScalar(dx * 0.035).add(cameraUp.multiplyScalar(-dy * 0.035));
    const forceSim = forceWorld.divide(domainSize);
    const simOrigin = worldToSim(raycaster.ray.origin);
    solver.setPointerRay(simOrigin, raycaster.ray.direction, forceSim);
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
    collider.position.set(-3.8, 0.5, 0);
    collider.velocity.set(9.5, 1.6, THREE.MathUtils.randFloat(-1.5, 1.5));
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
  const dt = Math.min(1 / 30, 1 / 60);
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
