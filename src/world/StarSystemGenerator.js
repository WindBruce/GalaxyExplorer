/**
 * Star system generation: star class -> planets -> environment -> resources ->
 * life -> ruins -> stations -> anomalies.
 *
 * Everything is derived from a single integer seed, so any system in the
 * galaxy can be regenerated on demand. Generation is split into a cheap
 * "index" pass (used by the galactic map and quest resolution) and a full
 * detail pass (used when the player actually arrives).
 */
import { Rng } from '../core/Random.js';
import { planetName, starName, siteName, anomalyName } from './NameGen.js';

/** Gameplay scale constants. Real units are kept for stats; rendering uses these. */
export const SCALE = {
  unitsPerAu: 100, // 1 AU = 100 world units
  kmPerUnit: 200, // planetary bodies are exaggerated for playability
  unitsPerKpc: 1, // galactic map uses kiloparsecs directly
};

/** Stellar classes and the gameplay each one implies. */
export const STAR_CLASSES = {
  redDwarf: {
    id: 'redDwarf',
    label: 'Red Dwarf',
    spectral: 'M',
    tempRange: [2400, 3700],
    color: '#ff7b54',
    massRange: [0.08, 0.45],
    radiusUnits: [26, 44],
    luminosity: [0.001, 0.06],
    planetsRange: [3, 7],
    lifetime: 'Trillions of years - effectively immortal',
    hazard: 0.25,
    desc: 'A small, patient star that will outlive everything it made.',
    gameplay: {
      tidallyLockedBias: 0.55,
      radiation: 0.5,
      lifeBias: 0.8,
      resourceBias: ['iron', 'nickel', 'silicon'],
      ancientLife: true,
      notes: 'Tidally locked worlds, violent flares, and the best odds in the galaxy of finding ancient life.',
    },
  },
  yellow: {
    id: 'yellow',
    label: 'Yellow Dwarf',
    spectral: 'G',
    tempRange: [5200, 6000],
    color: '#ffd97d',
    massRange: [0.8, 1.1],
    radiusUnits: [55, 70],
    luminosity: [0.7, 1.4],
    planetsRange: [3, 8],
    lifetime: 'About ten billion years',
    hazard: 0.1,
    desc: 'The familiar case: a stable star with room for living worlds.',
    gameplay: {
      tidallyLockedBias: 0.05,
      radiation: 0.1,
      lifeBias: 1.5,
      resourceBias: ['carbon', 'oxygen', 'silicon', 'iron'],
      ancientLife: false,
      notes: 'Habitable zones are wide and long-lived. Civilisations cluster here.',
    },
  },
  blueGiant: {
    id: 'blueGiant',
    label: 'Blue Giant',
    spectral: 'O/B',
    tempRange: [15000, 30000],
    color: '#9bb0ff',
    massRange: [8, 40],
    radiusUnits: [110, 260],
    luminosity: [10000, 200000],
    planetsRange: [1, 4],
    lifetime: 'A few million years - a rounding error',
    hazard: 0.85,
    desc: 'A blowtorch that will not last. Nothing evolves here; things arrive.',
    gameplay: {
      tidallyLockedBias: 0.1,
      radiation: 0.95,
      lifeBias: 0.1,
      resourceBias: ['energyDense', 'antimatter', 'rareMetals'],
      ancientLife: false,
      notes: 'Extreme radiation, rare high-energy resources, and an extremely short window for anything to get started.',
    },
  },
  binary: {
    id: 'binary',
    label: 'Binary System',
    spectral: 'A/M',
    tempRange: [4000, 9000],
    color: '#ffe0b3',
    massRange: [0.6, 2.2],
    radiusUnits: [40, 90],
    luminosity: [1.0, 8.0],
    planetsRange: [2, 7],
    lifetime: 'Long, complicated, and occasionally violent',
    hazard: 0.3,
    desc: 'Two stars in a slow dance, and worlds that learned unusual steps.',
    gameplay: {
      tidallyLockedBias: 0.2,
      radiation: 0.25,
      lifeBias: 1.1,
      resourceBias: ['quantumCrystal', 'superconductor', 'iron'],
      ancientLife: true,
      notes: 'Unusual orbital mechanics, exotic environments, and civilisations with two shadows.',
    },
  },
  blackHole: {
    id: 'blackHole',
    label: 'Black Hole System',
    spectral: 'X',
    tempRange: [0, 0],
    color: '#1a1a2e',
    massRange: [3, 40],
    radiusUnits: [14, 30],
    luminosity: [0, 0.02],
    planetsRange: [0, 4],
    lifetime: 'Longer than the universe has so far managed',
    hazard: 1.0,
    desc: 'Absolute dark wrapped in a ring of screaming light.',
    gameplay: {
      tidallyLockedBias: 0.6,
      radiation: 0.9,
      lifeBias: 0.15,
      resourceBias: ['exoticMatter', 'antimatter', 'quantumCrystal'],
      ancientLife: false,
      notes: 'Extreme gravity, relativistic effects, spatial anomalies, and structures that should not be here.',
    },
  },
  neutron: {
    id: 'neutron',
    label: 'Neutron Star / Pulsar',
    spectral: 'P',
    tempRange: [600000, 900000],
    color: '#d0f4ff',
    massRange: [1.2, 2.1],
    radiusUnits: [8, 16],
    luminosity: [0.05, 0.4],
    planetsRange: [0, 3],
    lifetime: 'Ancient and implacable',
    hazard: 0.9,
    desc: 'A city-sized atomic nucleus spinning hundreds of times a second.',
    gameplay: {
      tidallyLockedBias: 0.8,
      radiation: 0.95,
      lifeBias: 0.05,
      resourceBias: ['superconductor', 'rareMetals', 'exoticMatter'],
      ancientLife: false,
      notes: 'Pulsar beams sweep the system like a lighthouse. Magnetar flares strip atmospheres.',
    },
  },
  whiteDwarf: {
    id: 'whiteDwarf',
    label: 'White Dwarf',
    spectral: 'D',
    tempRange: [8000, 40000],
    color: '#eef4ff',
    massRange: [0.5, 1.2],
    radiusUnits: [10, 18],
    luminosity: [0.0005, 0.05],
    planetsRange: [1, 5],
    lifetime: 'Cools for longer than the current age of the universe',
    hazard: 0.5,
    desc: 'The exposed core of a dead star, still hot, still holding court over its frozen planets.',
    gameplay: {
      tidallyLockedBias: 0.3,
      radiation: 0.45,
      lifeBias: 0.4,
      resourceBias: ['rareMetals', 'superconductor', 'iron'],
      ancientLife: true,
      notes: 'Heavy-element pollution in the photosphere: the corpse has been eating its planets for billions of years.',
    },
  },
};

