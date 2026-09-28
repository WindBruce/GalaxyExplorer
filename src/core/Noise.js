/**
 * CPU noise utilities (used for terrain generation and gameplay rolls).
 * Deterministic and seed-derived, matching the GPU noise in Shaders.js.
 */

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Value noise in [0,1]. */
export function valueNoise2D(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

/** Fractal brownian motion over value noise, roughly in [0,1]. */
export function fbm2D(x, y, octaves = 5, seed = 0, lacunarity = 2.0, gain = 0.5) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(fx, fy, seed + i * 977);
    norm += amp;
    fx *= lacunarity;
    fy *= lacunarity;
    amp *= gain;
  }
  return sum / norm;
}

/** Ridged noise for mountain ranges, in [0,1]. */
export function ridged2D(x, y, octaves = 4, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = x;
  let fy = y;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise2D(fx, fy, seed + i * 613) * 2 - 1);
    sum += amp * n * n;
    norm += amp;
    fx *= 2.07;
    fy *= 2.07;
    amp *= 0.5;
  }
  return sum / norm;
}

/** Deterministic pseudo-random in [0,1) from an integer. */
export function hash1(n) {
  let h = Math.imul(n | 0, 2654435761);
  h = Math.imul(h ^ (h >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
