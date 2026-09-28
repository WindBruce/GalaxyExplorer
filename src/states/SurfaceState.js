/**
 * SurfaceState: planetary exploration on foot.
 *
 * Walks the generated terrain, extracts surface resources, excavates
 * artifacts at ruins and takes real environmental risk (radiation, toxicity,
 * gravity) depending on the world and the ship's life support.
 */
import * as THREE from '../../vendor/three.module.js';
import { TerrainScene } from '../render/TerrainScene.js';
import { CharacterControls } from '../render/FlightControls.js';
import { makeCharacter, makeBeam } from '../render/Objects.js';

export class SurfaceState {
  constructor(game) {
    this.game = game;
    this.name = 'surface';
    // Built on enter(): see SpaceState._ensureScene().
    this.scene = null;
    this.controls = null;
    this.character = null;
    this.prompt = null;
    this.beam = null;
    this.mineCooldown = 0;
    this.hazardTimer = 0;
    this.time = 0;
  }

  /** Lazily (re)create the terrain scene for the current game state. */
  _ensureScene() {
    const game = this.game;
    if (this.scene && this.scene.state === game.state) return this.scene;
    if (this.scene) {
      game.scene.remove(this.scene.root);
      this.scene.dispose();
    }
    this.scene = new TerrainScene(game.state);
    return this.scene;
  }

  enter(payload = {}) {
    const game = this.game;
    const state = game.state;
    const planet = payload.planet ?? state.currentPlanet() ?? state.location.system.planets[0];
    const ruin = payload.ruin ?? (planet.ruinSiteIds.length
      ? state.location.system.ruins.find((r) => r.id === planet.ruinSiteIds[0])
      : null);

    state.location.planetId = planet.id;
    state.location.mode = 'surface';
    state.location.landingSite = ruin?.id ?? null;

    const scene = this._ensureScene();
    scene.build(planet, ruin);
    game.scene.add(scene.root);

    this.character = makeCharacter();
    // Spawn a little way from the site so the ruin is visible on arrival.
    const spawnAngle = Math.PI * 0.25;
    const spawnRadius = ruin ? 110 : 40;
    const sx = Math.cos(spawnAngle) * spawnRadius;
    const sz = Math.sin(spawnAngle) * spawnRadius;
    this.character.position.set(sx, scene.heightAt(sx, sz), sz);
    scene.root.add(this.character);

    this.controls = new CharacterControls(game.camera, this.character);
    this.controls.yaw = Math.atan2(-sx, -sz);
    game.camera.position.set(sx, scene.heightAt(sx, sz) + 1.7, sz);
    game.camera.rotation.set(0, this.controls.yaw, 0);

    game.ui.hud.setPlanet(planet, ruin);
    game.ui.hud.show();
    game.ui.notify(
      `Landed on ${planet.name}`,
      `${planet.description}${planet.life ? '' : ' No biosignatures.'}${ruin ? ` Ruin site: ${ruin.name}.` : ''}`,
      'landing'
    );
    state.bus.emit('surface:entered', { planetId: planet.id });
  }

  exit() {
    if (this.scene) {
      this.game.scene.remove(this.scene.root);
      this.scene.dispose();
    }
    this.character = null;
    this.game.ui.hud.setPrompt(null);
    this.game.ui.hud.setPlanet(null, null);
  }

