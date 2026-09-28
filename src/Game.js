/**
 * Game: the orchestrator. Owns the renderer, camera, input, UI, state machine
 * and the main loop, and wires every subsystem to the global event bus.
 */
import * as THREE from '../vendor/three.module.js';
import { loadAllData } from './core/DataLoader.js';
import { bus } from './core/EventBus.js';
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

const PANEL_KEYS = {
  KeyI: 'cargo', KeyU: 'ship', KeyK: 'skills', KeyL: 'tech',
  KeyJ: 'archaeology', KeyB: 'civs', KeyA: 'archive', KeyP: 'missions', KeyN: 'systemMap',
};

export class Game {
  constructor() {
    this.bus = bus;
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
      notify: (title, body, kind, ttl) => this.notifications.notify(title, body, kind, ttl),
      hud: null, panels: null, modals: null, map: null, menu: null,
    };
    this.ui.hud = new HUD(this);
    this.ui.panels = new Panels(this);
    this.ui.modals = new Modals(this);
    this.ui.map = new GalacticMapUI(this);
    this.ui.menu = new MainMenu(this);
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
      showGalacticMap: (mapState) => this.ui.map.show(this, mapState),
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
    bus.on('player:levelup', ({ level }) => {
      this.ui.notify('Level up', `You are now level ${level}. +2 skill points.`, 'good');
    });
    bus.on('archive:added', (record) => {
      this.ui.notify('Archive updated', `${record.name} recorded in the Galactic Civilization Archive.`, 'scan', 4200);
    });
    bus.on('civ:discovered', ({ name }) => {
      this.ui.notify('First contact', `${name} added to the civilisation database.`, 'good');
    });
    bus.on('quest:started', ({ title }) => {
      this.ui.notify('Mission accepted', title, 'info');
    });
    bus.on('quest:completed', ({ title, rewards }) => {
      const bits = [];
      if (rewards?.credits) bits.push(`¢${rewards.credits.toLocaleString()}`);
      if (rewards?.research) bits.push(`${rewards.research} research`);
      if (rewards?.xp) bits.push(`${rewards.xp} XP`);
      this.ui.notify('Mission complete', `${title}${bits.length ? ` — ${bits.join(', ')}` : ''}`, 'good');
    });
    bus.on('quest:available', ({ title }) => {
      this.ui.notify('New contract available', title, 'info');
    });
    bus.on('tech:researched', ({ name }) => {
      this.ui.notify('Technology researched', name, 'good');
    });
    bus.on('tech:reconstructed', ({ name }) => {
      this.ui.notify('Technology reconstructed', `${name} — recovered from archaeological evidence.`, 'good');
    });
    bus.on('skill:unlocked', ({ name }) => {
      this.ui.notify('Skill learned', name, 'good');
    });
    bus.on('civ:politics', ({ title, text }) => {
      this.ui.notify(title, text, 'info', 8000);
    });
    bus.on('ship:destroyed', () => {
      this.ui.notify('SHIP DESTROYED', 'Press R to be recovered by the Terran Concord rescue tow.', 'danger', 20000);
    });
  }

  async boot() {
    const status = document.getElementById('loading-status');
    const fill = document.getElementById('loading-fill');
    const step = (pct, text) => {
      fill.style.width = `${pct}%`;
      status.textContent = text;
    };
    step(10, 'Loading data packs…');
    this.data = await loadAllData();
    step(45, 'Generating procedural galaxy…');
    this.state = new GameState(this.data);
    step(70, 'Initialising systems…');
    this.ui.menu.show();
    step(100, 'Ready');
    setTimeout(() => document.getElementById('loading').classList.add('hidden'), 350);
    this.start();
  }

  newGame(seed, playerName = 'Commander') {
    if (!this.state) this.state = new GameState(this.data);
    this.state.newGame(seed, playerName);
    this.ui.hud.setSystem(this.state.location.system);
    this.ui.notify(
      'Expedition begins',
      `${this.state.galaxy.allSystems().length} systems generated from seed "${seed}". You are in orbit at ${this.state.location.system.name}. Press M for the galactic map.`,
      'good',
      12000
    );
    this.states.change('space');
    this.input.requestPointerLock();
    this.saveGame('autosave');
  }

  loadGame(slot) {
    const res = this.save.load(slot, this.state);
    if (res.ok) {
      this.ui.hud.setSystem(this.state.location.system);
      this.states.change(this.state.location.mode === 'surface' ? 'surface' : 'space');
      this.input.requestPointerLock();
    }
    return res;
  }

  saveGame(slot = 'slot1') {
    const res = this.save.save(slot, this.state);
    this.ui.notify(
      res.ok ? 'Game saved' : 'Save failed',
      res.ok ? `Slot: ${slot} (${(res.bytes / 1024).toFixed(0)} KB)` : res.reason,
      res.ok ? 'good' : 'danger'
    );
    return res;
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  get inMenu() {
    return !this.ui.menu.root.classList.contains('hidden');
  }

  _handleGlobalKeys() {
    const input = this.input;
    for (const [code, panel] of Object.entries(PANEL_KEYS)) {
      if (input.justPressed(code)) {
        if (this.ui.modals.isOpen()) return;
        this.ui.panels.open(panel);
        return;
      }
    }
    if (input.justPressed('Escape')) {
      if (this.ui.modals.isOpen()) {
        this.ui.modals.close();
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
    document.getElementById('pause-menu').classList.toggle('hidden', !this.paused);
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
      input.endFrame();
      return;
    }

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
