/**
 * UI integration tests (jsdom).
 *
 * Exercises every panel, modal and HUD path against a real GameState without
 * a browser. If jsdom is unavailable the suite skips itself so `npm test`
 * stays green in a bare environment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let JSDOM = null;
try {
  ({ JSDOM } = await import('/tmp/node_modules/jsdom/lib/api.js'));
} catch {
  try {
    ({ JSDOM } = await import('jsdom'));
  } catch {
    JSDOM = null;
  }
}

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

/** Minimal 2D canvas context so the system-map panel can draw. */
function fake2D() {
  const grad = { addColorStop() {} };
  return {
    canvas: { width: 520, height: 380 },
    createRadialGradient: () => grad,
    createLinearGradient: () => grad,
    fillRect() {}, beginPath() {}, arc() {}, fill() {}, stroke() {},
    moveTo() {}, lineTo() {}, fillText() {}, closePath() {},
    set fillStyle(v) {}, get fillStyle() { return ''; },
    set strokeStyle(v) {}, get strokeStyle() { return ''; },
    set font(v) {}, get font() { return ''; },
    set lineWidth(v) {}, get lineWidth() { return 1; },
  };
}

async function makeUi() {
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost:8080/' });
  const { window } = dom;
  // Canvas 2D stub.
  window.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type === '2d') return fake2D();
    return null;
  };
  window.Blob = class Blob {};
  window.URL.createObjectURL = () => 'blob:fake';
  window.URL.revokeObjectURL = () => {};

  const prev = [];
  const setGlobal = (key, value) => {
    const desc = Object.getOwnPropertyDescriptor(globalThis, key);
    prev.push({ key, desc });
    Object.defineProperty(globalThis, key, {
      value, writable: true, configurable: true, enumerable: true,
    });
  };
  const globals = {
    window, document: window.document, navigator: window.navigator,
    localStorage: window.localStorage, requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame, HTMLElement: window.HTMLElement,
    HTMLCanvasElement: window.HTMLCanvasElement, Blob: window.Blob, URL: window.URL,
    performance: window.performance, getComputedStyle: window.getComputedStyle,
    CustomEvent: window.CustomEvent, Event: window.Event, MouseEvent: window.MouseEvent,
  };
  for (const [k, v] of Object.entries(globals)) setGlobal(k, v);

  const { loadAllData, loadI18nPacks } = await import('../src/core/DataLoader.js');
  const { GameState } = await import('../src/sim/GameState.js');
  const { Game } = await import('../src/Game.js');
  const { i18n } = await import('../src/core/I18n.js');

  i18n.load(await loadI18nPacks());
  const data = await loadAllData();
  const state = new GameState(data);
  state.newGame('ui-test', 'UI Tester');

  // A Game without the WebGL renderer: stub out what the UI needs.
  const game = Object.create(Game.prototype);
  game.bus = state.bus;
  game.data = data;
  game.state = state;
  game.i18n = i18n;
  game.narrate = () => {};
  game.save = { save: () => ({ ok: true, bytes: 100 }), load: () => ({ ok: true }), peek: () => null, allSlots: () => [], remove() {} };
  game.input = { requestPointerLock() {}, exitPointerLock() {}, justPressed: () => false, isDown: () => false, justClicked: () => false, endFrame() {} };
  game.renderer = { domElement: window.document.createElement('canvas') };
  game.states = { change() {}, currentName: 'space' };
  game.notifications = { notify() {} };
  game.ui = { notify() {} };
  const { Notifications } = await import('../src/ui/Notifications.js');
  const { HUD } = await import('../src/ui/HUD.js');
  const { Panels } = await import('../src/ui/Panels.js');
  const { Modals } = await import('../src/ui/Modals.js');
  const { GalacticMapUI } = await import('../src/ui/GalacticMapUI.js');
  const { MainMenu } = await import('../src/ui/MainMenu.js');
  game.notifications = new Notifications(window.document.getElementById('notifications'));
  game.ui.hud = new HUD(game);
  game.ui.panels = new Panels(game);
  game.ui.modals = new Modals(game);
  game.ui.map = new GalacticMapUI(game);
  game.i18n = i18n;
  game.ui.menu = new MainMenu(game);
  game.ui.settings = { speak() {}, isOpen: () => false, open() {}, close() {} };
  game.ui.notify = (...a) => game.notifications.notify(...a);
  game.saveGame = () => ({ ok: true });
  game.loadGame = () => ({ ok: true });
  game.newGame = () => {};

  const restore = () => {
    for (const { key, desc } of prev.reverse()) {
      if (desc) Object.defineProperty(globalThis, key, desc);
      else delete globalThis[key];
    }
  };
  return { dom, window, game, state, restore };
}

