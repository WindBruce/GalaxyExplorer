/**
 * Resource economy: cargo holds, mining yields, market pricing.
 *
 * `amounts` is a plain { resourceId: quantity } map so it serialises directly.
 */
export class ResourceSystem {
  constructor(state) {
    this.state = state;
    /** @type {Record<string, number>} */
    this.amounts = {};
  }

  get capacity() {
    return this.state.ship.cargoCapacity;
  }

  get used() {
    let total = 0;
    for (const qty of Object.values(this.amounts)) total += Number(qty) || 0;
    return total;
  }

  get free() {
    return Math.max(0, this.capacity - this.used);
  }

  amount(id) {
    return this.amounts[id] ?? 0;
  }

  /** Add resources, respecting cargo capacity. Returns amount actually stored. */
  add(id, qty) {
    const def = this.state.data.resources[id];
    if (!def) return 0;
    const space = this.free;
    const stored = Math.max(0, Math.min(qty, space));
    this.amounts[id] = this.amount(id) + stored;
    if (this.amounts[id] <= 0) delete this.amounts[id];
    if (stored > 0) this.state.bus.emit('resource:gained', { id, qty: stored });
    if (stored < qty) this.state.bus.emit('resource:overflow', { id, lost: qty - stored });
    return stored;
  }

  remove(id, qty) {
    const have = this.amount(id);
    const taken = Math.min(have, qty);
    const left = have - taken;
    if (left > 0) this.amounts[id] = left;
    else delete this.amounts[id];
    return taken;
  }

  canAfford(cost) {
    for (const [id, qty] of Object.entries(cost ?? {})) {
      if (this.amount(id) < qty) return false;
    }
    return true;
  }

  spend(cost) {
    if (!this.canAfford(cost)) return false;
    for (const [id, qty] of Object.entries(cost ?? {})) this.remove(id, qty);
    return true;
  }

  /** Market price for a resource at a civilisation (scarcity + economy). */
  price(id, civId = null) {
    const def = this.state.data.resources[id];
    if (!def) return 0;
    let mult = 1;
    if (civId) {
      const civ = this.state.civs.get(civId);
      if (civ) {
        const econ = civ.template.economy ?? {};
        if (econ.strength?.includes(id)) mult *= 0.75;
        if (econ.weakness?.includes(id)) mult *= 1.6;
        const tradeBonus = this.state.skills.getEffects().bonuses?.tradePrice ?? 0;
        mult *= 1 - tradeBonus * 0.5;
      }
    }
    return Math.max(1, Math.round(def.value * mult));
  }

  /** Buy from a civilisation market. */
  buy(id, qty, civId) {
    const price = this.price(id, civId) * qty;
    if (this.state.player.credits < price) {
      return { ok: false, reason: 'Not enough credits', reasonKey: 'ftl.notEnoughCredits' };
    }
    if (this.free < qty) return { ok: false, reason: 'Cargo hold full', reasonKey: 'sim.cargoFull' };
    this.state.player.credits -= price;
    this.add(id, qty);
    return { ok: true, price };
  }

  /** Sell to a civilisation market. */
  sell(id, qty, civId) {
    const have = this.amount(id);
    const amount = Math.min(have, qty);
    if (amount <= 0) return { ok: false, reason: 'Nothing to sell', reasonKey: 'sim.nothingToSell' };
    const price = Math.round(this.price(id, civId) * amount * 0.8);
    this.state.player.credits += price;
    this.remove(id, amount);
    return { ok: true, price };
  }

  /** Apply a mining strike. Returns what was extracted. */
  mine(nodeResources, yieldMultiplier = 1) {
    const out = {};
    for (const r of nodeResources) {
      const qty = Math.max(1, Math.round(r.quantity * 0.15 * yieldMultiplier));
      const stored = this.add(r.id, qty);
      if (stored > 0) out[r.id] = stored;
    }
    return out;
  }

  /**
   * Destroy a fraction of cargo (ship loss). Returns what was jettisoned.
   * @param {number} fraction 0–1
   */
  jettison(fraction = 0.4) {
    const lost = {};
    const f = Math.max(0, Math.min(1, fraction));
    for (const [id, qty] of Object.entries(this.amounts)) {
      const drop = Math.floor(qty * f);
      if (drop <= 0) continue;
      this.remove(id, drop);
      lost[id] = drop;
    }
    if (Object.keys(lost).length) this.state.bus.emit('cargo:jettisoned', lost);
    return lost;
  }

  /** Everything the player is carrying, for the inventory UI. */
  manifest() {
    return Object.entries(this.amounts)
      .map(([id, qty]) => {
        const def = this.state.data.resources[id];
        return { id, qty, name: def?.name ?? id, category: def?.category ?? 'basic', color: def?.color ?? '#fff', value: def?.value ?? 0 };
      })
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
  }
}
