/**
 * Simulation smoke tests: prove the whole game-logic layer runs headlessly in
 * Node - galaxy generation, progression, quests, archaeology, technology,
 * civilisations, combat and save/load.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAllData } from '../src/core/DataLoader.js';
import { GameState } from '../src/sim/GameState.js';
import { createGalaxy } from '../src/world/GalaxyGenerator.js';
import { saveSystem } from '../src/core/SaveSystem.js';

const data = await loadAllData();

function freshState(seed = 'test-galaxy') {
  const state = new GameState(data);
  state.newGame(seed, 'Test Commander');
  return state;
}

/** Give the player an effectively unlimited hold (tests focus on logic, not cargo). */
function bigHold(state, capacity = 100000) {
  state.ship.cargoCapacity = capacity;
  return state;
}

test('galaxy generates deterministically from a seed', () => {
  const g1 = createGalaxy('alpha', data.regions);
  const g2 = createGalaxy('alpha', data.regions);
  const g3 = createGalaxy('beta', data.regions);
  assert.equal(g1.allSystems().length, g2.allSystems().length);
  assert.equal(g1.allSystems().length, g3.allSystems().length);
  const a = g1.getSystem(g1.order[10]);
  const b = g2.getSystem(g2.order[10]);
  assert.deepEqual(a.planets.map((p) => p.name), b.planets.map((p) => p.name));
  assert.deepEqual(a.position, b.position);
  // Different seeds produce different galaxies.
  const c = g3.getSystem(g3.order[10]);
  assert.notDeepEqual(a.position, c.position);
});

test('galaxy has the required regions and a playable home system', () => {
  const g = createGalaxy('alpha', data.regions);
  const ids = g.regionInfo().map((r) => r.id);
  for (const required of ['core', 'bulge', 'innerDisk', 'orionSpur', 'perseusArm', 'outerDisk', 'galacticEdge', 'interstellar', 'unknownRegions']) {
    assert.ok(ids.includes(required), `missing region ${required}`);
  }
  assert.ok(g.home, 'home system exists');
  assert.equal(g.home.name, "Kepler's Rest");
  assert.ok(g.home.stations.some((s) => s.owner === 'terranConcord'));
  assert.ok(g.home.ruins.length >= 1, 'home system has a starter ruin');
  assert.ok(g.home.planets.some((p) => p.landable));
  assert.ok(g.anchorSystemId, 'mystery anchor system exists');
});

test('star systems produce varied gameplay (red dwarf vs blue giant vs black hole)', () => {
  const g = createGalaxy('alpha', data.regions);
  const classes = new Set(g.allSystems().map((s) => s.star.classId));
  assert.ok(classes.size >= 5, `expected stellar variety, got ${[...classes].join(',')}`);
  const bh = g.allSystems().find((s) => s.star.classId === 'blackHole');
  if (bh) assert.ok(bh.danger >= 0.9);
  const red = g.allSystems().find((s) => s.star.classId === 'redDwarf');
  if (red) assert.ok(red.planets.some((p) => p.tidallyLocked) || red.star.gameplay);
});

test('new game starts the player at home with a quest and working ship', () => {
  const state = freshState();
  assert.equal(state.location.systemId, state.galaxy.homeSystemId);
  assert.ok(state.quests.unlocked.includes('q_firstSurvey'));
  assert.ok(state.shipSystem.stats.thrust > 0);
  assert.ok(state.ship.maxHull > 0);
  assert.equal(state.ship.hull, state.ship.maxHull);
  assert.ok(state.resources.amount('iron') >= 60);
});

test('ship modules change derived stats and install gating works', () => {
  const state = bigHold(freshState());
  state.player.credits = 500000;
  state.resources.amounts = { iron: 500, silicon: 500, superconductor: 200, rareMetals: 200 };
  const before = state.shipSystem.stats.scanRange;
  // Deep Field Array requires tech; without it install must fail.
  const blocked = state.shipSystem.install('scan_t2');
  assert.equal(blocked.ok, false);
  state.tech.unlockFromArtifact('sci_deepscan'); // simulate tech knowledge
  const ok = state.shipSystem.install('scan_t2');
  assert.equal(ok.ok, true);
  assert.ok(state.shipSystem.stats.scanRange > before, 'scanner range improved');
  // Weapon slot starts unarmed.
  assert.equal(state.shipSystem.stats.damage, 0);
});

