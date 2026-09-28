/**
 * Coverage for the M0–M3 roadmap: data-driven hostiles, salvage, rescue tow,
 * cargo jettison, map filters, audio mixer (no AudioContext in Node).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAllData } from '../src/core/DataLoader.js';
import { GameState } from '../src/sim/GameState.js';
import { GameAudio } from '../src/core/Audio.js';

const data = await loadAllData();

function fresh() {
  const state = new GameState(data);
  state.newGame('roadmap-seed', 'Roadmap');
  return state;
}

test('hostiles pack is loaded and combat uses it', () => {
  assert.ok(data.hostiles.hostiles.pirate);
  assert.ok(data.hostiles.hostiles.zealot.reputationHit);
  const state = fresh();
  const spawned = state.combat.spawn(1, 'pirate');
  assert.equal(spawned[0].kind, 'pirate');
  assert.equal(spawned[0].nameKey, 'content.hostile.pirate.name');
});

test('destroying a hostile leaves a wreck that can be salvaged', () => {
  const state = fresh();
  state.ship.cargoCapacity = 10000;
  state.tech.unlockFromArtifact('wpn_laser');
  state.shipSystem.install('wpn_laser');
  state.combat.spawn(1, 'drone');
  const foe = state.combat.hostiles[0];
  foe.hp = 1;
  foe.shield = 0;
  const id = foe.id;
  for (let i = 0; i < 20 && state.combat.hostiles.length; i++) {
    state.clock.stardate += 0.01;
    state.combat.playerFire(id);
  }
  assert.equal(state.combat.hostiles.length, 0);
  assert.ok(state.combat.wrecks.length >= 1, 'wreck spawned');
  const before = state.resources.used;
  const res = state.combat.salvageWreck(state.combat.wrecks[0].id);
  assert.equal(res.ok, true);
  assert.ok(state.resources.used >= before);
  assert.equal(state.combat.wrecks.length, 0);
});

test('out-running hostiles clears combat', () => {
  const state = fresh();
  state.combat.spawn(1, 'pirate');
  state.location.position = { x: 9000, y: 0, z: 0 };
  state.combat.hostiles[0].position = { x: 0, y: 0, z: 0 };
  state.combat.update(0.016);
  assert.equal(state.combat.hostiles.length, 0);
});

test('rescue tow spends credits and returns home', () => {
  const state = fresh();
  const home = state.galaxy.home.id;
  state.ship.fuel = 0;
  state.player.credits = 20000;
  const far = state.galaxy.allSystems().find((s) => s.id !== home);
  state.location.systemId = far.id;
  state.location.system = far;
  const res = state.ftl.rescueTow();
  assert.equal(res.ok, true);
  assert.equal(state.location.systemId, home);
  assert.ok(state.ship.fuel > 0);
  assert.equal(state.player.credits, 20000 - 8000);
});

test('ship destruction jettisons a fraction of cargo', () => {
  const state = fresh();
  state.ship.cargoCapacity = 10000;
  state.resources.amounts = { iron: 100 };
  state.ship.shield = 0;
  state.ship.applyDamage(9999);
  assert.equal(state.ship.destroyed, true);
  assert.equal(state.resources.amount('iron'), 60);
});

test('GameAudio is inert without AudioContext', () => {
  const audio = new GameAudio({ values: { master: 1, sfx: 1, music: 1, ambient: 1 } });
  assert.doesNotThrow(() => {
    audio.sfx('fire');
    audio.setAmbience('space');
    audio.setThrust(0.5);
    audio.sync();
  });
});
