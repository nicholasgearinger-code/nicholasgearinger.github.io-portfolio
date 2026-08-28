import { Fn, instanceIndex } from "three/tsl";
import { FluidSolver } from "./FluidSolver.js";

// Three.js WebGPURenderer does not expose GPUCommandEncoder.copyBufferToBuffer()
// as a renderer method. FluidSolver v2 originally used that nonexistent helper
// after pressure projection, which stopped the first live frame on Safari.
//
// Keep the solver architecture unchanged, but replace that final buffer copy
// with a tiny storage-buffer compute pass. This remains fully GPU-side and uses
// the same TSL/compute abstraction as every other solver stage.
const originalStep = FluidSolver.prototype.step;

FluidSolver.prototype.step = function fluidV2CompatibleStep(dtSeconds) {
  if (!this.__velocityCommitCompute) {
    this.__velocityCommitCompute = Fn(() => {
      const i = instanceIndex;
      this.velocityA.element(i).assign(this.velocityB.element(i));
    })().compute(this.cellCount);
  }

  const renderer = this.renderer;
  const nativeCopy = renderer.copyBufferToBuffer;

  // Preserve a future/native Three implementation if one exists. On r185 the
  // method is undefined, so emulate exactly the operation FluidSolver expects.
  if (typeof nativeCopy !== "function") {
    renderer.copyBufferToBuffer = () => {
      renderer.compute(this.__velocityCommitCompute);
    };
  }

  try {
    return originalStep.call(this, dtSeconds);
  } finally {
    if (typeof nativeCopy === "function") {
      renderer.copyBufferToBuffer = nativeCopy;
    } else {
      delete renderer.copyBufferToBuffer;
    }
  }
};
