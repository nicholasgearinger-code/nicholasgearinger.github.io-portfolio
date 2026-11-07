// Adapted from Fluid Simulation Lab's M5.7 event-driven ripple concept and
// M4.1 transient whitewater lifecycle. Unlike the lab's full particle SSFR,
// this is a bounded CPU event bus feeding Rift's EXISTING GPU shallow-water
// interaction uniforms and Water Pro's existing material draw.
// No extra GPU dispatch, texture, shader program, renderer or global hook.
const MAX_EVENTS = 8;
const FOAM_LIFETIME = 0.64;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function stateFor(handle) {
  if (!handle.__riftLabInteractions) {
    handle.__riftLabInteractions = {
      pending: [], visualPending: [], active: null, lastEventTime: -100,
    };
  }
  return handle.__riftLabInteractions;
}

/**
 * An event is a paddle entry, hull slap, dropped item or player interaction.
 * Repeated wake drag is NOT added to the queue; the existing stern wake
 * remains the baseline. Emit only discrete impacts, with world X/Z coords.
 */
export function emitRiftWaterImpact(handle, x, z, {
  strength = 0.8, radius = 1.5, foam = 0.5, kind = "impact",
} = {}, time = 0) {
  if (!handle?.gpuFFT || !Number.isFinite(x) || !Number.isFinite(z)) return false;
  const s = stateFor(handle);
  const item = {
    x, z, strength: clamp(Number(strength) || 0, 0, 3.4),
    radius: clamp(Number(radius) || 1.5, 1.2, 5),
    foam: clamp(Number(foam) || 0, 0, 0.24),
    kind,
    time: Number.isFinite(time) ? time : 0,
  };
  if (!item.strength) return false;
  // Avoid unbounded queues during an 11-fps hitch or repeated fast taps.
  if (s.pending.length === MAX_EVENTS) s.pending.shift();
  s.pending.push(item);
  // A separate bounded queue feeds the real-time lab-derived SPH spray.
  // Physics impulses and visible droplets consume independently.
  if (s.visualPending.length === MAX_EVENTS) s.visualPending.shift();
  s.visualPending.push(item);
  return true;
}

/**
 * Called ONCE per rendered frame just before the already-existing shallow
 * water compute dispatch. One queued event gets the existing interaction
 * slot; otherwise the continuous rowing wake can use it as before.
 * The event's foam envelope is exposed through uniform writes only.
 */
export function consumeRiftWaterImpact(handle, time = 0) {
  if (!handle?.gpuFFT) return null;
  const s = handle.__riftLabInteractions;
  if (!s) return null;
  const next = s.pending.shift() ?? null;
  if (next) {
    s.active = next;
    s.lastEventTime = time;
  }
  const active = s.active;
  const elapsed = active ? Math.max(0, time - s.lastEventTime) : Infinity;
  const life = clamp(1 - elapsed / FOAM_LIFETIME, 0, 1);
  const energy = active ? active.foam * life * life : 0;
  if (handle.fftLabImpactCenter?.value && active) {
    handle.fftLabImpactCenter.value.set(active.x, active.z);
  }
  if (handle.fftLabImpactEnergy) handle.fftLabImpactEnergy.value = energy;
  if (handle.fftLabImpactInvRadiusSq && active) {
    handle.fftLabImpactInvRadiusSq.value = 1 / (active.radius * active.radius);
  }
  if (!life) s.active = null;
  return next;
}

export function consumeRiftWaterVisualImpact(handle) {
  const queue = handle?.__riftLabInteractions?.visualPending;
  return queue?.length ? queue.shift() : null;
}

export function resetRiftWaterImpacts(handle) {
  if (!handle) return;
  if (handle.fftLabImpactEnergy) handle.fftLabImpactEnergy.value = 0;
  handle.__riftLabInteractions = null;
}
