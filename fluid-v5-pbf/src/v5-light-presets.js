// Fluid V5 M3.2 multi-light presets.
// Presets deliberately differ in receiver lighting, environment fill, beam geometry and caustic
// strength so switching rigs is obvious even when the HDR background is mostly out of frame.

export const LIGHT_TYPES = ['sun', 'spot', 'point', 'underwater', 'skylight'];

export const ENV_PRESETS = {
  bright:  { label:'BRIGHT SKY', intensity:0.92, yaw:0.00 },
  cloudy:  { label:'CLOUDY',    intensity:0.56, yaw:0.18 },
  indoor:  { label:'INDOOR',    intensity:0.24, yaw:0.34 },
  sunset:  { label:'SUNSET',    intensity:0.34, yaw:0.58 },
  night:   { label:'NIGHT',     intensity:0.055, yaw:0.12 },
};

export const LIGHT_PRESETS = {
  noon: {
    label:'NOON', type:'sun', caustic:true, envPreset:'bright',
    color:'#fff8e8', intensity:1.28, elevation:72, azimuth:32, softness:0.045,
    causticGain:1.12, character:'hard-white',
  },
  afternoon: {
    label:'AFTERNOON', type:'sun', caustic:true, envPreset:'bright',
    color:'#ffd3a1', intensity:1.10, elevation:38, azimuth:72, softness:0.10,
    causticGain:1.05, character:'warm-slant',
  },
  golden: {
    label:'GOLDEN HOUR', type:'sun', caustic:true, envPreset:'sunset',
    color:'#ff8f3c', intensity:1.06, elevation:16, azimuth:96, softness:0.16,
    causticGain:0.86, character:'orange-grazing',
  },
  moon: {
    label:'MOONLIGHT', type:'sun', caustic:true, envPreset:'night',
    color:'#6d91ff', intensity:0.46, elevation:29, azimuth:18, softness:0.07,
    causticGain:0.34, character:'blue-night',
  },
  spot: {
    label:'SPOTLIGHT', type:'spot', caustic:true, envPreset:'indoor',
    color:'#fff0c8', intensity:1.72, position:[0.50,0.96,0.50],
    azimuth:18, elevation:82, cone:18, softness:0.10, range:4.1, volumetric:0.22,
    causticGain:1.28, character:'tight-stage',
  },
  flashlight: {
    label:'FLASHLIGHT', type:'spot', caustic:true, envPreset:'night',
    color:'#c9e7ff', intensity:2.05, position:[0.08,0.62,0.10],
    azimuth:56, elevation:28, cone:11, softness:0.055, range:3.7, volumetric:0.38,
    causticGain:1.38, character:'cold-pencil',
  },
  bulb: {
    label:'OVERHEAD BULB', type:'point', caustic:true, envPreset:'indoor',
    color:'#ffc77f', intensity:1.68, position:[0.50,0.82,0.50], range:2.45,
    causticGain:1.12, character:'warm-radial',
  },
  poolBlue: {
    label:'POOL BLUE', type:'underwater', caustic:false, envPreset:'night',
    color:'#167dff', intensity:1.82, position:[0.035,0.16,0.50],
    azimuth:90, elevation:3, cone:38, softness:0.18, range:3.2, volumetric:1.28,
    character:'deep-blue-beam',
  },
  poolAqua: {
    label:'POOL AQUA', type:'underwater', caustic:false, envPreset:'night',
    color:'#25ffd0', intensity:1.58, position:[0.965,0.20,0.48],
    azimuth:270, elevation:6, cone:44, softness:0.24, range:3.0, volumetric:1.10,
    character:'aqua-sidewash',
  },
  redLed: {
    label:'RED LED', type:'underwater', caustic:false, envPreset:'night',
    color:'#ff241c', intensity:1.72, position:[0.035,0.18,0.52],
    azimuth:90, elevation:2, cone:34, softness:0.15, range:2.7, volumetric:1.18,
    character:'red-night-beam',
  },
  overcast: {
    label:'OVERCAST', type:'skylight', caustic:false, envPreset:'cloudy',
    color:'#bed6e9', intensity:0.90, softness:0.96,
    character:'flat-cool',
  },
  indoor: {
    label:'INDOOR POOL', type:'skylight', caustic:false, envPreset:'indoor',
    color:'#d5f2ef', intensity:1.02, softness:0.76,
    character:'cyan-indoor',
  },
};

export function clonePreset(name='noon') {
  const p = LIGHT_PRESETS[name] || LIGHT_PRESETS.noon;
  return JSON.parse(JSON.stringify(p));
}
