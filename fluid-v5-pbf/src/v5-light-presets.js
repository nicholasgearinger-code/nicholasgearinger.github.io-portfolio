// Fluid V5 M3.5 unified time-of-day presets for true HDR image-based lighting.
// Day/Sunset use real scene-linear Poly Haven Radiance HDRIs. Night uses a black HDR environment
// and localized submerged pool fixtures only.

export const TIME_PRESETS = {
  day: {
    label:'DAY',
    description:'True HDR daylight from the Resting Place lakeside environment. The real HDR sky provides most ambient/reflection energy; the explicit sun is restrained so tiles, water and caustics keep detail.',
    envIntensity:0.46, envYaw:0.10, exposure:0.70,
    sunColor:'#fff2d8', sunIntensity:0.25, sunElevation:38, sunAzimuth:36,
    waterTint:'#b8e6f6', waterTintStrength:0.025,
    transmit:[0.20,0.46,0.68], absorption:0.42, roughness:0.040,
    causticGain:0.31,
  },
  sunset: {
    label:'SUNSET',
    description:'True HDR sunset from The Sky Is On Fire. The environment carries the warm sky and reflected horizon while a low, softer explicit sun supports shadows and the live atomic caustics.',
    envIntensity:0.58, envYaw:0.00, exposure:0.72,
    sunColor:'#ff7440', sunIntensity:0.18, sunElevation:10, sunAzimuth:38,
    waterTint:'#ff8a72', waterTintStrength:0.15,
    transmit:[0.34,0.40,0.52], absorption:0.43, roughness:0.046,
    causticGain:0.27,
  },
  night: {
    label:'NIGHT',
    description:'Black HDR environment with sun and overhead fill removed. Six localized submerged fixtures provide all visible pool illumination and colored water-volume scattering.',
    envIntensity:0.0, envYaw:0.00, exposure:0.84,
    sunColor:'#000000', sunIntensity:0.0, sunElevation:0, sunAzimuth:0,
    waterTint:'#102f57', waterTintStrength:0.24,
    transmit:[0.08,0.18,0.32], absorption:0.48, roughness:0.050,
    causticGain:0.0,
  },
};

export const POOL_LIGHT_MODES = {
  blue: {
    label:'BLUE', color:'#1687ff', accent:'#6d35ff', intensity:1.52, volumetric:0.88,
    waterTint:'#185fa8', transmit:[0.10,0.38,0.74],
  },
  aqua: {
    label:'AQUA', color:'#22ffd0', accent:'#20ff69', intensity:1.46, volumetric:0.86,
    waterTint:'#169d91', transmit:[0.09,0.56,0.48],
  },
  red: {
    label:'RED', color:'#ff352d', accent:'#ff1aa4', intensity:1.48, volumetric:0.86,
    waterTint:'#a52b40', transmit:[0.50,0.10,0.12],
  },
  rainbow: {
    label:'RAINBOW', color:'#ffffff', accent:'#ffffff', intensity:1.50, volumetric:0.88,
    waterTint:'#34435f', transmit:[0.15,0.24,0.38], rainbow:true,
  },
};

export const TIME_ORDER = ['day','sunset','night'];
export const POOL_LIGHT_ORDER = ['blue','aqua','red','rainbow'];
