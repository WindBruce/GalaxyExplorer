/**
 * Alien civilisation system.
 *
 * Living civilisations are stateful instances generated from data templates:
 * reputation with the player, inter-civilisation relations that evolve over
 * time (alliances, wars, migrations), markets, dialogue and quest hooks.
 *
 * Extinct civilisations exist only as archaeological evidence and are handled
 * by ArchaeologySystem + the timeline.
 */
import { Rng, hashString } from '../core/Random.js';
import { i18n } from '../core/I18n.js';

export class CivilizationSystem {
  constructor(state) {
    this.state = state;
    this.i18n = i18n;
    /** @type {Map<string, object>} */
    this.instances = new Map();
    this._init();
  }

  _init() {
    for (const tpl of this.state.data.civilizations.templates) {
      this.instances.set(tpl.id, {
        id: tpl.id,
        name: tpl.name,
        template: tpl,
        reputation: tpl.startingReputation ?? 0,
        discovered: false,
        met: false,
        knownSystemIds: [],
        questsCompleted: [],
        // Inter-civ relations, seeded from templates then evolved.
        relations: { ...(tpl.relations ?? {}) },
        warWith: [],
        alliedWith: [],
        migrationTarget: null,
        politics: 'stable',
        lastEventAt: 0,
      });
    }
  }

  get(id) {
    return this.instances.get(id) ?? null;
  }

  all() {
    return [...this.instances.values()];
  }

  discovered() {
    return this.all().filter((c) => c.discovered);
  }

  /** Mark a civilisation as discovered (archive + first contact). */
  discover(id, systemId = null) {
    const civ = this.get(id);
    if (!civ) return { isNew: false };
    const isNew = !civ.discovered;
    civ.discovered = true;
    if (systemId && !civ.knownSystemIds.includes(systemId)) civ.knownSystemIds.push(systemId);
    if (isNew) {
      this.state.archive.add('civilization', civ.id, {
        name: civ.name,
        summary: civ.template.background,
        meta: {
          techLevel: civ.template.techLevel,
          government: civ.template.government,
          philosophy: civ.template.philosophy,
          traits: civ.template.traits,
          existentialProblem: civ.template.existentialProblem,
        },
      });
      this.state.archive.add('species', civ.template.biology?.split(',')[0] ?? civ.id, {
        name: civ.template.biology ?? civ.name,
        summary: `Associated with ${civ.name}.`,
        meta: { civ: civ.id },
      });
      this.state.bus.emit('civ:discovered', { id: civ.id, name: civ.name });
      this.state.addXp(250);
    }
    return { isNew, civ };
  }

  /** Player meets the civilisation in person (station dialogue etc). */
  meet(id) {
    const civ = this.get(id);
    if (!civ) return null;
    civ.met = true;
    return this.discover(id).civ;
  }

  adjustReputation(id, delta) {
    const civ = this.get(id);
    if (!civ) return 0;
    civ.reputation = Math.max(-1, Math.min(1, civ.reputation + delta));
    return civ.reputation;
  }

  reputationLabel(id) {
    const r = this.get(id)?.reputation ?? 0;
    if (r > 0.7) return 'Exalted';
    if (r > 0.4) return 'Trusted';
    if (r > 0.15) return 'Friendly';
    if (r > -0.15) return 'Neutral';
    if (r > -0.4) return 'Unfriendly';
    if (r > -0.7) return 'Hostile';
    return 'Nemesis';
  }

  /** Dialogue tree for a civilisation (data-driven). */
  dialogue(id) {
    const civ = this.get(id);
    if (!civ) return null;
    return { civ, tree: civ.template.dialogue };
  }

  /** Apply dialogue option effects. */
  applyEffects(effects = {}) {
    const out = [];
    if (effects.reputation && effects.reputation.civ) {
      this.adjustReputation(effects.reputation.civ, effects.reputation.delta);
    } else if (typeof effects.reputation === 'number') {
      // Applied to the current dialogue partner by the caller.
    }
    if (effects.credits) {
      this.state.player.credits += effects.credits;
      out.push({ type: 'credits', amount: effects.credits });
    }
    if (effects.research) {
      this.state.research.points += effects.research;
      out.push({ type: 'research', amount: effects.research });
    }
    if (effects.giveResource) {
      for (const [id, qty] of Object.entries(effects.giveResource)) {
        this.state.resources.add(id, qty);
        out.push({ type: 'resource', id, amount: qty });
      }
    }
    if (effects.quest) {
      this.state.quests.start(effects.quest);
      out.push({ type: 'quest', id: effects.quest });
    }
    if (effects.flag) {
      this.state.flags[effects.flag] = true;
    }
    if (effects.action === 'openTrade') {
      this.state.bus.emit('ui:openTrade', {});
    }
    return out;
  }

  /** Market offers at a civilisation. */
  market(civId) {
    const civ = this.get(civId);
    if (!civ) return [];
    const rng = new Rng((this.state.galaxy.seed ^ hashString(civId + this.state.clock.stardate.toFixed(0))) >>> 0);
    const econ = civ.template.economy ?? {};
    const pool = Object.keys(this.state.data.resources).filter((id) => id !== 'credits');
    const offers = [];
    const count = rng.int(5, 9);
    for (let i = 0; i < count; i++) {
      const id = rng.pick(pool);
      const def = this.state.data.resources[id];
      const price = this.state.resources.price(id, civId);
      const stock = rng.int(20, 400);
      offers.push({
        id,
        name: def.name,
        category: def.category,
        price,
        stock,
        playerHas: this.state.resources.amount(id),
        demand: econ.strength?.includes(id) ? 'high' : econ.weakness?.includes(id) ? 'desperate' : 'normal',
      });
    }
    return offers;
  }

