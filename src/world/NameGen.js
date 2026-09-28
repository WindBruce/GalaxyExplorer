/**
 * Procedural naming: star catalog designations, planet designations,
 * civilisation names, species names, region and ruin names.
 *
 * Names are derived from the entity seed, so a system keeps its name forever
 * without storing it.
 */
import { Rng } from '../core/Random.js';

const GREEK = [
  'Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta', 'Iota',
  'Kappa', 'Lambda', 'Mu', 'Nu', 'Xi', 'Omicron', 'Pi', 'Rho', 'Sigma', 'Tau',
  'Upsilon', 'Phi', 'Chi', 'Psi', 'Omega',
];

const CATALOGS = [
  { p: 'HD', min: 1000, max: 899999 },
  { p: 'HIP', min: 100, max: 118000 },
  { p: 'GJ', min: 100, max: 4999 },
  { p: 'KEP', min: 100, max: 9999 },
  { p: 'TOI', min: 100, max: 9999 },
  { p: 'NGC', min: 1000, max: 7999 },
];

const SYL_A = ['ka', 'ze', 'lor', 'tha', 'mir', 'vel', 'sha', 'nor', 'cy', 'dra', 'phe', 'ith', 'ur', 'gal', 'syn', 'quor', 'nyx', 'ael', 'vor', 'tel', 'xen', 'ros', 'lun', 'sol', 'kar', 'eth'];
const SYL_B = ['ra', 'lis', 'don', 'mar', 'tis', 'vor', 'nex', 'qui', 'sha', 'bel', 'tan', 'ruk', 'sen', 'vay', 'dor', 'mis', 'pha', 'lyn', 'zar', 'kol'];
const SYL_C = ['', 'n', 's', 'th', 'x', 'r', 'k', 'm', 'na', 'ss'];

/** Star name, e.g. "KEP 4471" or "Vhara Nex". */
export function starName(seed) {
  const r = new Rng(seed);
  if (r.chance(0.45)) {
    const cat = r.pick(CATALOGS);
    return `${cat.p} ${r.int(cat.min, cat.max)}`;
  }
  return coin(r) + (r.chance(0.4) ? ' ' + word(r, 2) : '');
}

/** Planet designation, e.g. "KEP 4471 b" / "Vhara Nex III". */
export function planetName(starSeed, index) {
  const base = starName(starSeed);
  if (/\d/.test(base)) {
    const letters = 'bcdefghijklmnopqrstuvwxyz';
    return `${base} ${letters[index] ?? 'z'}`;
  }
  const roman = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  return `${base} ${roman[index] ?? 'X' + index}`;
}

function coin(r) {
  const a = r.pick(SYL_A);
  const b = r.pick(SYL_B);
  const c = r.chance(0.5) ? r.pick(SYL_C) : '';
  return cap(a + b + c);
}

function word(r, syllables) {
  let out = '';
  for (let i = 0; i < syllables; i++) out += r.pick(SYL_A) + (r.chance(0.6) ? r.pick(SYL_B) : '');
  return cap(out.replace(/(.)\1+/g, '$1'));
}

function cap(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Civilisation name: 2-3 syllables + optional epithet. */
export function civName(seed) {
  const r = new Rng(seed);
  let name = word(r, r.int(1, 2));
  if (r.chance(0.35)) {
    const ep = ['Dominion', 'Concord', 'Ascendancy', 'Remnant', 'Compact', 'Sphere', 'Assembly', 'Chorus', 'Sovereignty', 'Heirs', 'Enclave', 'Collective'];
    name += ' ' + r.pick(ep);
  }
  return name;
}

/** Species / people name. */
export function speciesName(seed) {
  const r = new Rng(seed);
  let n = word(r, r.int(2, 3));
  if (r.chance(0.4)) n = word(r, 2) + "'" + n;
  return n;
}

/** Ruin / structure site name. */
export function siteName(seed) {
  const r = new Rng(seed);
  const kinds = ['Reliquary', 'Spire', 'Hollow', 'Vault', 'Terrace', 'Cistern', 'Ossuary', 'Array', 'Seat', 'Gate', 'Monolith Field', 'Undercity', 'Causeway', 'Sanctum', 'Bastion'];
  return `${coin(r)} ${r.pick(kinds)}`;
}

/** Anomaly designation. */
export function anomalyName(seed) {
  const r = new Rng(seed);
  const pre = ['The', 'Anomaly', 'Distortion', 'Silence', 'Hollow'];
  return `${r.pick(pre)} ${word(r, 2)}`;
}

export { GREEK };
