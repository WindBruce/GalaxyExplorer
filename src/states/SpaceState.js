/**
 * SpaceState: flight inside a star system.
 *
 * Owns the SpaceScene, flight controls, targeting, scanning, mining, combat,
 * landing/docking and the transition to the galactic map.
 */
import * as THREE from '../../vendor/three.module.js';
import { SpaceScene } from '../render/SpaceScene.js';
import { FlightControls } from '../render/FlightControls.js';
import { makeBeam, makeBolt, makeExplosion, makeGlowTexture } from '../render/Objects.js';
import { EventSystem } from '../sim/EventSystem.js';
import { DEFAULT_BINDINGS } from '../ui/Settings.js';

const LAND_DISTANCE_FACTOR = 2.6;
const DOCK_DISTANCE = 150;
const SCAN_RANGE_FACTOR = 6.0;

export class SpaceState {
  constructor(game) {
    this.game = game;
    this.i18n = game.i18n;
    this.name = 'space';
    // Built on enter(): Game constructs the states before boot() creates the
    // GameState, and loading a save replaces that state object entirely.
    this.scene = null;
    this.controls = null;
    this.target = null;
    this.scanProgress = 0;
    this.scanning = null;
    this.mining = false;
    this.miningBeam = null;
    this.fireCooldown = 0;
    this.bolts = [];
    this.explosions = [];
    this.landPrompt = null;
    this.dockPrompt = null;
    this.eventTimer = 30;
    this.time = 0;
  }

  /**
   * The scene is created lazily and rebuilt whenever the game state object
   * changes (new game or load), so it always matches the live simulation.
   */
  _ensureScene() {
    const game = this.game;
    if (this.scene && this.scene.state === game.state) return this.scene;
    if (this.scene) {
      game.scene.remove(this.scene.root);
      this.scene.dispose();
    }
    this.scene = new SpaceScene(game.state);
    return this.scene;
  }

  enter() {
    const game = this.game;
    const state = game.state;
    if (!state) return;
    const system = state.location.system ?? state.galaxy.home;
    state.location.systemId = system.id;
    state.location.system = system;
    state.location.mode = 'space';

    const scene = this._ensureScene();
    scene.build(system);
    game.scene.add(scene.root);

    this.controls = new FlightControls(game.camera, scene.shipObject);
    this.controls.reset();

    game.ui.hud.setSystem(system);
    game.ui.hud.show();
    game.ui.notify(
      this.i18n.t('state.arrived', { name: system.name }),
      this.i18n.t('gen.systemSummary', {
        star: this.i18n.content('starclass', system.star.classId, system.star.classLabel, 'label'),
        planets: this.i18n.tp('gen.planets', system.planets.length, { n: system.planets.length }),
        extras: system.summary,
      }),
      'system'
    );

    // Intro event roll when arriving somewhere new.
    this._rollEvent(true);
    game.bus.emit('space:entered', { systemId: system.id });
  }

  exit() {
    if (this.scene) {
      this.game.scene.remove(this.scene.root);
      this.scene.dispose();
    }
    this.target = null;
    this.scanning = null;
    this.game.ui.hud.setPrompt(null);
  }

  /** Try to trigger a narrative event for the current context. */
  _rollEvent(force = false) {
    const state = this.game.state;
    const ctx = EventSystem.contextFrom(state.location.system);
    const ev = state.events.maybeRoll(ctx, force ? 12 : 45);
    if (ev) this.game.ui.showEvent(ev);
  }

