/**
 * Deterministic pseudo-random number generation.
 *
 * Every piece of procedural content in Galaxy Explorer (stars, planets,
 * civilizations, ruins, names, quests) is derived from an integer seed so the
 * same seed always produces the same galaxy. This is a hard architectural
 * requirement: it makes the universe shareable, testable and streamable
 * (content can be regenerated on demand instead of being stored).
 */

/** FNV-1a 32-bit string hash -> unsigned int. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Mulberry32: small, fast, good-enough seeded PRNG. */
export function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seeded random helper with a small, expressive API. */
export class Rng {
  constructor(seed) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
    this._fn = mulberry32(this.seed);
  }

  /** Raw float in [0,1). */
  next() {
    return this._fn();
  }

  /** Float in [min,max). */
  float(min = 0, max = 1) {
    return min + this._fn() * (max - min);
  }

  /** Integer in [min,max] inclusive. */
  int(min, max) {
    if (max === undefined) {
      max = min;
      min = 0;
    }
    return Math.floor(this.float(min, max + 1 - 1e-9));
  }

  /** True with probability p. */
  chance(p) {
    return this._fn() < p;
  }

  /** Uniform pick from an array. */
  pick(arr) {
    return arr[this.pickIndex(arr.length)];
  }

  /** Uniform index in [0, n) - same stream position as `pick`, key-friendly. */
  pickIndex(n) {
    return Math.floor(this._fn() * n);
  }

  /**
   * Weighted pick. Accepts [{ item, weight }] or { item: weight }.
   * Falls back to uniform when all weights are zero.
   */
  weighted(entries) {
    let list;
    if (Array.isArray(entries)) {
      list = entries.map((e) => ({ item: e.item, weight: Math.max(0, e.weight ?? 1) }));
    } else {
      list = Object.entries(entries).map(([item, weight]) => ({ item, weight: Math.max(0, weight) }));
    }
    const total = list.reduce((s, e) => s + e.weight, 0);
    if (total <= 0) return this.pick(list).item;
    let roll = this._fn() * total;
    for (const e of list) {
      roll -= e.weight;
      if (roll <= 0) return e.item;
    }
    return list[list.length - 1].item;
  }

  /** In-place Fisher-Yates shuffle (also returns the array). */
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this._fn() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /** Approximately normal distribution. */
  gauss(mean = 0, std = 1) {
    const u = Math.max(1e-9, this._fn());
    const v = this._fn();
    return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /**
   * Derive a child generator that is deterministic given (parent seed, label).
   * Used to give each sub-system its own independent randomness stream.
   */
  fork(label) {
    return new Rng((this.seed ^ hashString(String(label))) >>> 0);
  }
}

/** Convenience: build a seeded Rng from any string/number. */
export function rngFrom(...parts) {
  return new Rng(hashString(parts.join('|')));
}
