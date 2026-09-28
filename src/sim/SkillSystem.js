/**
 * Character progression: skill tree with hybrid builds.
 *
 * Skills are data-driven nodes with prerequisites; effects are aggregated
 * into { bonuses, statMods, flat, capabilities } and consumed by ShipSystem
 * and the archaeology / diplomacy systems.
 */
export class SkillSystem {
  constructor(state) {
    this.state = state;
  }

  get data() {
    return this.state.data.skills;
  }

  get unlocked() {
    return this.state.player.skills;
  }

  has(id) {
    return this.unlocked.includes(id);
  }

  canUnlock(id) {
    if (this.has(id)) return { ok: false, reason: 'Already learned', reasonKey: 'sim.alreadyLearned' };
    const node = this.data[id];
    if (!node) return { ok: false, reason: 'Unknown skill', reasonKey: 'sim.unknownSkill' };
    for (const req of node.requires ?? []) {
      if (!this.has(req)) {
        return {
          ok: false,
          reason: `Requires ${this.data[req]?.name ?? req}`,
          reasonKey: 'sim.needsSkill',
          reasonVars: { name: this.data[req]?.name ?? req },
        };
      }
    }
    if (this.state.player.skillPoints < node.cost) {
      return {
        ok: false,
        reason: `Requires ${node.cost} skill point${node.cost > 1 ? 's' : ''}`,
        reasonKey: node.cost > 1 ? 'sim.needsPointsPlural' : 'sim.needsPointsOne',
        reasonVars: { n: node.cost },
      };
    }
    return { ok: true };
  }

  unlock(id) {
    const check = this.canUnlock(id);
    if (!check.ok) return check;
    const node = this.data[id];
    this.state.player.skillPoints -= node.cost;
    this.unlocked.push(id);
    this.state.shipSystem.recompute();
    this.state.bus.emit('skill:unlocked', { id, name: node.name });
    return { ok: true, skill: node };
  }

  /** Aggregate effects of every unlocked skill. */
  getEffects() {
    const out = { bonuses: {}, statMods: {}, flat: {}, capabilities: [] };
    for (const id of this.unlocked) {
      const node = this.data[id];
      if (!node?.effects) continue;
      const e = node.effects;
      for (const [k, v] of Object.entries(e.bonuses ?? {})) out.bonuses[k] = (out.bonuses[k] ?? 0) + v;
      for (const [k, v] of Object.entries(e.statMods ?? {})) out.statMods[k] = (out.statMods[k] ?? 0) + v;
      for (const [k, v] of Object.entries(e.flat ?? {})) out.flat[k] = (out.flat[k] ?? 0) + v;
      for (const c of e.capabilities ?? []) if (!out.capabilities.includes(c)) out.capabilities.push(c);
    }
    return out;
  }

  /** Nodes grouped by archetype, with unlock state, for the UI. */
  tree() {
    const byArchetype = {};
    for (const [id, node] of Object.entries(this.data)) {
      const arch = node.archetype;
      if (!byArchetype[arch]) byArchetype[arch] = [];
      byArchetype[arch].push({ ...node, id, unlocked: this.has(id), canUnlock: this.canUnlock(id).ok });
    }
    for (const arch of Object.keys(byArchetype)) {
      byArchetype[arch].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
    }
    return byArchetype;
  }

  archetypeProgress() {
    const out = {};
    for (const id of this.unlocked) {
      const arch = this.data[id]?.archetype ?? 'unknown';
      out[arch] = (out[arch] ?? 0) + 1;
    }
    return out;
  }
}
