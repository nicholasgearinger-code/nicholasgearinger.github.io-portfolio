// Fluid V5 M3.1 multi-light presets.
// Positions are normalized to the current simulation box so the rigs survive quality/domain changes.

export const LIGHT_TYPES = ['sun', 'spot', 'point', 'underwater', 'skylight'];

export const ENV_PRESETS = {
  bright:  { label:'BRIGHT SKY', intensity:1.05, yaw:0.00 },
  cloudy:  { label:'CLOUDY',    intensity:0.78, yaw:0.18 },
  indoor:  { label:'INDOOR',    intensity:0.52, yaw:0.34 },
  sunset:  { label:'SUNSET',    intensity:0.62, yaw:0.58 },
  night:   { label:'NIGHT',     intensity:0.18, yaw:0.12 },
};

export const LIGHT_PRESETS = {
  noon: {
    label:'NOON', type:'sun', caustic:true, envPreset:'bright',
    color:'#fff4dc', intensity:1.00, elevation:62, azimuth:38, softness:0.08,
  },
  afternoon: {
    label:'AFTERNOON', type:'sun', caustic:true, envPreset:'bright',
    color:'#ffdcb5', intensity:0.92, elevation:43, azimuth:64, softness:0.12,
  },
  golden: {
    label:'GOLDEN HOUR', type:'sun', caustic:true, envPreset:'sunset',
    color:'#ffb36b', intensity:0.78, elevation:23, azimuth:82, softness:0.17,
  },
  moon: {
    label:'MOONLIGHT', type:'sun', caustic:true, envPreset:'night',
    color:'#9bbcff', intensity:0.25, elevation:35, azimuth:24, softness:0.10,
  },
  spot: {
    label:'SPOTLIGHT', type:'spot', caustic:true, envPreset:'indoor',
    color:'#fff3d8', intensity:1.10, position:[0.50,0.92,0.50],
    azimuth:25, elevation:78, cone:24, softness:0.22, range:3.8,
  },
  flashlight: {
    label:'FLASHLIGHT', type:'spot', caustic:true, envPreset:'night',
    color:'#e8f3ff', intensity:1.28, position:[0.12,0.68,0.16],
    azimuth:48, elevation:34, cone:17, softness:0.12, range:3.4,
  },
  bulb: {
    label:'OVERHEAD BULB', type:'point', caustic:true, envPreset:'indoor',
    color:'#ffe5ba', intensity:1.05, position:[0.50,0.86,0.50], range:3.1,
  },
  poolBlue: {
    label:'POOL BLUE', type:'underwater', caustic:false, envPreset:'night',
    color:'#58aaff', intensity:1.00, position:[0.06,0.18,0.50],
    azimuth:90, elevation:2, cone:52, softness:0.34, range:2.8, volumetric:0.80,
  },
  poolAqua: {
    label:'POOL AQUA', type:'underwater', caustic:false, envPreset:'night',
    color:'#4fffe0', intensity:0.86, position:[0.94,0.22,0.48],
    azimuth:270, elevation:5, cone:58, softness:0.38, range:2.7, volumetric:0.70,
  },
  redLed: {
    label:'RED LED', type:'underwater', caustic:false, envPreset:'night',
    color:'#ff4d45', intensity:0.78, position:[0.06,0.20,0.52],
    azimuth:90, elevation:1, cone:46, softness:0.30, range:2.5, volumetric:0.62,
  },
  overcast: {
    label:'OVERCAST', type:'skylight', caustic:false, envPreset:'cloudy',
    color:'#dcecff', intensity:0.76, softness:0.88,
  },
  indoor: {
    label:'INDOOR POOL', type:'skylight', caustic:false, envPreset:'indoor',
    color:'#edf6ff', intensity:0.70, softness:0.72,
  },
};

export function clonePreset(name='noon') {
  const p = LIGHT_PRESETS[name] || LIGHT_PRESETS.noon;
  return JSON.parse(JSON.stringify(p));
}
