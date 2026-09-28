/**
 * Galaxy generation.
 *
 * The Milky Way is described as a set of regions (core, bulge, arms, disk,
 * halo, unknown regions). Each region produces a deterministic set of star
 * systems; every system's full contents are a pure function of its seed, so
 * the galaxy can be generated lazily / streamed rather than stored.
 *
 * This slice pre-generates ~1,100 systems (a vertical slice of the galaxy);
 * the same code path scales to millions because nothing depends on the total
 * count - see docs/ARCHITECTURE.md.
 */
import { Rng, hashString } from '../core/Random.js';
import { generateSystem, STAR_CLASS_WEIGHTS } from './StarSystemGenerator.js';
import { starName } from './NameGen.js';

const LY_PER_KPC = 3261.56;

const ARM_OFFSETS = [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2];
const SPIRAL_TIGHTNESS = 2.6; // radians of winding per e-fold of radius

export class Galaxy {
  /**
   * @param {number} seed
   * @param {Array} regionData from data/regions.json
   */
  constructor(seed, regionData) {
    this.seed = seed >>> 0;
    this.regions = regionData;
    /** @type {Map<string, object>} full system records by id */
    this.systems = new Map();
    /** @type {Array<object>} ordered list of ids */
    this.order = [];
    this._byRegion = new Map();
    this._build();
  }

  _build() {
    let counter = 0;
    for (const region of this.regions) {
      const rng = new Rng((this.seed ^ hashString(region.id)) >>> 0);
      const ids = [];
      for (let i = 0; i < region.systemCount; i++) {
        const id = `${region.id.slice(0, 3)}_${String(counter++).padStart(5, '0')}`;
        const seed = (this.seed ^ hashString(id)) >>> 0;
        const starClassId = rng.weighted(region.starClassBias);
        const system = generateSystem(seed, { regionId: region.id, starClass: starClassId, id, name: starName(seed) });
        // Region colour/hazard influences are applied by the generator via regionId.
        system.position = this._positionFor(region, i, region.systemCount, rng);
        this.systems.set(id, system);
        this.order.push(id);
        ids.push(id);
      }
      this._byRegion.set(region.id, ids);
    }
    this._designateSpecialSystems();
  }

  _positionFor(region, i, count, rng) {
    const [rMin, rMax] = region.radius;
    let r, theta, y;
    switch (region.shape) {
      case 'sphere': {
        const dir = randomDirection(rng);
        r = Math.sqrt(rng.float(0, 1)) * rMax;
        return { x: dir.x * r, y: dir.y * r * 0.6, z: dir.z * r };
      }
      case 'halo': {
        const dir = randomDirection(rng);
        r = rng.float(rMin, rMax);
        return { x: dir.x * r, y: dir.y * r, z: dir.z * r };
      }
      case 'arm': {
        const armOffset = ARM_OFFSETS[(region.armIndex ?? 0) % ARM_OFFSETS.length];
        r = rng.float(rMin, rMax);
        theta = SPIRAL_TIGHTNESS * Math.log(Math.max(0.5, r)) + armOffset;
        theta += rng.gauss(0, 0.28);
        r += rng.gauss(0, 0.7);
        y = rng.gauss(0, 0.28);
        break;
      }
      case 'scatter': {
        r = rng.float(rMin, rMax);
        theta = rng.float(0, Math.PI * 2);
        y = rng.gauss(0, 1.1);
        break;
      }
      case 'disk':
      default: {
        r = Math.sqrt(rng.float(0, 1)) * (rMax - rMin) + rMin;
        theta = rng.float(0, Math.PI * 2);
        y = rng.gauss(0, 0.35);
        break;
      }
    }
    return { x: Math.cos(theta) * r, y, z: Math.sin(theta) * r };
  }