  update(dt) {
    const game = this.game;
    const state = game.state;
    const input = game.input;
    this.time += dt;
    // Never run half-initialised (a failed enter() must not spam the console).
    if (!state || !this.scene || !this.controls || !this.character) return;

    // --- Movement --------------------------------------------------------
    const charPos = this.character.position;
    const ground = this.scene.heightAt(charPos.x, charPos.z);
    const move = this.controls.update(dt, input, ground);
    this.scene.update(dt, game.camera);

    // --- Hazard exposure -------------------------------------------------
    const planet = this.scene.planet;
    this.hazardTimer -= dt;
    if (this.hazardTimer <= 0) {
      this.hazardTimer = 6;
      const hazard = planet.hazard * (planet.breathable ? 0.35 : 1.0);
      const resist = state.shipSystem.stats.hazardResist;
      const damage = Math.max(0, (hazard * 9 - resist * 2.2));
      if (damage > 0.5) {
        state.ship.applyDamage(damage, 'environmental');
        if (Math.random() < 0.4) {
          game.ui.notify('Environmental damage', `Hull integrity dropping on the surface of ${planet.name}.`, 'warn');
        }
      }
    }

    // --- Resource extraction --------------------------------------------
    const node = this._nearestNode(6.5);
    if (input.buttons.has(0) && node) {
      this._extract(node);
    } else if (this.beam) {
      this.beam.visible = false;
    }

    // --- Artifacts -------------------------------------------------------
    const artifact = this._nearestArtifact(5.0);
    if (input.justPressed('KeyE')) {
      if (artifact) this._excavate(artifact);
    }

    // --- Prompts ---------------------------------------------------------
    let prompt = null;
    if (node) prompt = `[Hold LMB] Extract ${state.data.resources[node.resourceId]?.name ?? node.resourceId}`;
    if (artifact) prompt = `[E] Excavate artifact`;
    const distToShipSpawn = Math.hypot(charPos.x, charPos.z);
    if (distToShipSpawn < 14) prompt = '[F] Return to ship';
    this.game.ui.hud.setPrompt(prompt);

    if (input.justPressed('KeyF') && distToShipSpawn < 14) {
      state.location.mode = 'space';
      game.states.change('space');
      return;
    }
    if (input.justPressed('KeyV')) {
      const mode = this.controls.toggleCamera();
      game.ui.notify(mode === 'first' ? 'First person' : 'Third person', null, 'info');
    }
    if (input.justPressed('KeyM')) {
      game.states.change('map');
      return;
    }

    // --- HUD -------------------------------------------------------------
    game.ui.hud.update(this._hudData(move));
  }

  _nearestNode(maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const n of this.scene.resourceNodes) {
      if (n.depleted) continue;
      const d = n.position.distanceTo(this.character.position);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  _nearestArtifact(maxDist) {
    let best = null;
    let bestD = maxDist;
    for (const a of this.scene.artifactProps) {
      if (a.taken) continue;
      const d = a.object.position.distanceTo(this.character.position);
      if (d < bestD) {
        bestD = d;
        best = a;
      }
    }
    return best;
  }

  _extract(node) {
    if (!this.beam) {
      this.beam = makeBeam('#ffaa33', 8);
      this.scene.root.add(this.beam);
    }
    this.beam.visible = true;
    this.beam.position.set(
      this.character.position.x,
      this.character.position.y + 1.4,
      this.character.position.z
    );
    this.beam.lookAt(node.position);
    this.mineCooldown -= 1 / 60;
    if (this.mineCooldown <= 0) {
      this.mineCooldown = 0.5;
      const got = this.scene.mineNode(node, this.game.state.shipSystem.stats.miningYield);
      if (got?.amount > 0) {
        this.game.ui.notify(
          'Extracted',
          `${this.game.state.data.resources[got.resourceId]?.name ?? got.resourceId} +${got.amount}`,
          'mine'
        );
      }
    }
  }

  _excavate(artifact) {
    const state = this.game.state;
    const def = state.archaeology.artifactDef(artifact.artifactId);
    if (!def) return;
    artifact.taken = true;
    artifact.object.visible = false;
    state.archaeology.collect(def.id, state.location.systemId, artifact.siteId);
    state.stats.artifactsFound += 1;
    state.addXp(150);
    this.game.ui.notify(
      `Recovered: ${def.name}`,
      `${def.desc} Analyse it in the Archaeology Archive [J].`,
      'artifact'
    );
    // Discovering a ruin site on the ground also counts.
    const ruin = state.location.system?.ruins.find((r) => r.id === artifact.siteId);
    if (ruin && !ruin.discovered) {
      ruin.discovered = true;
      state.stats.ruinsFound += 1;
      state.bus.emit('ruin:discovered', { siteId: ruin.id, systemId: state.location.systemId });
      state.archive.add('ruin', ruin.id, {
        name: ruin.name,
        summary: ruin.description,
        meta: { civTag: ruin.civTag, era: ruin.era, size: ruin.size, ageGyr: ruin.ageGyr, systemId: state.location.systemId },
      });
    }
  }

  _hudData(move) {
    const state = this.game.state;
    const planet = this.scene.planet;
    return {
      surface: true,
      planet,
      speed: move.speed,
      grounded: move.grounded,
      hull: state.ship.hull, maxHull: state.ship.maxHull,
      shield: state.ship.shield, maxShield: state.ship.maxShield,
      fuel: state.ship.fuel, maxFuel: state.ship.maxFuel,
      cargoUsed: state.resources.used, cargoMax: state.resources.capacity,
      hazard: planet.hazard,
      resist: state.shipSystem.stats.hazardResist,
      stardate: state.clock.stardate,
      system: state.location.system,
    };
  }
}
