// Local 3D fluid solver for active surf-break spray, inspired by Rift's
// Fluid Simulation Lab. Particles have true 3D positions/velocities and
// pressure/separation + XSPH viscosity against spatially indexed neighbors.
// This is a bounded local breaking-water volume, NOT an ocean-scale SPH solver.
// No THREE / renderer dependency, allowing deterministic low-FPS tests.
const G = 9.81;
const H = 0.45;
const H2 = H * H;
const MIN_SEPARATION = 0.22;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Spatial hash with linked lists: avoids an O(N²) scan across the entire pool.
function hash(ix, iy, iz) {
  return (Math.imul(ix, 73856093) ^ Math.imul(iy, 19349663) ^
    Math.imul(iz, 83492791)) | 0;
}

export function createSurfParticlePool(maxParticles = 160, settings = {}) {
  const count = Math.max(16, Math.min(1200, Math.floor(maxParticles)));
  return {
    supportRadius: clamp(Number(settings.supportRadius) || H, 0.40, 1.35),
    restSpacing: clamp(Number(settings.restSpacing) || MIN_SEPARATION, 0.18, 0.82),
    particles: Array.from({ length: count }, () => ({
      x: 0, y: -1000, z: 0, px: 0, py: 0, pz: 0,
      vx: 0, vy: 0, vz: 0, life: 0, radius: 0.09,
    })),
    heads: new Map(),
    next: new Int16Array(count),
    indexes: new Int16Array(count),
    cursor: 0, emitted: 0, visible: 0,
  };
}

/** Initialize a SOLID three-dimensional crest of moving water particles.
 * Unlike the scattered spray emitter, this fills a volume. The particle
 * solver then determines its deformation and collapse; no crest animation
 * overrides particle positions after emission.
 */
export function seedSurfWaveBody(pool, x, z, {
  seaY = 8, shoreX = 0, shoreZ = -1,
  height = 3.4, width = 8.8, thickness = 2.4,
  columns = 12, levels = 5, layers = 4,
} = {}) {
  if (!pool || ![x, z, seaY, shoreX, shoreZ].every(Number.isFinite)) return 0;
  const n = Math.hypot(shoreX, shoreZ) || 1;
  const nx = shoreX / n, nz = shoreZ / n;
  const tx = -nz, tz = nx;
  const count = Math.min(pool.particles.length, columns * levels * layers);
  let emitted = 0;
  for (let i = 0; i < count; i++) {
    const ix = i % columns;
    const iy = Math.floor(i / columns) % levels;
    const iz = Math.floor(i / (columns * levels));
    const across = (ix / Math.max(1, columns - 1) - 0.5) * width;
    const vertical = iy / Math.max(1, levels - 1);
    const depth = (iz / Math.max(1, layers - 1) - 0.5) * thickness;
    // A curved, rounded initial slug of incompressible moving water.
    const taper = 0.84 + 0.16 * Math.cos(across / width * Math.PI);
    const leading = depth + vertical * vertical * 0.68;
    const p = pool.particles[i];
    p.x = x + tx * across + nx * leading;
    p.z = z + tz * across + nz * leading;
    p.y = seaY + 0.26 + vertical * height * taper;
    const crestSpeed = 1.8 + vertical * 3.0;
    p.vx = nx * crestSpeed + tx * Math.sin(across * 0.48) * 0.16;
    p.vz = nz * crestSpeed + tz * Math.sin(across * 0.48) * 0.16;
    p.vy = 0.70 - vertical * 1.5;
    p.life = 2.25;
    p.radius = 0.27;
    p.px = p.x; p.py = p.y; p.pz = p.z;
    emitted++;
  }
  for (let i = emitted; i < pool.particles.length; i++) {
    pool.particles[i].life = 0;
  }
  pool.visible = emitted;
  pool.cursor = emitted % pool.particles.length;
  pool.emitted += emitted;
  return emitted;
}

/**
 * Replenish the top of the active water mass from the incoming swell.
 * This is a boundary inflow, not resetting particle positions each frame:
 * only particles already absorbed by the sea can be recycled. It allows
 * a rolling crest to remain a fluid volume as the first water falls away.
 */
export function injectSurfWaveBody(pool, x, z, {
  seaY = 8, shoreX = 0, shoreZ = -1,
  height = 3.2, width = 8.5, count = 14,
} = {}) {
  if (!pool || ![x,z,seaY,shoreX,shoreZ].every(Number.isFinite)) return 0;
  const norm = Math.hypot(shoreX,shoreZ)||1;
  const nx=shoreX/norm,nz=shoreZ/norm,tx=-nz,tz=nx;
  let injected=0;
  for(let i=0;i<Math.max(0,Math.min(count,24));i++){
    let p=null;
    for(let j=0;j<pool.particles.length;j++){
      const target=pool.particles[pool.cursor++%pool.particles.length];
      if(target.life<=0){p=target;break;}
    }
    if(!p)break;
    const seed=pool.emitted++ * 0.61803398875;
    const across=(seed-Math.floor(seed)-0.5)*width;
    const level=0.50+(Math.sin(seed*4.9)*0.5+0.5)*0.50;
    const inDepth=Math.cos(seed*7.4)*0.67+level*.54;
    p.x=x+tx*across+nx*inDepth;
    p.z=z+tz*across+nz*inDepth;
    p.y=seaY+0.25+height*level;
    const forward=2.6+2.0*level;
    p.vx=nx*forward;p.vz=nz*forward;
    p.vy=0.25-0.95*level;
    p.life=1.45;
    p.radius=0.26;
    p.px=p.x;p.py=p.y;p.pz=p.z;
    injected++;
  }
  return injected;
}