  /**
   * Evolve inter-civilisation relations over time. Called on the game clock.
   * Relations drift; occasionally a war, alliance or migration begins and is
   * recorded in the archive as a phenomenon.
   */
  update(dt) {
    const civs = this.all();
    const now = this.state.clock.stardate;
    if (now - (this._lastPoliticsUpdate ?? 0) < 60) return;
    this._lastPoliticsUpdate = now;
    const rng = new Rng((this.state.galaxy.seed ^ Math.floor(now)) >>> 0);

    for (const civ of civs) {
      for (const otherId of Object.keys(civ.relations)) {
        const drift = rng.gauss(0, 0.01);
        civ.relations[otherId] = Math.max(-1, Math.min(1, civ.relations[otherId] + drift));
      }
      // Random political event.
      if (rng.chance(0.12)) {
        const roll = rng.next();
        if (roll < 0.35) {
          const target = rng.pick(Object.keys(civ.relations));
          if (target && !civ.warWith.includes(target)) {
            civ.warWith.push(target);
            civ.politics = 'at war';
            const other = this.get(target);
            if (other && !other.warWith.includes(civ.id)) other.warWith.push(civ.id);
            this._recordPhenomenon('civ.politics.war', {
              a: this.i18n.content('civilization', civ.id, civ.name, 'name'),
              b: this.i18n.content('civilization', target, other?.name ?? target, 'name'),
            });
          }
        } else if (roll < 0.6) {
          const target = rng.pick(Object.keys(civ.relations));
          if (target && civ.warWith.includes(target)) {
            civ.warWith = civ.warWith.filter((w) => w !== target);
            if (!civ.warWith.length) civ.politics = 'stable';
            const other = this.get(target);
            if (other) other.warWith = other.warWith.filter((w) => w !== civ.id);
            this._recordPhenomenon('civ.politics.ceasefire', {
              a: this.i18n.content('civilization', civ.id, civ.name, 'name'),
              b: this.i18n.content('civilization', target, other?.name ?? target, 'name'),
            });
          }
        } else if (roll < 0.8) {
          const target = rng.pick(Object.keys(civ.relations));
          if (target && !civ.alliedWith.includes(target)) {
            civ.alliedWith.push(target);
            const other = this.get(target);
            if (other && !other.alliedWith.includes(civ.id)) other.alliedWith.push(civ.id);
            this._recordPhenomenon('civ.politics.pact', {
              a: this.i18n.content('civilization', civ.id, civ.name, 'name'),
              b: this.i18n.content('civilization', target, other?.name ?? target, 'name'),
            });
          }
        } else {
          civ.migrationTarget = rng.pick(['coreward', 'rimward', 'unknownRegions']);
          civ.politics = 'migrating';
          this._recordPhenomenon('civ.politics.migration', {
            a: this.i18n.content('civilization', civ.id, civ.name, 'name'),
            dir: this.i18n.t(`civ.direction.${civ.migrationTarget}`, {}),
          });
        }
      }
    }
  }

  /**
   * Record a political shift. `key` is an i18n key with `.title` / `.text`
   * suffixes so the notification and the archive entry are localised.
   */
  _recordPhenomenon(key, vars = {}) {
    const title = this.i18n.t(`${key}.title`, vars);
    const text = this.i18n.t(`${key}.text`, vars);
    const id = `phen_${key.replace(/\W+/g, '_').slice(0, 40)}_${Math.floor(this.state.clock.stardate)}`;
    this.state.archive.add('phenomenon', id, { name: title, summary: text, meta: { at: this.state.clock.stardate } });
    this.state.bus.emit('civ:politics', { title, text, key });
  }

  /**
   * Assign civilisations to systems so the galaxy feels inhabited.
   * Deterministic given the galaxy seed.
   */
  assignPresence(galaxy) {
    for (const civ of this.all()) {
      const region = civ.template.homeRegion;
      const systems = galaxy.regionSystems(region);
      const rng = new Rng((galaxy.seed ^ hashString(civ.id)) >>> 0);
      const share = civ.template.traits?.includes('expansionist') ? 0.5 : 0.3;
      for (const s of systems) {
        if (rng.chance(share)) {
          s.civId = civ.id;
          civ.knownSystemIds.push(s.id);
        }
      }
      // Guarantee presence at the player's home system for the opening.
      const home = galaxy.home;
      if (home && region === 'orionSpur') home.civId = civ.id;
    }
  }

  /** Extinct civilisations, for the archive / archaeology UI. */
  extinct() {
    return this.state.data.civilizations.extinct;
  }

  serialize() {
    return [...this.instances.values()].map((c) => ({
      id: c.id,
      reputation: c.reputation,
      discovered: c.discovered,
      met: c.met,
      knownSystemIds: c.knownSystemIds,
      relations: c.relations,
      warWith: c.warWith,
      alliedWith: c.alliedWith,
      politics: c.politics,
      questsCompleted: c.questsCompleted ?? [],
    }));
  }

  deserialize(list) {
    for (const saved of list ?? []) {
      const civ = this.instances.get(saved.id);
      if (!civ) continue;
      Object.assign(civ, saved);
    }
  }
}
