/**
 * GameState: the single authoritative container for all persistent player
 * and world-progress state. Systems are attached here and read/write through
 * it, which keeps serialisation trivial and prevents circular dependencies.
 */
import { GameClock } from '../core/Time.js';
import { bus as globalBus } from '../core/EventBus.js';
import { createGalaxy } from '../world/GalaxyGenerator.js';
import { ShipSystem, DEFAULT_LOADOUT } from './ShipSystem.js';
import { ResourceSystem } from './ResourceSystem.js';
import { SkillSystem } from './SkillSystem.js';
import { TechSystem } from './TechSystem.js';
import { ArchaeologySystem } from './ArchaeologySystem.js';
import { CivilizationSystem } from './CivilizationSystem.js';
import { QuestSystem } from './QuestSystem.js';
import { EventSystem } from './EventSystem.js';
import { ArchiveSystem } from './ArchiveSystem.js';
import { FTLSystem } from './FTLSystem.js';
import { CombatSystem } from './CombatSystem.js';

export const SAVE_VERSION = 3;

export class GameState {
  /**
   * @param {object} data data packs from DataLoader.loadAllData()
   */
  constructor(data) {
    this.data = data;
    // The global event bus is shared by every system and the UI layer.
    this.bus = globalBus;
    this.clock = new GameClock();
    this.galaxy = null;

    this.player = {
      name: 'Commander',
      level: 1,
      xp: 0,
      skillPoints: 2,
      credits: 15000,
      skills: [],
      playtime: 0,
    };

    this.ship = {
      modules: { ...DEFAULT_LOADOUT },
      hull: 150,
      shield: 120,
      fuel: 100,
      maxHull: 150,
      maxShield: 120,
      maxFuel: 100,
      cargoCapacity: 120,
      destroyed: false,
    };
    // Combat, surface hazards and narrative events all call
    // `state.ship.applyDamage(...)`; keep that working whichever system owns it.
    this.ship.applyDamage = (amount, type = 'kinetic') => this.shipSystem.applyDamage(amount, type);
    this.ship.repair = (amount) => this.shipSystem.repair(amount);

    this.location = {
      systemId: null,
      system: null,
      planetId: null,
      mode: 'space', // 'space' | 'surface'
      position: { x: 0, y: 0, z: 0 },
      landingSite: null,
    };

    this.research = { points: 150, completed: [] };
    this.techCapabilities = [];
    this.flags = {};
    this.equipment = {};
    this.stats = {
      systemsVisited: 0,
      planetsLanded: 0,
      ruinsFound: 0,
      artifactsFound: 0,
      artifactsAnalyzed: 0,
      hostilesDestroyed: 0,
      jumpsMade: 0,
      distanceTravelledLy: 0,
    };

    // Subsystems (order matters: they reference each other through `state`).
    this.skills = new SkillSystem(this);
    this.tech = new TechSystem(this);
    this.resources = new ResourceSystem(this);
    this.archive = new ArchiveSystem(this);
    this.archaeology = new ArchaeologySystem(this);
    this.civs = new CivilizationSystem(this);
    this.quests = new QuestSystem(this);
    this.events = new EventSystem(this);
    this.ftl = new FTLSystem(this);
    this.combat = new CombatSystem(this);
    this.shipSystem = new ShipSystem(this);
  }

  /** Start a new game with the given galaxy seed. */
  newGame(seed = 'GalaxyExplorer', playerName = 'Commander') {
    this.galaxy = createGalaxy(seed, this.data.regions);
    this.civs.assignPresence(this.galaxy);
    this.player.name = playerName;

    const home = this.galaxy.home;
    this.location.systemId = home.id;
    this.location.system = home;
    home.visited = true;
    home.discovered = true;

    // Opening resources and known content.
    this.resources.amounts = { iron: 60, silicon: 45, carbon: 30, hydrogen: 40 };
    this.research.points = 150;
    this.quests.unlock('q_firstSurvey');
    this.quests.unlock('q_hostileSpace');

    this.archive.add('region', 'orionSpur', {
      name: 'Orion Spur',
      summary: this.data.regions.find((r) => r.id === 'orionSpur')?.desc ?? '',
      meta: { hazard: 0.15 },
    });
    this.archive.add('star', home.star.name, {
      name: home.star.name,
      summary: `${home.star.classLabel} (${home.star.spectral}), ${home.star.temp}K, ${home.star.mass.toFixed(2)} solar masses.`,
      meta: { classId: home.star.classId, systemId: home.id },
    });
    this.civs.meet('terranConcord');
    this.civs.discover('terranConcord', home.id);

    this.shipSystem.recompute();
    this.ship.hull = this.ship.maxHull;
    this.ship.shield = this.ship.maxShield;
    this.ship.fuel = this.ship.maxFuel;
    return this;
  }

  // ---- Progression -------------------------------------------------------

  xpForLevel(level) {
    return Math.round(120 * Math.pow(level, 1.55));
  }

  addXp(amount) {
    this.player.xp += Math.round(amount);
    let leveled = false;
    while (this.player.xp >= this.xpForLevel(this.player.level)) {
      this.player.xp -= this.xpForLevel(this.player.level);
      this.player.level += 1;
      this.player.skillPoints += 2;
      this.player.credits += 2500;
      leveled = true;
    }
    if (leveled) this.bus?.emit('player:levelup', { level: this.player.level });
    return leveled;
  }

