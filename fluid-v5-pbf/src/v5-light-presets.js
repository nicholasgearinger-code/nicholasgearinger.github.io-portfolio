// Fluid V5 M3.4.2 unified time-of-day + tuned true-night-pool moods.
// Environment, sun, water response and caustic character are coupled; Night is lit by localized submerged fixtures.

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
    description:'Near-black environment with the sun removed. Six submerged pool-wall fixtures create localized colored pools and underwater beams.',
    envIntensity:0.012, envYaw:0.12, exposure:0.82,
    sunColor:'#7898ff', sunIntensity:0.003, sunElevation:28, sunAzimuth:18,
    waterTint:'#126cff', waterTintStrength:0.58,
    transmit:[0.11,0.34,0.82], absorption:0.52, roughness:0.048,
    causticGain:0.0,
  },
};

export const POOL_LIGHT_MODES = {
  blue: {
    label:'BLUE', color:'#167dff', accent:'#7624ff', intensity:0.88, volumetric:0.52,
    waterTint:'#126cff', transmit:[0.10,0.32,0.86],
  },
  aqua: {
    label:'AQUA', color:'#22ffd0', accent:'#20ff69', intensity:0.82, volumetric:0.48,
    waterTint:'#18e8cf', transmit:[0.10,0.76,0.64],
  },
  red: {
    label:'RED', color:'#ff261e', accent:'#ff189e', intensity:0.86, volumetric:0.50,
    waterTint:'#ff251d', transmit:[0.70,0.12,0.10],
  },
  rainbow: {
    label:'RAINBOW', color:'#ffffff', accent:'#ffffff', intensity:0.84, volumetric:0.50,
    waterTint:'#ffffff', transmit:[0.22,0.34,0.58], rainbow:true,
  },
};

export const TIME_ORDER = ['day','sunset','night'];
export const POOL_LIGHT_ORDER = ['blue','aqua','red','rainbow'];