export const PLANET_TYPES = {
  terrestrial: { label: 'Terrestrial', landable: true, lifeBias: 1.3, hazard: 0.15, color: '#6b8f71' },
  ocean: { label: 'Ocean World', landable: true, lifeBias: 1.6, hazard: 0.2, color: '#2e6f95' },
  desert: { label: 'Desert World', landable: true, lifeBias: 0.5, hazard: 0.3, color: '#c19a6b' },
  ice: { label: 'Ice World', landable: true, lifeBias: 0.35, hazard: 0.35, color: '#cfe8ef' },
  volcanic: { label: 'Volcanic World', landable: true, lifeBias: 0.2, hazard: 0.65, color: '#7f4f3a' },
  toxic: { label: 'Toxic World', landable: true, lifeBias: 0.3, hazard: 0.7, color: '#8f9e6b' },
  barren: { label: 'Barren Rock', landable: true, lifeBias: 0.02, hazard: 0.2, color: '#8a8a8a' },
  molten: { label: 'Molten World', landable: false, lifeBias: 0.0, hazard: 0.85, color: '#e05252' },
  tidallyLocked: { label: 'Tidally Locked World', landable: true, lifeBias: 0.9, hazard: 0.35, color: '#a98c6b' },
  gasGiant: { label: 'Gas Giant', landable: false, lifeBias: 0.2, hazard: 0.3, color: '#d8b28c' },
  exotic: { label: 'Exotic World', landable: true, lifeBias: 0.1, hazard: 0.8, color: '#b07fe0' },
};