  get xpProgress() {
    const need = this.xpForLevel(this.player.level);
    return { current: this.player.xp, need, pct: Math.min(1, this.player.xp / need) };
  }

  // ---- Convenience -------------------------------------------------------

  currentSystem() {
    return this.location.system;
  }

  currentPlanet() {
    const sys = this.location.system;
    if (!sys || !this.location.planetId) return null;
    return sys.planets.find((p) => p.id === this.location.planetId) ?? null;
  }

  /** Notify every system that the player has scanned a body. */
  markScanned(body, kind) {
    if (body && !body.scanned) {
      body.scanned = true;
      this.addXp(40);
      this.bus?.emit('scan:body', { bodyId: body.id, kind, name: body.name, systemId: this.location.systemId });
      if (kind === 'ruin') {
        this.archive.add('ruin', body.id, {
          name: body.name,
          summary: body.description,
          meta: { civTag: body.civTag, era: body.era, size: body.size, ageGyr: body.ageGyr, systemId: this.location.systemId },
        });
      } else if (kind === 'planet') {
        this.archive.add('planet', body.id, {
          name: body.name,
          summary: body.description,
          meta: { type: body.type, systemId: this.location.systemId },
        });
      } else if (kind === 'station') {
        this.archive.add('anomaly', body.id, {
          name: body.name,
          summary: `${body.kind}${body.derelict ? ' (derelict)' : ''} orbiting at ${body.orbitAu.toFixed(2)} AU.`,
          meta: { systemId: this.location.systemId, derelict: body.derelict },
        });
      }
    } else if (body) {
      this.bus?.emit('scan:body', { bodyId: body.id, kind, name: body.name, systemId: this.location.systemId });
    }
  }

  /** Survey the current system (full scan). */
  surveySystem() {
    const sys = this.location.system;
    if (!sys) return null;
    sys.surveyed = true;
    sys.discovered = true;
    this.addXp(200);
    this.bus?.emit('scan:system', { systemId: sys.id, regionId: sys.regionId, name: sys.name });
    for (const p of sys.planets) p.discovered = true;
    this.archive.add('star', sys.star.name, {
      name: sys.star.name,
      summary: `${sys.star.classLabel} (${sys.star.spectral}), ${sys.star.temp}K. ${sys.summary}`,
      meta: { classId: sys.star.classId, systemId: sys.id },
    });
    return sys;
  }

  // ---- Save / load -------------------------------------------------------

  serialize() {
    return {
      version: SAVE_VERSION,
      savedAt: Date.now(),
      clock: this.clock.serialize(),
      player: this.player,
      ship: this.ship,
      location: {
        systemId: this.location.systemId,
        planetId: this.location.planetId,
        mode: this.location.mode,
        position: this.location.position,
      },
      research: this.research,
      techCapabilities: this.techCapabilities,
      flags: this.flags,
      equipment: this.equipment,
      stats: this.stats,
      galaxy: this.galaxy ? this.galaxy.serialize() : null,
      resources: { ...this.resources.amounts },
      skills: this.skills.unlocked,
      archive: this.archive.serialize(),
      archaeology: this.archaeology.serialize(),
      civs: this.civs.serialize(),
      quests: this.quests.serialize(),
      events: this.events.serialize(),
      combat: this.combat.serialize(),
    };
  }

  deserialize(save) {
    if (!save) return false;
    try {
      this.clock.deserialize(save.clock);
      Object.assign(this.player, save.player ?? {});
      Object.assign(this.ship, save.ship ?? {});
      this.research = save.research ?? this.research;
      this.techCapabilities = save.techCapabilities ?? [];
      this.flags = save.flags ?? {};
      this.equipment = save.equipment ?? {};
      this.stats = { ...this.stats, ...(save.stats ?? {}) };
      this.resources.amounts = { ...(save.resources ?? {}) };
      this.player.skills = save.skills ?? [];
      this.archive.deserialize(save.archive);
      this.archaeology.deserialize(save.archaeology);
      this.civs.deserialize(save.civs);
      this.quests.deserialize(save.quests);
      this.events.deserialize(save.events);
      this.combat.deserialize(save.combat);

      // Rebuild the galaxy (deterministic) and restore discovery state.
      const gsave = save.galaxy;
      this.galaxy = createGalaxy(gsave?.seed ?? 'GalaxyExplorer', this.data.regions);
      this.civs.assignPresence(this.galaxy);
      if (gsave) {
        for (const id of gsave.discovered ?? []) {
          const s = this.galaxy.getSystem(id);
          if (s) s.discovered = true;
        }
        for (const id of gsave.visited ?? []) {
          const s = this.galaxy.getSystem(id);
          if (s) s.visited = true;
        }
        for (const id of gsave.surveyed ?? []) {
          const s = this.galaxy.getSystem(id);
          if (s) s.surveyed = true;
        }
      }
      const loc = save.location ?? {};
      this.location.systemId = loc.systemId ?? this.galaxy.homeSystemId;
      this.location.system = this.galaxy.getSystem(this.location.systemId);
      this.location.planetId = loc.planetId ?? null;
      this.location.mode = loc.mode ?? 'space';
      this.location.position = loc.position ?? { x: 0, y: 0, z: 0 };

      this.shipSystem.recompute();
      return true;
    } catch (err) {
      console.error('[GameState] Failed to load save:', err);
      return false;
    }
  }
}
