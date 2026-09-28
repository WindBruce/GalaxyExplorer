/**
 * Quest system: data-driven templates instantiated with concrete targets
 * resolved against the live galaxy, so objectives always point at real
 * systems, planets, ruins and civilisations.
 */
import { Rng, hashString } from '../core/Random.js';

export class QuestSystem {
  constructor(state) {
    this.state = state;
    /** @type {Array<object>} */
    this.active = [];
    /** @type {Array<object>} */
    this.completed = [];
    this.failed = [];
    /** Quest ids the player has unlocked (available to start). */
    this.unlocked = [];
    this._wireEvents();
  }

  get templates() {
    return this.state.data.quests.quests;
  }

  template(id) {
    return this.templates.find((q) => q.id === id) ?? null;
  }

  /** Quests that can be started right now. */
  available() {
    const out = [];
    for (const tpl of this.templates) {
      if (this.isActive(tpl.id) || this.completed.some((q) => q.id === tpl.id)) continue;
      if (!this.unlocked.includes(tpl.id)) continue;
      out.push(tpl);
    }
    return out;
  }

  /** Unlock a quest for the player (does not start it). */
  unlock(questId) {
    if (this.unlocked.includes(questId)) return false;
    this.unlocked.push(questId);
    const tpl = this.template(questId);
    if (tpl) {
      this.state.bus.emit('quest:available', { id: questId, title: tpl.title });
      this.state.archive.add('event', `quest_${questId}`, {
        name: `Contract: ${tpl.title}`,
        summary: tpl.description,
        meta: { giver: tpl.giver, category: tpl.category },
      });
    }
    return true;
  }

  isActive(id) {
    return this.active.some((q) => q.id === id);
  }

  get(id) {
    return this.active.find((q) => q.id === id) ?? this.completed.find((q) => q.id === id) ?? null;
  }

  /** Start a quest, resolving 'any' targets against the galaxy. */
  start(questId) {
    const tpl = this.template(questId);
    if (!tpl) return { ok: false, reason: 'Unknown quest', reasonKey: 'sim.unknownQuest' };
    if (this.isActive(questId)) return { ok: false, reason: 'Already active', reasonKey: 'sim.questActive' };
    if (this.completed.some((q) => q.id === questId)) {
      return { ok: false, reason: 'Already completed', reasonKey: 'sim.questComplete' };
    }

    const objectives = tpl.objectives.map((o, i) => this._resolveObjective(questId, o, i));
    const quest = {
      id: tpl.id,
      title: tpl.title,
      giver: tpl.giver,
      category: tpl.category,
      chain: tpl.chain,
      description: tpl.description,
      objectives,
      startedAt: this.state.clock.stardate,
      rewards: tpl.rewards,
      state: 'active',
    };
    this.active.push(quest);
    this.state.bus.emit('quest:started', { id: questId, title: tpl.title, objectives });
    this.state.addXp(50);
    return { ok: true, quest };
  }

  /** Resolve an objective template into a concrete, trackable objective. */
  _resolveObjective(questId, o, index) {
    const galaxy = this.state.galaxy;
    const obj = { ...o, index, progress: 0, required: o.count ?? 1, done: false, targetId: null, targetName: null };
    const rng = new Rng((galaxy.seed ^ hashString(questId + o.type + index)) >>> 0);

    switch (o.type) {
      case 'travelTo': {
        const candidates = galaxy.find((s) => {
          if (s.visited) return false;
          if (o.region && s.regionId !== o.region) return false;
          if (o.hasRuin && !s.ruins.length) return false;
          return true;
        }, 12);
        const pick = candidates.length ? rng.pick(candidates) : galaxy.home;
        obj.targetId = pick.id;
        obj.targetName = pick.name;
        obj.region = o.region ?? pick.regionId;
        break;
      }
      case 'scanBody': {
        if (o.target === 'anyRuin') {
          const ruin = galaxy.find((s) => s.ruins.length > 0 && !s.visited).flatMap((s) => s.ruins)[0];
          if (ruin) { obj.targetId = ruin.id; obj.targetName = ruin.name; }
        } else if (o.target === 'anyDerelict') {
          const st = galaxy.find((s) => s.stations.some((x) => x.derelict)).flatMap((s) => s.stations.filter((x) => x.derelict))[0];
          if (st) { obj.targetId = st.id; obj.targetName = st.name; }
        }
        break;
      }
      case 'landOnPlanet': {
        const sys = galaxy.find((s) => s.ruins.length > 0 && s.planets.some((p) => p.landable));
        if (sys) {
          const ruin = sys.ruins[0];
          const planet = sys.planets.find((p) => p.id === ruin.planetId) ?? sys.planets.find((p) => p.landable);
          if (planet) { obj.targetId = planet.id; obj.targetName = planet.name; obj.systemId = sys.id; }
        }
        break;
      }
      case 'collectResource':
        obj.targetId = o.resource;
        obj.targetName = this.state.data.resources[o.resource]?.name ?? o.resource;
        obj.required = o.count ?? 1;
        break;
      case 'analyzeArtifact':
        obj.artifactType = o.artifactType ?? null;
        break;
      case 'reachReputation':
        obj.targetId = o.civ;
        obj.targetName = this.state.civs.get(o.civ)?.name ?? o.civ;
        break;
      case 'researchTech':
        obj.targetId = o.target;
        obj.targetName = this.state.tech.nameOf(o.target);
        break;
      case 'returnTo':
      case 'talkTo':
        obj.targetId = o.civ;
        obj.targetName = this.state.civs.get(o.civ)?.name ?? o.civ;
        break;
      case 'scanSystem':
        obj.region = o.region ?? null;
        break;
      default:
        break;
    }
    return obj;
  }

