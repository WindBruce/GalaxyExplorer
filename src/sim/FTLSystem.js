/**
 * FTL travel: jump range, fuel economy, jump execution and arrival events.
 */

export class FTLSystem {
  constructor(state) {
    this.state = state;
    this.jumping = false;
    this.jumpProgress = 0;
    this.lastJump = null;
  }

  /** Can we jump from -> to? Returns a detailed result for the UI. */
  canJump(fromId, toId) {
    const galaxy = this.state.galaxy;
    const shipSystem = this.state.shipSystem;
    if (fromId === toId) return { ok: false, reason: 'Already there', reasonKey: 'ftl.alreadyThere' };
    const distance = galaxy.distanceLy(fromId, toId);
    if (!isFinite(distance)) return { ok: false, reason: 'No route', reasonKey: 'ftl.noRoute' };
    const range = shipSystem.stats.jumpRange;
    const cost = shipSystem.jumpFuelCost(distance);
    const inRange = distance <= range;
    const result = {
      ok: inRange && this.state.ship.fuel >= cost && !this.state.ship.destroyed,
      reason: !inRange
        ? `Out of range (${Math.round(distance)} ly / ${Math.round(range)} ly)`
        : this.state.ship.fuel < cost
          ? `Insufficient fuel (${cost} needed, ${Math.floor(this.state.ship.fuel)} available)`
          : this.state.ship.destroyed ? 'Ship destroyed' : null,
      // Machine-readable mirror of `reason`, so the UI can localise it.
      reasonKey: !inRange
        ? 'ftl.outOfRange'
        : this.state.ship.fuel < cost
          ? 'ftl.noFuel'
          : this.state.ship.destroyed ? 'ftl.destroyed' : null,
      reasonVars: !inRange
        ? { d: Math.round(distance), r: Math.round(range) }
        : this.state.ship.fuel < cost
          ? { need: cost, have: Math.floor(this.state.ship.fuel) }
          : {},
      distanceLy: distance,
      fuelCost: cost,
      inRange,
      chargeTime: shipSystem.stats.chargeTime,
      fromId,
      toId,
    };
    return result;
  }

  /** Execute a jump (immediate; the visual charge is handled by the state). */
  jump(toId) {
    const fromId = this.state.location.systemId;
    const check = this.canJump(fromId, toId);
    if (!check.ok) return check;
    this.state.ship.fuel -= check.fuelCost;
    this.lastJump = check;
    this.jumping = true;
    this.jumpProgress = 0;
    this.state.bus.emit('ftl:start', check);
    return check;
  }

  /** Called when the jump animation completes. */
  arrive(systemId) {
    this.jumping = false;
    this.state.location.systemId = systemId;
    const system = this.state.galaxy.getSystem(systemId);
    this.state.location.system = system;
    if (system && !system.visited) {
      system.visited = true;
      system.discovered = true;
      this.state.addXp(120);
      this.state.archive.add('region', system.regionId, {
        name: this.state.galaxy.regions.find((r) => r.id === system.regionId)?.name ?? system.regionId,
        summary: this.state.galaxy.regions.find((r) => r.id === system.regionId)?.desc ?? '',
        meta: { hazard: this.state.galaxy.regions.find((r) => r.id === system.regionId)?.hazard ?? 0 },
      });
    }
    this.state.bus.emit('travel:complete', { systemId, regionId: system?.regionId });
    return system;
  }

  /** Refuel at a station or by scooping a gas giant. */
  refuel(amount = 50, cost = 0) {
    const ship = this.state.ship;
    if (cost > 0 && this.state.player.credits < cost) {
      return { ok: false, reason: 'Not enough credits', reasonKey: 'ftl.notEnoughCredits' };
    }
    const before = ship.fuel;
    ship.fuel = Math.min(ship.maxFuel, ship.fuel + amount);
    if (cost > 0) this.state.player.credits -= cost;
    return { ok: true, amount: ship.fuel - before };
  }

  /**
   * Emergency tow back to the home system. Expensive, but better than drifting.
   */
  rescueTow() {
    const cost = 8000;
    if (this.state.player.credits < cost) {
      return { ok: false, reason: 'Cannot afford rescue', reasonKey: 'ftl.rescuePoor', reasonVars: { n: cost } };
    }
    this.state.player.credits -= cost;
    this.state.ship.fuel = Math.max(this.state.ship.fuel, this.state.ship.maxFuel * 0.35);
    this.state.ship.destroyed = false;
    const home = this.state.galaxy.home;
    this.state.location.systemId = home.id;
    this.state.location.system = home;
    this.state.combat.clear();
    this.state.bus.emit('ftl:rescue', { cost, systemId: home.id });
    return { ok: true, cost, systemId: home.id };
  }

  /** Fuel price per unit at a civilisation station. */
  fuelPrice(civId = null) {
    let price = 3;
    const civ = civId ? this.state.civs.get(civId) : null;
    if (civ?.template.economy?.strength?.includes('hydrogen')) price *= 0.7;
    return Math.round(price);
  }
}
