/**
 * Archaeological investigation system.
 *
 * Artifacts are evidence, not loot. Each artifact supports one or more
 * galactic timeline events. A single piece of evidence produces a HYPOTHESIS
 * (an uncertain, arguable conclusion); a second, independent piece confirms
 * the event. Confirmed events advance the main mystery.
 *
 * Some artifacts carry a `techTag` which reconstructs an unknown technology
 * that cannot be researched conventionally.
 */
import { Rng } from '../core/Random.js';

export class ArchaeologySystem {
  constructor(state) {
    this.state = state;
    /** @type {Array<{uid, artifactId, sourceSystemId, siteId, analyzed, analyzedAt}>} */
    this.instances = [];
    /** eventId -> Set<artifactId> */
    this.eventEvidence = {};
    /** Timeline events the player has reconstructed. */
    this.revealedEvents = {};
  }

  get catalog() {
    return this.state.data.artifacts.artifacts;
  }

  artifactDef(id) {
    return this.catalog.find((a) => a.id === id) ?? null;
  }

  /** All artifacts that can appear at a ruin of the given civTag/era. */
  candidatesFor(civTag, era) {
    return this.catalog.filter((a) => a.civTag === civTag || a.civTag === 'unknown' || a.era === era);
  }

  /**
   * Place artifacts at a ruin site (deterministic from the site seed) and
   * return the artifact instance descriptors the player can excavate.
   */
  siteArtifacts(site) {
    const rng = new Rng(site.seed ^ 0xa17c);
    const pool = this.catalog.filter((a) => a.civTag === site.civTag || a.civTag === 'unknown' || a.era === site.era);
    const usable = pool.length ? pool : this.catalog;
    const out = [];
    for (let i = 0; i < site.artifactCount; i++) {
      const def = rng.pick(usable);
      out.push({ artifactId: def.id, siteId: site.id });
    }
    return out;
  }

  /** Create an inventory instance when the player excavates an artifact. */
  collect(artifactId, sourceSystemId, siteId) {
    const def = this.artifactDef(artifactId);
    if (!def) return null;
    const uid = `${artifactId}_${sourceSystemId}_${siteId}_${this.instances.length}`;
    const instance = {
      uid,
      artifactId,
      sourceSystemId,
      siteId,
      analyzed: false,
      analyzedAt: null,
      collectedAt: this.state.clock.stardate,
    };
    this.instances.push(instance);
    this.state.bus.emit('artifact:collected', { uid, artifactId, name: def.name });
    this.state.archive.add('artifact', artifactId, {
      name: def.name,
      summary: def.desc,
      meta: { type: def.type, civTag: def.civTag, era: def.era, analyzed: false },
    });
    return instance;
  }

  get collected() {
    return this.instances;
  }

  get analyzed() {
    return this.instances.filter((i) => i.analyzed);
  }

  /** Chance that analysis succeeds, from ship archaeology stats and skills. */
  analysisChance(artifactDef) {
    const stats = this.state.shipSystem.stats;
    const skill = this.state.skills.getEffects();
    const base = 0.35 + (stats.analysis - 1) * 0.25 + (stats.translation - 1) * 0.12;
    const tierPenalty = (artifactDef.tier - 1) * 0.06;
    const bonus = (skill.bonuses?.analysis ?? 0) * 0.3 + (skill.bonuses?.translation ?? 0) * 0.2;
    return Math.max(0.05, Math.min(0.98, base + bonus - tierPenalty));
  }

  /**
   * Analyse an artifact. Returns evidence gained and any technology
   * reconstructed. Analysis always yields *something* - a failed translation
   * still produces a partial reading (and a hypothesis, if lucky).
   */
  analyze(uid) {
    const instance = this.instances.find((i) => i.uid === uid);
    if (!instance) return { ok: false, reason: 'No such artifact' };
    const def = this.artifactDef(instance.artifactId);
    if (!def) return { ok: false, reason: 'Unknown artifact' };
    if (instance.analyzed) return { ok: false, reason: 'Already analysed' };

    const rng = new Rng((def.id.length * 2654435761) ^ (this.instances.length * 40503));
    const chance = this.analysisChance(def);
    const success = rng.chance(chance);

    instance.analyzed = true;
    instance.analyzedAt = this.state.clock.stardate;

    const researchGain = Math.round((def.tier * 90 + 60) * this.state.shipSystem.stats.research);
    this.state.research.points += researchGain;
    this.state.addXp(def.tier * 120 + 80);

    const evidence = [];
    let techUnlocked = null;
    let newEvents = [];
    let confirmedEvents = [];

    if (success) {
      for (const evId of def.supports ?? []) {
        if (!this.eventEvidence[evId]) this.eventEvidence[evId] = new Set();
        const alreadyHad = this.eventEvidence[evId].has(def.id);
        this.eventEvidence[evId].add(def.id);
        evidence.push(evId);
        if (!alreadyHad) {
          const status = this.eventStatus(evId);
          if (status === 'confirmed' && !this.revealedEvents[evId]?.confirmed) {
            confirmedEvents.push(evId);
          } else if (!this.revealedEvents[evId]) {
            newEvents.push(evId);
          }
        }
      }
      for (const evId of newEvents) {
        this.revealedEvents[evId] = { confirmed: false, at: this.state.clock.stardate, artifacts: [...this.eventEvidence[evId]] };
      }
      for (const evId of confirmedEvents) {
        this.revealedEvents[evId] = { confirmed: true, at: this.state.clock.stardate, artifacts: [...this.eventEvidence[evId]] };
        // Confirmation is a genuine discovery.
        this.state.addXp(300);
        this.state.research.points += 250;
      }

      if (def.techTag) {
        // techTag matches a technology's `requiresArtifact`; the technology is
        // reconstructed rather than researched.
        const techId = this.state.tech.techForArtifactTag(def.techTag);
        if (techId) {
          const res = this.state.tech.unlockFromArtifact(techId);
          if (res.ok) techUnlocked = res.tech;
        }
      }
    }

    // Update the archive record with findings.
    this.state.archive.add('artifact', def.id, {
      summary: success ? def.evidenceText : `Partial reading only: ${def.desc} The inscription resists full translation.`,
      meta: { type: def.type, civTag: def.civTag, era: def.era, analyzed: true, translated: success },
    });

    // Notify systems that track archaeology objectives.
    this.state.bus.emit('artifact:analyzed', {
      uid,
      artifactId: def.id,
      type: def.type,
      civTag: def.civTag,
      success,
      evidence,
      newEvents,
      confirmedEvents,
      techUnlocked,
      researchGain,
    });

    return {
      ok: true,
      success,
      artifact: def,
      evidence,
      newEvents,
      confirmedEvents,
      techUnlocked,
      researchGain,
      reading: success ? def.evidenceText : def.desc,
    };
  }

