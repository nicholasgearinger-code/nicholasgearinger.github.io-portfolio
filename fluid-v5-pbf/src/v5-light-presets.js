// Fluid V5 M3.4.6 unified time-of-day + linearized supplied panorama environments.
// Day and Sunset use the user-supplied 2:1 panorama maps converted to linear Radiance HDR at runtime.
// Night uses a true black environment and smooth submerged pool flood lighting.

export const TIME_PRESETS = {
  day: {
    label:'DAY',
    description:'Balanced daylight using the supplied lake panorama converted into a linear HDR environment. Direct sun is aligned to the visible sun while exposure is kept low enough to preserve tile and water detail.',
    envIntensity:0.72, envYaw:0.00, exposure:0.92,
    sunColor:'#fff4dc', sunIntensity:0.52, sunElevation:38, sunAzimuth:36,
    waterTint:'#b9e7f7', waterTintStrength:0.04,
    transmit:[0.22,0.50,0.72], absorption:0.38, roughness:0.045,
    causticGain:0.48,
  },
  sunset: {
    label:'SUNSET',
    description:'The supplied coastal sunset panorama is converted into a linear HDR environment. A low warm direct sun reinforces the bright horizon and produces warm moving reflections without washing out the pool.',
    envIntensity:0.68, envYaw:0.00, exposure:0.92,
    sunColor:'#ff7a4a', sunIntensity:0.42, sunElevation:14, sunAzimuth:38,
    waterTint:'#ff8b72', waterTintStrength:0.24,
    transmit:[0.38,0.42,0.54], absorption:0.40, roughness:0.052,
    causticGain:0.44,
  },
  night: {
    label:'NIGHT',
    description:'Pure black HDR environment with all solar and overhead fill removed. Six submerged flood fixtures blend smoothly through the water rather than painting discrete color bands on the pool walls.',
    envIntensity:0.0, envYaw:0.00, exposure:0.82,
    sunColor:'#000000', sunIntensity:0.0, sunElevation:0, sunAzimuth:0,
    waterTint:'#123a68', waterTintStrength:0.34,
    transmit:[0.10,0.20,0.34], absorption:0.46, roughness:0.050,
    causticGain:0.0,
  },
};

export const POOL_LIGHT_MODES = {
  blue: {
    label:'BLUE', color:'#1687ff', accent:'#6d35ff', intensity:1.46, volumetric:0.82,
    waterTint:'#185fa8', transmit:[0.10,0.36,0.70],
  },
  aqua: {
    label:'AQUA', color:'#22ffd0', accent:'#20ff69', intensity:1.38, volumetric:0.78,
    waterTint:'#169d91', transmit:[0.09,0.54,0.46],
  },
  red: {
    label:'RED', color:'#ff352d', accent:'#ff1aa4', intensity:1.42, volumetric:0.80,
    waterTint:'#a52b40', transmit:[0.48,0.10,0.12],
  },
  rainbow: {
    label:'RAINBOW', color:'#ffffff', accent:'#ffffff', intensity:1.44, volumetric:0.82,
    waterTint:'#435174', transmit:[0.17,0.25,0.37], rainbow:true,
  },
};

export const TIME_ORDER = ['day','sunset','night'];
export const POOL_LIGHT_ORDER = ['blue','aqua','red','rainbow'];
