# Hybrid WebGPU Fluid Lab — review build

This branch replaces the portfolio's existing `fluid-sim-prototype.html` implementation while leaving Rift Islands untouched.

## Architecture

### GPU fluid state

The main water body is a 2.5D heightfield coupled to a horizontal 2D velocity field. State lives in Three.js WebGPU storage buffers:

- `heightA / heightB` — free-surface displacement
- `velocityA / velocityB` — horizontal water velocity
- `pressureA / pressureB` — Jacobi pressure ping-pong
- `divergence` — compression/expansion of the horizontal velocity field
- `curl` — scalar vorticity
- `foamA / foamB` — advected, persistent foam

There is no per-cell CPU update or GPU readback in the render loop.

### Per-frame simulation

1. Semi-Lagrangian velocity/height/foam advection.
2. Up to four Gaussian-like splats inject height and momentum from touch/mouse, rigid bodies, or returning droplets.
3. Curl calculation.
4. Vorticity confinement restores rotational detail lost by semi-Lagrangian advection.
5. Shallow-water gravity accelerates flow down the free-surface height gradient.
6. Divergence calculation.
7. Even-numbered Jacobi pressure iterations ping-pong `pressureA -> pressureB -> pressureA`.
8. Pressure-gradient projection removes most horizontal divergence.
9. Pre-projection divergence updates free-surface height through a shallow-water continuity term.
10. Curl/divergence/height energy produces persistent advected foam.

### Rendering

`FluidSurface.js` samples the live GPU height buffer in the vertex shader. Surface normals are finite differences of neighboring height cells and are transformed into view space for a `MeshPhysicalNodeMaterial`.

The material uses:

- IOR 1.333
- high transmission
- low roughness
- attenuation color/distance
- clearcoat
- foam-driven roughness, color and transmission

### Secondary liquid

`FluidParticles.js` uses one `InstancedMesh` of transmissive droplets. Splash droplets are ballistic particles; when they cross the water plane they inject a small momentum/height splat back into the GPU solver and disappear.

### Rigid-body physics

`FluidPhysics.js` uses `@dimforge/rapier3d-compat` 0.20.0.

- Balls and cubes are real Rapier dynamic rigid bodies.
- Mean-surface buoyancy and drag are applied before each physics step.
- Moving submerged bodies inject wake momentum into the fluid.
- Downward water-surface crossings inject impact splats and spray.

The current coupling deliberately avoids synchronous GPU height readback. A later refinement can add asynchronous sparse water-height sampling or a small CPU proxy field if exact per-body local buoyancy is needed.

## Why this build does not add React Three Fiber yet

The portfolio is already a static Three.js site and this fluid demo is loaded in an iframe. Adding React/R3F at the same time as a completely new compute solver would add a second integration variable without improving the hot simulation path. The classes in `fluid-v2/` are intentionally framework-neutral and can be wrapped by R3F components later.

## Quality presets

- Mobile default: 128², 10 pressure iterations, 96 droplets.
- Desktop default: 192², 16 pressure iterations, 144 droplets.
- `?quality=low`: 96² / 6 pressure iterations.
- `?quality=medium`: 128² / 10 pressure iterations.
- `?quality=high`: 192² / 16 pressure iterations.

The on-screen Pressure button cycles 6 / 10 / 16 / 22 Jacobi iterations without rebuilding the grid.

## Review checklist

- Drag quickly through the pool: the wake should follow pointer direction instead of only creating circular ripples.
- Drop a sphere: it should create a splash, droplets, then partially float with wake generation.
- Drop a cube: rotation/drag should create a different wake pattern from the sphere.
- Toggle vorticity: swirling wake/impact detail should visibly reduce when disabled.
- Cycle pressure iterations: low iteration counts should be cheaper/softer; high counts should produce a more coherent projected flow.
- Watch foam: it should advect with the flow and linger after an impact instead of being a static texture.
- Inspect the water at grazing angles: reflections and transmission should respond to the GPU-derived surface normal.

## Existing prototype

The previous implementation remains recoverable from Git history. It is not duplicated in this branch so the review diff stays focused.
