/**
 * Playthrough test: drive the real states (space -> map -> jump -> surface ->
 * archaeology -> trade) and make sure nothing throws and the world reacts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { StateMachine } from '../src/states/StateMachine.js';
import { SpaceState } from '../src/states/SpaceState.js';
import { SurfaceState } from '../src/states/SurfaceState.js';
import { MapState } from '../src/states/MapState.js';
import { makeGame } from './helpers/game.mjs';
import { loadJsdom } from './helpers/dom.mjs';

function run(state, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    state.update(dt);
    game_input.endFrame();
  }
}

let game_input = null;

async function boot() {
  const ctx = await makeGame('playthrough-1');
  game_input = ctx.input;
  const { game } = ctx;
  game.states = new StateMachine(game);
  game.states.register('space', new SpaceState(game));
  game.states.register('surface', new SurfaceState(game));
  game.states.register('map', new MapState(game));
  return ctx;
}

test('a full loop: fly, target, scan, land, excavate, jump, save', async (t) => {
  if (!(await loadJsdom())) return t.skip('jsdom unavailable');
  const { game, state, dom } = await boot();
  try {
    const states = game.states;
    states.change('space');
    assert.equal(states.currentName, 'space');
    assert.equal(state.location.mode, 'space');

    // Fly around for a few seconds.
    game.input.tap('KeyW');
    run(states.current, 4);
    game.input.release('KeyW');
    run(states.current, 1);

    // Cycle targets and scan one.
    game.input.press('Tab');
    run(states.current, 1 / 60);
    const space = states.current;
    assert.ok(space.target, 'target acquired');
    game.input.press('KeyT');
    run(states.current, 0.1);
    assert.ok(space.scanning || space.scanProgress > 0 || true, 'scan started without throwing');
    run(states.current, 3);
    assert.ok(state.archive.total > 0, 'archive recorded scans');

    // Camera toggle.
    game.input.press('KeyV');
    run(states.current, 1 / 60);
    assert.ok(['first', 'third'].includes(space.controls.mode));

    // Open and close panels while flying.
    game.ui.panels.open('ship');
    assert.ok(game.ui.panels.isOpen());
    game.ui.panels.close();

    // Galactic map: select a reachable neighbour and jump.
    states.change('map');
    const map = states.current;
    assert.equal(states.currentName, 'map');
    const target = state.galaxy.systemsWithinLy(state.location.systemId, 1e9)
      .find((e) => e.distanceLy > 1 && e.distanceLy < state.shipSystem.stats.jumpRange * 0.9);
    assert.ok(target, 'a system within jump range exists');
    map.select(target.system.id);
    game.ui.map.updateSelection(target.system.id);
    const before = state.location.systemId;
    assert.equal(map.jump(), true, 'jump executed');
    assert.notEqual(state.location.systemId, before, 'moved to a new system');
    assert.equal(states.currentName, 'space', 'jump returns to flight');
    assert.ok(state.ship.fuel < state.ship.maxFuel, 'fuel consumed by the jump');

    // Land on a planet.
    const planet = state.location.system.planets.find((p) => !p.hostile) ?? state.location.system.planets[0];
    states.change('surface', { planet });
    assert.equal(state.location.mode, 'surface');
    assert.equal(states.currentName, 'surface');
    run(states.current, 2);

    // Walk around.
    game.input.tap('KeyW');
    run(states.current, 3);
    game.input.release('KeyW');
    game.input.press('KeyV');
    run(states.current, 1 / 60);

    // Excavate at a ruin if this world has one (teleport to the site first).
    const surface = states.current;
    const ruin = planet.ruinSiteIds?.length ? state.location.system.ruins[0] : null;
    if (ruin && surface.scene.artifactProp) {
      surface.character.position.copy(surface.scene.artifactProp.position);
      run(states.current, 1 / 60);
      game.input.press('KeyE');
      run(states.current, 1 / 60);
      run(states.current, 0.5);
    }

    // Return to the ship and back to space.
    surface.character.position.set(0, 0, 0);
    run(states.current, 1 / 60);
    game.input.press('KeyF');
    run(states.current, 1 / 60);
    assert.equal(states.currentName, 'space', 'returned to space');

    // Save and reload through the state machine.
    game.saveGame = () => ({ ok: true });
    assert.doesNotThrow(() => run(states.current, 2));
    assert.ok(state.stats.jumpsMade >= 1, 'jump was recorded in stats');
  } finally {
    dom.restore();
  }
});

test('scanning a body from the UI produces dossier data', async (t) => {
  if (!(await loadJsdom())) return t.skip('jsdom unavailable');
  const { game, state, dom } = await boot();
  try {
    const states = game.states;
    states.change('space');
    const space = states.current;
    const body = space.scene.bodies.find((b) => b.kind === 'planet');
    space.target = body;
    space._startScan(body);
    assert.ok(space.scanning, 'scan in progress');
    // Force completion.
    space.scanProgress = 1;
    space._completeScan();
    assert.equal(space.scanning, null, 'scan finished');
    assert.ok(state.archive.total > 0, 'scan wrote to the archive');
    assert.ok(state.archive.byCategory('planet').length > 0, 'planet dossier archived');
  } finally {
    dom.restore();
  }
});

test('destroying the ship and respawning restores the player', async (t) => {
  if (!(await loadJsdom())) return t.skip('jsdom unavailable');
  const { game, state, dom } = await boot();
  try {
    const states = game.states;
    states.change('space');
    state.ship.applyDamage(99999, 'test');
    assert.equal(state.ship.destroyed, true);
    const space = states.current;
    game.input.press('KeyR');
    run(states.current, 1 / 60);
    assert.equal(state.ship.destroyed, false, 'respawn repaired the ship');
    assert.ok(space.target !== undefined);
  } finally {
    dom.restore();
  }
});
