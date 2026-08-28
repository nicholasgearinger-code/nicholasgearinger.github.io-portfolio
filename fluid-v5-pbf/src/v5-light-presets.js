// Fluid V5 M3.4.4 unified time-of-day + bright submerged pool-light moods.
// Day/Sunset keep their HDR balance. Night remains black overhead, while broad submerged fixtures
// provide the pool's visible light and a stronger colored water-volume glow.

export const TIME_PRESETS = {
  day: {
    label:'DAY',
    description:'Balanced daylight with a softer HDR sky, restrained sun energy, clear blue water and readable white caustics.',
    envIntensity:0.44, envYaw:0.02, exposure:0.88,
    sunColor:'#fff4dc', sunIntensity:0.58, sunElevation:58, sunAzimuth:32,
    waterTint:'#b9e7f7', waterTintStrength:0.045,
    transmit:[0.22,0.50,0.72], absorption:0.38, roughness:0.044,
    causticGain:0.52,
  },
  sunset: {
    label:'SUNSET',
    description:'A true HDR sunset panorama with a low orange sun, pink-violet clouds, darker surroundings and warm reflections moving across the water.',
    envIntensity:0.72, envYaw:0.00, exposure:0.92,
    sunColor:'#ff7a3c', sunIntensity:0.58, sunElevation:8, sunAzimuth:98,
    waterTint:'#ff8a68', waterTintStrength:0.29,
    transmit:[0.36,0.40,0.50], absorption:0.40, roughness:0.051,
    causticGain:0.52,
  },
  night: {
    label:'NIGHT',
    description:'Black overhead environment with solar fill removed. Six bright submerged flood fixtures illuminate the tiles and make the water volume itself glow.',
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
