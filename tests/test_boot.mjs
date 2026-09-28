/**
 * Headless boot test: constructs the REAL Game (renderer stubbed, see
 * ./three-stub.mjs), boots it, and drives the menu/state-machine flows that a
 * player hits in the browser.
 *
 * This is the regression net for "Game builds its states before boot() creates
 * the GameState" and for the state machine re-entry semantics.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './helpers/dom.mjs';

async function bootGame() {
  const dom = await installDom('index.html');
  const { Game } = await import('../src/Game.js');
  const game = new Game();
  await game.boot();
  // Let boot()'s loading-screen timer fire while the DOM is still installed.
  await new Promise((resolve) => setTimeout(resolve, 400));
  return { dom, game };
}

/** Send a real keydown so the game's own Input class registers the press. */
function pressKey(dom, code) {
  dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { code, bubbles: true }));
}

function tick(game, frames = 5, dt = 1 / 60) {
  for (let i = 0; i < frames; i++) {
    game._tick(dt);
    game.input.endFrame();
  }
}

test('boot shows the menu and hides the loading screen', async (t) => {
  const { dom, game } = await bootGame();
  try {
    assert.equal(game.inMenu, true, 'main menu is up after boot');
    assert.ok(game.state, 'game state exists');
    assert.ok(game.data, 'data packs loaded');
    assert.equal(game.state.galaxy, null, 'the galaxy waits for a new game / load');
    assert.equal(game.states.currentName, null, 'no state entered yet');
    // The render loop must not throw while the menu is open.
    assert.doesNotThrow(() => tick(game, 10));
  } finally {
    dom.window.close();
    dom.restore();
  }
});

test('new game enters flight with a built scene and working controls', async (t) => {
  const { dom, game } = await bootGame();
  try {
    game.newGame('boot-test', 'Tester');
    const space = game.states.current;
    assert.equal(game.states.currentName, 'space');
    assert.equal(game.inMenu, false, 'menu hidden');
    assert.ok(space.scene, 'space scene exists');
    assert.equal(space.scene.state, game.state, 'scene is bound to the live game state');
    assert.ok(space.scene.system, 'scene built for the current system');
    assert.ok(space.scene.bodies.length > 3, 'system populated');
    assert.ok(space.controls, 'flight controls exist');
    assert.ok(space.scene.shipObject, 'player ship exists');
    assert.doesNotThrow(() => tick(game, 120));
  } finally {
    dom.window.close();
    dom.restore();
  }
});

test('loading a save rebuilds the scene instead of tearing it down', async (t) => {
  const { dom, game } = await bootGame();
  try {
    game.newGame('boot-load', 'Tester');
    const space = game.states.current;
    const systemName = space.scene.system.name;
    tick(game, 30);
    assert.equal(game.saveGame('slot1').ok, true);

    // Load while already flying: the state machine must re-enter (force) and
    // must not exit() the state it just re-entered.
    const res = game.loadGame('slot1');
    assert.equal(res.ok, true);
    assert.equal(game.states.currentName, 'space');
    assert.ok(space.scene.system, 'scene still built after load');
    assert.equal(space.scene.system.name, systemName);
    assert.ok(space.scene.bodies.length > 3, 'scene still populated after load');
    assert.ok(space.controls, 'controls still exist');
    assert.doesNotThrow(() => tick(game, 60));
  } finally {
    dom.window.close();
    dom.restore();
  }
});

test('a fresh Game (page reload) can continue an expedition', async (t) => {
  // One DOM = one localStorage, so the second Game sees the first one's saves.
  const { dom } = await bootGame();
  try {
    const first = dom.window.galaxyExplorerProbe ?? null;
    void first;
    const { Game } = await import('../src/Game.js');
    const gameOne = new Game();
    await gameOne.boot();
    gameOne.newGame('reload-test', 'Reloader');
    tick(gameOne, 30);
    assert.equal(gameOne.saveGame('autosave').ok, true);

    const gameTwo = new Game();
    await gameTwo.boot();
    const res = gameTwo.loadGame('autosave');
    assert.equal(res.ok, true, 'autosave loaded');
    assert.equal(gameTwo.states.currentName, 'space');
    assert.ok(gameTwo.states.current.scene.system, 'scene built for the loaded system');
    assert.equal(gameTwo.state.location.system.name, 'Kepler\'s Rest');
    assert.doesNotThrow(() => tick(gameTwo, 60));
  } finally {
    dom.window.close();
    dom.restore();
  }
});

test('loading a surface save enters the surface state (null payload tolerated)', async (t) => {
  const { dom, game } = await bootGame();
  try {
    game.newGame('boot-surface', 'Tester');
    const planet = game.state.location.system.planets.find((p) => p.landable)
      ?? game.state.location.system.planets[0];
    game.states.change('surface', { planet });
    assert.equal(game.states.currentName, 'surface');
    tick(game, 10);
    assert.equal(game.saveGame('slot2').ok, true);

    // Back to space, then load the surface save: enter() gets no payload.
    game.states.change('space');
    assert.equal(game.states.currentName, 'space');
    const res = game.loadGame('slot2');
    assert.equal(res.ok, true);
    assert.equal(game.states.currentName, 'surface', 'resumed on the surface');
    const surface = game.states.current;
    assert.ok(surface.scene, 'terrain scene exists');
    assert.ok(surface.character, 'character exists');
    assert.ok(surface.controls, 'character controls exist');
    assert.doesNotThrow(() => tick(game, 60));

    // And back up to the ship.
    surface.character.position.set(0, 0, 0);
    pressKey(dom, 'KeyF');
    tick(game, 2);
    assert.equal(game.states.currentName, 'space');
    assert.ok(game.states.current.controls, 'flight controls restored');
    assert.doesNotThrow(() => tick(game, 30));
  } finally {
    dom.window.close();
    dom.restore();
  }
});

test('a failing enter() is contained and does not spam every frame', async (t) => {
  const { dom, game } = await bootGame();
  try {
    game.newGame('boot-fail', 'Tester');
    const space = game.states.current;
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(' '));

    // Break the surface state, then try to enter it.
    game.states.register('broken', {
      name: 'broken',
      enter() { throw new Error('boom'); },
      update() { throw new Error('should never tick'); },
    });
    const ok = game.states.change('broken');
    console.error = originalError;

    assert.equal(ok, false, 'change reports failure');
    assert.equal(game.states.currentName, 'space', 'machine stayed on the previous state');
    assert.equal(game.states.current, space, 'same state instance');
    assert.equal(errors.length, 1, 'logged exactly once');
    assert.doesNotThrow(() => tick(game, 30), 'no per-frame crash');
  } finally {
    dom.window.close();
    dom.restore();
  }
});
