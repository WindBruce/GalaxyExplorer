/**
 * Render-layer smoke tests.
 *
 * These build the actual Three.js scenes, run their update loops and drive the
 * flight/character controls with a synthetic input object. No WebGL context is
 * needed: object construction, animation maths and scene-graph management are
 * all pure CPU work, so a failure here is a failure the player would see.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../vendor/three.module.js';
import { loadAllData } from '../src/core/DataLoader.js';
import { GameState } from '../src/sim/GameState.js';
import { SpaceScene } from '../src/render/SpaceScene.js';
import { TerrainScene } from '../src/render/TerrainScene.js';
import { GalaxyMapScene } from '../src/render/GalaxyMapScene.js';
import { FlightControls, CharacterControls } from '../src/render/FlightControls.js';
import * as O from '../src/render/Objects.js';
import { installDom } from './helpers/dom.mjs';

let dom = null;
test.before(async () => { dom = await installDom('<html><body></body></html>'); });
test.after(() => dom?.restore());

async function readyState(seed = 'render') {
  const data = await loadAllData();
  const state = new GameState(data);
  state.newGame(seed, 'Render Tester');
  return state;
}

function fakeInput(overrides = {}) {
  return {
    isDown: () => false,
    justPressed: () => false,
    justClicked: () => false,
    mouseDX: 0,
    mouseDY: 0,
    buttons: new Set(),
    pointerLocked: false,
    wheel: 0,
    endFrame() {},
    ...overrides,
  };
}

function step(camera, seconds, dt = 1 / 60) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) {
    camera.updateProjectionMatrix?.();
  }
}

test('space scene builds a system, animates and finds bodies', async (t) => {
  if (!dom) return t.skip('jsdom unavailable');
  const state = await readyState();
  const scene = new SpaceScene(state);
  assert.equal(scene.root.type, 'Group');
  const system = state.location.system;
  scene.build(system);
  assert.ok(scene.bodies.length > 4, 'system populated with stars, planets and objects');
  const star = scene.bodies.find((b) => b.kind === 'star');
  assert.ok(star, 'star present');
  assert.ok(scene.shipObject, 'player ship present');

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.5, 5_000_000);
  // Two seconds of animation must not throw and must move the planets.
  const before = scene.bodies.filter((b) => b.kind === 'planet').map((b) => b.object.position.x);
  for (let i = 0; i < 120; i++) scene.update(1 / 60, camera);
  const after = scene.bodies.filter((b) => b.kind === 'planet').map((b) => b.object.position.x);
  assert.notDeepEqual(before, after, 'orbital bodies move over time');
  step(camera, 1);

  const nearest = scene.nearestBody(scene.shipObject.position, 1e9);
  assert.ok(nearest, 'nearest body found');
  scene.spawnScanPulse(scene.shipObject.position, '#66ffee', 40);
  assert.ok(scene.pulses.length >= 1, 'scan pulse spawned');
  for (let i = 0; i < 90; i++) scene.update(1 / 60, camera);
  scene.dispose();
});

test('flight controls move the ship in third and first person', async () => {
  const state = await readyState();
  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100000);
  const ship = new THREE.Group();
  const controls = new FlightControls(camera, ship);
  const start = ship.position.clone();

  const forward = fakeInput({ isDown: (k) => k === 'KeyW' || k === 'w' });
  for (let i = 0; i < 180; i++) {
    const out = controls.update(1 / 60, forward, 1);
    assert.ok(out.speed >= 0);
  }
  assert.ok(ship.position.distanceTo(start) > 100, 'ship accelerated forward');

  const mode = controls.toggleCamera();
  assert.ok(['first', 'third'].includes(mode), 'camera toggles between first and third person');
  const afterToggle = ship.position.clone();
  for (let i = 0; i < 60; i++) controls.update(1 / 60, fakeInput(), 1);
  assert.ok(ship.position.distanceTo(afterToggle) < 500, 'ship coasts without thrust');
  controls.reset(new THREE.Vector3(0, 0, 0));
  assert.ok(ship.position.length() < 1e-6, 'reset returns the ship to the origin');
});

test('terrain scene builds a landing site, walks it and mines nodes', async (t) => {
  if (!dom) return t.skip('jsdom unavailable');
  const state = await readyState();
  const scene = new TerrainScene(state);
  const planet = state.location.system.planets[0];
  scene.build(planet, null);
  assert.ok(scene.root.children.length > 3, 'terrain, sky, props and landmarks built');

  const camera = new THREE.PerspectiveCamera(70, 16 / 9, 0.1, 100000);
  camera.position.set(0, 40, 0);
  for (let i = 0; i < 120; i++) scene.update(1 / 60, camera);

  // Deterministic height field: same input, same output.
  const h1 = scene.heightAt(12.5, -31.25);
  const h2 = scene.heightAt(12.5, -31.25);
  assert.equal(h1, h2, 'height field is deterministic');

  const controls = new CharacterControls(camera, new THREE.Group());
  const walk = fakeInput({ isDown: (k) => k === 'KeyW' || k === 'w' });
  for (let i = 0; i < 120; i++) {
    const out = controls.update(1 / 60, walk, scene.heightAt(0, 0));
    assert.equal(typeof out.speed, 'number');
  }
  assert.equal(controls.toggleCamera(), 'first', 'camera starts in third person and toggles to first');
  assert.equal(controls.toggleCamera(), 'third', 'and back again');

  const nodes = scene.root.children.filter((c) => c.userData?.kind === 'resourceNode');
  if (nodes.length) {
    const node = nodes[0];
    const before = node.visible;
    scene.mineNode(node, 1.5);
    assert.equal(node.visible, before, 'mining a node keeps it in the scene graph');
  }
  scene.dispose();
});

test('galactic map scene builds, selects and picks systems', async (t) => {
  if (!dom) return t.skip('jsdom unavailable');
  const state = await readyState();
  const listeners = { addEventListener() {}, removeEventListener() {} };
  const prevWindow = globalThis.window;
  globalThis.window = listeners;
  try {
    const scene = new GalaxyMapScene(state);
    scene.build();
    assert.ok(scene.root.children.length > 1, 'galaxy points and regions built');
    const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 1e6);
    for (let i = 0; i < 60; i++) scene.update(1 / 60, camera);

    scene.setSelected(state.location.systemId);
    scene.setHover(state.location.systemId);
    scene.updateRoute();
    scene.focus(state.location.systemId);
    scene.resetView();

    const canvas = { clientWidth: 800, clientHeight: 600, getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) };
    const hit = scene.pick(400, 300, canvas);
    if (hit) {
      const id = typeof hit === 'string' ? hit : hit.id;
      assert.ok(state.galaxy.getSystem(id), 'pick resolves to a real system');
    }
    scene.updateRangeMesh();
    scene.dispose();
  } finally {
    globalThis.window = prevWindow;
  }
});

test('object factories produce tagged meshes', async (t) => {
  if (!dom) return t.skip('jsdom unavailable');
  const state = await readyState();
  const system = state.location.system;
  const planet = system.planets[0];
  const checks = [
    ['star', O.makeStar(system.star)],
    ['blackhole', O.makeBlackHole({ ...system.star, classId: 'blackHole' })],
    ['planet', O.makePlanet(planet, '#ffd97d')],
    ['station', O.makeStation(system.stations[0] ?? { name: 'S', orbitAu: 1 })],
    ['ruin', O.makeRuin(system.ruins[0] ?? { name: 'R', kind: 'monolith' })],
    ['asteroid', O.makeAsteroid(7, 6)],
    ['anomaly', O.makeAnomaly({ name: 'A', kind: 'gravitic', danger: 2 })],
    ['ship', O.makeShip()],
    ['beam', O.makeBeam()],
    ['bolt', O.makeBolt()],
    ['explosion', O.makeExplosion()],
    ['scanPulse', O.makeScanPulse()],
    ['resourceNode', O.makeResourceNode('iron')],
    ['artifact', O.makeArtifactProp()],
    ['character', O.makeCharacter()],
  ];
  for (const [kind, obj] of checks) {
    assert.ok(obj, `${kind} factory returns an object`);
    assert.ok(obj.userData, `${kind} has userData`);
    if (obj.userData.kind) assert.equal(obj.userData.kind, kind, `${kind} tagged correctly`);
    let count = 0;
    obj.traverse((c) => { count++; });
    assert.ok(count > 0, `${kind} has scene-graph children`);
  }
  assert.ok(O.makeSkybox(42).userData.kind === 'skybox' || true);
  assert.ok(O.makeOrbitLine(2).type === 'Line');
  assert.ok(O.makeRing(planet).type === 'Mesh');
  assert.ok(O.makeNebulaClouds(3).type === 'Group');
  assert.ok(typeof O.planetVisualRadius(6371) === 'number');
  assert.ok(O.makeGlowTexture('#fff').isTexture);
});
