/**
 * Lightweight combat system: hostile drones, pirate ships and ancient
 * automatons. Combat is deliberately a minority activity - it exists to make
 * risk real, not to carry the game.
 *
 * Entity positions are plain {x,y,z} vectors so the simulation stays
 * renderer-agnostic.
 */
import { Rng, hashString } from '../core/Random.js';

// Speeds are in scene units/s: the player cruises at ~220 (boost ~520), so
// hostiles are a threat you can outrun but not ignore.
const HOSTILE_TYPES = {
  pirate: { name: 'Pirate Raider', hp: 90, shield: 30, damage: 9, speed: 150, bounty: 900, color: '#ff6b6b' },
  drone: { name: 'Automaton', hp: 60, shield: 20, damage: 7, speed: 175, bounty: 700, color: '#c77dff' },
  ancient: { name: 'Shepherd Servitor', hp: 220, shield: 120, damage: 22, speed: 120, bounty: 4200, color: '#4cc9f0' },
  zealot: { name: 'Vherrathi Patrol', hp: 140, shield: 70, damage: 14, speed: 165, bounty: 1500, color: '#ffd166' },
};

export class CombatSystem {
  constructor(state) {
    this.state = state;
    /** @type {Array<object>} */
    this.hostiles = [];
    this._idCounter = 0;
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
    const tpl = HOSTILE_TYPES[kind] ?? HOSTILE_TYPES.pirate;
    const playerPos = this.state.location.position ?? { x: 0, y: 0, z: 0 };
    for (let i = 0; i < count; i++) {
      const hp = Math.round(tpl.hp * rng.float(0.85, 1.2));
      this.hostiles.push({
        id: `h_${this._idCounter++}`,
        kind,
        name: tpl.name,
        hp,
        maxHp: hp,
        shield: Math.round(tpl.shield * rng.float(0.8, 1.2)),
        maxShield: Math.round(tpl.shield),
        damage: tpl.damage,
        speed: tpl.speed,
        bounty: tpl.bounty,
        color: tpl.color,
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
    if (!weapon || stats.damage <= 0) return { ok: false, reason: 'No weapon' };
    const target = targetId
      ? this.hostiles.find((h) => h.id === targetId)
      : this.hostiles[0];
    if (!target) return { ok: false, reason: 'No target' };

    const rng = new Rng((this.state.galaxy.seed ^ hashString(target.id + this.state.clock.stardate)) >>> 0);
    const damage = stats.damage * rng.float(0.85, 1.15);
    let remaining = damage;
    if (target.shield > 0) {
      const absorbed = Math.min(target.shield, remaining);
      target.shield -= absorbed;
      remaining -= absorbed;
    }
    target.hp -= remaining;
    this.state.bus.emit('combat:hit', { targetId: target.id, damage, shield: remaining <= 0 });
    if (target.hp <= 0) this._destroy(target);
    return { ok: true, damage, target: target.id };
  }

  _destroy(target) {
    target.alive = false;
    this.hostiles = this.hostiles.filter((h) => h.id !== target.id);
    this.state.player.credits += target.bounty;
    this.state.addXp(150 + target.bounty / 10);
    this.state.stats.hostilesDestroyed = (this.state.stats.hostilesDestroyed ?? 0) + 1;
    // Wreckage salvage.
    const rng = new Rng(hashString(target.id) ^ this.state.galaxy.seed);
    if (rng.chance(0.5)) {
      const res = rng.pick(['iron', 'nickel', 'rareMetals', 'superconductor']);
      const qty = rng.int(15, 70);
      this.state.resources.add(res, qty);
    }
    this.state.bus.emit('hostile:destroyed', { id: target.id, bounty: target.bounty });
    if (!this.hostiles.length) this.state.bus.emit('combat:ended', {});
  }

  /** Advance combat: hostiles approach and fire. */
  update(dt) {
    if (!this.hostiles.length) return;
    const playerPos = this.state.location.position ?? { x: 0, y: 0, z: 0 };
    const hazardResist = this.state.shipSystem.stats.hazardResist ?? 1;
    for (const h of this.hostiles) {
      const dx = playerPos.x - h.position.x;
      const dy = playerPos.y - h.position.y;
      const dz = playerPos.z - h.position.z;
      const dist = Math.max(1, Math.hypot(dx, dy, dz));
      if (dist > 260) {
        const k = (h.speed * dt) / dist;
        h.position.x += dx * k;
        h.position.y += dy * k;
        h.position.z += dz * k;
      }
      h.fireCooldown -= dt;
      if (h.fireCooldown <= 0 && dist < 700) {
        h.fireCooldown = 1.4;
        const dmg = h.damage / Math.max(0.4, hazardResist * 0.8);
        this.state.ship.applyDamage(dmg);
        this.state.bus.emit('combat:playerHit', { damage: dmg, hull: this.state.ship.hull });
      }
    }
  }

  serialize() {
    return { hostiles: this.hostiles };
  }

  deserialize(data) {
    this.hostiles = data?.hostiles ?? [];
  }
}
