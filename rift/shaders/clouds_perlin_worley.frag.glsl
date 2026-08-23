#version 300 es
precision highp float;
precision highp sampler3D;

in vec3 vWorldPosition;
out vec4 fragColor;

uniform sampler3D uBaseNoise;
uniform sampler3D uDetailNoise;
uniform sampler2D uWeather;
uniform sampler2D uMacroGuide;

uniform vec3 uCameraPosition;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform vec3 uCloudHighlight;
uniform vec3 uCloudShadow;
uniform vec3 uCloudAmbient;
uniform vec3 uWindOffset;
uniform vec2 uWeatherOffset;
uniform vec2 uMacroOffset;

uniform float uCloudBase;
uniform float uCloudTop;
uniform float uCoverage;
uniform float uDensity;
uniform float uHumidity;
uniform float uConvection;
uniform float uErosion;
uniform float uStorm;
uniform float uMacroStrength;
uniform float uBaseScale;
uniform float uDetailScale;
uniform float uWeatherScale;
uniform float uMacroScale;
uniform float uMaxDistance;
uniform float uExtinction;
uniform float uLightExtinction;
uniform float uMultipleScatter;
uniform int uViewSteps;
uniform int uLightSteps;

const int MAX_VIEW_STEPS = 32;
const int MAX_LIGHT_STEPS = 6;

float saturate(float x) { return clamp(x, 0.0, 1.0); }

float hg(float mu, float g) {
  float g2 = g * g;
  return (1.0 - g2) / max(0.001, pow(1.0 + g2 - 2.0 * g * mu, 1.5));
}

float dualPhase(float mu) {
  return 0.10 + 0.33 * (0.80 * hg(mu, 0.65) + 0.20 * hg(mu, -0.20));
}

float macroField(vec3 p) {
  vec2 weatherUV = fract(p.xz * uWeatherScale + uWeatherOffset);
  vec4 weather = texture(uWeather, weatherUV);
  vec2 guideUV = fract(p.xz * uMacroScale + uMacroOffset);
  vec4 guide = texture(uMacroGuide, guideUV);
  float guideLum = dot(guide.rgb, vec3(0.299, 0.587, 0.114)) * guide.a;
  return mix(weather.r, guideLum, uMacroStrength);
}

float verticalProfile(vec3 p, vec4 weather) {
  float h = saturate((p.y - uCloudBase) / max(1.0, uCloudTop - uCloudBase));
  float conv = mix(0.30, 1.18, weather.g) * uConvection;

  float cumBase = smoothstep(0.010, 0.070, h);
  float cumTopStart = mix(0.56, 0.86, conv);
  float cumTop = 1.0 - smoothstep(cumTopStart, 0.995, h);
  float cumulus = cumBase * cumTop;

  float strBase = smoothstep(0.006, 0.038, h);
  float strTop = 1.0 - smoothstep(0.38, 0.67, h);
  float stratus = strBase * strTop;

  float stormBase = smoothstep(0.004, 0.032, h);
  float stormTop = 1.0 - smoothstep(0.88, 0.999, h);
  float tower = stormBase * stormTop;

  float stratiformWeight = clamp(uCoverage * (1.0 - uConvection * 0.62) * 0.62, 0.0, 0.55);
  return mix(mix(cumulus, stratus, stratiformWeight), tower, uStorm * 0.90);
}

