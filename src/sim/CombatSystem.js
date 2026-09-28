/**
 * Lightweight combat system: hostile drones, pirate ships and ancient
 * automatons. Combat is deliberately a minority activity - it exists to make
 * risk real, not to carry the game.
 *
 * Archetypes live in data/hostiles.json. Entity positions are plain {x,y,z}
 * so the simulation stays renderer-agnostic.
 */
import { Rng, hashString } from '../core/Random.js';

const FALLBACK = {
  pirate: { id: 'pirate', hp: 90, shield: 30, damage: 9, speed: 150, bounty: 900, color: '#ff6b6b', weaponRange: 700, approach: 260, fireInterval: 1.4, salvage: ['iron', 'nickel'], reputationHit: null },
};

export class CombatSystem {
  constructor(state) {
    this.state = state;
    /** @type {Array<object>} */
    this.hostiles = [];
    /** @type {Array<object>} wrecks waiting to be scooped */
    this.wrecks = [];
    this._idCounter = 0;
    this.disengageRange = 2400;
  }

  get templates() {
    return this.state.data.hostiles?.hostiles ?? FALLBACK;
  }

  template(kind) {
    return this.templates[kind] ?? this.templates.pirate ?? FALLBACK.pirate;
  }

  get inCombat() {
    return this.hostiles.length > 0;
  }

  /** Spawn hostiles near the player. */
  spawn(count = 2, type = null) {
    const rng = new Rng((this.state.galaxy.seed ^ hashString(String(this.state.clock.stardate))) >>> 0);
    const system = this.state.location.system;
    let kind = type;
    if (!kind) {
      const options = ['pirate', 'drone'];
      if (system?.regionId === 'unknownRegions') options.push('ancient');
      if (system?.civId === 'vherrathi') options.push('zealot');
      kind = rng.pick(options);
    }
    const tpl = this.template(kind);
    const playerPos = this.state.location.position ?? { x: 0, y: 0, z: 0 };
    for (let i = 0; i < count; i++) {
      const hp = Math.round(tpl.hp * rng.float(0.85, 1.2));
      this.hostiles.push({
        id: `h_${this._idCounter++}`,
        kind: tpl.id,
        nameKey: `content.hostile.${tpl.id}.name`,
        name: tpl.id,
        hp,
        maxHp: hp,
        shield: Math.round(tpl.shield * rng.float(0.8, 1.2)),
        maxShield: Math.round(tpl.shield),
        damage: tpl.damage,
        speed: tpl.speed,
        bounty: tpl.bounty,
        color: tpl.color,
        weaponRange: tpl.weaponRange ?? 700,
        approach: tpl.approach ?? 260,
        fireInterval: tpl.fireInterval ?? 1.4,
        salvage: tpl.salvage ?? ['iron'],
        reputationHit: tpl.reputationHit ?? null,
        position: {
          x: playerPos.x + rng.float(-400, 400),
          y: playerPos.y + rng.float(-150, 150),
          z: playerPos.z + rng.float(-400, 400),
        },
        velocity: { x: 0, y: 0, z: 0 },
        fireCooldown: rng.float(0.5, 2),
        alive: true,
      });
    }
    this.state.bus.emit('combat:started', { count });
    return this.hostiles.slice(-count);
  }

  clear() {
    this.hostiles = [];
    this.state.bus.emit('combat:ended', {});
  }

