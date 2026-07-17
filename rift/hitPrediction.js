// hitPrediction.js
// -----------------------------------------------------------------------------
// Formerly: cosmetic-only latency-hiding for multiplayer hits, always
// overrulable by the server's authoritative confirmation (see the old
// server/combat.js). Single-player has no server to confirm against, so
// this ray-sphere math is now used directly and authoritatively against
// Resonance Crystals (see crystals.js) — a hit found here IS the hit,
// immediately.
// -----------------------------------------------------------------------------

function raySphereIntersectionDistance(origin, direction, center, radius) {
  const ocx = origin.x - center.x;
  const ocy = origin.y - center.y;
  const ocz = origin.z - center.z;

  const b = 2 * (ocx * direction.x + ocy * direction.y + ocz * direction.z);
  const c = ocx * ocx + ocy * ocy + ocz * ocz - radius * radius;
  const discriminant = b * b - 4 * c;
  if (discriminant < 0) return null;

  const sqrtDisc = Math.sqrt(discriminant);
  const t1 = (-b - sqrtDisc) / 2;
  const t2 = (-b + sqrtDisc) / 2;
  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return null;
}

/**
 * @param {{x,y,z}} origin
 * @param {{x,y,z}} direction  normalized
 * @param {Array<{id:string, position:{x,y,z}}>} candidates
 * @param {number} radius  hit-sphere radius for every candidate
 * @param {number} maxRange
 * @returns {{id:string, distance:number} | null}
 */
function findClosestHit(origin, direction, candidates, radius, maxRange) {
  let closest = null;
  for (const target of candidates) {
    const t = raySphereIntersectionDistance(origin, direction, target.position, radius);
    if (t !== null && t <= maxRange) {
      if (!closest || t < closest.distance) closest = { id: target.id, distance: t };
    }
  }
  return closest;
}

export { findClosestHit, raySphereIntersectionDistance };