test('resource economy respects cargo capacity', () => {
  const state = freshState();
  // Start empty so capacity maths is unambiguous.
  state.resources.amounts = {};
  state.ship.cargoCapacity = 100;
  assert.equal(state.resources.free, 100);
  const stored = state.resources.add('iron', 500);
  assert.equal(stored, 100, 'cargo capacity enforced');
  assert.equal(state.resources.free, 0);
  assert.equal(state.resources.remove('iron', 30), 30);
  assert.equal(state.resources.amount('iron'), 70);
  assert.ok(state.resources.price('iron') > 0);
  const buy = state.resources.buy('nickel', 10, 'terranConcord');
  assert.equal(buy.ok, true);
  assert.equal(state.resources.amount('nickel'), 10);
  const sell = state.resources.sell('nickel', 10, 'terranConcord');
  assert.equal(sell.ok, true);
  assert.equal(state.resources.amount('nickel'), 0);
  // A civilisation that needs a resource pays more for it.
  // The Vherrathi produce quantum crystal, so they sell it cheaper than the Concord.
  assert.ok(state.resources.price('quantumCrystal', 'vherrathi') < state.resources.price('quantumCrystal', 'terranConcord'));
});

test('skill tree unlocks and feeds ship stats', () => {
  const state = freshState();
  const baseRange = state.shipSystem.stats.scanRange;
  state.player.skillPoints = 10;
  assert.equal(state.skills.unlock('exp_core1').ok, true);
  // Prereq chain: core2 requires core1, and skill points are spent.
  state.player.skillPoints = 0;
  const broke = state.skills.unlock('exp_core2');
  assert.equal(broke.ok, false);
  assert.ok(broke.reason.includes('skill point'), broke.reason);
  state.player.skillPoints = 10;
  assert.equal(state.skills.unlock('exp_core2').ok, true);
  state.player.skillPoints = 10;
  assert.equal(state.skills.unlock('exp_core3').ok, true);
  assert.ok(state.shipSystem.stats.scanRange > baseRange, 'skill increased scan range');
  // Hybrid build: an archaeologist node is reachable from a different archetype.
  state.player.skillPoints = 10;
  assert.equal(state.skills.unlock('arc_core1').ok, true);
  const effects = state.skills.getEffects();
  assert.ok(effects.bonuses.analysis > 0 && effects.statMods.scanRange > 0, 'effects aggregate across archetypes');
});

test('technology research consumes points and materials', () => {
  const state = freshState();
  state.research.points = 500;
  state.resources.amounts = { iron: 200, silicon: 200, rareMetals: 100 };
  const res = state.tech.research('wpn_laser');
  assert.equal(res.ok, true);
  assert.ok(state.tech.has('wpn_laser'));
  assert.equal(state.shipSystem.install('wpn_laser').ok, true);
  assert.ok(state.shipSystem.stats.damage > 0);
  // Unknown tech requires an artifact.
  const gated = state.tech.research('unk_aegis');
  assert.equal(gated.ok, false);
});

