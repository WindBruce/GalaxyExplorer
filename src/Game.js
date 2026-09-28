/**
 * Game: the orchestrator. Owns the renderer, camera, input, UI, state machine
 * and the main loop, and wires every subsystem to the global event bus.
 */
import * as THREE from '../vendor/three.module.js';
import { loadAllData, loadI18nPacks } from './core/DataLoader.js';
import { bus } from './core/EventBus.js';
import { i18n } from './core/I18n.js';
import { GameState } from './sim/GameState.js';
import { saveSystem } from './core/SaveSystem.js';
import { StateMachine } from './states/StateMachine.js';
import { SpaceState } from './states/SpaceState.js';
import { SurfaceState } from './states/SurfaceState.js';
import { MapState } from './states/MapState.js';
import { Input } from './render/Input.js';
import { Notifications } from './ui/Notifications.js';
import { HUD } from './ui/HUD.js';
import { Panels } from './ui/Panels.js';
import { Modals } from './ui/Modals.js';
import { GalacticMapUI } from './ui/GalacticMapUI.js';
import { MainMenu } from './ui/MainMenu.js';
import { Settings, DEFAULT_BINDINGS } from './ui/Settings.js';
import { GameAudio } from './core/Audio.js';

const PANEL_ACTIONS = ['cargo', 'ship', 'skills', 'tech', 'archaeology', 'civs', 'archive', 'missions', 'systemMap'];

const SETTINGS_KEY = 'F2';

export class Game {
  constructor() {
    this.bus = bus;
    this.i18n = i18n;
    this.data = null;
    this.state = null;
    this.save = saveSystem;
    this.canvas = document.getElementById('game-canvas');
    this.paused = false;
    this.autosaveTimer = 0;
    this.hudModuleTimer = 0;

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.audio = null;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(68, window.innerWidth / window.innerHeight, 0.35, 90000);
    this.camera.position.set(0, 40, 240);

    this.input = new Input(this.canvas);
    this.notifications = new Notifications(document.getElementById('notifications'));
    this.ui = {
      notify: (title, body, kind, ttl, speak = false) =>
        this.notifications.notify(title, body, kind, ttl, speak),
      hud: null, panels: null, modals: null, map: null, menu: null,
    };
    this.ui.hud = new HUD(this);
    this.ui.panels = new Panels(this);
    this.ui.modals = new Modals(this);
    this.ui.map = new GalacticMapUI(this);
    this.ui.menu = new MainMenu(this);
    this.ui.settings = new Settings(this);
    this.audio = new GameAudio(this.ui.settings);
    this.applyQuality();
    // Voice narration of transmissions, analyses and mission updates.
    this.notifications.onSpeak = (line) => this.ui.settings.speak(line);
    // Modal + map conveniences so states can talk to the UI through one object.
    Object.assign(this.ui, {
      showEvent: (ev) => this.ui.modals.showEvent(ev),
      showStation: (station) => this.ui.modals.showStation(station),
      showScanResult: (body, info) => this.ui.modals.showScanResult(body, info),
      showAnalysis: (res) => this.ui.modals.showAnalysis(res),
      openDialogue: (civId) => this.ui.modals.openDialogue(civId),
      openTrade: (civId, station) => this.ui.modals.openTrade(civId, station),
      openPanel: (name) => this.ui.panels.open(name),
      closePanel: () => this.ui.panels.close(),
      showGalacticMap: (scene, mapState) => this.ui.map.show(scene, mapState),
      hideGalacticMap: () => this.ui.map.hide(),
      updateGalacticMapSelection: (id) => this.ui.map.updateSelection(id),
    });

    this.states = new StateMachine(this);
    this.states.register('space', new SpaceState(this));
    this.states.register('surface', new SurfaceState(this));
    this.states.register('map', new MapState(this));

    window.addEventListener('resize', () => this._onResize());
    this.canvas.addEventListener('click', () => {
      if (!this.state) return;
      if (this.ui.panels.isOpen() || this.ui.modals.isOpen()) return;
      if (this.states.currentName === 'space' || this.states.currentName === 'surface') {
        this.input.requestPointerLock();
      }
    });

    this._wireBus();
    this.clock = { last: performance.now() };
  }