  /** Progress an objective. Returns true if it (newly) completed. */
  _advance(quest, obj, amount = 1) {
    if (obj.done) return false;
    obj.progress = Math.min(obj.required, obj.progress + amount);
    if (obj.progress >= obj.required) {
      obj.done = true;
      this.state.bus.emit('quest:objective', { questId: quest.id, title: quest.title, objective: obj.desc ?? obj.type });
      return true;
    }
    return false;
  }

  _wireEvents() {
    const bus = this.state.bus;

    bus.on('travel:complete', ({ systemId }) => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'travelTo' && !o.done && (!o.targetId || o.targetId === systemId)) this._advance(q, o);
          if (o.type === 'scanSystem' && o.region) {
            const sys = this.state.galaxy.getSystem(systemId);
            if (sys && sys.regionId === o.region) this._advance(q, o);
          }
        }
      }
      this._checkCompletion();
    });

    bus.on('scan:system', ({ systemId, regionId }) => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'scanSystem' && !o.done && (!o.region || o.region === regionId)) this._advance(q, o);
          if (o.type === 'travelTo' && o.targetId === systemId) this._advance(q, o);
        }
      }
      this._checkCompletion();
    });

    bus.on('scan:body', ({ bodyId, kind }) => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'scanBody' && !o.done) {
            if (!o.targetId || o.targetId === bodyId) this._advance(q, o);
          }
          if (o.type === 'scanAnomaly' && kind === 'anomaly') this._advance(q, o);
        }
      }
      this._checkCompletion();
    });

    bus.on('resource:gained', ({ id, qty }) => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'collectResource' && !o.done && o.targetId === id) this._advance(q, o, qty);
        }
      }
      this._checkCompletion();
    });

    bus.on('artifact:analyzed', ({ type, artifactId }) => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'analyzeArtifact' && !o.done && (!o.artifactType || o.artifactType === type)) this._advance(q, o);
        }
      }
      this._checkCompletion();
    });

    bus.on('ruin:discovered', () => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'discoverRuin' && !o.done) this._advance(q, o);
        }
      }
      this._checkCompletion();
    });

    bus.on('landing', ({ planetId }) => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'landOnPlanet' && !o.done && (!o.targetId || o.targetId === planetId)) this._advance(q, o);
        }
      }
      this._checkCompletion();
    });

    bus.on('hostile:destroyed', () => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'defeatHostiles' && !o.done) this._advance(q, o);
        }
      }
      this._checkCompletion();
    });

    bus.on('tech:researched', ({ id }) => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'researchTech' && !o.done && o.targetId === id) this._advance(q, o);
        }
      }
      this._checkCompletion();
    });

    bus.on('civ:discovered', ({ id }) => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if (o.type === 'discoverCiv' && !o.done && o.targetId === id) this._advance(q, o);
        }
      }
      this._checkCompletion();
    });

    bus.on('dialogue:end', ({ civId }) => {
      for (const q of this.active) {
        for (const o of q.objectives) {
          if ((o.type === 'returnTo' || o.type === 'talkTo') && !o.done && o.targetId === civId) this._advance(q, o);
        }
      }
      this._checkCompletion();
    });
  }

  _checkCompletion() {
    for (const q of [...this.active]) {
      if (q.objectives.every((o) => o.done)) {
        this.complete(q.id);
      }
    }
  }

  complete(id) {
    const idx = this.active.findIndex((q) => q.id === id);
    if (idx < 0) return { ok: false };
    const quest = this.active.splice(idx, 1)[0];
    quest.state = 'completed';
    quest.completedAt = this.state.clock.stardate;
    this.completed.push(quest);

    const r = quest.rewards ?? {};
    if (r.credits) this.state.player.credits += r.credits;
    if (r.research) this.state.research.points += r.research;
    if (r.xp) this.state.addXp(r.xp);
    if (r.resources) {
      for (const [res, qty] of Object.entries(r.resources)) this.state.resources.add(res, qty);
    }
    if (r.reputation && quest.giver && quest.giver !== 'unknown') {
      this.state.civs.adjustReputation(quest.giver, r.reputation / 100);
      this.state.civs.get(quest.giver)?.questsCompleted.push(quest.id);
    }
    if (r.unlockQuest) this.unlock(r.unlockQuest);

    this.state.bus.emit('quest:completed', { id: quest.id, title: quest.title, rewards: r });
    this.state.archive.add('event', `quest_done_${quest.id}`, {
      name: `Completed: ${quest.title}`,
      summary: quest.description,
      meta: { giver: quest.giver, rewards: r },
    });
    return { ok: true, quest, rewards: r };
  }

  abandon(id) {
    const idx = this.active.findIndex((q) => q.id === id);
    if (idx < 0) return false;
    const [quest] = this.active.splice(idx, 1);
    quest.state = 'abandoned';
    this.failed.push(quest);
    this.state.bus.emit('quest:abandoned', { id, title: quest.title });
    return true;
  }

  /** Objectives display helper. */
  describe(quest) {
    return quest.objectives.map((o) => ({
      text: o.desc ?? o.type,
      done: o.done,
      progress: o.required > 1 ? `${o.progress}/${o.required}` : null,
      target: o.targetName,
    }));
  }

  serialize() {
    return {
      active: this.active,
      completed: this.completed.map((q) => q.id),
      unlocked: this.unlocked,
    };
  }

  deserialize(data) {
    if (!data) return;
    this.active = data.active ?? [];
    this.completed = (data.completed ?? []).map((id) => ({ id, title: this.template(id)?.title ?? id, rewards: {} }));
    this.unlocked = data.unlocked ?? [];
  }
}
