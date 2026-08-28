// Fluid V5 M3.4 unified time-of-day + true night-pool moods.
// Environment, sun, water response and caustic character are coupled; Night is lit by submerged fixtures.

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
    description:'Near-black environment with the sun removed. Six submerged pool-wall fixtures become the dominant light sources.',
    envIntensity:0.016, envYaw:0.12, exposure:0.94,
    sunColor:'#7898ff', sunIntensity:0.004, sunElevation:28, sunAzimuth:18,
    waterTint:'#126cff', waterTintStrength:1.38,
    transmit:[0.055,0.25,1.00], absorption:0.47, roughness:0.046,
    causticGain:0.0,
  },
};

export const POOL_LIGHT_MODES = {
  blue: {
    label:'BLUE', color:'#167dff', accent:'#7624ff', intensity:2.10, volumetric:1.34,
    waterTint:'#126cff', transmit:[0.055,0.25,1.00],
  },
  aqua: {
    label:'AQUA', color:'#22ffd0', accent:'#20ff69', intensity:1.98, volumetric:1.28,
    waterTint:'#18e8cf', transmit:[0.055,1.00,0.68],
  },
  red: {
    label:'RED', color:'#ff261e', accent:'#ff189e', intensity:2.08, volumetric:1.32,
    waterTint:'#ff251d', transmit:[1.00,0.055,0.04],
  },
  rainbow: {
    label:'RAINBOW', color:'#ffffff', accent:'#ffffff', intensity:2.04, volumetric:1.36,
    waterTint:'#ffffff', transmit:[0.42,0.48,0.72], rainbow:true,
  },
};

export const TIME_ORDER = ['day','sunset','night'];
export const POOL_LIGHT_ORDER = ['blue','aqua','red','rainbow'];
