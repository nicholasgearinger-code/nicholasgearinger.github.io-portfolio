import { instancedArray, struct } from "three/tsl";
import { MLSMPMSolver } from "./MLSMPMSolver.js";

// V3.4 water preset: keep the proven MLS-MPM kernels, but initialize a fuller
// pool and tune the constitutive parameters away from the syrupy V3.3 look.
export class MLSMPMPoolSolver extends MLSMPMSolver {
  constructor(renderer, options = {}) {
    super(renderer, {
      ...options,
      // Lower viscous stress and slightly stronger pressure response make the
      // volume accelerate/rebound more like water instead of a thick gel.
      stiffness: 52,
      restDensity: 1.12,
      viscosity: 0.026,
    });
  }

  _setupBuffers() {
    const particleStruct = struct({
      position: { type: 'vec3' },
      velocity: { type: 'vec3' },
      C: { type: 'mat3' },
    });

    const strideFloats = 20;
    const particleArray = new Float32Array(this.maxParticles * strideFloats);
    const n = this.particleCount;

    // Fill nearly to the visible V3.3 coping. In world coordinates the solver
    // maps [0,1] to [-5,+5], so maxY ~= 0.36 corresponds to y ~= -1.4.
    const layersY = Math.max(7, Math.round(Math.cbrt(n) * 0.47));
    const across = Math.ceil(Math.sqrt(n / layersY));
    const nx = across;
    const nz = Math.ceil(n / (nx * layersY));

    const minX = 0.070, spanX = 0.86;
    const minZ = 0.070, spanZ = 0.86;
    const minY = 0.052, spanY = 0.308;

    let p = 0;
    for (let y = 0; y < layersY && p < n; y++) {
      for (let z = 0; z < nz && p < n; z++) {
        for (let x = 0; x < nx && p < n; x++, p++) {
          const i = p * strideFloats;
          // Strong 3D jitter removes the regular lattice without introducing a
          // preferred horizontal direction into the rest state.
          const jx = (Math.random() - 0.5) * 0.76;
          const jy = (Math.random() - 0.5) * 0.76;
          const jz = (Math.random() - 0.5) * 0.76;

          particleArray[i] = minX + ((x + 0.5 + jx) / nx) * spanX;
          particleArray[i + 1] = minY + ((y + 0.5 + jy) / layersY) * spanY;
          particleArray[i + 2] = minZ + ((z + 0.5 + jz) / nz) * spanZ;
        }
      }
    }

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
