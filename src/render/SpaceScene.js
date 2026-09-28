/**
 * SpaceScene: builds and animates everything inside one star system.
 *
 * The scene is rebuilt whenever the player jumps. Bodies keep their real
 * physical values in `userData` while being rendered at gameplay scale.
 */
import * as THREE from '../../vendor/three.module.js';
import { SCALE } from '../world/StarSystemGenerator.js';
import { Rng } from '../core/Random.js';
import {
  makeSkybox, makeStar, makeBlackHole, makePlanet, makeOrbitLine, makeStation,
  makeRuin, makeAsteroid, makeAnomaly, makeNebulaClouds, makeShip, makeScanPulse,
  planetVisualRadius,
} from './Objects.js';

export class SpaceScene {
  /** @param {import('../sim/GameState.js').GameState} state */
  constructor(state) {
    this.state = state;
    this.root = new THREE.Group();
    this.bodies = [];
    this.pulses = [];
    this.time = 0;
    this.system = null;
    this.shipObject = null;
    this.skybox = null;
  }

  /** Build the scene for a star system. */
  build(system) {
    this.dispose();
    this.system = system;
    const state = this.state;
    const rng = new Rng(system.seed);

    // Backdrop.
    const region = state.galaxy.regions.find((r) => r.id === system.regionId);
    this.skybox = makeSkybox(system.seed, region?.color ?? '#4a6fa5', 1.0);
    this.root.add(this.skybox);

    // Nebula clouds.
    this.nebula = makeNebulaClouds(system.seed, [region?.color ?? '#8338ec', '#3a86ff', '#f72585']);
    this.root.add(this.nebula);

    // Star.
    if (system.star.classId === 'blackHole') {
      this.star = makeBlackHole(system.star);
    } else {
      this.star = makeStar(system.star);
    }
    this.root.add(this.star);
    this.bodies.push({
      object: this.star, kind: 'star', data: system.star, name: system.star.name,
      radius: this.star.userData.radius, label: system.star.classLabel, systemId: system.id,
    });

    // Planets.
    this.planets = [];
    for (const planet of system.planets) {
      const obj = makePlanet(planet, system.star.color);
      this.root.add(obj);
      this.planets.push(obj);
      this.bodies.push({
        object: obj, kind: 'planet', data: planet, name: planet.name,
        radius: obj.userData.radius, label: planet.typeLabel, systemId: system.id,
      });
      const orbit = makeOrbitLine(planet.orbitAu);
      this.root.add(orbit);

      // Moons (visual only).
      for (let m = 0; m < Math.min(3, planet.moons.length); m++) {
        const moon = new THREE.Mesh(
          new THREE.SphereGeometry(planetVisualRadius(planet.moons[m].radiusKm) * 1.6, 20, 14),
          new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.95, metalness: 0.05 })
        );
        moon.userData = { orbitRadius: obj.userData.radius * 3.2 + m * 4, phase: rng.float(0, 6.28), speed: rng.float(0.15, 0.4) };
        obj.add(moon);
      }

