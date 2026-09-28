/**
 * Focused gameplay tests: mining, combat, docking, landing, surface
 * archaeology and the save/load round trip through the real SaveSystem.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { StateMachine } from '../src/states/StateMachine.js';
import { SpaceState } from '../src/states/SpaceState.js';
import { SurfaceState } from '../src/states/SurfaceState.js';
import { MapState } from '../src/states/MapState.js';
import { makeGame } from './helpers/game.mjs';
import { loadJsdom } from './helpers/dom.mjs';

let frames = 0;
function run(state, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    state.update(dt);
    frames++;
    game_input.endFrame();
  }
}

let game_input = null;

async function boot(seed = 'gameplay') {
  const ctx = await makeGame(seed);
  game_input = ctx.input;
  const { game } = ctx;
  game.states = new StateMachine(game);
  game.states.register('space', new SpaceState(game));
  game.states.register('surface', new SurfaceState(game));
  game.states.register('map', new MapState(game));
  game.states.change('space');
  return ctx;
}

test('mining an asteroid fills the hold', async (t) => {
  if (!(await loadJsdom())) return t.skip('jsdom unavailable');
  const { game, state, dom } = await boot();
  try {
    const space = game.states.current;
    const asteroid = space.scene.bodies.find((b) => b.kind === 'asteroid');
    assert.ok(asteroid, 'the home system contains asteroids');
    state.resources.amounts = {};
    space.scene.shipObject.position.copy(asteroid.object.position);
    game.input.buttons.add(2);
    run(space, 2);
    assert.ok(state.resources.used > 0, 'resources were extracted');
    assert.ok(game.notifications.some((n) => n.title === 'Extracted'), 'the player was told what was extracted');
  } finally {
    dom.restore();
  }
});

test('weapons fire repeatedly and destroy hostiles', async (t) => {
  if (!(await loadJsdom())) return t.skip('jsdom unavailable');
  const { game, state, dom } = await boot();
  try {
    state.tech.unlockFromArtifact('wpn_laser');
    state.shipSystem.install('wpn_laser');
    const space = game.states.current;
    state.combat.spawn(1);
    assert.equal(state.combat.hostiles.length, 1, 'hostile spawned');
    const hostile = state.combat.hostiles[0];
    const creditsBefore = state.player.credits;
    // Put the hostile right in front of the guns and hold fire.
    const ship = space.scene.shipObject;
    ship.position.set(0, 0, 0);
    ship.quaternion.identity();
    hostile.position = { x: 0, y: 0, z: -400 };
    game.input.buttons.add(0);
    run(space, 6);
    assert.ok(space.fireCooldown >= 0, `fire cooldown stays finite (got ${space.fireCooldown})`);
    assert.equal(state.combat.hostiles.length, 0, 'hostile destroyed');
    assert.ok(state.stats.hostilesDestroyed >= 1, 'kill recorded in stats');
    assert.ok(state.player.credits > creditsBefore, 'bounty paid');
    assert.ok(state.player.xp > 0, 'experience awarded');
  } finally {
    dom.restore();
  }
});

test('docking at a station opens services and refuelling costs credits', async (t) => {
  if (!(await loadJsdom())) return t.skip('jsdom unavailable');
  const { game, state, dom } = await boot();
  try {
    const space = game.states.current;
    const stationBody = space.scene.bodies.find((b) => b.kind === 'station' && !b.data.derelict);
    if (!stationBody) return t.skip('no live station in the home system');
    const station = stationBody.data;
    space._dock({ station });
    assert.ok(game.ui.modals.isOpen(), 'station modal opened');
    assert.match(dom.window.document.querySelector('.m-title').textContent, /STATION|DOCK/i);

    state.ship.hull = 10;
    state.ship.fuel = 5;
    const credits = state.player.credits;
    const repair = Math.ceil((state.ship.maxHull - state.ship.hull) * 12);
    const fuel = Math.ceil((state.ship.maxFuel - state.ship.fuel) * state.ftl.fuelPrice(station.owner));
    assert.ok(credits >= repair + fuel, 'the player can afford the full service');
    const choice = [...dom.window.document.querySelectorAll('.choice')].find((c) => /Refuel and repair/i.test(c.textContent));
    choice.click();
    assert.equal(state.ship.hull, state.ship.maxHull, 'hull repaired');
    assert.equal(state.ship.fuel, state.ship.maxFuel, 'fuel topped up');
    assert.ok(state.player.credits < credits, 'service was paid for');
  } finally {
    dom.restore();
  }
});

test('landing through the flight prompt switches to the surface state', async (t) => {
  if (!(await loadJsdom())) return t.skip('jsdom unavailable');
  const { game, state, dom } = await boot();
  try {
    const space = game.states.current;
    const planetBody = space.scene.bodies.find((b) => b.kind === 'planet' && b.data.landable);
    assert.ok(planetBody, 'a landable planet exists');
    space._land({ planet: planetBody.data, body: planetBody, distance: 0 });
    assert.equal(game.states.currentName, 'surface');
    assert.equal(state.location.mode, 'surface');
    assert.equal(state.location.planetId, planetBody.data.id);
    assert.equal(state.stats.planetsLanded, 1);
    run(game.states.current, 1);
    // Walking away from the landing site and back.
    const surface = game.states.current;
    surface.character.position.set(300, surface.scene.heightAt(300, 300), 300);
    game.input.tap('KeyW');
    run(surface, 2);
    game.input.release('KeyW');
    assert.doesNotThrow(() => run(surface, 2));
  } finally {
    dom.restore();
  }
});

test('surface excavation produces an analyzable artifact', async (t) => {
  if (!(await loadJsdom())) return t.skip('jsdom unavailable');
  const { game, state, dom } = await boot();
  try {
    // Find a system with a ruin by walking the galaxy deterministically.
    let ruinSystem = null;
    for (const entry of state.galaxy.systemsWithinLy(state.location.systemId, 1e9)) {
      if (entry.system.ruins.length) { ruinSystem = entry.system; break; }
    }
    assert.ok(ruinSystem, 'a system with ruins exists nearby');
    state.location.system = ruinSystem;
    state.location.systemId = ruinSystem.id;
    const ruin = ruinSystem.ruins[0];
    const planet = ruinSystem.planets.find((p) => p.ruinSiteIds.includes(ruin.id)) ?? ruinSystem.planets[0];
    game.states.change('surface', { planet, ruin });
    const surface = game.states.current;
    assert.ok(surface.scene.artifactProps.length > 0, 'the ruin site has artifact props');
    surface.character.position.copy(surface.scene.artifactProps[0].object.position);
    run(surface, 1 / 60);
    game.input.press('KeyE');
    run(surface, 1 / 60);
    assert.equal(state.archaeology.instances.length, 1, 'artifact excavated into the journal');
    assert.equal(state.stats.artifactsFound, 1);

    // Analyse it through the archaeology panel path.
    const inst = state.archaeology.instances[0];
    const res = state.archaeology.analyze(inst.uid);
    assert.equal(res.ok, true);
    assert.ok(res.reading, 'analysis produced a reading');
    game.ui.modals.showAnalysis(res);
    assert.ok(dom.window.document.querySelector('.modal-body').textContent.length > 40);
  } finally {
    dom.restore();
  }
});

test('save and load round-trips a played session', async (t) => {
  if (!(await loadJsdom())) return t.skip('jsdom unavailable');
  const { game, state, dom } = await boot();
  try {
    const { saveSystem } = await import('../src/core/SaveSystem.js');
    // Mutate the world a bit so the round trip is meaningful.
    state.resources.add('iron', 40);
    state.archaeology.collect('art_firstLamp', state.location.systemId, 'site');
    state.civs.meet('terranConcord');
    state.addXp(500);
    state.ship.hull = 77;

    const saved = saveSystem.save('roundtrip', state);
    assert.equal(saved.ok, true, 'save succeeded');

    // Load into a brand new state.
    const { loadAllData } = await import('../src/core/DataLoader.js');
    const { GameState } = await import('../src/sim/GameState.js');
    const fresh = new GameState(await loadAllData());
    const loaded = saveSystem.load('roundtrip', fresh);
    assert.equal(loaded.ok, true, 'load succeeded');
    assert.equal(fresh.location.systemId, state.location.systemId);
    assert.equal(fresh.player.xp, state.player.xp);
    assert.equal(fresh.ship.hull, 77);
    assert.equal(fresh.resources.amount('iron'), state.resources.amount('iron'));
    assert.equal(fresh.resources.used, state.resources.used);
    assert.equal(fresh.archaeology.instances.length, 1);
    assert.equal(fresh.civs.discovered().length, state.civs.discovered().length);
    assert.equal(fresh.galaxy.seed, state.galaxy.seed);
    // And the loaded state keeps simulating.
    assert.doesNotThrow(() => fresh.shipSystem.recompute());
    assert.doesNotThrow(() => fresh.ftl.canJump(fresh.location.systemId, state.location.systemId));
  } finally {
    dom.restore();
  }
});
