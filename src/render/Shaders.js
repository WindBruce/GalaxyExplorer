/**
 * GLSL shader library.
 *
 * Everything celestial is procedural on the GPU: no texture assets are loaded,
 * which keeps the build tiny and lets any planet in a million-system galaxy
 * render without streaming.
 */

/** Shared simplex/value noise + fbm chunk (3D). */
export const NOISE_GLSL = /* glsl */ `
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)),
           dot(p, vec3(269.5, 183.3, 246.1)),
           dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float snoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(dot(hash33(i + vec3(0,0,0)), f - vec3(0,0,0)),
                     dot(hash33(i + vec3(1,0,0)), f - vec3(1,0,0)), u.x),
                 mix(dot(hash33(i + vec3(0,1,0)), f - vec3(0,1,0)),
                     dot(hash33(i + vec3(1,1,0)), f - vec3(1,1,0)), u.x), u.y),
             mix(mix(dot(hash33(i + vec3(0,0,1)), f - vec3(0,0,1)),
                     dot(hash33(i + vec3(1,0,1)), f - vec3(1,0,1)), u.x),
                 mix(dot(hash33(i + vec3(0,1,1)), f - vec3(0,1,1)),
                     dot(hash33(i + vec3(1,1,1)), f - vec3(1,1,1)), u.x), u.y), u.z);
}
float fbm(vec3 p, int octaves, float lacunarity, float gain) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * snoise(p);
    p *= lacunarity;
    amp *= gain;
  }
  return sum;
}
float ridged(vec3 p, int octaves) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    float n = 1.0 - abs(snoise(p));
    sum += amp * n * n;
    p *= 2.03;
    amp *= 0.5;
  }
  return sum;
}
`;

/** Deep-space backdrop: procedural star field + galactic band + nebulae. */
export const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform float uTime;
uniform vec3 uBandColor;
uniform float uSeed;
uniform float uExposure;

${NOISE_GLSL}