float sampleDensity(vec3 p, bool detail) {
  vec2 wuv = fract(p.xz * uWeatherScale + uWeatherOffset);
  vec4 weather = texture(uWeather, wuv);
  float field = macroField(p);
  float threshold = 1.0 - uCoverage;
  float coverage = smoothstep(threshold - 0.14, threshold + 0.16, field);

  vec3 baseUV = fract(p * uBaseScale + uWindOffset);
  vec4 base = texture(uBaseNoise, baseUV);
  float worleyFBM = dot(base.gba, vec3(0.625, 0.25, 0.125));
  float densityThreshold = mix(0.60, 0.33, uDensity);
  float mass = smoothstep(
    densityThreshold,
    densityThreshold + 0.24,
    base.r * 0.82 + worleyFBM * 0.18
  );

  if (detail) {
    vec3 detailUV = fract(p * uDetailScale + uWindOffset * 1.73 + vec3(0.17, 0.31, 0.09));
    vec4 dn = texture(uDetailNoise, detailUV);
    float detailFBM = dot(dn.rgb, vec3(0.625, 0.25, 0.125));
    float edgeBand = (1.0 - mass) * mass * 4.0;
    mass = saturate(mass - (1.0 - detailFBM) * uErosion * edgeBand);
  }

  float moisture = mix(0.76, 1.20, uHumidity * weather.b);
  return mass * coverage * verticalProfile(p, weather) * moisture * uDensity;
}

float lightVisibility(vec3 p) {
  float opticalDepth = 0.0;
  for (int i = 0; i < MAX_LIGHT_STEPS; ++i) {
    if (i >= uLightSteps) break;
    float d = 12.0 * float(i + 1);
    opticalDepth += sampleDensity(p + uSunDirection * d, false);
  }
  return exp(-opticalDepth * uLightExtinction);
}

void main() {
  vec3 ro = uCameraPosition;
  vec3 rd = normalize(vWorldPosition - ro);
  float safeY = max(abs(rd.y), 0.001);

  float t0 = (uCloudBase - ro.y) / rd.y;
  float t1 = (uCloudTop - ro.y) / rd.y;
  float tNear = min(t0, t1);
  float tFar = max(t0, t1);
  float tStart = max(tNear, 0.0);
  float tEnd = min(tFar, tStart + uMaxDistance);
  float lengthRay = max(0.0, tEnd - tStart);
  float stepSize = lengthRay / max(1.0, float(uViewSteps));

  vec2 jitterUV = fract(vWorldPosition.xz * 0.0137 + uWeatherOffset * 2.37);
  float jitter = 0.06 + texture(uWeather, jitterUV).g * 0.88;
  float t = tStart + stepSize * jitter;
  float transmittance = 1.0;
  vec3 scattered = vec3(0.0);
  float phase = dualPhase(clamp(dot(rd, uSunDirection), -1.0, 1.0));

  for (int i = 0; i < MAX_VIEW_STEPS; ++i) {
    if (i >= uViewSteps || t > tEnd || transmittance < 0.01) break;
    vec3 p = ro + rd * t;
    float density = sampleDensity(p, true);

    if (density > 0.0005) {
      float h = saturate((p.y - uCloudBase) / max(1.0, uCloudTop - uCloudBase));
      float visibility = lightVisibility(p);
      float powder = 1.0 - exp(-density * 2.45);
      float multiple = uMultipleScatter + visibility * (1.0 - uMultipleScatter);
      float heightLight = smoothstep(0.05, 0.72, h);

      vec3 highlight = mix(uSunColor, uCloudHighlight, 0.46);
      vec3 ambient = mix(uAmbientColor, uCloudAmbient, 0.40);
      vec3 shadow = mix(uAmbientColor * 0.72, uCloudShadow, 0.50);
      vec3 interior = mix(shadow, ambient, heightLight * 0.70 + powder * 0.18);
      vec3 direct = highlight * phase * multiple * (0.74 + heightLight * 0.40);
      vec3 sampleLight = mix(interior + direct, shadow * 0.82, uStorm * 0.58);

      float alpha = 1.0 - exp(-density * stepSize * uExtinction);
      scattered += sampleLight * alpha * transmittance;
      transmittance *= 1.0 - alpha;
    }

    t += stepSize;
  }

  float horizonFade = smoothstep(0.012, 0.072, abs(rd.y));
  float alpha = (1.0 - transmittance) * horizonFade;
  fragColor = vec4(scattered, alpha);
}
