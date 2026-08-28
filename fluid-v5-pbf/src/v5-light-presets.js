// Fluid V5 M3.4.3 unified time-of-day + environment-balanced pool moods.
// Day, Sunset and Night use controlled HDR panoramas; Night is lit only by submerged fixtures.

export const TIME_PRESETS = {
  day: {
    label:'DAY',
    description:'Balanced daylight with a softer HDR sky, restrained sun energy, clear blue water and readable white caustics.',
    envIntensity:0.56, envYaw:0.02, exposure:1.02,
    sunColor:'#fff4dc', sunIntensity:0.72, sunElevation:58, sunAzimuth:32,
    waterTint:'#b9e7f7', waterTintStrength:0.055,
    transmit:[0.24,0.55,0.78], absorption:0.36, roughness:0.043,
    causticGain:0.66,
  },
  sunset: {
    label:'SUNSET',
    description:'A true HDR sunset panorama with a low orange sun, pink-violet clouds, darker surroundings and warm reflections moving across the water.',
    envIntensity:0.76, envYaw:0.00, exposure:0.98,
    sunColor:'#ff7a3c', sunIntensity:0.62, sunElevation:8, sunAzimuth:98,
    waterTint:'#ff8a68', waterTintStrength:0.31,
    transmit:[0.38,0.42,0.52], absorption:0.39, roughness:0.050,
    causticGain:0.56,
  },
  night: {
    label:'NIGHT',
    description:'Near-black HDR environment with solar and overhead fill removed. Only the six submerged pool-wall fixtures illuminate the pool.',
    envIntensity:0.22, envYaw:0.00, exposure:0.70,
    sunColor:'#000000', sunIntensity:0.0, sunElevation:0, sunAzimuth:0,
    waterTint:'#102b4b', waterTintStrength:0.24,
    transmit:[0.07,0.12,0.19], absorption:0.56, roughness:0.052,
    causticGain:0.0,
  },
};

export const POOL_LIGHT_MODES = {
  blue: {
    label:'BLUE', color:'#167dff', accent:'#7624ff', intensity:0.88, volumetric:0.46,
    waterTint:'#164b8f', transmit:[0.07,0.18,0.38],
  },
  aqua: {
    label:'AQUA', color:'#22ffd0', accent:'#20ff69', intensity:0.84, volumetric:0.43,
    waterTint:'#167f78', transmit:[0.07,0.31,0.28],
  },
  red: {
    label:'RED', color:'#ff261e', accent:'#ff189e', intensity:0.86, volumetric:0.44,
    waterTint:'#76202d', transmit:[0.30,0.07,0.08],
  },
  rainbow: {
    label:'RAINBOW', color:'#ffffff', accent:'#ffffff', intensity:0.84, volumetric:0.44,
    waterTint:'#343b55', transmit:[0.11,0.15,0.22], rainbow:true,
  },
};

export const TIME_ORDER = ['day','sunset','night'];
export const POOL_LIGHT_ORDER = ['blue','aqua','red','rainbow'];
