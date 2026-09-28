/**
 * Ship system: modular stats, installation, damage, power budgeting.
 *
 * Derived stats = sum of installed module stats, modified multiplicatively by
 * skill tree statMods and flat additions, plus module bonuses. Everything is
 * recomputed from scratch whenever the loadout changes, which keeps the
 * system trivially serialisable (only module ids + hull/shield/fuel).
 */

/** Primary stat produced by each slot. */
export const SLOT_PRIMARY_STAT = {
  engine: 'thrust',
  ftl: 'jumpRange',
  power: 'powerOutput',
  shield: 'shield',
  armor: 'hull',
  weapon: 'damage',
  cargo: 'cargoCapacity',
  mining: 'miningYield',
  scanner: 'scanRange',
  archaeology: 'analysis',
  lab: 'research',
  lifesupport: 'hazardResist',
  drone: 'drones',
  ai: 'automation',
};

export const SLOTS = Object.keys(SLOT_PRIMARY_STAT);

export const DEFAULT_LOADOUT = {
  engine: 'eng_chem',
  ftl: 'ftl_t1',
  power: 'pwr_fusion',
  shield: 'shd_t1',
  armor: 'arm_t1',
  weapon: 'wpn_none',
  cargo: 'cargo_t1',
  mining: 'min_t1',
  scanner: 'scan_t1',
  archaeology: 'arch_t1',
  lab: 'lab_t1',
  lifesupport: 'ls_t1',
  drone: 'drone_none',
  ai: 'ai_none',
};

export class ShipSystem {
  /** @param {import('./GameState.js').GameState} state */
  constructor(state) {
    this.state = state;
    this.stats = {};
    this.recompute();
  }

  get moduleData() {
    return this.state.data.shipModules;
  }

  /** All module definitions keyed by id. */
  allModules() {
    const out = {};
    for (const [slot, list] of Object.entries(this.moduleData)) {
      for (const m of list) out[m.id] = { ...m, slot };
    }
    return out;
  }

  getModule(id) {
    return this.allModules()[id] ?? null;
  }

  installed(slot) {
    return this.getModule(this.state.ship.modules[slot] ?? '') ?? null;
  }

  /** Install a module into its slot, refunding nothing. */
  install(moduleId) {
    const mod = this.getModule(moduleId);
    if (!mod) return { ok: false, reason: 'Unknown module' };
    const tech = this.state.tech;
    if (mod.requiresTech && !tech.has(mod.requiresTech)) {
      return { ok: false, reason: `Requires technology: ${tech.nameOf(mod.requiresTech)}` };
    }
    const prev = this.installed(mod.slot);
    if (prev && prev.tier > 0 && mod.cost?.credits > 0 && !this.state.resources.canAfford(mod.cost.resources ?? {})) {
      return { ok: false, reason: 'Insufficient resources' };
    }
    if (prev && prev.tier > 0) {
      // Sell back the old module for 40% of its credit cost.
      this.state.player.credits += Math.floor((prev.cost?.credits ?? 0) * 0.4);
    }
    if (mod.cost?.credits > 0) {
      this.state.player.credits -= mod.cost.credits;
      for (const [res, qty] of Object.entries(mod.cost.resources ?? {})) {
        this.state.resources.remove(res, qty);
      }
    }
    this.state.ship.modules[mod.slot] = moduleId;
    this.recompute();
    return { ok: true, module: mod };
  }

  uninstall(slot) {
    const mod = this.installed(slot);
    if (!mod || mod.tier === 0) return { ok: false, reason: 'Nothing to remove' };
    const base = this.moduleData[slot]?.find((m) => m.tier === 1);
    this.state.ship.modules[slot] = base?.id ?? mod.id;
    this.state.player.credits += Math.floor((mod.cost?.credits ?? 0) * 0.25);
    this.recompute();
    return { ok: true };
  }