  eventStatus(evId) {
    const count = this.eventEvidence[evId]?.size ?? 0;
    if (count >= 2) return 'confirmed';
    if (count === 1) return 'hypothesis';
    return 'unknown';
  }

  /** Timeline events with their reconstruction status. */
  eventRecords() {
    const events = this.state.data.timeline.events;
    return events.map((e) => {
      const evidence = [...(this.eventEvidence[e.id] ?? [])];
      const status = this.eventStatus(e.id);
      return {
        ...e,
        status,
        evidence,
        evidenceNames: evidence.map((id) => this.artifactDef(id)?.name ?? id),
      };
    });
  }

  /** Timeline grouped by era. */
  timeline() {
    const eras = this.state.data.timeline.eras;
    const events = this.eventRecords();
    return eras.map((era) => ({
      ...era,
      events: events.filter((e) => e.era === era.id),
      known: events.filter((e) => e.era === era.id && e.status !== 'unknown').length,
    }));
  }

  /** Current stage of the main mystery. */
  mysteryStage() {
    const mystery = this.state.data.timeline.mystery;
    let stage = mystery.stages[0];
    for (const s of mystery.stages) {
      const ok = (s.requiresEvents ?? []).every((evId) => this.eventStatus(evId) === 'confirmed');
      if (ok) stage = s;
    }
    return { ...mystery, stage, stages: mystery.stages.map((s) => ({
      ...s,
      reached: (s.requiresEvents ?? []).every((evId) => this.eventStatus(evId) === 'confirmed'),
    })) };
  }

  /** Conflicting-evidence "hypotheses" the player can form from the evidence. */
  hypotheses() {
    const out = [];
    const rec = this.eventRecords();
    const war = rec.find((e) => e.id === 'evSunderingWar');
    const kill = rec.find((e) => e.id === 'evStarKilling');
    const vanish = rec.find((e) => e.id === 'evVanishing');
    const core = rec.find((e) => e.id === 'evCoreSignal');
    const shepherd = rec.find((e) => e.id === 'evShepherd');

    if (war && war.status !== 'unknown' && kill && kill.status !== 'unknown') {
      out.push({
        id: 'hyp_warTimestamps',
        title: 'The war records do not agree',
        text: 'Korrathi records claim the star-killings. Veshari observations predate them. One of the two civilisations was not measuring time the way we do.',
        confidence: Math.min(1, (war.evidence.length + kill.evidence.length) / 6),
      });
    }
    if (vanish && vanish.status !== 'unknown') {
      out.push({
        id: 'hyp_notCollapse',
        title: 'It was not a collapse',
        text: 'Nine centuries of orderly silence is not the signature of catastrophe. Civilisations ended in a sequence, and the sequence was chosen.',
        confidence: Math.min(1, vanish.evidence.length / 5),
      });
    }
    if (core && core.status !== 'unknown' && shepherd && shepherd.status !== 'unknown') {
      out.push({
        id: 'hyp_waiting',
        title: 'Something was waiting',
        text: 'The network answered a signal that predated its own architecture. The question was prepared in advance. The network was a test.',
        confidence: Math.min(1, (core.evidence.length + shepherd.evidence.length) / 6),
      });
    }
    return out;
  }

  onTechResearched(techId) {
    // Some conventional techs also advance the archaeological record.
    if (techId === 'q_chrono') this.state.bus.emit('archaeology:capability', { capability: 'precisionDating' });
  }

  serialize() {
    return {
      instances: this.instances,
      eventEvidence: Object.fromEntries(Object.entries(this.eventEvidence).map(([k, v]) => [k, [...v]])),
      revealedEvents: this.revealedEvents,
    };
  }

  deserialize(data) {
    if (!data) return;
    this.instances = data.instances ?? [];
    this.eventEvidence = Object.fromEntries(Object.entries(data.eventEvidence ?? {}).map(([k, v]) => [k, new Set(v)]));
    this.revealedEvents = data.revealedEvents ?? {};
  }
}
