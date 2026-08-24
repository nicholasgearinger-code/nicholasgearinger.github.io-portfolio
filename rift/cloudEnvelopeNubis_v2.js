import { createNubisEnvelopeTexture } from "./cloudEnvelopeNubis.js";

// Two independent macro envelopes are cross-faded and advected at slightly
// different rates by Nubis v2. This lets cloud systems form/dissipate instead
// of translating one frozen 2D weather mask across the sky.
export function createNubisEnvelopePair(size = 128) {
  return {
    a: createNubisEnvelopeTexture(size, 0x4e554249),
    b: createNubisEnvelopeTexture(size, 0x71c3a5d9),
  };
}