// Dense procedural star field from 3D noise peaks.
float starLayer(vec3 dir, float density, float sharpness, float seed) {
  vec3 p = dir * density + seed;
  vec3 i = floor(p);
  vec3 f = fract(p);
  float h = fract(sin(dot(i, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
  if (h < 0.06) {
    vec3 centre = vec3(0.5) + 0.4 * sin(seed + 6.2831 * fract(h * 91.7 + vec3(1.0, 2.0, 3.0)));
    float d = length(f - centre);
    float mag = 0.4 + 0.6 * fract(h * 37.0);
    return mag * pow(max(0.0, 1.0 - d * sharpness), 8.0);
  }
  return 0.0;
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 col = vec3(0.008, 0.010, 0.020);

  // Galactic band: the Milky Way, tilted relative to the galactic plane.
  vec3 bandNormal = normalize(vec3(0.15, 1.0, 0.25));
  float band = exp(-pow(dot(dir, bandNormal) * 2.6, 2.0));
  float bandNoise = fbm(dir * 3.2 + uSeed, 5, 2.1, 0.55) * 0.5 + 0.5;
  float dust = smoothstep(0.35, 0.75, fbm(dir * 6.0 - uSeed, 4, 2.3, 0.5) * 0.5 + 0.5);
  col += uBandColor * band * (0.16 + 0.5 * bandNoise) * (1.0 - 0.55 * dust);

  // Faint nebulae away from the band.
  float neb = smoothstep(0.25, 0.9, fbm(dir * 1.7 + 11.0 + uSeed, 5, 2.0, 0.6) * 0.5 + 0.5);
  col += vec3(0.05, 0.02, 0.09) * neb * (1.0 - band * 0.5);

  // Star field: three layers of density.
  float stars = starLayer(dir, 90.0, 2.2, uSeed)
              + starLayer(dir, 210.0, 2.6, uSeed * 1.7 + 3.0) * 0.7
              + starLayer(dir, 480.0, 3.0, uSeed * 2.3 + 7.0) * 0.45;
  // Slight colour variation.
  vec3 starCol = mix(vec3(0.75, 0.85, 1.0), vec3(1.0, 0.9, 0.75), fract(sin(uSeed + dir.x * 31.0) * 43758.0));
  col += starCol * stars * 1.6;

  // Subtle twinkle.
  float tw = 0.9 + 0.1 * sin(uTime * 2.0 + dir.x * 40.0 + dir.y * 25.0);
  col *= tw;

  gl_FragColor = vec4(col * uExposure, 1.0);
}
`;

/** Planet surface shader: type-driven palette, fbm continents, ice caps, clouds, city lights. */
export const PLANET_VERT = /* glsl */ `
varying vec3 vNormal;
varying vec3 vPos;
varying vec2 vUv;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vPos = position;
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PLANET_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vPos;
varying vec2 vUv;

uniform vec3 uLightDir;      // direction TO the star (view space)
uniform vec3 uLightColor;
uniform vec3 uOcean;
uniform vec3 uShallow;
uniform vec3 uLand;
uniform vec3 uHigh;
uniform vec3 uSand;
uniform vec3 uIce;
uniform float uSeed;
uniform float uTime;
uniform float uWaterLevel;
uniform float uIceCaps;
uniform float uCloudAmount;
uniform float uRoughness;
uniform float uTypeMix;      // 0 = earthlike, 1 = rocky/desert, 2 = ice, 3 = volcanic, 4 = toxic
uniform float uNightLights;
uniform vec3 uAtmoColor;

${NOISE_GLSL}

void main() {
  vec3 p = normalize(vPos);
  float lat = abs(p.y);

  // Continents and terrain.
  float base = fbm(p * 2.2 + uSeed, 6, 2.1, 0.52);
  float detail = fbm(p * 9.0 - uSeed, 5, 2.3, 0.5) * 0.35;
  float h = base + detail * uRoughness;

  // Mountains.
  float mountains = ridged(p * 4.5 + uSeed * 0.5, 5) * 0.35 * smoothstep(0.05, 0.3, h);

  vec3 col;
  float oceanMask = smoothstep(uWaterLevel - 0.01, uWaterLevel + 0.02, h);

  if (uTypeMix < 0.5) {
    // Earthlike.
    col = mix(uShallow, uOcean, smoothstep(uWaterLevel - 0.12, uWaterLevel, h));
    float grass = mix(uLand, uHigh, smoothstep(0.15, 0.55, h));
    col = mix(col, grass, oceanMask);
    col = mix(col, uSand, smoothstep(0.02, 0.10, h) * (1.0 - oceanMask) * smoothstep(0.25, 0.05, h));
    col = mix(col, uHigh, mountains);
  } else if (uTypeMix < 1.5) {
    // Rocky / desert.
    col = mix(uSand, uLand, smoothstep(-0.15, 0.25, h));
    col = mix(col, uHigh, mountains * 1.4);
    col *= 0.85 + 0.3 * fbm(p * 22.0 + uSeed, 4, 2.2, 0.5);
  } else if (uTypeMix < 2.5) {
    // Ice world.
    col = mix(uOcean * 0.7, uIce, smoothstep(-0.2, 0.2, h));
    col = mix(col, vec3(0.85, 0.92, 0.98), smoothstep(0.25, 0.6, h));
  } else if (uTypeMix < 3.5) {
    // Volcanic.
    float lava = smoothstep(0.05, -0.25, h);
    vec3 rock = mix(uLand * 0.4, uHigh * 0.5, smoothstep(-0.1, 0.3, h));
    float glow = smoothstep(0.45, 0.9, fbm(p * 5.0 + uTime * 0.03, 4, 2.2, 0.5) * 0.5 + 0.5);
    col = mix(rock, vec3(1.0, 0.32, 0.06) * (0.6 + 1.4 * glow), lava * 0.85);
  } else {
    // Toxic / exotic.
    col = mix(uLand * 0.8, uHigh, smoothstep(-0.1, 0.3, h));
    col = mix(col, vec3(0.6, 0.9, 0.35), smoothstep(0.3, 0.7, fbm(p * 3.0 + uSeed, 5, 2.0, 0.5) * 0.5 + 0.5) * 0.7);
  }

  // Polar caps.
  float cap = smoothstep(1.0 - uIceCaps, 1.0 - uIceCaps * 0.55, lat);
  float capNoise = fbm(p * 6.0 + 4.0, 4, 2.2, 0.5) * 0.5 + 0.5;
  cap *= smoothstep(0.35, 0.65, capNoise);
  col = mix(col, uIce, cap * (1.0 - oceanMask * 0.0) * (uTypeMix < 1.5 ? 1.0 : 0.8));

  // Clouds (2D banded noise, slowly drifting).
  if (uCloudAmount > 0.001) {
    vec3 cp = p * 2.6;
    float rot = uTime * 0.006;
    mat2 R = mat2(cos(rot), -sin(rot), sin(rot), cos(rot));
    cp.xz = R * cp.xz;
    float cl = fbm(cp * 1.8 + uSeed * 0.3, 6, 2.3, 0.55) * 0.5 + 0.5;
    float cloud = smoothstep(1.0 - uCloudAmount * 0.55, 1.0 - uCloudAmount * 0.35, cl);
    cloud *= smoothstep(0.98, 0.86, lat + 0.05);
    col = mix(col, vec3(0.95, 0.96, 1.0), cloud * 0.85);
  }

  // Lighting: Lambert + wrap term so the terminator is soft and cinematic.
  vec3 n = normalize(vNormal);
  float ndl = dot(n, normalize(uLightDir));
  float wrap = clamp((ndl + 0.25) / 1.25, 0.0, 1.0);
  float diffuse = pow(wrap, 0.85);
  float ambient = 0.045 + 0.02 * (1.0 - lat);

  // Specular on water.
  vec3 viewDir = normalize(-vPos);
  float spec = 0.0;
  if (uTypeMix < 0.5) {
    vec3 h = normalize(normalize(uLightDir) + viewDir);
    spec = pow(max(dot(n, h), 0.0), 42.0) * (1.0 - oceanMask) * 0.5;
  }

  vec3 lit = col * (uLightColor * diffuse + ambient * vec3(0.55, 0.65, 0.9));

  // Night-side city lights for inhabited worlds.
  if (uNightLights > 0.0) {
    float night = smoothstep(0.08, -0.22, ndl);
    float cities = smoothstep(0.55, 0.8, fbm(p * 14.0 + uSeed * 2.0, 5, 2.2, 0.5) * 0.5 + 0.5);
    cities *= (1.0 - oceanMask) * (1.0 - cap);
    lit += vec3(1.0, 0.78, 0.42) * cities * night * uNightLights * 1.4;
  }

  lit += uLightColor * spec;

  // Atmospheric limb glow on the lit edge.
  float fres = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
  lit += uAtmoColor * fres * (0.10 + 0.55 * diffuse);

  gl_FragColor = vec4(lit, 1.0);
}
`;

/** Atmospheric shell (additive rim). */
export const ATMO_VERT = PLANET_VERT;

export const ATMO_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vPos;
uniform vec3 uLightDir;
uniform vec3 uColor;
uniform float uIntensity;
void main() {
  vec3 n = normalize(vNormal);
  vec3 viewDir = normalize(-vPos);
  float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 2.4);
  float ndl = clamp(dot(n, normalize(uLightDir)) * 0.5 + 0.5, 0.0, 1.0);
  float lit = pow(ndl, 1.4);
  gl_FragColor = vec4(uColor, 1.0) * rim * lit * uIntensity;
}
`;

/** Star surface + corona. */
export const STAR_VERT = PLANET_VERT;

export const STAR_FRAG = /* glsl */ `
precision highp float;
varying vec3 vNormal;
varying vec3 vPos;
uniform vec3 uColorHot;
uniform vec3 uColorCool;
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
${NOISE_GLSL}
void main() {
  vec3 p = normalize(vPos);
  float gran = fbm(p * 7.0 + vec3(0.0, uTime * 0.05, 0.0) + uSeed, 5, 2.2, 0.55) * 0.5 + 0.5;
  float cells = fbm(p * 16.0 - uTime * 0.08 + uSeed, 4, 2.4, 0.5) * 0.5 + 0.5;
  float flare = smoothstep(0.62, 0.95, gran * 0.6 + cells * 0.6);
  vec3 col = mix(uColorCool, uColorHot, clamp(gran * 1.2, 0.0, 1.0));
  col += uColorHot * flare * 1.6;
  // Limb brightening for that stellar edge.
  vec3 viewDir = normalize(-vPos);
  float limb = pow(1.0 - max(dot(normalize(vNormal), viewDir), 0.0), 2.0);
  col += uColorHot * limb * 0.8;
  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;

/** Accretion disk / black hole shader. */
export const DISK_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const DISK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
varying vec3 vWorld;
uniform float uTime;
uniform vec3 uInner;
uniform vec3 uOuter;
uniform float uIntensity;
${NOISE_GLSL}
void main() {
  float r = length(vUv - 0.5) * 2.0;
  if (r < 0.32 || r > 1.0) discard;
  // Doppler beaming: one side brighter.
  float angle = atan(vUv.y - 0.5, vUv.x - 0.5);
  float doppler = 0.55 + 0.45 * cos(angle + 1.2);
  float swirl = fbm(vec3(cos(angle) * 3.0, sin(angle) * 3.0, r * 6.0 - uTime * 0.25), 5, 2.2, 0.55) * 0.5 + 0.5;
  float bands = 0.6 + 0.4 * sin(r * 42.0 - uTime * 1.6 + swirl * 5.0);
  float falloff = smoothstep(1.0, 0.34, r) * smoothstep(0.30, 0.45, r);
  vec3 col = mix(uInner, uOuter, smoothstep(0.35, 1.0, r));
  float alpha = falloff * bands * (0.45 + 0.75 * swirl) * doppler;
  gl_FragColor = vec4(col * (0.8 + 1.8 * doppler) * uIntensity, alpha * uIntensity);
}
`;

/** Volumetric-ish nebula billboard. */
export const NEBULA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const NEBULA_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uSeed;
uniform float uTime;
uniform float uIntensity;
${NOISE_GLSL}
void main() {
  vec2 p = vUv - 0.5;
  float d = length(p);
  if (d > 0.5) discard;
  float n = fbm(vec3(p * 4.0, uSeed + uTime * 0.01), 6, 2.2, 0.55) * 0.5 + 0.5;
  float n2 = fbm(vec3(p * 9.0 - 3.0, uSeed * 1.7), 5, 2.4, 0.5) * 0.5 + 0.5;
  float shape = smoothstep(0.5, 0.02, d) * (0.35 + 0.9 * n) * (0.5 + 0.7 * n2);
  vec3 col = mix(uColorA, uColorB, n2);
  gl_FragColor = vec4(col * shape * uIntensity, shape * uIntensity * 0.85);
}
`;

/** Scan pulse ring (expanding, additive). */
export const SCAN_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const SCAN_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uProgress;
uniform float uIntensity;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float ring = smoothstep(0.02, 0.0, abs(r - uProgress));
  float fade = 1.0 - uProgress;
  float grid = 0.5 + 0.5 * sin(atan(vUv.y - 0.5, vUv.x - 0.5) * 24.0);
  float a = ring * fade * (0.55 + 0.45 * grid) * uIntensity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor * a, a);
}
`;

/** Engine glow / thruster plume. */
export const PLUME_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const PLUME_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
void main() {
  vec2 p = vUv - vec2(0.5, 0.0);
  float d = abs(p.x) / max(0.001, (1.0 - vUv.y));
  float core = smoothstep(0.35, 0.0, d) * (1.0 - vUv.y);
  float flicker = 0.8 + 0.2 * sin(uTime * 40.0 + vUv.y * 20.0);
  float a = core * uIntensity * flicker;
  gl_FragColor = vec4(uColor * (1.5 + a), a);
}
`;
