import {
  HalfFloatType,
  NodeMaterial,
  NodeUpdateType,
  QuadMesh,
  RenderTarget,
  RendererUtils,
  TempNode,
  Vector2,
} from "three/webgpu";
import {
  Fn,
  clamp,
  float,
  floor,
  mix,
  mod,
  passTexture,
  screenCoordinate,
  select,
  smoothstep,
  texture,
  uniform,
  uv,
  vec2,
} from "three/tsl";

// -----------------------------------------------------------------------------
// Rift r185 cloud temporal interleaver.
//
// The expensive cloud pass is rendered at 1/16 screen width/height. That is one
// sample for every 4x4 block of the quarter-resolution history image. A 16-phase
// camera jitter moves that sample to a different history texel each frame.
//
// This node resolves the tiny current cloud texture into a persistent 1/4-width
// x 1/4-height history buffer. Only the active phase receives the new raymarched
// sample; the other 15 texels are reprojected from history with the cheap cloud
// proxy velocity pass. On fast motion history confidence falls back toward the
// current coarse sample, avoiding long trails while the 16 phases refill.
// -----------------------------------------------------------------------------

const _size = new Vector2();
const _quad = new QuadMesh();
let _rendererState;

export class RiftInterleavedCloudHistoryNode extends TempNode {
  constructor(currentNode, velocityNode, phaseNode, historyScale = 0.25) {
    super("vec4");

    this.currentNode = currentNode;
    this.velocityNode = velocityNode;
    this.phaseNode = phaseNode;
    this.historyScale = historyScale;
    this.updateBeforeType = NodeUpdateType.FRAME;

    this._resolution = uniform(new Vector2(1, 1));
    this._compRT = new RenderTarget(1, 1, {
      depthBuffer: false,
      type: HalfFloatType,
    });
    this._compRT.texture.name = "RiftCloudInterleave.comp";

    this._oldRT = new RenderTarget(1, 1, {
      depthBuffer: false,
      type: HalfFloatType,
    });
    this._oldRT.texture.name = "RiftCloudInterleave.history";

    this._outputNode = passTexture(this, this._compRT.texture);
    this._oldNode = texture(this._oldRT.texture);
    this._material = new NodeMaterial();
    this._material.name = "RiftCloudInterleave.resolve";
  }

  getTextureNode() {
    return this._outputNode;
  }

  setSize(width, height) {
    this._compRT.setSize(width, height);
    this._oldRT.setSize(width, height);
    this._resolution.value.set(width, height);
  }

  updateBefore(frame) {
    const { renderer } = frame;
    _rendererState = RendererUtils.resetRendererState(renderer, _rendererState);

    renderer.getDrawingBufferSize(_size);
    const width = Math.max(1, Math.ceil(_size.x * this.historyScale));
    const height = Math.max(1, Math.ceil(_size.y * this.historyScale));
    this.setSize(width, height);

    // Keep texture-node references attached to the actual ping-pong targets.
    this._outputNode.value = this._compRT.texture;
    this._oldNode.value = this._oldRT.texture;

    _quad.material = this._material;
    _quad.name = "RiftCloudInterleave";
    renderer.setRenderTarget(this._compRT);
    _quad.render(renderer);
    renderer.setRenderTarget(null);

    const old = this._oldRT;
    this._oldRT = this._compRT;
    this._compRT = old;

    RendererUtils.restoreRendererState(renderer, _rendererState);
  }

  setup(builder) {
    const currentNode = this.currentNode;
    const velocityNode = this.velocityNode;
    const phaseNode = this.phaseNode;
    const oldNode = this._oldNode;
    const resolution = this._resolution;

    const resolve = Fn(() => {
      // screenCoordinate is in the quarter-resolution history target here.
      const pixel = floor(screenCoordinate.xy.sub(0.5));
      const phaseX = mod(pixel.x, float(4));
      const phaseY = mod(pixel.y, float(4));
      const isActive = phaseX.equal(phaseNode.x).and(phaseY.equal(phaseNode.y));

      // One tiny cloud texel represents one 4x4 block of history texels. The
      // sample camera is jittered so that this texel corresponds to the active
      // phase location instead of always sampling the block center.
      const currentSize = currentNode.size();
      const tinyPixel = floor(pixel.div(float(4)));
      const tinyUV = clamp(
        tinyPixel.add(0.5).div(currentSize),
        vec2(0.00001),
        vec2(0.99999),
      );
      const current = currentNode.sample(tinyUV).max(0).toVar();

      const screenUv = uv();
      const vel = velocityNode.sample(screenUv).xy;
      // Three's velocity is an NDC derivative. Convert it to the UV offset used
      // to find the previous-frame history location.
      const velocityUV = vec2(vel.x.mul(0.5), vel.y.mul(-0.5));
      const historyUV = screenUv.sub(velocityUV).toVar();
      const inside = historyUV.x.greaterThanEqual(0)
        .and(historyUV.x.lessThanEqual(1))
        .and(historyUV.y.greaterThanEqual(0))
        .and(historyUV.y.lessThanEqual(1));

      const history = oldNode.sample(clamp(historyUV, vec2(0.00001), vec2(0.99999))).max(0);

      // Reprojection is trusted while motion is sub-pixel/small. Under a fast
      // turn, use the current tiny sample as a coarse 4x4 reconstruction instead
      // of dragging stale clouds across the screen.
      const motionPixels = velocityUV.mul(resolution).length();
      const motionTrust = smoothstep(float(1.25), float(18.0), motionPixels).oneMinus();
      const historyCandidate = select(inside, history, current);
      const stableHistory = mix(current, historyCandidate, motionTrust);

      // The active texel gets a mostly-current update. A small amount of history
      // damps single-sample brightness noise without smearing the silhouette.
      const activeResult = mix(stableHistory, current, float(0.90));
      return select(isActive, activeResult, stableHistory);
    });

    this._material.fragmentNode = resolve().context(builder.getSharedContext());
    this._material.needsUpdate = true;
    return this._outputNode;
  }

  dispose() {
    this._compRT.dispose();
    this._oldRT.dispose();
    this._material.dispose();
  }
}

export function createRiftInterleavedCloudHistory(currentNode, velocityNode, phaseNode, historyScale = 0.25) {
  return new RiftInterleavedCloudHistoryNode(currentNode, velocityNode, phaseNode, historyScale);
}