  update(dt) {
    const game = this.game;
    const state = game.state;
    const input = game.input;
    this.time += dt;
    // Never run half-initialised (a failed enter() must not spam the console).
    if (!state || !this.scene || !this.controls) return;

    if (state.ship.destroyed) {
      game.ui.hud.setPrompt(this.i18n.t('state.destroyed'));
      if (input.justPressed('KeyR')) this._respawn();
      return;
    }

    // --- Flight ----------------------------------------------------------
    const flight = this.controls.update(dt, input, state.shipSystem.stats.thrust / 70);
    state.location.position = {
      x: this.scene.shipObject.position.x,
      y: this.scene.shipObject.position.y,
      z: this.scene.shipObject.position.z,
    };

    // Engine plume intensity.
    for (const plume of this.scene.shipObject.userData.plumes) {
      plume.material.uniforms.uIntensity.value = this.controls.thrustLevel;
    }
    game.audio?.setThrust(this.controls.thrustLevel);

    this.scene.update(dt, game.camera);

    // --- Targeting -------------------------------------------------------
    if (input.justPressed('Tab')) this._cycleTarget();
    const shipPos = this.scene.shipObject.position;
    const near = this.scene.nearestBody(shipPos, 4200);
    if (!this.target || (this.target && this.target.object && !this.target.object.parent)) {
      this.target = near;
    }
    if (near && (!this.target || near.distance < (this.target.distance ?? Infinity) - 60)) this.target = near;

    // --- Scanning --------------------------------------------------------
    const bind = (action) => (typeof game.binding === 'function' ? game.binding(action) : DEFAULT_BINDINGS[action]);
    if (input.justPressed(bind('scan')) && this.target) this._startScan(this.target);
    if (this.scanning) {
      this.scanProgress += dt / 1.6;
      if (this.scanProgress >= 1) this._completeScan();
    }

    // --- Weapons ---------------------------------------------------------
    this.fireCooldown -= dt;
    if (input.buttons.has(0) && this.fireCooldown <= 0 && state.combat.hostiles.length) {
      this._fireWeapon();
    }

    // --- Mining ----------------------------------------------------------
    const asteroid = this.scene.nearestAsteroid(shipPos, 90);
    if (input.buttons.has(2) && asteroid) {
      this._mine(asteroid);
    } else if (this.miningBeam) {
      this.scene.root.remove(this.miningBeam);
      this.miningBeam = null;
      this.mining = false;
    }

    // --- Landing / docking prompts ---------------------------------------
    this._updatePrompts(shipPos);

    if (input.justPressed(bind('land'))) {
      if (this.landPrompt) this._land(this.landPrompt);
      else if (this.dockPrompt) this._dock(this.dockPrompt);
    }

    // --- Combat entities -------------------------------------------------
    state.combat.update(dt);
    this._updateHostiles(dt);

    // --- Camera / mode keys ----------------------------------------------
    if (input.justPressed(bind('view'))) {
      const mode = this.controls.toggleCamera();
      game.ui.notify(mode === 'first' ? this.i18n.t('state.cockpit') : this.i18n.t('state.external'), null, 'info');
    }
    if (input.justPressed(bind('map'))) {
      game.states.change('map');
      return;
    }
    if (input.justPressed(bind('rescue')) && state.ship.fuel < 2) {
      const res = state.ftl.rescueTow();
      if (res.ok) {
        this.scene.build(state.location.system);
        this.controls = new FlightControls(this.game.camera, this.scene.shipObject);
        this.controls.reset();
      } else {
        game.ui.notify(this.i18n.t('notify.rescueFail'), this.i18n.reason(res), 'warn');
      }
    }
    if (input.justPressed('KeyE')) {
      const scoop = state.combat.salvageNearest(140);
      if (scoop.ok) game.audio?.sfx('ui');
    }

    // --- Dynamic events ---------------------------------------------------
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.eventTimer = 40 + Math.random() * 30;
      if (!state.events.current) this._rollEvent();
    }

    // --- Survival: fuel/hull warnings ------------------------------------
    this._updateWarnings(dt);