  _wireBus() {
    const T = (k, v) => this.i18n.t(k, v);
    bus.on('player:levelup', ({ level }) => {
      this.ui.notify(T('notify.levelup'), T('notify.levelupBody', { n: level }), 'good');
    });
    bus.on('archive:added', (record) => {
      this.ui.notify(T('notify.archive'), T('notify.archiveBody', { name: record.name }), 'scan', 4200);
    });
    bus.on('civ:discovered', ({ name }) => {
      this.ui.notify(T('notify.firstContact'), T('notify.firstContactBody', { name }), 'good');
    });
    bus.on('quest:started', ({ title }) => {
      this.ui.notify(T('notify.missionAccepted'), title, 'info');
    });
    bus.on('quest:completed', ({ title, rewards }) => {
      const bits = [];
      if (rewards?.credits) bits.push(T('missions.rewardCredits', { n: rewards.credits.toLocaleString() }));
      if (rewards?.research) bits.push(T('missions.rewardResearch', { n: rewards.research }));
      if (rewards?.xp) bits.push(T('missions.rewardXp', { n: rewards.xp }));
      const line = `${title}${bits.length ? ` — ${bits.join(', ')}` : ''}`;
      this.ui.notify(T('notify.missionComplete'), line, 'good', 6500, true);
    });
    bus.on('quest:available', ({ title }) => {
      this.ui.notify(T('notify.newContract'), title, 'info', 6500, true);
    });
    bus.on('tech:researched', ({ name }) => {
      this.ui.notify(T('notify.techResearched'), name, 'good');
    });
    bus.on('tech:reconstructed', ({ name }) => {
      this.ui.notify(T('notify.techReconstructed'), T('notify.techReconstructedBody', { name }), 'good');
    });
    bus.on('skill:unlocked', ({ name }) => {
      this.ui.notify(T('notify.skillLearned'), name, 'good');
    });
    bus.on('civ:politics', ({ title, text }) => {
      this.ui.notify(title, text, 'info', 8000, true);
    });
    bus.on('ship:destroyed', (payload) => {
      const lost = payload?.lost ?? {};
      const n = Object.values(lost).reduce((s, v) => s + v, 0);
      this.ui.notify(
        T('notify.shipDestroyed'),
        n ? T('notify.shipDestroyedCargo', { n }) : T('notify.shipDestroyedBody'),
        'danger',
        20000
      );
      this.audio?.sfx('hit');
    });
    bus.on('combat:started', () => this.audio?.sfx('notify'));
    bus.on('combat:playerHit', () => this.audio?.sfx('hit'));
    bus.on('combat:hit', () => this.audio?.sfx('fire'));
    bus.on('hostile:destroyed', () => this.audio?.sfx('hit'));
    bus.on('wreck:salvaged', ({ resource, qty }) => {
      this.ui.notify(T('notify.salvage'), T('notify.salvageBody', { name: resource, n: qty }), 'good');
    });
    bus.on('ftl:rescue', ({ cost }) => {
      this.ui.notify(T('notify.rescue'), T('notify.rescueBody', { n: cost.toLocaleString() }), 'warn', 8000, true);
    });
    bus.on('ftl:start', () => this.audio?.sfx('jump'));
    bus.on('i18n:changed', () => this._onLocaleChanged());
  }

