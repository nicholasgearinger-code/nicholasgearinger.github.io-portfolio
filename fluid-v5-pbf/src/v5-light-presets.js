// Fluid V5 M3.4.5 unified time-of-day + supplied panorama environments.
// Day and Sunset use the user-supplied 2:1 panorama maps. Night uses a true black environment
// and is illuminated only by the broad submerged pool flood fixtures.

export const TIME_PRESETS = {
  day: {
    label:'DAY',
    description:'Balanced daylight using the supplied lake panorama. Direct sun is aligned to the visible sun in the environment, with reduced exposure so the pool and tiles keep detail.',
    envIntensity:0.34, envYaw:0.00, exposure:0.80,
    sunColor:'#fff4dc', sunIntensity:0.44, sunElevation:38, sunAzimuth:36,
    waterTint:'#b9e7f7', waterTintStrength:0.035,
    transmit:[0.20,0.47,0.69], absorption:0.40, roughness:0.045,
    causticGain:0.46,
  },
  sunset: {
    label:'SUNSET',
    description:'The supplied coastal sunset panorama drives the environment while a low warm sun, aligned with its bright horizon, produces warm moving reflections across the water.',
    envIntensity:0.50, envYaw:0.00, exposure:0.84,
    sunColor:'#ff7a4a', sunIntensity:0.38, sunElevation:14, sunAzimuth:38,
    waterTint:'#ff8b72', waterTintStrength:0.25,
    transmit:[0.34,0.38,0.49], absorption:0.42, roughness:0.052,
    causticGain:0.44,
  },
  night: {
    label:'NIGHT',
    description:'Pure black environment with all solar and overhead fill removed. Six bright submerged flood fixtures illuminate the tiles and make the water volume itself glow.',
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