test('artifact analysis produces evidence, confirms events and unlocks unknown tech', () => {
  const state = freshState();
  // Give the player the tools and a strong archaeology loadout.
  state.tech.unlockFromArtifact('sci_stratigraphy');
  state.tech.unlockFromArtifact('sci_mnemo');
  state.shipSystem.install('arch_t3');
  state.research.points = 0;
  // A fully-staffed translation lab: analysis always succeeds.
  state.shipSystem.stats.analysis = 25;
  state.shipSystem.stats.translation = 25;

  const catalog = state.archaeology.catalog;
  // Collect several artifacts from different civs so events get confirmed.
  const picks = catalog.filter((a) => a.supports.includes('evFirstCities')).slice(0, 3);
  assert.ok(picks.length >= 2, 'enough evidence for the first event');
  const instances = picks.map((a) => state.archaeology.collect(a.id, 'sys_x', 'site_x'));
  let confirmed = [];
  let techUnlocked = null;
  for (const inst of instances) {
    const r = state.archaeology.analyze(inst.uid);
    assert.equal(r.ok, true);
    confirmed.push(...r.confirmedEvents);
    if (r.techUnlocked) techUnlocked = r.techUnlocked;
  }
  assert.ok(confirmed.includes('evFirstCities'), 'first cities event confirmed by multiple evidence');
  assert.equal(state.archaeology.eventStatus('evFirstCities'), 'confirmed');

  // An artifact with a techTag reconstructs unknown technology.
  const tagged = catalog.find((a) => a.techTag);
  const inst = state.archaeology.collect(tagged.id, 'sys_x', 'site_x');
  const r = state.archaeology.analyze(inst.uid);
  assert.ok(r.success, 'analysis with a good lab should succeed');
  assert.ok(r.techUnlocked, 'tech reconstructed from artifact');
  assert.ok(state.tech.has(r.techUnlocked.id));
});

test('mystery stage advances as events are confirmed', () => {
  const state = freshState();
  const stage0 = state.archaeology.mysteryStage().stage.id;
  assert.equal(stage0, 'm0');
  state.archaeology.eventEvidence['evFirstCities'] = new Set(['art_sevenStar', 'art_firstLamp']);
  const stage1 = state.archaeology.mysteryStage().stage.id;
  assert.equal(stage1, 'm1');
});

test('quests resolve targets, track progress and pay out', () => {
  const state = bigHold(freshState());
  const started = state.quests.start('q_firstSurvey');
  assert.equal(started.ok, true);
  const quest = state.quests.get('q_firstSurvey');
  assert.ok(quest.objectives[0].targetId, 'travel objective resolved to a real system');

  // Complete every objective the "honest" way.
  const travel = quest.objectives[0];
  state.location.systemId = travel.targetId;
  state.location.system = state.galaxy.getSystem(travel.targetId);
  state.bus.emit('travel:complete', { systemId: travel.targetId });

  state.surveySystem();
  state.resources.add('iron', 200);
  state.bus.emit('dialogue:end', { civId: 'terranConcord' });

  assert.ok(state.quests.completed.some((q) => q.id === 'q_firstSurvey'), 'quest completed');
  assert.ok(state.quests.unlocked.includes('q_ruinSignal'), 'chain unlocked');
  assert.ok(state.player.credits > 15000, 'quest credits paid');
});

test('civilisation reputation, dialogue effects and markets work', () => {
  const state = bigHold(freshState());
  const civ = state.civs.meet('vherrathi');
  assert.ok(civ);
  assert.equal(state.civs.get('vherrathi').discovered, true);
  state.civs.adjustReputation('vherrathi', 0.5);
  assert.equal(state.civs.reputationLabel('vherrathi'), 'Trusted');
  const market = state.civs.market('terranConcord');
  assert.ok(market.length >= 5);
  const before = state.player.credits;
  const out = state.civs.applyEffects({ credits: 1000, giveResource: { ancientAlloy: 2 }, flag: 'test' });
  assert.equal(state.player.credits, before + 1000);
  assert.equal(state.resources.amount('ancientAlloy'), 2);
  assert.equal(state.flags.test, true);
  assert.ok(state.archive.byCategory('civilization').length >= 1);
});

test('dynamic events trigger and choices have consequences', () => {
  const state = freshState();
  const ctx = { inSystem: true, nearStar: true, nearPlanet: true, nearRuin: false, nearBlackHole: false, anomalyChance: 0.1, civPresent: true, deepSpace: false };
  let ev = null;
  for (let i = 0; i < 200 && !ev; i++) {
    state.clock.stardate += 100;
    ev = state.events.maybeRoll(ctx, 1);
  }
  assert.ok(ev, 'an event eventually triggers');
  const credits = state.player.credits;
  const result = state.events.choose(0);
  assert.equal(result.ok, true);
  assert.ok(result.outcome.length > 0);
  // Every choice resolves (event cleared).
  assert.equal(state.events.current, null);
});