test('HUD renders vitals, target dossier and prompts', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const hud = game.ui.hud;
    hud.setSystem(state.location.system);
    hud.show();
    hud.setPrompt('[G] Land on Acheron');
    assert.match(window.document.getElementById('hud-prompt').textContent, /Land on Acheron/);
    hud.update({
      system: state.location.system, speed: 120, maxSpeed: 220, boost: false,
      hull: 100, maxHull: 150, shield: 80, maxShield: 120, fuel: 60, maxFuel: 100,
      cargoUsed: 30, cargoMax: 120, power: 40, powerDraw: 20,
      target: { name: 'Acheron', label: 'Terrestrial', distance: 420, scanned: false },
      scanning: null, combat: 0, stardate: 48102.5, region: 'Orion Spur',
    });
    assert.match(window.document.getElementById('val-hull').textContent, /100\/150/);
    assert.match(window.document.getElementById('val-fuel').textContent, /60\/100/);
    assert.match(window.document.getElementById('target-name').textContent, /Acheron/);
    hud.setScan({ active: true, name: 'Acheron', progress: 0.5 });
    assert.match(window.document.getElementById('scan-fill').style.width, /50/);
    hud.hide();
    assert.ok(window.document.getElementById('hud').classList.contains('hidden'));
  } finally {
    restore();
  }
});

test('every panel opens, renders content and closes', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const panels = game.ui.panels;
    // Give the player some content so panels have something to show.
    state.tech.unlockFromArtifact('wpn_laser');
    state.shipSystem.install('wpn_laser');
    state.resources.add('iron', 80);
    state.resources.add('quantumCrystal', 5);
    state.archaeology.collect('art_sevenStar', state.location.systemId, 'site');
    state.quests.start('q_firstSurvey');
    state.civs.meet('vherrathi');

    for (const name of ['ship', 'cargo', 'missions', 'tech', 'skills', 'archaeology', 'civs', 'archive', 'systemMap']) {
      panels.open(name);
      const panel = window.document.querySelector('.panel');
      assert.ok(panel, `panel ${name} rendered`);
      assert.ok(panel.textContent.length > 120, `panel ${name} has content`);
      assert.ok(panels.isOpen(), `panel ${name} registered as open`);
      panels.close();
      assert.ok(!panels.isOpen(), `panel ${name} closed`);
    }
  } finally {
    restore();
  }
});

test('ship panel installs a module through the UI', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const panels = game.ui.panels;
    state.player.credits = 500000;
    state.resources.amounts = { iron: 400, silicon: 400, superconductor: 200, rareMetals: 200 };
    state.tech.unlockFromArtifact('sci_deepscan');
    panels.open('ship');
    const buttons = [...window.document.querySelectorAll('.panel .btn')];
    const upgrade = buttons.find((b) => /Deep Field Array/.test(b.textContent));
    assert.ok(upgrade, 'upgrade button present');
    assert.equal(upgrade.disabled, false, 'upgrade affordable');
    upgrade.click();
    assert.equal(state.ship.modules.scanner, 'scan_t2', 'module installed via UI');
    assert.ok(state.shipSystem.stats.scanRange > 1.9);
  } finally {
    restore();
  }
});

test('technology panel researches a technology through the UI', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const panels = game.ui.panels;
    state.research.points = 500;
    state.resources.amounts = { iron: 200, silicon: 200, rareMetals: 100 };
    panels.open('tech');
    const buttons = [...window.document.querySelectorAll('.panel .btn')];
    const research = buttons.find((b) => /RESEARCH/.test(b.textContent) && !b.disabled);
    assert.ok(research, 'a researchable technology exists');
    const before = state.research.completed.length;
    research.click();
    assert.ok(state.research.completed.length > before, 'technology researched via UI');
  } finally {
    restore();
  }
});

test('skill panel unlocks a skill through the UI', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const panels = game.ui.panels;
    state.player.skillPoints = 5;
    panels.open('skills');
    const buttons = [...window.document.querySelectorAll('.panel .btn')];
    const unlock = buttons.find((b) => /SP$/.test(b.textContent) && !b.disabled);
    assert.ok(unlock, 'an unlockable skill exists');
    const before = state.player.skills.length;
    unlock.click();
    assert.ok(state.player.skills.length > before, 'skill unlocked via UI');
  } finally {
    restore();
  }
});

test('dialogue tree walks and applies effects', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const modals = game.ui.modals;
    modals.openDialogue('terranConcord');
    assert.match(window.document.querySelector('.m-title').textContent, /Terran Concord/);
    const choice = [...window.document.querySelectorAll('.choice')].find((c) => /work/i.test(c.textContent));
    assert.ok(choice, 'work option present');
    choice.click();
    assert.match(window.document.querySelector('.modal-body').textContent, /survey/i);
    const accept = [...window.document.querySelectorAll('.choice')].find((c) => /take it/i.test(c.textContent));
    accept.click();
    // Dialogue ended; quest started and reputation moved.
    assert.ok(state.quests.isActive('q_firstSurvey'), 'dialogue started the survey quest');
    assert.ok(state.civs.get('terranConcord').reputation > 0.2, 'reputation increased');
  } finally {
    restore();
  }
});

