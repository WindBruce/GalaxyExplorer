/**
 * Test helper: build a Game-shaped object wired to the real simulation, the
 * real UI classes and the real states, but with the WebGL renderer replaced by
 * a stub. Lets the whole gameplay loop be driven headlessly.
 */
import * as THREE from '../../vendor/three.module.js';
import { loadAllData, loadI18nPacks } from '../../src/core/DataLoader.js';
import { i18n } from '../../src/core/I18n.js';
import { GameState } from '../../src/sim/GameState.js';
import { Notifications } from '../../src/ui/Notifications.js';
import { HUD } from '../../src/ui/HUD.js';
import { Panels } from '../../src/ui/Panels.js';
import { Modals } from '../../src/ui/Modals.js';
import { GalacticMapUI } from '../../src/ui/GalacticMapUI.js';
import { MainMenu } from '../../src/ui/MainMenu.js';
import { installDom } from './dom.mjs';

export class FakeInput {
  constructor() {
    this.down = new Set();
    this.pressed = new Set();
    this.clicked = new Set();
    this.buttons = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.lastClientX = 0;
    this.lastClientY = 0;
    this.pointerLocked = false;
  }
  isDown(code) { return this.down.has(code); }
  justPressed(code) {
    if (this.pressed.has(code)) { this.pressed.delete(code); return true; }
    return false;
  }
  justClicked(button = 0) {
    if (this.clicked.has(button)) { this.clicked.delete(button); return true; }
    return false;
  }
  press(code) { this.pressed.add(code); }
  tap(code) { this.down.add(code); }
  release(code) { this.down.delete(code); }
  click(button = 0) { this.clicked.add(button); }
  requestPointerLock() { this.pointerLocked = true; }
  exitPointerLock() { this.pointerLocked = false; }
  endFrame() { this.pressed.clear(); this.clicked.clear(); }
}

export async function makeGame(seed = 'playthrough') {
  const dom = await installDom('index.html');
  i18n.load(await loadI18nPacks());
  const data = await loadAllData();
  const state = new GameState(data);
  state.newGame(seed, 'Play Tester');

  const game = {
    state,
    data,
    i18n,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(68, 16 / 9, 0.35, 90000),
    renderer: {
      domElement: dom.window.document.getElementById('game-canvas')
        ?? dom.window.document.createElement('canvas'),
      setSize() {}, render() {}, setPixelRatio() {}, toneMapping: 0, outputColorSpace: '',
    },
    input: new FakeInput(),
    bus: state.bus,
    notifications: [],
    ui: {},
    states: null,
    save: { save: () => ({ ok: true }), load: () => ({ ok: true }), peek: () => null, allSlots: () => [], remove() {} },
    notify(title, body, kind, ttl) { this.notifications.push({ title, body, kind, ttl }); },
    narrate() {},
  };
  game.ui.notify = (...a) => game.notify(...a);
  game.ui.hud = new HUD(game);
  game.ui.panels = new Panels(game);
  game.ui.modals = new Modals(game);
  game.ui.map = new GalacticMapUI(game);
  game.ui.menu = new MainMenu(game);
  game.ui.settings = { speak() {}, isOpen: () => false, open() {}, close() {} };
  Object.assign(game.ui, {
    showEvent: (ev) => game.ui.modals.showEvent(ev),
    showStation: (s) => game.ui.modals.showStation(s),
    showScanResult: (b, i) => game.ui.modals.showScanResult(b, i),
    showAnalysis: (r) => game.ui.modals.showAnalysis(r),
    openDialogue: (id) => game.ui.modals.openDialogue(id),
    openTrade: (id, s) => game.ui.modals.openTrade(id, s),
    showGalacticMap: (scene, mapState) => game.ui.map.show(scene, mapState),
    hideGalacticMap: () => game.ui.map.hide(),
    updateGalacticMapSelection: (id) => game.ui.map.updateSelection(id),
  });
  return { game, state, dom, input: game.input };
}