  /** Player fires at the nearest hostile in front. Returns hit info. */
  playerFire(targetId = null) {
    const weapon = this.state.shipSystem.installed('weapon');
    const stats = this.state.shipSystem.stats;
    if (!weapon || stats.damage <= 0) return { ok: false, reason: 'No weapon', reasonKey: 'combat.noWeapon' };
    const target = targetId
      ? this.hostiles.find((h) => h.id === targetId)
      : this.hostiles[0];
    if (!target) return { ok: false, reason: 'No target', reasonKey: 'combat.noTarget' };

    const rng = new Rng((this.state.galaxy.seed ^ hashString(target.id + this.state.clock.stardate)) >>> 0);
    const damage = stats.damage * rng.float(0.85, 1.15);
    let remaining = damage;
    let hitShield = false;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
      hitShield = absorbed > 0;
    }
    target.hp -= remaining;
    this.state.bus.emit('combat:hit', {
      targetId: target.id, damage, shield: hitShield && remaining <= 0, hull: remaining > 0,
    });
    if (target.hp <= 0) this._destroy(target);
    return { ok: true, damage, target: target.id, shieldHit: hitShield };
  }

  _destroy(target) {
    target.alive = false;
    this.hostiles = this.hostiles.filter((h) => h.id !== target.id);
    this.state.player.credits += target.bounty;
    this.state.addXp(150 + target.bounty / 10);
    this.state.stats.hostilesDestroyed = (this.state.stats.hostilesDestroyed ?? 0) + 1;
    const rng = new Rng(hashString(target.id) ^ this.state.galaxy.seed);
    const salvageId = rng.pick(target.salvage?.length ? target.salvage : ['iron']);
    const qty = rng.int(15, 70);
    this.wrecks.push({
      id: `w_${target.id}`,
      resource: salvageId,
      qty,
      position: { ...target.position },
    });
    this.state.bus.emit('wreck:spawned', { id: `w_${target.id}`, resource: salvageId, qty });
    if (target.reputationHit?.civId) {
      this.state.civs.adjustReputation(target.reputationHit.civId, target.reputationHit.amount);
    }
    this.state.bus.emit('hostile:destroyed', { id: target.id, bounty: target.bounty, kind: target.kind });
    if (!this.hostiles.length) this.state.bus.emit('combat:ended', {});
  }

  /** Scoop a wreck into cargo. */
  salvageWreck(wreckId) {
    const w = this.wrecks.find((x) => x.id === wreckId);
    if (!w) return { ok: false, reasonKey: 'combat.noWreck' };
    const stored = this.state.resources.add(w.resource, w.qty);
    this.wrecks = this.wrecks.filter((x) => x.id !== wreckId);
    this.state.bus.emit('wreck:salvaged', { id: wreckId, resource: w.resource, qty: stored });
    return { ok: true, resource: w.resource, qty: stored };
  }

  salvageNearest(maxDist = 120) {
    const pos = this.state.location.position ?? { x: 0, y: 0, z: 0 };
    let best = null;
    let bestD = maxDist;
    for (const w of this.wrecks) {
      const d = Math.hypot(w.position.x - pos.x, w.position.y - pos.y, w.position.z - pos.z);
      if (d < bestD) { best = w; bestD = d; }
    }
    if (!best) return { ok: false, reasonKey: 'combat.noWreck' };
    return this.salvageWreck(best.id);
  }

  /** Advance combat: hostiles approach and fire. Player can outrun them. */
  update(dt) {
    if (!this.hostiles.length) return;
    const playerPos = this.state.location.position ?? { x: 0, y: 0, z: 0 };
    const hazardResist = this.state.shipSystem.stats.hazardResist ?? 1;
    const still = [];
    for (const h of this.hostiles) {
      const dx = playerPos.x - h.position.x;
      const dy = playerPos.y - h.position.y;
      const dz = playerPos.z - h.position.z;
      const dist = Math.max(1, Math.hypot(dx, dy, dz));
      if (dist > this.disengageRange) {
        this.state.bus.emit('combat:escaped', { id: h.id });
        continue;
      }
      const approach = h.approach ?? 260;
      if (dist > approach) {
        const k = (h.speed * dt) / dist;
        h.position.x += dx * k;
        h.position.y += dy * k;
        h.position.z += dz * k;
      }
      h.fireCooldown -= dt;
      const range = h.weaponRange ?? 700;
      if (h.fireCooldown <= 0 && dist < range) {
        h.fireCooldown = h.fireInterval ?? 1.4;
        const dmg = h.damage / Math.max(0.4, hazardResist * 0.8);
        this.state.ship.applyDamage(dmg);
        this.state.bus.emit('combat:playerHit', { damage: dmg, hull: this.state.ship.hull, shield: this.state.ship.shield });
      }
      still.push(h);
    }
    this.hostiles = still;
    if (!this.hostiles.length) this.state.bus.emit('combat:ended', {});
  }

  serialize() {
    return { hostiles: this.hostiles, wrecks: this.wrecks };
  }

  deserialize(data) {
    this.hostiles = data?.hostiles ?? [];
    this.wrecks = data?.wrecks ?? [];
  }
}