const ATMOSPHERES = [
  { name: 'Nitrogen-Oxygen', breathable: true, color: '#9ecbff' },
  { name: 'Carbon Dioxide', breathable: false, color: '#e8c39e' },
  { name: 'Methane-Ammonia', breathable: false, color: '#c8e6a0' },
  { name: 'Sulphur Dioxide', breathable: false, color: '#e0d68a' },
  { name: 'Hydrogen-Helium', breathable: false, color: '#d8f0ff' },
  { name: 'Thin Argon', breathable: false, color: '#cfd8dc' },
  { name: 'Exotic Halides', breathable: false, color: '#e0a8d8' },
];

/**
 * Generate the full contents of a star system.
 * @param {number} seed
 * @param {{regionId:string, starClass:string, index:number}} opts
 */
export function generateSystem(seed, opts = {}) {
  const rng = new Rng(seed);
  const regionId = opts.regionId ?? 'orionSpur';
  const starClassId = opts.starClass ?? rng.weighted(STAR_CLASS_WEIGHTS);
  const starClass = STAR_CLASSES[starClassId] ?? STAR_CLASSES.yellow;

  const star = generateStar(rng, starClass, seed);
  const planetCount = rng.int(starClass.gameplay ? starClass.planetsRange[0] : 2, starClass.planetsRange[1]);
  const planets = [];
  let au = rng.float(0.25, 0.7);

  for (let i = 0; i < planetCount; i++) {
    const planet = generatePlanet(rng, star, starClass, regionId, seed, i, au);
    planets.push(planet);
    au *= rng.float(1.35, 2.1);
    if (au > 60) break;
  }

  const system = {
    id: opts.id ?? `sys_${seed >>> 0}`,
    seed,
    regionId,
    name: opts.name ?? starName(seed),
    star,
    planets,
    stations: [],
    ruins: [],
    anomalies: [],
    comets: [],
    civId: null,
    danger: starClass.hazard,
    summary: '',
  };

  // Stations: more likely where civilisations live.
  if (rng.chance(0.22)) system.stations.push(generateStation(rng, system));
  // Ruins: scaled by region and stellar age.
  const ruinChance = 0.18 + starClass.gameplay.ancientLife ? 0.12 : 0;
  if (rng.chance(ruinChance)) {
    const siteCount = rng.int(1, 3);
    for (let i = 0; i < siteCount; i++) system.ruins.push(generateRuin(rng, system, i));
  }
  if (rng.chance(0.16)) {
    system.anomalies.push({
      id: `${system.id}_anom0`,
      name: anomalyName(seed ^ 0x5f5f),
      seed,
      hazard: rng.float(0.4, 1),
      scanned: false,
      kind: rng.pick(['gravimetric', 'temporal', 'quantum', 'unknown']),
      resources: rng.chance(0.5) ? ['exoticMatter', 'anomalousMatter'] : ['unknownEnergy'],
    });
  }
  if (rng.chance(0.1)) {
    system.comets.push({
      id: `${system.id}_comet0`,
      name: `${system.name} Comet ${rng.int(10, 99)}`,
      resources: ['hydrogen', 'carbon', 'oxygen'],
      scanned: false,
    });
  }

  system.summary = summarizeSystem(system);
  return system;
}

const STAR_CLASS_WEIGHTS = {
  redDwarf: 0.34,
  yellow: 0.2,
  binary: 0.14,
  blueGiant: 0.05,
  whiteDwarf: 0.11,
  neutron: 0.06,
  blackHole: 0.04,
};

