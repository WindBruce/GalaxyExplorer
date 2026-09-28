/**
 * Technology tree: conventional research + artifact-gated reconstruction.
 *
 * Technologies in the "unknown" category carry `requiresArtifact`: they can
 * only be unlocked by analysing an artifact carrying the matching techTag.
 * This is the mechanism that makes exploration a source of technology.
 */
export class TechSystem {
  constructor(state) {
    this.state = state;
  }

  get data() {
    return this.state.data.technologies;
  }

  get completed() {
    return this.state.research.completed;
  }

  has(id) {
    return this.completed.includes(id);
  }

  nameOf(id) {
    return this.data[id]?.name ?? id;
  }

  /** The technology unlocked by an artifact tag (artifact-gated techs only). */
  techForArtifactTag(tag) {
    if (!tag) return null;
    for (const [id, tech] of Object.entries(this.data)) {
      if (tech.requiresArtifact === tag) return id;
    }
    return null;
  }

  /** Techs whose prerequisites are met and that are not yet researched. */
  available() {
    const out = [];
    for (const [id, tech] of Object.entries(this.data)) {
      if (this.has(id)) continue;
      if (!this._prereqsMet(tech)) continue;
      out.push({ ...tech, id, artifactGated: !!tech.requiresArtifact });
    }
    return out.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  }

  /** Techs the player can see (prereqs met, or a parent is known). */
  visible() {
    const out = [];
    for (const [id, tech] of Object.entries(this.data)) {
      if (this.has(id)) continue;
      const parentKnown = (tech.requires ?? []).some((r) => this.has(r));
      if (parentKnown || (tech.requires ?? []).length === 0) out.push({ ...tech, id });
    }
    return out.sort((a, b) => a.tier - b.tier);
  }

  _prereqsMet(tech) {
    return (tech.requires ?? []).every((r) => this.has(r));
  }

  canResearch(id) {
    const tech = this.data[id];
    if (!tech) return { ok: false, reason: 'Unknown technology', reasonKey: 'sim.unknownTech' };
    if (this.has(id)) return { ok: false, reason: 'Already researched', reasonKey: 'sim.alreadyResearched' };
    if (tech.requiresArtifact) return { ok: false, reason: 'Reconstruct from an artifact', reasonKey: 'sim.artifactOnly' };
    if (!this._prereqsMet(tech)) return { ok: false, reason: 'Prerequisites not met', reasonKey: 'sim.prereqs' };
    const cost = tech.cost ?? { research: 0, resources: {} };
    if (this.state.research.points < cost.research) {
      return {
        ok: false,
        reason: `Requires ${cost.research} research points`,
        reasonKey: 'sim.needsPoints',
        reasonVars: { n: cost.research },
      };
    }
    if (!this.state.resources.canAfford(cost.resources ?? {})) {
      return { ok: false, reason: 'Missing required materials', reasonKey: 'sim.needsMaterials' };
    }
    return { ok: true };
  }

  research(id) {
    const check = this.canResearch(id);
    if (!check.ok) return check;
    const tech = this.data[id];
    this.state.research.points -= tech.cost.research;
    this.state.resources.spend(tech.cost.resources);
    this.completed.push(id);
    this._applyUnlocks(tech);
    this.state.bus.emit('tech:researched', { id, name: tech.name });
    this.state.archaeology.onTechResearched(id);
    return { ok: true, tech: { ...tech, id }, techId: id };
  }

  /** Unlock an artifact-gated technology (called by ArchaeologySystem). */
  unlockFromArtifact(id) {
    if (this.has(id)) return { ok: false, reason: 'Already researched' };
    const tech = this.data[id];
    if (!tech) return { ok: false, reason: 'Unknown technology' };
    this.completed.push(id);
    this._applyUnlocks(tech);
    this.state.bus.emit('tech:reconstructed', { id, name: tech.name });
    return { ok: true, tech: { ...tech, id }, techId: id };
  }

  _applyUnlocks(tech) {
    const caps = tech.unlocks?.capabilities ?? [];
    for (const c of caps) {
      if (!this.state.techCapabilities.includes(c)) this.state.techCapabilities.push(c);
    }
    this.state.shipSystem.recompute();
  }

  capabilities() {
    return this.state.techCapabilities;
  }

  /** Grouped tree for the UI. */
  tree() {
    const byCategory = {};
    for (const [id, tech] of Object.entries(this.data)) {
      if (!byCategory[tech.category]) byCategory[tech.category] = [];
      byCategory[tech.category].push({
        ...tech,
        id,
        researched: this.has(id),
        prereqsMet: this._prereqsMet(tech),
        canResearch: this.canResearch(id).ok,
        artifactGated: !!tech.requiresArtifact,
      });
    }
    for (const cat of Object.keys(byCategory)) {
      byCategory[cat].sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
    }
    return byCategory;
  }
}
