// Fluid V5 M3.3 unified time-of-day + pool-light moods.
// Environment, sun, water response and caustic character are intentionally coupled.

export const TIME_PRESETS = {
  day: {
    label:'DAY',
    description:'Bright neutral daylight with a high sun, clear blue water and strong white caustics.',
    envIntensity:0.92, envYaw:0.00, exposure:1.50,
    sunColor:'#fff8e8', sunIntensity:1.28, sunElevation:70, sunAzimuth:32,
    waterTint:'#b8e8ff', waterTintStrength:0.12,
    transmit:[0.30,0.67,0.92], absorption:0.30, roughness:0.038,
    causticGain:1.12,
  },
  sunset: {
    label:'SUNSET',
    description:'Low red-orange sun, darkened environment and warm reflections moving across the water surface.',
    envIntensity:0.30, envYaw:0.58, exposure:1.38,
    sunColor:'#ff5c25', sunIntensity:1.08, sunElevation:13, sunAzimuth:98,
    waterTint:'#ff3d1f', waterTintStrength:0.82,
    transmit:[0.67,0.50,0.38], absorption:0.34, roughness:0.044,
    causticGain:0.90,
  },
  night: {
    label:'NIGHT',
    description:'Very dark environment with the sun removed. Pool-wall fixtures become the dominant light source.',
    envIntensity:0.045, envYaw:0.12, exposure:1.08,
    sunColor:'#7898ff', sunIntensity:0.018, sunElevation:28, sunAzimuth:18,
    waterTint:'#167dff', waterTintStrength:1.05,
    transmit:[0.18,0.52,0.96], absorption:0.40, roughness:0.050,
    causticGain:0.0,
  },
};

export const POOL_LIGHT_MODES = {
  blue: {
    label:'BLUE', color:'#167dff', intensity:1.65, volumetric:1.10,
    waterTint:'#167dff', transmit:[0.16,0.50,0.98],
  },
  aqua: {
    label:'AQUA', color:'#22ffd0', intensity:1.52, volumetric:1.02,
    waterTint:'#20f0d6', transmit:[0.16,0.92,0.82],
  },
  red: {
    label:'RED', color:'#ff261e', intensity:1.62, volumetric:1.08,
    waterTint:'#ff2b20', transmit:[0.96,0.20,0.18],
  },
  rainbow: {
    label:'RAINBOW', color:'#ffffff', intensity:1.58, volumetric:1.12,
    waterTint:'#ffffff', transmit:[0.62,0.68,0.86], rainbow:true,
  },
};

export const TIME_ORDER = ['day','sunset','night'];
export const POOL_LIGHT_ORDER = ['blue','aqua','red','rainbow'];
