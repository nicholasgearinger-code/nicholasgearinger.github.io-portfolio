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

export function createSurfParticlePool(maxParticles = 160) {
  const count = Math.max(16, Math.min(1200, Math.floor(maxParticles)));
  return {
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
      const key = hash(Math.floor(p.x / H), Math.floor(p.y / H),
        Math.floor(p.z / H));
      pool.next[i] = grid.get(key) ?? -1;
      grid.set(key, i);
      pool.indexes[active++] = i;
    }
    // Position-based incompressibility / short-range repulsion, applied
    // in three dimensions. Each pair visited once with a 27-cell search.
    for (let k = 0; k < active; k++) {
      const index = pool.indexes[k], a = dots[index];
      const cx = Math.floor(a.x / H), cy = Math.floor(a.y / H),
        cz = Math.floor(a.z / H);
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
                if (distSq > 1e-8 && distSq < H2) {
                  const distance = Math.sqrt(distSq);
                  const q = 1 - distance / H, weight = q * q;
                  const correction = Math.min(0.07,
                    Math.max(0, MIN_SEPARATION - distance) * 0.25
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