test('event modal presents choices and resolves them', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const modals = game.ui.modals;
    const ev = {
      id: 'ev_test', title: 'Test Event', text: 'Something happens in the dark.',
      choices: [
        { text: 'Investigate', effects: { artifact: true, research: 100 }, outcome: 'You find a derelict.' },
        { text: 'Leave', effects: {}, outcome: 'You leave.' },
      ],
    };
    state.events.current = { ...ev, at: state.clock.stardate, context: {} };
    modals.showEvent(ev);
    const before = state.research.points;
    const investigate = [...window.document.querySelectorAll('.choice')].find((c) => /Investigate/.test(c.textContent));
    investigate.click();
    assert.match(window.document.querySelector('.modal-body').textContent, /derelict/);
    assert.ok(state.research.points > before, 'research awarded');
    const close = window.document.querySelector('.choice');
    close.click();
    assert.ok(modals.root.classList.contains('hidden'), 'modal closed');
  } finally {
    restore();
  }
});

test('station modal and trade modal work', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const modals = game.ui.modals;
    const station = { id: 'st', name: 'Station Test', kind: 'Trading Post', derelict: false, orbitAu: 1, owner: 'terranConcord', scanned: true, resources: [] };
    modals.showStation(station);
    const trade = [...window.document.querySelectorAll('.choice')].find((c) => /Trade with/.test(c.textContent));
    assert.ok(trade, 'trade option present');
    trade.click();
    assert.match(window.document.querySelector('.m-title').textContent, /TRADE/);
    const buy = [...window.document.querySelectorAll('.trade-row .btn')].find((b) => /BUY/.test(b.textContent));
    assert.ok(buy, 'buy button present');
    const creditsBefore = state.player.credits;
    buy.click();
    assert.ok(state.player.credits < creditsBefore || state.resources.used > 0, 'trade executed');
  } finally {
    restore();
  }
});

test('analysis modal reports evidence and reconstructed technology', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const modals = game.ui.modals;
    const arch = state.archaeology;
    state.shipSystem.stats.analysis = 30;
    state.shipSystem.stats.translation = 30;
    const inst = arch.collect('art_networkRelay', state.location.systemId, 'site');
    const res = arch.analyze(inst.uid);
    assert.equal(res.ok, true);
    modals.showAnalysis(res);
    const text = window.document.querySelector('.modal-body').textContent;
    assert.match(text, /Translation successful/);
    assert.match(text, /Echo of the Network/, 'reconstructed technology named');
  } finally {
    restore();
  }
});

test('galactic map overlay shows the selected system and jump state', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, state, restore } = await makeUi();
  try {
    const map = game.ui.map;
    const mapState = { selectedId: state.location.systemId, jump() { this.jumped = true; } };
    map.show(null, mapState);
    assert.match(window.document.getElementById('map-seedline').textContent, /systems/);
    assert.match(window.document.getElementById('mi-name').textContent, /Kepler's Rest/);
    // Select a far system: jump must be disabled with a reason.
    const far = state.galaxy.systemsWithinLy(state.location.systemId, 1e9).pop().system;
    map.updateSelection(far.id);
    const jumpBtn = window.document.getElementById('map-jump');
    assert.equal(jumpBtn.disabled, true, 'jump disabled when out of range');
    assert.match(jumpBtn.textContent, /RANGE/);
    // A nearby system (with a huge drive) enables the button.
    state.shipSystem.stats.jumpRange = 1e6;
    map.updateSelection(far.id);
    assert.equal(window.document.getElementById('map-jump').disabled, false);
    map.hide();
    assert.ok(window.document.getElementById('map-ui').classList.contains('hidden'));
  } finally {
    restore();
  }
});

test('main menu new game, save slots and briefing render', async (t) => {
  if (!JSDOM) return t.skip('jsdom unavailable');
  const { window, game, restore } = await makeUi();
  try {
    const menu = game.ui.menu;
    menu.show();
    assert.ok(!window.document.getElementById('main-menu').classList.contains('hidden'));
    menu.showSaves();
    assert.ok(!window.document.getElementById('menu-saves').classList.contains('hidden'));
    menu.showHelp();
    assert.match(window.document.getElementById('help-content').textContent, /ARCHAEOLOGY/);
    menu.showMain();
    assert.ok(!window.document.getElementById('menu-main').classList.contains('hidden'));
    window.document.getElementById('seed-input').value = 'test-seed-99';
    menu.newGame();
    assert.ok(window.document.getElementById('main-menu').classList.contains('hidden'));
  } finally {
    restore();
  }
});