export function emitSurfFluid(pool, x, y, z, {
  shoreX = 0, shoreZ = -1, speed = 3, height = 2,
  count = 8, spread = 1.5,
} = {}) {
  if (!pool || ![x, y, z, shoreX, shoreZ].every(Number.isFinite)) return 0;
  const n = Math.max(0, Math.min(24, Math.floor(count)));
  const len = Math.hypot(shoreX, shoreZ) || 1;
  const nx = shoreX / len, nz = shoreZ / len;
  const tx = -nz, tz = nx;
  for (let i = 0; i < n; i++) {
    const p = pool.particles[pool.cursor++ % pool.particles.length];
    const phase = pool.emitted * 2.39996323 + i * 0.83;
    const across = (Math.sin(phase) * spread);
    const offset = Math.cos(phase * 1.7) * 0.32;
    p.x = x + across * tx + nx * offset;
    p.y = y + Math.sin(phase * 2.2) * 0.18;
    p.z = z + across * tz + nz * offset;
    p.vx = nx * speed * (0.6 + (i % 5) * 0.12)
      + tx * Math.sin(phase) * 1.1;
    p.vy = Math.max(0.5, height * (0.38 + (i % 5) * 0.17));
    p.vz = nz * speed * (0.6 + (i % 5) * 0.12)
      + tz * Math.sin(phase) * 1.1;
    p.life = 0.85 + (i % 5) * 0.18;
    p.radius = 0.075 + (i % 4) * 0.023;
    pool.emitted++;
  }
  return n;
}

export function advanceSurfFluid(pool, frameDt, seaY, groundHeight) {
  if (!pool) return 0;
  const dt = clamp(Number(frameDt) || 0, 0, 0.08);
  if (!dt) return pool.visible;
  const steps = dt > 0.026 ? 2 : 1;
  const h = dt / steps;
  const dots = pool.particles, grid = pool.heads;
  const support = pool.supportRadius || H;
  const supportSq = support * support;
  const restSpacing = pool.restSpacing || MIN_SEPARATION;
  for (let tick = 0; tick < steps; tick++) {
    grid.clear();
    let active = 0;
    for (let i = 0; i < dots.length; i++) {
      const p = dots[i];
      if (p.life <= 0) continue;
      p.life -= h;
      if (p.life <= 0) continue;
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.vy = clamp(p.vy - G * h, -8.5, 8);
      p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
      const key = hash(Math.floor(p.x / support), Math.floor(p.y / support),
        Math.floor(p.z / support));
      pool.next[i] = grid.get(key) ?? -1;
      grid.set(key, i);
      pool.indexes[active++] = i;
    }
    // Position-based incompressibility / short-range repulsion, applied
    // in three dimensions. Each pair visited once with a 27-cell search.
    for (let k = 0; k < active; k++) {
      const index = pool.indexes[k], a = dots[index];
      const cx = Math.floor(a.x / support), cy = Math.floor(a.y / support),
        cz = Math.floor(a.z / support);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (let oz = -1; oz <= 1; oz++) {
            let bIdx = grid.get(hash(cx + ox, cy + oy, cz + oz)) ?? -1;
            while (bIdx !== -1) {
              const nextIdx = pool.next[bIdx];
              if (bIdx > index) {
                const b = dots[bIdx];
                const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
                const distSq = dx * dx + dy * dy + dz * dz;
                if (distSq > 1e-8 && distSq < supportSq) {
                  const distance = Math.sqrt(distSq);
                  const q = 1 - distance / support, weight = q * q;
                  const correction = Math.min(0.07,
                    Math.max(0, restSpacing - distance) * 0.25
                      + weight * 0.008) / distance;
                  a.x -= dx * correction; a.y -= dy * correction;
                  a.z -= dz * correction;
                  b.x += dx * correction; b.y += dy * correction;
                  b.z += dz * correction;
                  // XSPH viscosity: damp relative velocities while
                  // preserving pairwise momentum.
                  const viscosity = weight * 0.025;
                  const vdx = (b.vx - a.vx) * viscosity;
                  const vdy = (b.vy - a.vy) * viscosity;
                  const vdz = (b.vz - a.vz) * viscosity;
                  // Position reconstruction below would discard pure
                  // velocity edits. Convert XSPH into pairwise position
                  // impulses too, retaining its actual smoothing effect.
                  a.x += vdx * h; a.y += vdy * h; a.z += vdz * h;
                  b.x -= vdx * h; b.y -= vdy * h; b.z -= vdz * h;
                  a.vx += vdx; a.vy += vdy; a.vz += vdz;
                  b.vx -= vdx; b.vy -= vdy; b.vz -= vdz;
                }
              }
              bIdx = nextIdx;
            }
          }
        }
      }
    }
    for (let k = 0; k < active; k++) {
      const p = dots[pool.indexes[k]];
      if (![p.x, p.y, p.z].every(Number.isFinite)) {
        p.life = 0; continue;
      }
      // On mobile don't sample full fractal island terrain for every
      // airborne particle; only check the seabed when near water level.
      const floorY = p.y < seaY + 0.20 &&
        typeof groundHeight === "function"
        ? groundHeight(p.x, p.z) : seaY - 4;
      // Landing returns droplets into the underlying FFT/shallow water.
      if (p.y <= Math.max(seaY + 0.045,
        Number.isFinite(floorY) ? floorY + 0.075 : seaY)) {
        p.life = 0; continue;
      }
      const inv = 1 / h;
      p.vx = clamp((p.x - p.px) * inv * 0.98, -8, 8);
      p.vy = clamp((p.y - p.py) * inv * 0.99, -8.5, 8.5);
      p.vz = clamp((p.z - p.pz) * inv * 0.98, -8, 8);
    }
  }
  let visible = 0;
  for (const p of dots) if (p.life > 0) visible++;
  pool.visible = visible;
  return visible;
}
