// Compatibility entry point retained because the stable Rift runtime already
// imports ./volumetricClouds.js. The implementation now lives in the unified
// procedural atmosphere module so visible cloud density, weather evolution and
// cloud occlusion all come from one system.
export {
  createVolumetricClouds,
  updateVolumetricClouds,
  disposeVolumetricClouds,
} from "./proceduralClouds.js";