  /**
   * Hand-place the systems the vertical slice's story needs: the player's
   * home system (Concord station + an early ruin) and one ancient system in
   * the Unknown Regions that anchors the late-game mystery.
   */
  _designateSpecialSystems() {
    const home = this.systems.get(this._byRegion.get('orionSpur')[0]);
    if (home) {
      home.name = "Kepler's Rest";
      home.star.classId = 'yellow';
      home.star.classLabel = 'Yellow Dwarf';
      home.star.color = '#ffd97d';
      home.star.temp = 5770;
      home.star.radiusUnits = 62;
      home.star.luminosity = 1.0;
      home.star.mass = 1.0;
      home.star.ageGyr = 4.6;
      home.civId = 'terranConcord';
      home.stations = [{
        id: `${home.id}_st0`,
        name: "Station Kepler's Rest",
        kind: 'Trading Post',
        derelict: false,
        orbitAu: 1.9,
        owner: 'terranConcord',
        scanned: false,
        resources: [{ id: 'hydrogen', quantity: 120 }, { id: 'iron', quantity: 90 }],
      }];
      // Guarantee a habitable terrestrial world with a starter ruin.
      const habitable = home.planets.find((p) => p.type === 'terrestrial' || p.type === 'ocean')
        ?? home.planets.find((p) => p.landable)
        ?? home.planets[0];
      if (habitable) {
        habitable.type = 'terrestrial';
        habitable.typeLabel = 'Terrestrial';
        habitable.life = true;
        habitable.tempK = 288;
        habitable.breathable = true;
        habitable.atmosphere = { name: 'Nitrogen-Oxygen', breathable: true, pressure: 1.0, color: '#9ecbff' };
        habitable.lifeNotes = ' Detected: shallow-rooted flora and small grazers.';
        habitable.resources = [
          { id: 'iron', quantity: 320 },
          { id: 'silicon', quantity: 240 },
          { id: 'carbon', quantity: 180 },
          { id: 'oxygen', quantity: 150 },
          { id: 'rareMetals', quantity: 40 },
        ];
        habitable.description = `Terrestrial, ${habitable.radiusKm.toFixed(0)} km radius, ${habitable.gravity.toFixed(2)}g, mean 15C. Nitrogen-Oxygen atmosphere at 1.00 atm. Biosignatures confirmed.`;
        habitable.name = 'Acheron';
        if (!habitable.ruinSiteIds.length) {
          const ruin = {
            id: `${home.id}_ruin0`,
            name: "Acheron Reliquary",
            civTag: 'aelthera',
            era: 'eraFirstLight',
            size: 'outpost',
            seed: (home.seed ^ 0x1234) >>> 0,
            planetId: habitable.id,
            planetIndex: habitable.index,
            ageGyr: 9.1,
            scanned: false,
            discovered: false,
            looted: false,
            hazard: 0.2,
            artifactCount: 3,
            depth: false,
            description: "A compact structure, half-swallowed by the regolith. Stratigraphy attributes it to Ael'thera. Nothing here has eroded the way it should.",
          };
          home.ruins = [ruin];
          habitable.ruinSiteIds.push(ruin.id);
        }
      }
      home.summary = 'Yellow Dwarf | 4 planets | biosignatures | station | 1 ruin';
      this.homeSystemId = home.id;
    }

    // Anchor system for the late-game mystery in the Unknown Regions.
    const unknown = this._byRegion.get('unknownRegions');
    if (unknown && unknown.length) {
      const anchor = this.systems.get(unknown[unknown.length - 1]);
      if (anchor) {
        anchor.name = 'The Hollow Chorus';
        anchor.star.classId = 'blackHole';
        anchor.star.classLabel = 'Black Hole System';
        anchor.star.color = '#1a1a2e';
        anchor.star.radiusUnits = 22;
        anchor.star.luminosity = 0;
        anchor.star.mass = 26;
        anchor.danger = 1;
        anchor.civId = null;
        anchor.ruins = [{
          id: `${anchor.id}_ruin0`,
          name: 'The Seat of the Shepherd',
          civTag: 'shepherd',
          era: 'eraVanishing',
          size: 'megastructure',
          seed: (anchor.seed ^ 0x777) >>> 0,
          planetId: anchor.planets[0]?.id ?? null,
          planetIndex: 0,
          ageGyr: 12.4,
          scanned: false,
          discovered: false,
          looted: false,
          hazard: 0.9,
          artifactCount: 5,
          depth: true,
          description: 'A structure of planetary scale, its purpose not recoverable from the outside. Something has been maintaining this place.',
        }];
        if (anchor.planets[0]) anchor.planets[0].ruinSiteIds.push(`${anchor.id}_ruin0`);
        anchor.summary = 'Black Hole System | EXTREME HAZARD | megastructure';
        this.anchorSystemId = anchor.id;
      }
    }
  }

  get home() {
    return this.systems.get(this.homeSystemId);
  }

  getSystem(id) {
    return this.systems.get(id) ?? null;
  }

  regionSystems(regionId) {
    return (this._byRegion.get(regionId) ?? []).map((id) => this.systems.get(id));
  }

  allSystems() {
    return this.order.map((id) => this.systems.get(id));
  }

  /** Distance between two systems in light years. */
  distanceLy(aId, bId) {
    const a = this.systems.get(aId);
    const b = this.systems.get(bId);
    if (!a || !b) return Infinity;
    return Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y, a.position.z - b.position.z) * LY_PER_KPC;
  }

  /** All systems within `ly` light years of a system. */
  systemsWithinLy(systemId, ly) {
    const from = this.systems.get(systemId);
    if (!from) return [];
    const out = [];
    for (const id of this.order) {
      if (id === systemId) continue;
      const s = this.systems.get(id);
      const d = Math.hypot(s.position.x - from.position.x, s.position.y - from.position.y, s.position.z - from.position.z) * LY_PER_KPC;
      if (d <= ly) out.push({ system: s, distanceLy: d });
    }
    return out.sort((a, b) => a.distanceLy - b.distanceLy);
  }

  /** Find systems matching a predicate (used by quest resolution). */
  find(pred, limit = 1) {
    const out = [];
    for (const id of this.order) {
      const s = this.systems.get(id);
      if (pred(s)) {
        out.push(s);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  /** Region metadata for the galactic map UI. */
  regionInfo() {
    return this.regions.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      hazard: r.hazard,
      desc: r.desc,
      count: (this._byRegion.get(r.id) ?? []).length,
    }));
  }

  serialize() {
    return {
      seed: this.seed,
      discovered: this.order.filter((id) => this.systems.get(id).discovered),
      visited: this.order.filter((id) => this.systems.get(id).visited),
      surveyed: this.order.filter((id) => this.systems.get(id).surveyed),
    };
  }
}

function randomDirection(rng) {
  const z = rng.float(-1, 1);
  const t = rng.float(0, Math.PI * 2);
  const r = Math.sqrt(1 - z * z);
  return { x: r * Math.cos(t), y: z, z: r * Math.sin(t) };
}

/** Build a galaxy from a seed string/number. */
export function createGalaxy(seed, regionData) {
  const numeric = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  return new Galaxy(numeric, regionData);
}
