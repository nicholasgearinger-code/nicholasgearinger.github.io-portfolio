// Camera-focused presentation mesh for the experimental ocean.
// Remaps a regular square grid and every interpolated vertex attribute together.
// Keeps the original triangulation and perimeter; does not allocate GPU passes.
export function createAdaptiveOceanMesh(mesh, { strength = 0.20, threshold = 48 } = {}) {
  const geometry = mesh?.geometry;
  const position = geometry?.getAttribute?.("position");
  const count = position?.count || 0;
  const n = Math.round(Math.sqrt(count));
  // Only regular, non-index-encoded grids are safe to resample.
  if (n < 16 || n * n !== count || geometry.getAttribute("fftIndex")) return null;
  if (n > 513) return null; // iOS memory/CPU guard.
  const attrs = Object.entries(geometry.attributes);
  const data = attrs.map(([name, a]) => ({
    name, a, original: a.array.slice(), itemSize: a.itemSize,
    // Integer and normalized values cannot be interpolated safely.
    usable: a.array instanceof Float32Array && !a.normalized && a.count === count
  }));
  if (data.some(d => !d.usable)) return null;
  const pos = data.find(d => d.name === "position");
  if (!pos || pos.itemSize !== 3) return null;
  const xMin = pos.original[0], xMax = pos.original[(n - 1) * 3];
  const zMin = pos.original[2], zMax = pos.original[(count - n) * 3 + 2];
  const spanX = xMax - xMin, spanZ = zMax - zMin;
  if (Math.abs(spanX) < 1 || Math.abs(spanZ) < 1) return null;
  let enabled = false, lastX = NaN, lastZ = NaN;
  const bilinear = (original, components, sx, sz, component) => {
    const x0 = Math.floor(sx), z0 = Math.floor(sz);
    const x1 = Math.min(n - 1, x0 + 1), z1 = Math.min(n - 1, z0 + 1);
    const fx = sx - x0, fz = sz - z0;
    const ix = (z, x) => (z * n + x) * components + component;
    const a = original[ix(z0,x0)] * (1-fx) + original[ix(z0,x1)] * fx;
    const b = original[ix(z1,x0)] * (1-fx) + original[ix(z1,x1)] * fx;
    return a * (1-fz) + b * fz;
  };
  const refocus = (worldX = 0, worldZ = 0, force = false) => {
    if (!enabled) return false;
    if (!force && Math.hypot(worldX-lastX, worldZ-lastZ) < threshold) return false;
    lastX = worldX; lastZ = worldZ;
    // Smooth, boundary-fixed warp around camera. Source coordinates are
    // interpolated for ALL attributes, preserving depth and shoreline masks.
    const cx = Math.max(-0.6, Math.min(0.6, (worldX - mesh.position.x) / (spanX * 0.5)));
    const cz = Math.max(-0.6, Math.min(0.6, (worldZ - mesh.position.z) / (spanZ * 0.5)));
    const warp = (t, focus) => {
      const centered = Math.sign(t) * Math.pow(Math.abs(t), 1.0 + strength);
      return Math.max(-1, Math.min(1, centered + focus * strength * (1-centered*centered)));
    };
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
      const sx = (warp(2*x/(n-1)-1,cx)+1)*(n-1)/2;
      const sz = (warp(2*z/(n-1)-1,cz)+1)*(n-1)/2;
      const dest = z*n+x;
      for (const d of data) for(let c=0;c<d.itemSize;c++)
        d.a.array[dest*d.itemSize+c] = bilinear(d.original,d.itemSize,sx,sz,c);
    }
    for (const d of data) d.a.needsUpdate = true;
    geometry.computeBoundingSphere();
    return true;
  };
  return {
    get enabled(){return enabled;},
    enable(){enabled = true; refocus(0,0,true);},
    update(camera){if(camera) refocus(camera.position.x,camera.position.z);},
    restore(){
      if(!enabled)return;
      enabled=false;
      for(const d of data){d.a.array.set(d.original);d.a.needsUpdate=true;}
      geometry.computeBoundingSphere();
    },
    dispose(){this.restore();}
  };
}
