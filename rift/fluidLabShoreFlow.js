// Rift Islands: GPU shallow-water -> Water Pro surface optics.
// Fluid Simulation Lab M5/M8 principles: a fluid surface is rendered from
// *solved* height, flow, and aeration, not a painted periodic texture.
// We sample the EXISTING Rift solver in the vertex stage and interpolate
// it to the water material. No new compute dispatch / framebuffer / texture.
// On iPhone this avoids storage-buffer reads in the fragment stage.
import {
  Fn, attribute, varying, float, uint, floor, min, clamp, mix,
} from "three/tsl";

export function createFluidLabShoreFlow(handle, geometry) {
  const shallow = handle?.fftShallowHandle;
  if (!shallow?.gpuShallowWater || !shallow.state ||
      !geometry?.getAttribute?.("shallowCoord") ||
      !geometry.getAttribute("shallowCoverage")) return null;

  const N = shallow.N || 256;
  const Nmax = float(N - 1);
  const storage = shallow.state;
  const coord = attribute("shallowCoord", "vec2");
  const cover = attribute("shallowCoverage", "float");

  // Bilinear sampling is essential: nearest-neighbor water/foam at the
  // low-resolution solver grid visibly prints square cells on the beach.
  // The same state drives the wave-height geometry in gpu_fft_ocean_v2.js.
  const vertexFlow = Fn(() => {
    const sx = clamp(coord.x, 0, N - 1);
    const sz = clamp(coord.y, 0, N - 1);
    const x0 = floor(sx);
    const z0 = floor(sz);
    const x1 = min(x0.add(1), Nmax);
    const z1 = min(z0.add(1), Nmax);
    const dx = sx.sub(x0);
    const dz = sz.sub(z0);
    const row = uint(N);
    const i00 = z0.toUint().mul(row).add(x0.toUint());
    const i10 = z0.toUint().mul(row).add(x1.toUint());
    const i01 = z1.toUint().mul(row).add(x0.toUint());
    const i11 = z1.toUint().mul(row).add(x1.toUint());
    const a = mix(storage.element(i00), storage.element(i10), dx);
    const b = mix(storage.element(i01), storage.element(i11), dx);
    return mix(a, b, dz);
  })();

  return {
    // Varyings force buffer sampling into vertex stage, not every pixel.
    state: varying(vertexFlow, "riftLabShallowFlow"),
    coverage: cover,
  };
}