  applyQuality() {
    const cap = this.ui.settings?.pixelCap?.() ?? 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  binding(action) {
    return this.ui.settings?.binding(action) ?? DEFAULT_BINDINGS[action];
  }

  /** Re-render every open surface when the language changes. */
  _onLocaleChanged() {
    if (!this.ui) return;
    this.i18n.applyToDocument();
    const open = this.ui.panels?.current ?? null;
    if (open) this.ui.panels.open(open);
    if (this.ui.modals?.isOpen()) {
      const modal = this.ui.modals.current;
      if (modal?.rerender) modal.rerender();
      else if (modal?.title) this.ui.modals.open(modal);
    }
    if (this.ui.settings?.isOpen()) this.ui.settings.open();
    this.ui.hud?.setSystem(this.state?.location?.system ?? null);
    if (this.state?.location?.mode === 'surface') {
      this.ui.hud?.setPlanet(this.state.location.planet ?? null, null);
    }
    if (this.ui.menu?.isOpen()) this.ui.menu.show();
  }

  async boot() {
    const status = document.getElementById('loading-status');
    const fill = document.getElementById('loading-fill');
    const step = (pct, text) => {
      fill.style.width = `${pct}%`;
      status.textContent = text;
    };
    // Language first: every later status string is localised.
    const packs = await loadI18nPacks();
    this.i18n.load(packs);
    this.i18n.applyToDocument();
    step(10, this.i18n.t('app.loading'));
    this.data = await loadAllData();
    step(45, 'Generating procedural galaxy…');
    this.state = new GameState(this.data);
    step(70, 'Initialising systems…');
    this.ui.menu.show();
    step(100, 'Ready');
    // Capture the element: this timer can outlive the global document lookup.
    const loading = document.getElementById('loading');
    setTimeout(() => loading?.classList.add('hidden'), 350);
    this.start();
  }

  newGame(seed, playerName = 'Commander') {
    if (!this.state) this.state = new GameState(this.data);
    this.state.newGame(seed, playerName);
    this.ui.menu.hide();
    this.ui.hud.setSystem(this.state.location.system);
    this.ui.notify(
      this.i18n.t('state.arrived', { name: this.state.location.system.name }),
      this.i18n.t('gen.systemSummary', {
        star: this.state.location.system.star.classLabel,
        planets: this.i18n.tp('gen.planets', this.state.location.system.planets.length, {
          n: this.state.location.system.planets.length,
        }),
        extras: this.state.location.system.summary,
      }),
      'good',
      12000
    );
    this.states.change('space', null, true);
    this.input.requestPointerLock();
    this.audio?.resume();
    this.audio?.setAmbience('space');
    this._showTutorial();
    this.saveGame('autosave');
  }

  _showTutorial() {
    if (!this.ui.settings.get('tutorial')) return;
    const el = document.getElementById('tutorial');
    if (!el) return;
    el.classList.remove('hidden');
    el.innerHTML = `<div class="tutorial-card"><h3>${this.i18n.t('tutorial.title')}</h3><p>${this.i18n.t('tutorial.body')}</p><button class="btn primary" data-tutorial-ok="1">${this.i18n.t('tutorial.ok')}</button></div>`;
    el.querySelector('[data-tutorial-ok]')?.addEventListener('click', () => {
      el.classList.add('hidden');
      this.ui.settings.set('tutorial', false);
    });
  }

  loadGame(slot) {
    const res = this.save.load(slot, this.state);
    if (res.ok) {
      this.ui.menu.hide();
      this.ui.hud.setSystem(this.state.location.system);
      // Force the re-entry: the world under the current state just changed.
      this.states.change(this.state.location.mode === 'surface' ? 'surface' : 'space', null, true);
      this.input.requestPointerLock();
    }
    return res;
  }

  saveGame(slot = 'slot1') {
    const res = this.save.save(slot, this.state);
    this.ui.notify(
      res.ok ? this.i18n.t('notify.saved') : this.i18n.t('notify.saveFailed'),
      res.ok
        ? this.i18n.t('notify.savedBody', { slot, kb: (res.bytes / 1024).toFixed(0) })
        : this.i18n.reason(res),
      res.ok ? 'good' : 'danger'
    );
    return res;
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.applyQuality();
  }

  get inMenu() {
    return !this.ui.menu.root.classList.contains('hidden');
  }

  /** Read a line aloud when voice narration is enabled (see Settings). */
  narrate(text) {
    this.ui?.settings?.speak(text);
  }

  _handleGlobalKeys() {
    const input = this.input;
    for (const panel of PANEL_ACTIONS) {
      if (input.justPressed(this.binding(panel))) {
        if (this.ui.modals.isOpen()) return;
        this.ui.panels.open(panel);
        return;
      }
    }
    if (input.justPressed(SETTINGS_KEY)) {
      if (this.ui.settings.isOpen()) this.ui.settings.close();
      else this.ui.settings.open();
      return;
    }
    if (input.justPressed('Escape')) {
      if (this.ui.modals.isOpen()) {
        this.ui.modals.close();
        return;
      }
      if (this.ui.settings.isOpen()) {
        this.ui.settings.close();
        return;
      }
      if (this.ui.panels.isOpen()) {
        this.ui.panels.close();
        return;
      }
      if (this.states.currentName === 'map') {
        this.states.change('space');
        return;
      }
      this._togglePause();
    }
  }

  _togglePause() {
    this.paused = !this.paused;
    const menu = document.getElementById('pause-menu');
    menu.classList.toggle('hidden', !this.paused);
    const layer = document.getElementById('pause-layer');
    if (layer) layer.textContent = this.i18n.t('pause.layer');
    if (this.paused) {
      this.input.exitPointerLock();
      document.getElementById('btn-resume').onclick = () => this._togglePause();
      document.getElementById('btn-save').onclick = () => { this.saveGame('slot1'); this._togglePause(); };
      document.getElementById('btn-pause-load').onclick = () => {
        this.ui.menu.showSaves();
        this.ui.menu.show();
        this._togglePause();
      };
      document.getElementById('btn-pause-help').onclick = () => {
        this.ui.menu.showHelp();
        this.ui.menu.show();
        this._togglePause();
      };
      document.getElementById('btn-quit').onclick = () => {
        this.saveGame('autosave');
        this._togglePause();
        this.ui.menu.show();
      };
      document.getElementById('btn-settings').onclick = () => {
        this._togglePause();
        this.ui.settings.open();
      };
    } else {
      this.input.requestPointerLock();
    }
  }

  start() {
    const loop = (now) => {
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - this.clock.last) / 1000);
      this.clock.last = now;
      this._tick(dt);
    };
    requestAnimationFrame(loop);
  }

  _tick(dt) {
    const input = this.input;
    if (this.paused || !this.state || this.inMenu) {
      this.audio?.setAmbience('menu');
      this.audio?.setThrust(0);
      input.endFrame();
      return;
    }
    this.audio?.sync();
    const mode = this.states.currentName === 'surface'
      ? 'surface'
      : (this.state.combat?.inCombat ? 'combat' : 'space');
    this.audio?.setAmbience(mode);

    this._handleGlobalKeys();

    const uiBlocking = this.ui.modals.isOpen() || this.ui.panels.isOpen();
    if (!uiBlocking) {
      this.state.clock.update(dt);
      this.state.player.playtime += dt;
      this.state.civs.update(dt);
      this.states.update(dt);
      const s = this.state.ship;
      if (s.shield < s.maxShield) {
        s.shield = Math.min(s.maxShield, s.shield + this.state.shipSystem.stats.shieldRegen * dt);
      }
    }

    // HUD module summary (throttled).
    this.hudModuleTimer -= dt;
    if (this.hudModuleTimer <= 0) {
      this.hudModuleTimer = 0.5;
      const mods = this.state.shipSystem.loadoutSummary()
        .map(({ module }) => module?.name?.split(' (')[0])
        .filter(Boolean);
      const el = document.getElementById('hud-modules');
      if (el) el.textContent = mods.join(' · ');
    }

    this.autosaveTimer += dt;
    if (this.autosaveTimer > 120) {
      this.autosaveTimer = 0;
      this.saveGame('autosave');
    }

    const cam = this.states.currentName === 'map' ? this.states.current?.scene?.camera : this.camera;
    if (cam) this.renderer.render(this.scene, cam);

    input.endFrame();
  }
}