  /** Recompute every derived stat. */
  recompute() {
    const all = this.allModules();
    const mods = {};
    for (const slot of SLOTS) {
      const id = this.state.ship.modules[slot];
      if (!id) continue;
      const m = all[id];
      if (m) mods[slot] = m;
    }

    const s = {
      thrust: 0, jumpRange: 0, jumpEfficiency: 1, chargeTime: 6,
      powerOutput: 0, powerDraw: 0,
      shield: 0, shieldRegen: 0, hull: 0, hullRegen: 0,
      damage: 0, fireRate: 0, weaponRange: 0,
      cargoCapacity: 0, miningYield: 1, miningRate: 1,
      scanRange: 1, scanResolution: 1, anomalySense: 1,
      analysis: 1, translation: 1, excavation: 1,
      research: 1, xenobiology: 1, aiAssist: 1, automation: 1,
      hazardResist: 1, drones: 0, mass: 0,
    };

    // Module data uses compact stat names that collide between slots
    // (scanner `range` vs weapon `range`, shield `regen` vs armour `regen`),
    // so aliases are resolved per slot.
    const SLOT_STAT_ALIAS = {
      cargo: { capacity: 'cargoCapacity' },
      power: { output: 'powerOutput' },
      scanner: { range: 'scanRange', resolution: 'scanResolution' },
      weapon: { range: 'weaponRange', rate: 'fireRate' },
      mining: { yield: 'miningYield', rate: 'miningRate' },
      shield: { regen: 'shieldRegen' },
      armor: { regen: 'hullRegen' },
      lifesupport: { crew: 'drones' },
    };

    for (const [slot, m] of Object.entries(mods)) {
      const alias = SLOT_STAT_ALIAS[slot] ?? {};
      for (const [rawKey, v] of Object.entries(m.stats ?? {})) {
        const k = alias[rawKey] ?? rawKey;
        if (k in s) s[k] += v;
      }
      s.mass += m.mass ?? 0;
      s.powerDraw += m.powerDraw ?? 0;
    }

    // Skill tree modifiers.
    const skill = this.state.skills.getEffects();
    for (const [k, mult] of Object.entries(skill.statMods ?? {})) {
      if (k === 'cargoCapacity' || k === 'shield' || k === 'hull') s[k] *= 1 + mult;
      else if (k === 'powerOutput') s[k] *= 1 + mult;
      else if (k === 'jumpRange' || k === 'jumpEfficiency') s[k] *= 1 + mult;
      else if (k === 'scanRange' || k === 'scanResolution' || k === 'anomalySense') s[k] *= 1 + mult;
      else if (k === 'thrust') s[k] *= 1 + mult;
    }
    for (const [k, flat] of Object.entries(skill.flat ?? {})) {
      if (k in s) s[k] += flat;
    }
    const b = skill.bonuses ?? {};
    if (b.miningYield) s.miningYield *= 1 + b.miningYield;
    if (b.miningRate) s.miningRate *= 1 + b.miningRate;
    if (b.research) s.research *= 1 + b.research;
    if (b.xenobiology) s.xenobiology *= 1 + b.xenobiology;
    if (b.analysis) s.analysis *= 1 + b.analysis;
    if (b.translation) s.translation *= 1 + b.translation;
    if (b.hazardResist) s.hazardResist *= 1 + b.hazardResist;
    if (b.combat) s.damage *= 1 + b.combat;
    if (b.repair) s.hullRegen += b.repair;
    if (b.powerEfficiency) s.powerDraw *= 1 - Math.min(0.5, b.powerEfficiency);

    // Technology modifiers (capabilities).
    const caps = this.state.tech.capabilities();
    if (caps.includes('fastLearning')) s.research *= 1.15;
    if (caps.includes('overdrive')) s.thrust *= 1.15;
    if (caps.includes('gateConstruction')) s.jumpRange *= 1.5;

    // Clamp power draw to output for display purposes.
    s.powerAvailable = Math.max(0, s.powerOutput - s.powerDraw);
    s.powerRatio = s.powerOutput > 0 ? s.powerAvailable / s.powerOutput : 0;
    s.overloaded = s.powerDraw > s.powerOutput;
    if (s.overloaded) {
      // Systems brown out proportionally.
      const scale = s.powerOutput / Math.max(1, s.powerDraw);
      s.shield *= 0.5 + 0.5 * scale;
      s.thrust *= 0.5 + 0.5 * scale;
    }

    this.stats = s;
    // Keep hull/shield maxima in sync with derived stats.
    const ship = this.state.ship;
    ship.maxHull = Math.round(s.hull);
    ship.maxShield = Math.round(s.shield);
    ship.maxFuel = 100 + Math.round(s.jumpRange * 0.4);
    ship.cargoCapacity = Math.round(s.cargoCapacity * (1 + (b.cargo ?? 0)));
    ship.hull = Math.min(ship.hull, ship.maxHull);
    ship.shield = Math.min(ship.shield, ship.maxShield);
    ship.fuel = Math.min(ship.fuel, ship.maxFuel);
    return s;
  }

  /** Fuel cost in units for a jump of `ly` light years. */
  jumpFuelCost(distanceLy) {
    const eff = Math.max(0.2, this.stats.jumpEfficiency);
    const base = 2 + Math.pow(Math.max(0, distanceLy), 0.82) * 0.055;
    return Math.ceil(base / eff);
  }

  /** Maximum jump distance given current fuel. */
  maxJumpDistance() {
    const eff = Math.max(0.2, this.stats.jumpEfficiency);
    const fuel = this.state.ship.fuel;
    const effectiveFuel = fuel * eff;
    return Math.max(0, Math.pow(Math.max(0, (effectiveFuel - 2) / 0.055), 1 / 0.82));
  }

  applyDamage(amount, type = 'kinetic') {
    const ship = this.state.ship;
    let remaining = amount;
    if (ship.shield > 0) {
      const absorbed = Math.min(ship.shield, remaining);
      ship.shield -= absorbed;
      remaining -= absorbed;
    }
    if (remaining > 0) ship.hull = Math.max(0, ship.hull - remaining);
    if (ship.hull <= 0) {
      ship.destroyed = true;
      this.state.bus.emit('ship:destroyed', {});
    }
    return { hullDamage: amount - Math.max(0, remaining), shieldDamage: amount - remaining };
  }

  repair(amount) {
    const ship = this.state.ship;
    const before = ship.hull;
    ship.hull = Math.min(ship.maxHull, ship.hull + amount);
    return ship.hull - before;
  }

  recharge(dt) {
    const ship = this.state.ship;
    if (ship.shield < ship.maxShield) {
      ship.shield = Math.min(ship.maxShield, ship.shield + this.stats.shieldRegen * dt);
    }
    if (ship.hull < ship.maxHull && this.stats.hullRegen > 0) {
      ship.hull = Math.min(ship.maxHull, ship.hull + this.stats.hullRegen * dt);
    }
  }

  /** Loadout summary for the UI. */
  loadoutSummary() {
    const out = [];
    for (const slot of SLOTS) {
      const m = this.installed(slot);
      out.push({ slot, module: m });
    }
    return out;
  }
}