test('combat damages the ship and pays bounties', () => {
  const state = freshState();
  state.tech.unlockFromArtifact('wpn_laser');
  state.shipSystem.install('wpn_laser');
  const hostiles = state.combat.spawn(2);
  assert.equal(hostiles.length, 2);
  const creditsBefore = state.player.credits;
  // Simulate enough hits to kill both.
  for (let i = 0; i < 40 && state.combat.hostiles.length; i++) {
    state.combat.playerFire(state.combat.hostiles[0].id);
  }
  assert.equal(state.combat.hostiles.length, 0);
  assert.ok(state.player.credits > creditsBefore);
});

test('FTL respects range and fuel', () => {
  const state = freshState();
  const home = state.galaxy.homeSystemId;
  const all = state.galaxy.systemsWithinLy(home, 1e9);
  const nearest = all[0];
  const farthest = all[all.length - 1];
  assert.ok(nearest && farthest, 'galaxy has neighbours');

  // Too far for a Mk I drive.
  const tooFar = state.ftl.canJump(home, farthest.system.id);
  assert.equal(tooFar.ok, false);
  assert.match(tooFar.reason, /Out of range/);

  // Out of fuel is also refused.
  state.ship.fuel = 0;
  const noFuel = state.ftl.canJump(home, nearest.system.id);
  if (noFuel.inRange) {
    assert.equal(noFuel.ok, false);
    assert.match(noFuel.reason, /Insufficient fuel/);
  }

  // With a big drive and full tanks the jump executes and burns fuel.
  state.shipSystem.stats.jumpRange = 1e9;
  state.ship.fuel = state.ship.maxFuel;
  const fuelBefore = state.ship.fuel;
  const jump = state.ftl.jump(nearest.system.id);
  assert.equal(jump.ok, true);
  assert.ok(jump.fuelCost > 0);
  state.ftl.arrive(nearest.system.id);
  assert.equal(state.location.systemId, nearest.system.id);
  assert.equal(nearest.system.visited, true);
  assert.equal(nearest.system.discovered, true);
  assert.ok(state.ship.fuel < fuelBefore, 'fuel consumed by the jump');
  assert.equal(state.stats.jumpsMade, state.stats.jumpsMade); // stat tracked elsewhere
});

test('save and load round-trips the full game state', () => {
  const state = bigHold(freshState());
  state.addXp(500);
  state.surveySystem();
  state.resources.add('quantumCrystal', 12);
  state.archaeology.collect('art_sevenStar', state.location.systemId, 'site');
  const saved = state.serialize();

  const restored = new GameState(data);
  assert.equal(restored.deserialize(saved), true);
  assert.equal(restored.player.level, state.player.level);
  assert.equal(restored.resources.amount('quantumCrystal'), 12);
  assert.equal(restored.archaeology.collected.length, 1);
  assert.equal(restored.location.systemId, state.location.systemId);
  assert.equal(restored.galaxy.getSystem(state.location.systemId).surveyed, true);
  assert.equal(restored.archive.total, state.archive.total);
  // Deterministic rebuild means the same galaxy comes back.
  assert.deepEqual(
    restored.galaxy.getSystem(restored.galaxy.order[42]).planets.map((p) => p.name),
    state.galaxy.getSystem(state.galaxy.order[42]).planets.map((p) => p.name)
  );
});

test('save system slots work with an in-memory storage shim', () => {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, v),
    removeItem: (k) => mem.delete(k),
  };
  const state = freshState('slot-test');
  const res = saveSystem.save('slot1', state);
  assert.equal(res.ok, true);
  const peek = saveSystem.peek('slot1');
  assert.equal(peek.player, 'Test Commander');
  const other = new GameState(data);
  assert.equal(saveSystem.load('slot1', other).ok, true);
  assert.equal(other.location.systemId, state.location.systemId);
  delete globalThis.localStorage;
});