      // Ruins attached to their planet's surface.
      for (const siteId of planet.ruinSiteIds) {
        const ruin = system.ruins.find((r) => r.id === siteId);
        if (!ruin) continue;
        const ruinObj = makeRuin(ruin);
        const rrng = new Rng(ruin.seed);
        const lat = rrng.float(-0.9, 0.9);
        const lon = rrng.float(0, Math.PI * 2);
        const r = obj.userData.radius;
        const pos = new THREE.Vector3(
          Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)
        ).multiplyScalar(r);
        ruinObj.position.copy(pos);
        ruinObj.lookAt(pos.clone().multiplyScalar(2));
        obj.add(ruinObj);
        this.bodies.push({
          object: ruinObj, kind: 'ruin', data: ruin, name: ruin.name,
          radius: ruinObj.userData.radius, label: `${ruin.size} ruin (${ruin.civTag})`, systemId: system.id, parent: obj,
        });
      }
    }

    // Stations.
    for (const station of system.stations) {
      const obj = makeStation(station);
      const srrng = new Rng(station.id.length * 7717);
      obj.userData.orbitAu = station.orbitAu;
      obj.userData.phase = srrng.float(0, 6.28);
      obj.userData.speed = 0.05 / Math.pow(station.orbitAu, 1.5);
      this.root.add(obj);
      this.bodies.push({
        object: obj, kind: 'station', data: station, name: station.name,
        radius: obj.userData.radius, label: station.kind, systemId: system.id,
      });
    }

    // Asteroid belt.
    this.asteroids = [];
    const beltAu = system.planets.length ? system.planets[Math.floor(system.planets.length / 2)].orbitAu * 1.35 : 3;
    for (let i = 0; i < 26; i++) {
      const rock = makeAsteroid(system.seed + i * 31, rng.float(1.2, 4.5));
      const a = rng.float(0, Math.PI * 2);
      const r = beltAu * SCALE.unitsPerAu * rng.float(0.85, 1.2);
      rock.position.set(Math.cos(a) * r, rng.float(-14, 14), Math.sin(a) * r);
      rock.userData.orbitRadius = Math.hypot(rock.position.x, rock.position.z);
      rock.userData.orbitPhase = a;
      rock.userData.orbitSpeed = 0.05 / Math.pow(beltAu, 1.5);
      this.root.add(rock);
      this.asteroids.push(rock);
      if (i < 4) {
        this.bodies.push({
          object: rock, kind: 'asteroid',
          data: {
            resources: rng.chance(0.5)
              ? [{ id: 'iron', quantity: rng.int(120, 400) }, { id: 'nickel', quantity: rng.int(60, 220) }]
              : [{ id: 'silicon', quantity: rng.int(80, 260) }],
          },
          name: `Asteroid ${system.star.name}-${i + 1}`, radius: rock.userData.radius, label: 'Asteroid', systemId: system.id,
        });
      }
    }

    // Anomalies.
    for (const anomaly of system.anomalies) {
      const obj = makeAnomaly(anomaly);
      const dir = new THREE.Vector3(rng.float(-1, 1), rng.float(-0.4, 0.4), rng.float(-1, 1)).normalize();
      obj.position.copy(dir.multiplyScalar(rng.float(600, 1400)));
      this.root.add(obj);
      this.bodies.push({
        object: obj, kind: 'anomaly', data: anomaly, name: anomaly.name,
        radius: obj.userData.radius, label: `Anomaly (${anomaly.kind})`, systemId: system.id,
      });
    }

    // Player ship.
    const loadout = {};
    for (const id of Object.values(state.ship.modules)) loadout[id] = id;
    this.shipObject = makeShip(loadout);
    const spawn = this._spawnPoint(system);
    this.shipObject.position.copy(spawn);
    this.shipObject.lookAt(0, 0, 0);
    this.root.add(this.shipObject);

    return this;
  }

  /** A sensible arrival point: near the innermost landable planet. */
  _spawnPoint(system) {
    const landable = system.planets.find((p) => p.landable) ?? system.planets[0];
    if (!landable) return new THREE.Vector3(0, 60, 400);
    const au = landable.orbitAu * SCALE.unitsPerAu;
    return new THREE.Vector3(au * 1.15, au * 0.28, au * 1.15);
  }

  /** Animate orbits, spins, shaders and effects. */
  update(dt, camera) {
    this.time += dt;
    const t = this.time;

    if (this.skybox) {
      this.skybox.position.copy(camera.position);
      this.skybox.material.uniforms.uTime.value = t;
    }

    if (this.star) {
      const u = this.star.userData;
      if (u.core?.material?.uniforms) u.core.material.uniforms.uTime.value = t;
      if (u.disk) u.disk.material.uniforms.uTime.value = t;
      if (u.kind === 'star') this.star.rotation.y += dt * 0.02;
    }

    for (const obj of this.planets ?? []) {
      const u = obj.userData;
      const angle = u.phase + t * (0.05 / Math.pow(Math.max(0.3, u.orbitAu), 1.5));
      obj.position.set(
        Math.cos(angle) * u.orbitAu * SCALE.unitsPerAu, 0,
        Math.sin(angle) * u.orbitAu * SCALE.unitsPerAu
      );
      obj.rotation.y += dt * u.spin;
      if (u.surface) {
        u.surface.material.uniforms.uTime.value = t;
        u.surface.material.uniforms.uLightDir.value.copy(obj.worldToLocal(new THREE.Vector3(0, 0, 0))).normalize();
      }
      if (u.atmo) {
        u.atmo.material.uniforms.uLightDir.value.copy(obj.worldToLocal(new THREE.Vector3(0, 0, 0))).normalize();
      }
      for (const child of obj.children) {
        const cu = child.userData;
        if (cu.orbitRadius) {
          const a = cu.phase + t * cu.speed;
          child.position.set(Math.cos(a) * cu.orbitRadius, 0, Math.sin(a) * cu.orbitRadius);
        }
      }
    }

    for (const b of this.bodies) {
      const u = b.object.userData;
      if (u.kind === 'station' && u.orbitAu !== undefined) {
        const a = u.phase + t * u.speed;
        b.object.position.set(
          Math.cos(a) * u.orbitAu * SCALE.unitsPerAu, 0,
          Math.sin(a) * u.orbitAu * SCALE.unitsPerAu
        );
      }
      if (u.kind === 'ruin') {
        u.core.rotation.y += dt * 0.4;
        u.core.rotation.x += dt * 0.2;
      }
      if (u.kind === 'anomaly') {
        u.shell.rotation.y += dt * 0.25;
        u.shell.rotation.x += dt * 0.12;
        u.haze.material.uniforms.uTime.value = t;
      }
    }

    for (const rock of this.asteroids ?? []) {
      const u = rock.userData;
      const a = u.orbitPhase + t * u.orbitSpeed;
      rock.position.x = Math.cos(a) * u.orbitRadius;
      rock.position.z = Math.sin(a) * u.orbitRadius;
      rock.rotation.y += dt * u.spin;
      rock.rotation.x += dt * u.spin * 0.5;
    }

    if (this.nebula) {
      for (const cloud of this.nebula.children) {
        cloud.quaternion.copy(camera.quaternion);
        cloud.material.uniforms.uTime.value = t;
      }
    }

    if (this.shipObject) {
      for (const plume of this.shipObject.userData.plumes) {
        plume.material.uniforms.uTime.value = t;
      }
    }

    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      p.life -= dt;
      const progress = 1 - p.life / p.maxLife;
      p.material.uniforms.uProgress.value = progress;
      p.quaternion.copy(camera.quaternion);
      const scale = p.userData.startScale * (1 + progress * 3.2);
      p.scale.set(scale, scale, 1);
      if (p.life <= 0) {
        p.parent?.remove(p);
        p.geometry.dispose();
        p.material.dispose();
        this.pulses.splice(i, 1);
      }
    }
  }

  /** Fire a scan pulse at a world position. */
  spawnScanPulse(position, color = '#66ffee', scale = 60) {
    const pulse = makeScanPulse(color);
    pulse.position.copy(position);
    pulse.userData.startScale = scale;
    pulse.userData.life = 1.6;
    pulse.userData.maxLife = 1.6;
    pulse.life = 1.6;
    pulse.maxLife = 1.6;
    this.root.add(pulse);
    this.pulses.push(pulse);
    return pulse;
  }

  /** Nearest interactive body to a position within `maxDist`. */
  nearestBody(position, maxDist = Infinity) {
    let best = null;
    let bestDist = maxDist;
    for (const b of this.bodies) {
      if (b.kind === 'asteroid') continue;
      const world = b.object.getWorldPosition(new THREE.Vector3());
      const d = world.distanceTo(position) - b.radius;
      if (d < bestDist) {
        bestDist = d;
        best = { ...b, world, distance: d };
      }
    }
    return best;
  }

  /** Nearest asteroid to a position (for mining). */
  nearestAsteroid(position, maxDist = Infinity) {
    let best = null;
    let bestDist = maxDist;
    for (const rock of this.asteroids ?? []) {
      const world = rock.getWorldPosition(new THREE.Vector3());
      const d = world.distanceTo(position) - rock.userData.radius;
      if (d < bestDist) {
        bestDist = d;
        best = { object: rock, world, distance: d };
      }
    }
    return best;
  }

  dispose() {
    this.root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) {
          for (const key of Object.keys(m)) {
            const v = m[key];
            if (v && v.isTexture) v.dispose?.();
          }
          m.dispose?.();
        }
      }
    });
    this.root.clear();
    this.bodies = [];
    this.pulses = [];
    this.planets = [];
    this.asteroids = [];
    this.system = null;
  }
}