function generateStar(rng, starClass, seed) {
  const mass = rng.float(starClass.massRange[0], starClass.massRange[1]);
  const temp = starClass.tempRange[1] > 0 ? rng.int(starClass.tempRange[0], starClass.tempRange[1]) : 0;
  const isPulsar = starClass.id === 'neutron' && rng.chance(0.5);
  const companion = starClass.id === 'binary' ? {
    classId: rng.weighted({ redDwarf: 0.5, yellow: 0.3, whiteDwarf: 0.2 }),
    separationAu: rng.float(3, 40),
  } : null;
  return {
    classId: starClass.id,
    classLabel: starClass.label,
    spectral: starClass.spectral,
    name: starName(seed),
    color: starClass.color,
    temp,
    mass,
    radiusUnits: rng.float(starClass.radiusUnits[0], starClass.radiusUnits[1]),
    luminosity: starClass.id === 'blackHole' ? 0 : rng.float(starClass.luminosity[0], starClass.luminosity[1]),
    isPulsar,
    companion,
    ageGyr: starClass.id === 'blueGiant' ? rng.float(0.005, 0.05) : rng.float(0.5, 12),
  };
}

function generatePlanet(rng, star, starClass, regionId, systemSeed, index, au) {
  const seed = (systemSeed ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  const prng = new Rng(seed);
  const radiusKm = prng.float(1800, 14000) * (prng.chance(0.12) ? 4 : 1); // occasional super-earth
  const isGasGiant = au > (star.classId === 'blueGiant' ? 8 : 4) && prng.chance(0.45);

  // Equilibrium temperature from stellar luminosity and distance.
  const lum = Math.max(1e-4, star.luminosity);
  let tempK = 278 * Math.pow(lum, 0.25) / Math.sqrt(au) * (star.classId === 'blackHole' ? 0.25 : 1);
  tempK = Math.max(3, Math.min(2200, tempK * prng.float(0.7, 1.4)));

  let type;
  if (isGasGiant) type = 'gasGiant';
  else if (tempK > 900) type = 'molten';
  else if (tempK > 620) type = 'volcanic';
  else if (tempK < 90) type = 'ice';
  else if (tempK > 430) type = prng.chance(0.5) ? 'desert' : 'barren';
  else if (tempK < 200) type = prng.chance(0.5) ? 'ice' : 'barren';
  else if (tempK > 300) type = 'toxic';
  else if (prng.chance(0.25)) type = 'ocean';
  else type = 'terrestrial';

  const tidallyLocked = prng.chance(starClass.gameplay.tidallyLockedBias) && !isGasGiant && au < 1.2;
  if (tidallyLocked) type = 'tidallyLocked';

  const exotic = prng.chance(0.02);
  if (exotic) type = 'exotic';

  const gravity = (radiusKm / 6371) * (isGasGiant ? 2.4 : 1) * prng.float(0.7, 1.3);
  const atmo = pickAtmosphere(prng, type, tempK);
  const hasLife = !isGasGiant && type !== 'molten' && type !== 'barren' &&
    prng.chance(Math.min(0.85, 0.35 * starClass.gameplay.lifeBias * (PLANET_TYPES[type]?.lifeBias ?? 1)) * (tempK > 240 && tempK < 330 ? 2 : 0.6));

  const resources = rollResources(prng, regionId, type, starClass);
  const moons = [];
  const moonCount = isGasGiant ? prng.int(1, 5) : prng.int(0, 2);
  for (let m = 0; m < moonCount; m++) {
    moons.push({
      id: `${systemSeed}_p${index}_m${m}`,
      name: `${planetName(systemSeed, index)} ${['I', 'II', 'III', 'IV'][m] ?? m + 1}`,
      radiusKm: prng.float(200, 2600),
      gravity: prng.float(0.05, 0.4),
      resources: rollResources(prng, regionId, prng.chance(0.3) ? 'ice' : 'barren', starClass, 2),
      tidallyLocked: true,
    });
  }

  const planet = {
    id: `p_${seed}`,
    systemId: `sys_${systemSeed}`,
    name: planetName(systemSeed, index),
    index,
    seed,
    type,
    typeLabel: PLANET_TYPES[type]?.label ?? 'World',
    orbitAu: au,
    radiusKm,
    gravity,
    tempK,
    atmosphere: atmo,
    breathable: atmo.breathable && hasLife,
    tidallyLocked,
    ring: !isGasGiant ? false : prng.chance(0.4),
    dayLengthHours: tidallyLocked ? Infinity : prng.float(8, 90),
    life: hasLife,
    lifeNotes: hasLife ? describeLife(prng, type) : null,
    resources,
    moons,
    hazard: Math.min(1, (PLANET_TYPES[type]?.hazard ?? 0.3) + starClass.gameplay.radiation * 0.5 + (atmo.breathable ? 0 : 0.1)),
    landable: PLANET_TYPES[type]?.landable ?? true,
    ruinSiteIds: [],
    scanned: false,
    discovered: false,
    surfaceNodes: hasLife || type !== 'barren' ? prng.int(3, 9) : prng.int(1, 4),
    description: '',
  };
  planet.description = describePlanet(planet, star);
  return planet;
}

function pickAtmosphere(rng, type, tempK) {
  if (type === 'gasGiant') return { name: 'Hydrogen-Helium', breathable: false, pressure: rng.float(40, 400), color: '#d8f0ff' };
  if (type === 'molten' || type === 'barren') return { name: 'None (trace)', breathable: false, pressure: rng.float(0, 0.01), color: '#cfd8dc' };
  if (type === 'ice' && tempK < 60) return { name: 'Thin Methane', breathable: false, pressure: rng.float(0.05, 0.4), color: '#c8e6a0' };
  const pool = type === 'ocean' || type === 'terrestrial'
    ? ['Nitrogen-Oxygen', 'Carbon Dioxide', 'Thin Argon', 'Methane-Ammonia']
    : type === 'toxic' || type === 'volcanic'
      ? ['Sulphur Dioxide', 'Carbon Dioxide', 'Exotic Halides']
      : ['Carbon Dioxide', 'Thin Argon', 'Methane-Ammonia', 'Sulphur Dioxide'];
  const name = rng.pick(pool);
  const tpl = ATMOSPHERES.find((a) => a.name === name) ?? ATMOSPHERES[1];
  return { name, breathable: tpl.breathable, pressure: rng.float(0.3, 2.2), color: tpl.color };
}

function rollResources(rng, regionId, type, starClass, max = 4) {
  const region = REGION_RESOURCE_HINTS[regionId] ?? ['iron', 'nickel', 'silicon'];
  const pool = new Set([...region, ...starClass.gameplay.resourceBias, 'iron', 'nickel', 'silicon', 'carbon']);
  const typePool = TYPE_RESOURCES[type] ?? [];
  const out = [];
  const count = rng.int(1, Math.max(1, max));
  for (let i = 0; i < count; i++) {
    const id = rng.chance(0.45) ? rng.pick(typePool.length ? typePool : [...pool]) : rng.pick([...pool]);
    out.push({ id, quantity: rng.int(20, 400) });
  }
  // Merge duplicates.
  const merged = new Map();
  for (const r of out) merged.set(r.id, (merged.get(r.id) ?? 0) + r.quantity);
  return [...merged].map(([id, quantity]) => ({ id, quantity }));
}

const REGION_RESOURCE_HINTS = {
  core: ['energyDense', 'antimatter', 'rareMetals'],
  bulge: ['rareMetals', 'ancientAlloy', 'iron'],
  innerDisk: ['iron', 'nickel', 'silicon', 'rareMetals'],
  orionSpur: ['iron', 'carbon', 'oxygen', 'silicon'],
  perseusArm: ['quantumCrystal', 'superconductor', 'exoticMatter'],
  outerDisk: ['hydrogen', 'superconductor'],
  galacticEdge: ['antimatter', 'exoticMatter', 'quantumCrystal'],
  interstellar: ['hydrogen', 'iron'],
  unknownRegions: ['anomalousMatter', 'unknownEnergy', 'exoticMatter'],
};

const TYPE_RESOURCES = {
  terrestrial: ['iron', 'carbon', 'oxygen', 'silicon', 'rareMetals'],
  ocean: ['carbon', 'oxygen', 'hydrogen', 'alienBiomass'],
  desert: ['silicon', 'iron', 'rareMetals'],
  ice: ['hydrogen', 'oxygen', 'nickel', 'superconductor'],
  volcanic: ['iron', 'nickel', 'energyDense', 'rareMetals'],
  toxic: ['carbon', 'silicon', 'rareMetals'],
  barren: ['iron', 'nickel', 'silicon'],
  molten: ['iron', 'energyDense'],
  tidallyLocked: ['iron', 'silicon', 'oxygen', 'alienBiomass'],
  gasGiant: ['hydrogen', 'quantumCrystal', 'energyDense', 'antimatter'],
  exotic: ['exoticMatter', 'quantumCrystal', 'anomalousMatter'],
};

function generateStation(rng, system) {
  const kinds = ['Research Outpost', 'Refuelling Depot', 'Trading Post', 'Military Listen Post', 'Derelict', 'Observation Platform'];
  const kind = rng.pick(kinds);
  const isDerelict = kind === 'Derelict' || rng.chance(0.15);
  return {
    id: `${system.id}_st0`,
    name: `${rng.chance(0.5) ? system.name + ' ' : ''}${kind}`,
    kind,
    derelict: isDerelict,
    orbitAu: rng.float(0.4, 6),
    owner: isDerelict ? null : rng.pick(['terranConcord', 'vherrathi', 'kelthari', 'ashenRemnant']),
    scanned: false,
    resources: rng.chance(0.6) ? [{ id: rng.pick(['iron', 'hydrogen', 'superconductor', 'quantumCrystal']), quantity: rng.int(30, 200) }] : [],
  };
}

function generateRuin(rng, system, index) {
  const civTags = ['aelthera', 'synthari', 'korrathi', 'veshari', 'unknown', 'shepherd'];
  const civTag = rng.weighted([
    { item: 'aelthera', weight: 0.2 },
    { item: 'synthari', weight: 0.24 },
    { item: 'korrathi', weight: 0.18 },
    { item: 'veshari', weight: 0.16 },
    { item: 'unknown', weight: 0.14 },
    { item: 'shepherd', weight: 0.08 },
  ]);
  const eraMap = { aelthera: 'eraFirstLight', synthari: 'eraNetworks', korrathi: 'eraConflict', veshari: 'eraVanishing', unknown: 'eraVanishing', shepherd: 'eraVanishing' };
  const size = rng.weighted([
    { item: 'outpost', weight: 0.4 },
    { item: 'city', weight: 0.4 },
    { item: 'megastructure', weight: 0.2 },
  ]);
  const planet = rng.pick(system.planets.filter((p) => p.landable) ?? []) ?? system.planets[0];
  const site = {
    id: `${system.id}_ruin${index}`,
    name: siteName(system.seed ^ Math.imul(index + 7, 0x85ebca6b)),
    civTag,
    era: eraMap[civTag],
    size,
    seed: (system.seed ^ Math.imul(index + 3, 0x27d4eb2d)) >>> 0,
    planetId: planet?.id ?? null,
    planetIndex: planet?.index ?? 0,
    ageGyr: rng.float(1.2, 9.6),
    scanned: false,
    discovered: false,
    looted: false,
    hazard: rng.float(0.1, 0.7),
    artifactCount: size === 'outpost' ? rng.int(1, 2) : size === 'city' ? rng.int(2, 4) : rng.int(3, 6),
    depth: rng.chance(0.5),
    description: describeRuin(rng, civTag, size),
  };
  if (planet) planet.ruinSiteIds.push(site.id);
  return site;
}

function describeRuin(rng, civTag, size) {
  const civNames = { aelthera: "Ael'thera", synthari: 'Synthari', korrathi: 'Korrathi', veshari: 'Veshari', unknown: 'an unidentified people', shepherd: 'something that left no name' };
  const sizeWords = {
    outpost: 'A compact structure, half-swallowed by the regolith',
    city: 'A city, laid out on a geometry that predates the local mountain range',
    megastructure: 'A structure of planetary scale, its purpose not recoverable from the outside',
  };
  const tail = [
    'Nothing here has eroded the way it should.',
    'The interior power is still live.',
    'Something has been maintaining this place.',
    'The dust inside is arranged in layers, each layer a different age.',
    'Corridors run in directions that fight the local gravity.',
    'Every surface bears the same symbol, cut to a depth no tool of ours can match.',
  ];
  return `${sizeWords[size]}. Stratigraphy attributes it to ${civNames[civTag] ?? 'unknown builders'}. ${rng.pick(tail)}`;
}

function describeLife(rng, type) {
  const pools = {
    terrestrial: [' microbial mats in the soil', ' shallow-rooted flora and small hexapod grazers', ' a full trophic web, none of it familiar'],
    ocean: [' drifting plankton-analogues', ' reef structures visible from orbit', ' something large, moving slowly at depth'],
    desert: [' endolithic life inside the rocks', ' a single opportunistic bloom species', ' nocturnal burrowers'],
    ice: [' cryophilic mats under the ice', ' vent ecosystems at the ice-rock boundary', ' nothing visible, but the methane is wrong'],
    volcanic: [' thermophilic films around fissures', ' sulphur-metabolising mats', ' nothing that should work, working'],
    toxic: [' acid-tolerant films', ' metal-accumulating crusts', ' slow, patient chemistry that is definitely alive'],
    tidallyLocked: [' a band of flora at the terminator', ' migratory grazers following the twilight', ' life in the twilight band and something else in the dark'],
    exotic: [' a standing field that is, by some definitions, alive', ' structures that grow and then stop', ' life, if the word applies'],
  };
  return `Detected:${rng.pick(pools[type] ?? pools.terrestrial)}.`;
}

function describePlanet(planet, star) {
  const t = planet.typeLabel;
  const tempC = Math.round(planet.tempK - 273);
  const g = planet.gravity.toFixed(2);
  const lock = planet.tidallyLocked ? ' Tidally locked: one face in permanent day, the other in permanent night.' : '';
  const life = planet.life ? ' Biosignatures confirmed.' : ' No biosignatures.';
  const ring = planet.ring ? ' Prominent ring system.' : '';
  return `${t}, ${planet.radiusKm.toFixed(0)} km radius, ${g}g, mean ${tempC}C. ${planet.atmosphere.name} atmosphere at ${planet.atmosphere.pressure.toFixed(2)} atm.${lock}${ring}${life}`;
}

function summarizeSystem(system) {
  const bits = [system.star.classLabel];
  bits.push(`${system.planets.length} ${system.planets.length === 1 ? 'planet' : 'planets'}`);
  if (system.planets.some((p) => p.life)) bits.push('biosignatures');
  if (system.ruins.length) bits.push(`${system.ruins.length} ruin${system.ruins.length > 1 ? 's' : ''}`);
  if (system.stations.length) bits.push('station');
  if (system.anomalies.length) bits.push('anomaly');
  if (system.star.classId === 'blackHole') bits.push('EXTREME HAZARD');
  if (system.star.isPulsar) bits.push('pulsar');
  return bits.join(' | ');
}

export { STAR_CLASS_WEIGHTS, REGION_RESOURCE_HINTS, TYPE_RESOURCES };
