import * as THREE from "three/webgpu";
import { instancedArray, struct } from "three/tsl";
import { MLSMPMSolver } from "./MLSMPMSolver.js";

// V3.1 keeps the exact MLS-MPM compute kernels from MLSMPMSolver, but changes
// the initial condition from a dam-break block into a wide, shallow 3D pool.
// The base constructor deliberately dispatches to this override before building
// the compute graph, so all kernels bind these buffers normally.
export class MLSMPMPoolSolver extends MLSMPMSolver {
  _setupBuffers() {
    const particleStruct = struct({
      position: { type: 'vec3' },
      velocity: { type: 'vec3' },
      C: { type: 'mat3' },
    });

    const strideFloats = 20;
    const particleArray = new Float32Array(this.maxParticles * strideFloats);
    const n = this.particleCount;

    // Spread the liquid over most of X/Z, but only the lower ~25% of Y. The
    // stratification keeps local particle density predictable for MLS-MPM while
    // large per-cell jitter removes the visible comb/lattice pattern.
    const layersY = Math.max(6, Math.round(Math.cbrt(n) * 0.38));
    const across = Math.ceil(Math.sqrt(n / layersY));
    const nx = across;
    const nz = Math.ceil(n / (nx * layersY));

    const minX = 0.075, spanX = 0.85;
    const minZ = 0.075, spanZ = 0.85;
    const minY = 0.055, spanY = 0.245;

    let p = 0;
    for (let y = 0; y < layersY && p < n; y++) {
      for (let z = 0; z < nz && p < n; z++) {
        for (let x = 0; x < nx && p < n; x++, p++) {
          const i = p * strideFloats;
          const jx = (Math.random() - 0.5) * 0.72;
          const jy = (Math.random() - 0.5) * 0.72;
          const jz = (Math.random() - 0.5) * 0.72;

          particleArray[i] = minX + ((x + 0.5 + jx) / nx) * spanX;
          particleArray[i + 1] = minY + ((y + 0.5 + jy) / layersY) * spanY;
          particleArray[i + 2] = minZ + ((z + 0.5 + jz) / nz) * spanZ;
        }
      }
    }

    // Unused capacity is never dispatched/rendered, but park it safely anyway.
    for (; p < this.maxParticles; p++) {
      const i = p * strideFloats;
      particleArray[i] = 0.05;
      particleArray[i + 1] = 0.05;
      particleArray[i + 2] = 0.05;
    }

    this.particleBuffer = instancedArray(particleArray, particleStruct);

    const cellStruct = struct({
      x: { type: 'int', atomic: true },
      y: { type: 'int', atomic: true },
      z: { type: 'int', atomic: true },
      mass: { type: 'int', atomic: true },
    });
    this.cellBuffer = instancedArray(this.cellCount, cellStruct);
    this.cellBufferFloat = instancedArray(this.cellCount, 'vec4');
  }
}