    // --- HUD -------------------------------------------------------------
    game.ui.hud.update(this._hudData(flight, near));
  }

  // ---------------------------------------------------------------------
  // Targeting & scanning
  // ---------------------------------------------------------------------

  _cycleTarget() {
    const candidates = this.scene.bodies.filter((b) => b.kind !== 'asteroid');
    if (!candidates.length) return;
    const idx = this.target ? candidates.findIndex((b) => b.name === this.target.name) : -1;
    this.target = candidates[(idx + 1) % candidates.length];
    this.game.ui.notify(this.i18n.t('state.target', { name: this.target.name }), this.target.label, 'info');
  }

  _startScan(body) {
    if (this.scanning) return;
    const state = this.game.state;
    const dist = body.object.getWorldPosition(new THREE.Vector3()).distanceTo(this.scene.shipObject.position);
    const range = state.shipSystem.stats.scanRange * 900 + body.radius * 3;
    if (dist > range) {
      this.game.ui.notify(
      this.i18n.t('state.outOfRange'),
      this.i18n.t('state.outOfRangeBody', { n: Math.round(dist) }),
      'warn'
    );
      return;
    }
    this.scanning = body;
    this.scanProgress = 0;
    this.scene.spawnScanPulse(body.object.getWorldPosition(new THREE.Vector3()), '#66ffee', body.radius * 4);
    this.game.ui.hud.setScan({ active: true, name: body.name, progress: 0 });
  }

  _completeScan() {
    const body = this.scanning;
    this.scanning = null;
    this.scanProgress = 0;
    const state = this.game.state;
    state.markScanned(body.data, body.kind);
    this.game.ui.hud.setScan({ active: false, name: body.name, progress: 1 });
    const info = this._describe(body);
    this.game.ui.notify(this.i18n.t('state.scanComplete', { name: body.name }), info, 'scan');
    this.game.ui.showScanResult(body, info);
  }

  _describe(body) {
    const d = body.data;
    const T = (k, v) => this.i18n.t(k, v);
    const list = (ids) => ids.map((id) => this.i18n.content('resource', id, id)).join(', ');
    switch (body.kind) {
      case 'planet':
        return T('gen.scanPlanet', {
          desc: d.description,
          list: d.resources.map((r) => `${list([r.id])} x${r.quantity}`).join(', '),
        });
      case 'star':
        return T('gen.scanStar', {
          label: this.i18n.content('starclass', d.classId, d.classLabel, 'label'),
          spectral: d.spectral, temp: d.temp,
          mass: d.mass.toFixed(2), age: d.ageGyr.toFixed(1),
        });
      case 'station':
        return T('gen.scanStation', {
          kind: T(`label.stationkind.${d.kind}`, {}),
          derelict: d.derelict ? ` (${T('modal.derelict')})` : '',
          owner: d.owner ? this.i18n.content('civilization', d.owner, d.owner, 'name') : T('cargo.unknown'),
        });
      case 'ruin':
        return T('gen.scanRuin', { desc: d.description, age: d.ageGyr.toFixed(1) });
      case 'anomaly':
        return T('gen.scanAnomaly', {
          kind: this.i18n.content('anomalyKind', d.kind, d.kind),
          p: (d.hazard * 100).toFixed(0), list: list(d.resources),
        });
      case 'asteroid':
        return T('gen.scanAsteroid', { list: list(d.resources.map((r) => r.id)) });
      default:
        return '';
    }
  }

  // ---------------------------------------------------------------------
  // Mining / weapons / combat
  // ---------------------------------------------------------------------

  _mine(asteroid) {
    if (!this.miningBeam) {
      this.miningBeam = makeBeam('#ffaa33', 120);
      this.scene.root.add(this.miningBeam);
      this.mining = true;
    }
    const from = this.scene.shipObject.position;
    const to = asteroid.world;
    this.miningBeam.position.copy(from);
    this.miningBeam.lookAt(to);
    const dist = from.distanceTo(to);
    this.miningBeam.scale.set(1, Math.max(0.1, dist / 120), 1);
    this.miningBeam.visible = true;

    if (!this._mineCooldown || this._mineCooldown <= 0) {
      this._mineCooldown = 0.55;
      const resources = asteroid.object.userData.resources ?? this.target?.data?.resources ?? [{ id: 'iron', quantity: 100 }];
      const got = this.game.state.resources.mine(resources, this.game.state.shipSystem.stats.miningYield);
      const names = Object.entries(got).map(([id, q]) => `${id} +${q}`).join(', ');
      if (names) this.game.ui.notify(this.i18n.t('state.extracted'), names, 'mine');
    }
    this._mineCooldown -= 1 / 60;
  }

  _fireWeapon() {
    const state = this.game.state;
    const stats = state.shipSystem.stats;
    if (stats.damage <= 0) return;
    this.fireCooldown = 1 / Math.max(0.2, stats.rate ?? 1);
    const bolt = makeBolt('#ff88aa');
    const ship = this.scene.shipObject;
    bolt.position.copy(ship.position).addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion), 4);
    bolt.lookAt(ship.position.clone().addScaledVector(new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion), 1000));
    bolt.userData.velocity = new THREE.Vector3(0, 0, -1).applyQuaternion(ship.quaternion).multiplyScalar(900);
    bolt.userData.damage = stats.damage;
    this.scene.root.add(bolt);
    this.bolts.push(bolt);
    state.bus.emit('weapon:fired', {});
  }

  _updateHostiles(dt) {
    const state = this.game.state;
    const shipPos = this.scene.shipObject.position;
    for (const h of state.combat.hostiles) {
      let mesh = h._mesh;
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.OctahedronGeometry(4.5, 0),
          new THREE.MeshStandardMaterial({ color: new THREE.Color(h.color), metalness: 0.7, roughness: 0.35, emissive: new THREE.Color(h.color).multiplyScalar(0.25) })
        );
        this.scene.root.add(mesh);
        h._mesh = mesh;
      }
      mesh.position.set(h.position.x, h.position.y, h.position.z);
      mesh.rotation.y += dt * 1.5;
      mesh.rotation.x += dt * 0.8;

      // Bolts hitting hostiles.
      for (let i = this.bolts.length - 1; i >= 0; i--) {
        const bolt = this.bolts[i];
        if (bolt.position.distanceTo(mesh.position) < 7) {
          state.combat.playerFire(h.id);
          this.scene.root.remove(bolt);
          this.bolts.splice(i, 1);
        }
      }
    }

    // Expire bolts.
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.position.addScaledVector(bolt.userData.velocity, dt);
      bolt.userData.life -= dt;
      if (bolt.userData.life <= 0 || bolt.position.length() > 40000) {
        this.scene.root.remove(bolt);
        this.bolts.splice(i, 1);
      }
    }

    // Explosions.
    for (let i = this.explosions.length - 1; i >= 0; i--) {
      const ex = this.explosions[i];
      ex.userData.life -= dt;
      const t = 1 - ex.userData.life / ex.userData.maxLife;
      ex.scale.setScalar(0.4 + t * 3.2);
      ex.children[0].material.opacity = 1 - t;
      ex.children[1].material.opacity = (1 - t) * 0.9;
      if (ex.userData.life <= 0) {
        this.scene.root.remove(ex);
        this.explosions.splice(i, 1);
      }
    }

    // Hostile destroyed -> explosion.
    for (const h of [...state.combat.hostiles]) {
      if (h.hp <= 0 && h._mesh) {
        const ex = makeExplosion();
        ex.position.copy(h._mesh.position);
        this.scene.root.add(ex);
        this.explosions.push(ex);
        this.scene.root.remove(h._mesh);
        h._mesh = null;
      }
    }
  }

  // ---------------------------------------------------------------------
  // Landing, docking, prompts
  // ---------------------------------------------------------------------

  _updatePrompts(shipPos) {
    this.landPrompt = null;
    this.dockPrompt = null;
    let prompt = null;

    for (const b of this.scene.bodies) {
      if (b.kind === 'planet') {
        const world = b.object.getWorldPosition(new THREE.Vector3());
        const d = world.distanceTo(shipPos);
        if (b.data.landable && d < b.radius * LAND_DISTANCE_FACTOR) {
          this.landPrompt = { planet: b.data, body: b, distance: d };
          prompt = this.i18n.t('state.land', {
            name: b.data.name,
            type: this.i18n.content('planettype', b.data.type, b.data.typeLabel, 'label'),
          });
        }
      } else if (b.kind === 'station') {
        const world = b.object.getWorldPosition(new THREE.Vector3());
        const d = world.distanceTo(shipPos);
        if (d < DOCK_DISTANCE) {
          this.dockPrompt = { station: b.data, distance: d };
          prompt = this.i18n.t('state.dock', { name: b.data.name });
        }
      } else if (b.kind === 'anomaly') {
        const world = b.object.getWorldPosition(new THREE.Vector3());
        const d = world.distanceTo(shipPos);
        if (d < b.radius * 1.2) prompt = this.i18n.t('state.scanAnomaly', { name: b.data.name });
      }
    }
    this.game.ui.hud.setPrompt(prompt);
  }

  _land(prompt) {
    const state = this.game.state;
    state.location.planetId = prompt.planet.id;
    state.location.landingSite = null;
    state.stats.planetsLanded += 1;
    state.bus.emit('landing', { planetId: prompt.planet.id });
    state.addXp(80);
    this.game.states.change('surface', { planet: prompt.planet, ruin: null });
  }

  _dock(prompt) {
    this.game.ui.showStation(prompt.station);
  }

  _respawn() {
    const state = this.game.state;
    const home = state.galaxy.home;
    state.ship.destroyed = false;
    state.ship.hull = state.ship.maxHull;
    state.ship.shield = state.ship.maxShield;
    state.ship.fuel = state.ship.maxFuel;
    state.location.systemId = home.id;
    state.location.system = home;
    state.combat.clear();
    this.scene.build(home);
    this.controls = new FlightControls(this.game.camera, this.scene.shipObject);
    this.controls.reset();
    this.game.ui.notify(this.i18n.t('state.respawn'), this.i18n.t('state.respawnBody'), 'warn');
    state.player.credits = Math.max(0, state.player.credits - 4000);
  }

  _updateWarnings(dt) {
    const state = this.game.state;
    this._warnTimer = (this._warnTimer ?? 0) - dt;
    if (this._warnTimer > 0) return;
    this._warnTimer = 12;
    if (state.ship.fuel < 2) {
      this.game.ui.notify(this.i18n.t('state.dryFuel'), this.i18n.t('state.dryFuelBody'), 'danger');
    } else if (state.ship.fuel < state.ship.maxFuel * 0.15) {
      this.game.ui.notify(this.i18n.t('state.lowFuel'), this.i18n.t('state.lowFuelBody'), 'warn');
    }
    if (state.ship.hull < state.ship.maxHull * 0.3) {
      this.game.ui.notify(this.i18n.t('state.hullCritical'), this.i18n.t('state.hullCriticalBody'), 'warn');
    }
  }

  _hudData(flight, near) {
    const state = this.game.state;
    const ship = state.ship;
    const stats = state.shipSystem.stats;
    return {
      system: state.location.system,
      speed: flight.speed,
      maxSpeed: flight.maxSpeed,
      boost: flight.boost,
      hull: ship.hull, maxHull: ship.maxHull,
      shield: ship.shield, maxShield: ship.maxShield,
      fuel: ship.fuel, maxFuel: ship.maxFuel,
      cargoUsed: state.resources.used, cargoMax: state.resources.capacity,
      power: stats.powerOutput, powerDraw: stats.powerDraw,
      target: this.target ? {
        name: this.target.name, label: this.target.label,
        distance: this.target.object.getWorldPosition(new THREE.Vector3()).distanceTo(this.scene.shipObject.position),
        scanned: this.target.data?.scanned,
      } : null,
      scanning: this.scanning ? { name: this.scanning.name, progress: this.scanProgress } : null,
      combat: state.combat.hostiles.length,
      stardate: state.clock.stardate,
      region: state.galaxy.regions.find((r) => r.id === state.location.system?.regionId)?.name ?? '',
    };
  }
}
