/**
 * Dynamic narrative events.
 *
 * Events are weighted by context (in system, near a star, near a ruin, deep
 * space, anomaly field, civilisation present). Every event offers real choices
 * with consequences that persist (flags, reputation, artifacts, damage).
 */
import { Rng, hashString } from '../core/Random.js';

export class EventSystem {
  constructor(state) {
    this.state = state;
    this.current = null;
    this.cooldownUntil = 0;
    this.triggered = [];
  }

  get templates() {
    return this.state.data.events.events;
  }

  /** Context supplied by the flight state. */
  static contextFrom(system, extra = {}) {
    return {
      inSystem: !!system,
      nearStar: !!system,
      nearPlanet: !!system && system.planets.length > 0,
      nearRuin: !!system && system.ruins.length > 0,
      nearBlackHole: !!system && system.star.classId === 'blackHole',
      nearNeutron: !!system && (system.star.classId === 'neutron'),
      anomalyChance: system ? Math.min(1, system.anomalies.length * 0.5 + (system.regionId === 'unknownRegions' ? 0.6 : 0.1)) : 0,
      civPresent: !!system && !!system.civId,
      deepSpace: !!system && ['interstellar', 'galacticEdge', 'unknownRegions'].includes(system.regionId),
      ...extra,
    };
  }

  _matches(tpl, ctx) {
    const req = tpl.requires ?? {};
    for (const [k, v] of Object.entries(req)) {
      if (k === 'anomalyChance') {
        if (!(ctx.anomalyChance >= v)) return false;
      } else if (ctx[k] !== v) return false;
    }
    return true;
  }

  /**
   * Try to trigger an event. Returns the event or null.
   * Respects a cooldown so events feel like moments, not noise.
   */
  maybeRoll(ctx, minInterval = 45) {
    const now = this.state.clock.stardate;
    if (this.current) return null;
    if (now < this.cooldownUntil) return null;
    const rng = new Rng((this.state.galaxy.seed ^ Math.floor(now * 7) ^ hashString(JSON.stringify(ctx))) >>> 0);
    if (!rng.chance(0.35)) {
      this.cooldownUntil = now + minInterval * 0.5;
      return null;
    }
    const pool = this.templates.filter((t) => this._matches(t, ctx));
    if (!pool.length) return null;
    const tpl = rng.weighted(pool.map((t) => ({ item: t, weight: t.weight ?? 5 })));
    this.current = {
      id: tpl.id,
      title: tpl.title,
      text: tpl.text,
      choices: tpl.choices,
      at: now,
      context: ctx,
    };
    this.cooldownUntil = now + minInterval;
    this.triggered.push(this.current.id);
    this.state.bus.emit('event:triggered', this.current);
    this.state.archive.add('event', `dyn_${tpl.id}_${Math.floor(now)}`, {
      name: tpl.title,
      summary: tpl.text,
      meta: { at: now, dynamic: true },
    });
    return this.current;
  }

  /** Apply a choice by index. */
  choose(index) {
    const ev = this.current;
    if (!ev) return { ok: false };
    const choice = ev.choices[index];
    if (!choice) return { ok: false };
    const effects = choice.effects ?? {};
    const results = [];

    if (effects.credits) {
      this.state.player.credits += effects.credits;
      results.push({ type: 'credits', amount: effects.credits });
    }
    if (effects.research) {
      this.state.research.points += effects.research;
      results.push({ type: 'research', amount: effects.research });
    }
    if (effects.fuel) {
      this.state.ship.fuel = Math.max(0, this.state.ship.fuel + effects.fuel);
      results.push({ type: 'fuel', amount: effects.fuel });
    }
    if (effects.hull) {
      if (effects.hull < 0) this.state.ship.applyDamage(-effects.hull);
      else this.state.ship.repair(effects.hull);
      results.push({ type: 'hull', amount: effects.hull });
    }
    if (effects.shield) {
      this.state.ship.shield = Math.max(0, this.state.ship.shield + effects.shield);
      results.push({ type: 'shield', amount: effects.shield });
    }
    if (effects.giveResource) {
      for (const [id, qty] of Object.entries(effects.giveResource)) {
        this.state.resources.add(id, qty);
        results.push({ type: 'resource', id, amount: qty });
      }
    }
    if (effects.resources) {
      // A cache of supplies from the local system.
      const sys = this.state.location.system;
      const rng = new Rng((this.state.galaxy.seed ^ Math.floor(this.state.clock.stardate)) >>> 0);
      const count = rng.int(2, 4);
      for (let i = 0; i < count; i++) {
        const id = sys?.planets.length
          ? rng.pick(sys.planets.flatMap((p) => p.resources.map((r) => r.id)))
          : rng.pick(['iron', 'hydrogen', 'silicon']);
        const qty = rng.int(20, 90);
        this.state.resources.add(id, qty);
        results.push({ type: 'resource', id, amount: qty });
      }
    }
    if (effects.reputation) {
      for (const [civ, delta] of Object.entries(effects.reputation)) {
        this.state.civs.adjustReputation(civ, delta);
        results.push({ type: 'reputation', civ, amount: delta });
      }
    }
    if (effects.artifact) {
      const artifact = this._grantArtifact();
      results.push({ type: 'artifact', artifact });
    }
    if (effects.quest) {
      this.state.quests.start(effects.quest);
      results.push({ type: 'quest', id: effects.quest });
    }
    if (effects.combat) {
      this.state.combat.spawn(2 + Math.floor(Math.random() * 2));
      results.push({ type: 'combat', count: 3 });
    }
    if (effects.flag) {
      this.state.flags[effects.flag] = true;
    }
    this.state.addXp(120);

    this.state.bus.emit('event:resolved', { event: ev, choice, outcome: choice.outcome, results });
    this.current = null;
    return { ok: true, choice, outcome: choice.outcome, results };
  }

  /** Grant a random artifact (weighted toward the player's current region). */
  _grantArtifact() {
    const catalog = this.state.archaeology.catalog;
    const rng = new Rng((this.state.galaxy.seed ^ Math.floor(this.state.clock.stardate * 13)) >>> 0);
    const def = rng.weighted(catalog.map((a) => ({ item: a, weight: a.tier <= 2 ? 3 : a.tier === 3 ? 2 : 1 })));
    const instance = this.state.archaeology.collect(def.id, this.state.location.systemId, 'event');
    return instance ? def : null;
  }

  dismiss() {
    this.current = null;
  }

  serialize() {
    return { triggered: this.triggered.slice(-100), cooldownUntil: this.cooldownUntil };
  }

  deserialize(data) {
    if (!data) return;
    this.triggered = data.triggered ?? [];
    this.cooldownUntil = data.cooldownUntil ?? 0;
  }
}
