// Rift Next: a read-only GPU wave field backed by the EXISTING FFT buffers.
// All TSL nodes sample the already-dispatched spatial arrays. No CPU readback,
// second solver, new render pass, or ownership of the source buffers.
import { Fn, float, uint, vec2, vec3, floor, fract, mix, clamp } from "three/tsl";

export function createWaveField(source, { domain = null, resolution = 128 } = {}) {
  if (!source || typeof source !== "object") throw new TypeError("wave source required");
  const spatialA = source.resources?.[8];
  const spatialB = source.resources?.[9];
  if (!spatialA?.element || !spatialB?.element) {
    throw new Error("Wave field requires active FFT spatialA/spatialB buffers");
  }
  const n = resolution;
  if (!Number.isInteger(n) || n < 4) throw new RangeError("Invalid FFT resolution");
  const size = domain ?? source.mesh?.geometry?.parameters?.width;
  if (!(size > 0)) throw new RangeError("Explicit FFT domain required");
  const N = uint(n);
  const wrap = x => x.add(N).mod(N);
  const element = (x, z) => {
    const index = wrap(z).mul(N).add(wrap(x));
    const a = spatialA.element(index);
    const b = spatialB.element(index);
    // Existing packed FFT: spatialA.x=height, spatialA.z=horizontal X,
    // spatialB.x=horizontal Z.
    return vec3(a.z, a.x, b.x);
  };
  const sampleAt = uv => {
    const grid = fract(uv).mul(float(n));
    const xi = floor(grid.x).toUint();
    const zi = floor(grid.y).toUint();
    const t = grid.sub(floor(grid));
    const a = mix(element(xi, zi), element(xi.add(uint(1)), zi), t.x);
    const b = mix(element(xi, zi.add(uint(1))), element(xi.add(uint(1)), zi.add(uint(1))), t.x);
    return mix(a, b, t.y);
  };
  const uvAt = worldXZ => vec2(worldXZ.x, worldXZ.y)
    .div(float(size)).add(vec2(0.5, 0.5));
  const step = float(1 / n);
  const displacementAt = worldXZ => sampleAt(uvAt(worldXZ));
  const derivativesAt = worldXZ => {
    const uv = uvAt(worldXZ);
    const left = sampleAt(uv.sub(vec2(step, 0))).y;
    const right = sampleAt(uv.add(vec2(step, 0))).y;
    const down = sampleAt(uv.sub(vec2(0, step))).y;
    const up = sampleAt(uv.add(vec2(0, step))).y;
    const spacing = float(size / n);
    const inv = float(0.5).div(spacing);
    const dx = right.sub(left).mul(inv);
    const dz = up.sub(down).mul(inv);
    const center = sampleAt(uv).y;
    const curvature = left.add(right).add(down).add(up).sub(center.mul(4))
      .div(spacing.mul(spacing));
    return { dx, dz, curvature };
  };
  return Object.freeze({
    source, resolution: n, domain: size,
    get time() { return source.fftTime?.value ?? 0; },
    get displacement() { return spatialA; },
    get horizontalDisplacement() { return spatialB; },
    get waveScale() { return source.waveScale?.value ?? 1; },
    sampleDisplacement: Fn(worldXZ => displacementAt(worldXZ)),
    sampleNormal: Fn(worldXZ => {
      const { dx, dz } = derivativesAt(worldXZ);
      return vec3(dx.negate(), float(1), dz.negate()).normalize();
    }),
    sampleCurvature: Fn(worldXZ => derivativesAt(worldXZ).curvature),
  });
}
export function validateWaveField(field) {
  return Boolean(field?.source?.gpuFFT && field.displacement && field.horizontalDisplacement &&
    Number.isFinite(field.time) && field.domain > 0);
}
