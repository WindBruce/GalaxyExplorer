/**
 * TerrainScene: a planetary surface.
 *
 * Generates a landing-site heightmap (CPU noise), scatters rocks/flora, places
 * ruins, resource nodes and excavatable artifacts, and builds an atmospheric
 * sky. Everything is derived from the planet/ruin seeds so a site is always
 * the same when you return.
 */
import * as THREE from '../../vendor/three.module.js';
import { Rng } from '../core/Random.js';
import { fbm2D, ridged2D, hash1 } from '../core/Noise.js';
import { makeResourceNode, makeArtifactProp, makeRuin, makeGlowTexture } from './Objects.js';

const WORLD_SIZE = 900;     // metres-ish of playable surface
const SEGMENTS = 160;

const SURFACE_SKY = /* glsl */ `
precision highp float;
varying vec3 vDir;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uStars;
uniform float uTime;
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.65));
  // Sun disc + glow.
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  col += uSunColor * pow(sd, 900.0) * 12.0;
  col += uSunColor * pow(sd, 22.0) * 0.35;
  // Stars for thin atmospheres.
  if (uStars > 0.01) {
    vec3 p = floor(d * 320.0);
    float r = fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
    float star = smoothstep(0.9985, 1.0, r) * uStars;
    col += vec3(star) * (0.7 + 0.3 * sin(uTime * 3.0 + r * 40.0));
  }
  gl_FragColor = vec4(col, 1.0);
}
`;

const SURFACE_SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export class TerrainScene {
  /** @param {import('../sim/GameState.js').GameState} state */
  constructor(state) {
    this.state = state;
    this.root = new THREE.Group();
    this.resourceNodes = [];
    this.artifactProps = [];
    this.ruinProps = [];
    this.time = 0;
  }

  /**
   * @param {object} planet planet record
   * @param {object} [ruin] optional ruin site on this planet
   */
  build(planet, ruin = null) {
    this.dispose();
    this.planet = planet;
    this.ruin = ruin;
    const rng = new Rng((planet.seed ^ (ruin ? ruin.seed : 0)) >>> 0);
    this.rng = rng;

    // ---- Heightmap ------------------------------------------------------
    const amplitude = this._amplitudeFor(planet);
    const geom = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS);
    geom.rotateX(-Math.PI / 2);
    const pos = geom.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const palette = this._paletteFor(planet);
    this.heightScale = amplitude;

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.heightAt(x, z);
      pos.setY(i, h);
      const c = this._colorForHeight(h / Math.max(1, amplitude), palette, x, z);
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.computeVertexNormals();

    const terrain = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.05, flatShading: false,
    }));
    terrain.name = 'terrain';
    terrain.receiveShadow = true;
    this.root.add(terrain);
    this.terrain = terrain;

    // ---- Sky ------------------------------------------------------------
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(4200, 32, 24),
      new THREE.ShaderMaterial({
        vertexShader: SURFACE_SKY_VERT,
        fragmentShader: SURFACE_SKY,
        uniforms: {
          uHorizon: { value: new THREE.Color(this._horizonColor(planet)) },
          uZenith: { value: new THREE.Color(this._zenithColor(planet)) },
          uSunColor: { value: new THREE.Color(this.state.location.system?.star.color ?? '#ffd97d') },
          uSunDir: { value: new THREE.Vector3(0.45, 0.35, -0.82).normalize() },
          uStars: { value: (planet.atmosphere.pressure ?? 1) < 0.2 ? 1.0 : 0.15 },
          uTime: { value: 0 },
        },
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
      })
    );
    sky.name = 'sky';
    this.root.add(sky);
    this.sky = sky;

    // ---- Lighting -------------------------------------------------------
    const sunColor = new THREE.Color(this.state.location.system?.star.color ?? '#ffd97d');
    const sun = new THREE.DirectionalLight(sunColor, this._sunIntensity(planet));
    sun.position.set(220, 170, -400);
    this.root.add(sun);
    this.sun = sun;
    const hemi = new THREE.HemisphereLight(
      new THREE.Color(this._horizonColor(planet)),
      new THREE.Color('#20242c'),
      0.55
    );
    this.root.add(hemi);
    const fogColor = new THREE.Color(this._horizonColor(planet)).multiplyScalar(0.85);
    this.root.fog = new THREE.FogExp2(fogColor.getHex(), 0.00055);

    // ---- Props: rocks & flora ------------------------------------------
    this._scatterProps(planet, rng);

    // ---- Ruins ----------------------------------------------------------
    if (ruin) {
      const ruinObj = makeRuin(ruin);
      ruinObj.position.set(0, this.heightAt(0, 0) - 2, 0);
      this.root.add(ruinObj);
      this.ruinProps.push({ object: ruinObj, ruin });

      // Artifact props inside the ruin, from the archaeology system.
      const siteArtifacts = this.state.archaeology.siteArtifacts(ruin);
      this.siteArtifacts = siteArtifacts;
      for (let i = 0; i < siteArtifacts.length; i++) {
        const a = rng.float(0, Math.PI * 2);
        const r = rng.float(18, 60);
        const prop = makeArtifactProp();
        prop.position.set(Math.cos(a) * r, this.heightAt(Math.cos(a) * r, Math.sin(a) * r) + 1.2, Math.sin(a) * r);
        this.root.add(prop);
        this.artifactProps.push({ object: prop, artifactId: siteArtifacts[i].artifactId, taken: false, siteId: ruin.id });
      }
    } else {
      this.siteArtifacts = [];
    }

    // ---- Resource nodes -------------------------------------------------
    const nodeCount = Math.max(4, Math.min(18, planet.surfaceNodes ?? 6));
    for (let i = 0; i < nodeCount; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(40, 340);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const pool = planet.resources.length ? planet.resources : [{ id: 'iron', quantity: 200 }];
      const pick = rng.pick(pool);
      const color = this.state.data.resources[pick.id]?.color ?? '#caa472';
      const node = makeResourceNode(pick.id, color);
      node.position.set(x, this.heightAt(x, z), z);
      node.scale.setScalar(rng.float(0.8, 1.6));
      this.root.add(node);
      this.resourceNodes.push({
        object: node,
        resourceId: pick.id,
        quantity: Math.round(pick.quantity * rng.float(0.4, 0.9)),
        depleted: false,
        position: node.position.clone(),
      });
    }

    // Distant landmarks so the horizon is not empty.
    this._addDistantLandmarks(rng, amplitude);

    return this;
  }

  _amplitudeFor(planet) {
    switch (planet.type) {
      case 'volcanic':
      case 'molten':
        return 58;
      case 'desert':
        return 26;
      case 'ice':
        return 34;
      case 'ocean':
        return 12;
      case 'terrestrial':
        return 30;
      case 'tidallyLocked':
        return 22;
      case 'toxic':
        return 20;
      default:
        return 24;
    }
  }

  _paletteFor(planet) {
    const rng = this.rng;
    switch (planet.type) {
      case 'ocean':
        return { low: '#1d4e63', mid: '#2f7d8c', high: '#c2b280', rock: '#6b7280', tint: rng.float(0, 1) };
      case 'desert':
        return { low: '#a67c4e', mid: '#c9a06b', high: '#e3cfa4', rock: '#8a6a45', tint: rng.float(0, 1) };
      case 'ice':
        return { low: '#8fb8c9', mid: '#cfe6ef', high: '#f4fbfd', rock: '#7d94a3', tint: rng.float(0, 1) };
      case 'volcanic':
        return { low: '#2a1710', mid: '#4a2a1c', high: '#7a4632', rock: '#1c1008', tint: rng.float(0, 1) };
      case 'toxic':
        return { low: '#4d5a2b', mid: '#6f8438', high: '#a8b878', rock: '#3a4520', tint: rng.float(0, 1) };
      case 'tidallyLocked':
        return { low: '#6b5a44', mid: '#8a7554', high: '#c4b493', rock: '#54483a', tint: rng.float(0, 1) };
      case 'barren':
        return { low: '#4e4e52', mid: '#6f6f74', high: '#9a9aa0', rock: '#3c3c40', tint: rng.float(0, 1) };
      default:
        return { low: '#3f5d43', mid: '#5b7d4e', high: '#8a7f5c', rock: '#6b6f5a', tint: rng.float(0, 1) };
    }
  }

  _colorForHeight(t, pal, x, z) {
    const c = new THREE.Color();
    if (t < 0.18) c.set(pal.low);
    else if (t < 0.45) c.set(pal.mid);
    else if (t < 0.72) c.set(pal.high);
    else c.set(pal.rock);
    // Patchiness so the ground is not banded.
    const patch = fbm2D(x * 0.01, z * 0.01, 3, 7);
    c.offsetHSL(0, 0, (patch - 0.5) * 0.09);
    return c;
  }

  /** Terrain height at world (x,z). Deterministic per planet. */
  heightAt(x, z) {
    const planet = this.planet;
    if (!planet) return 0;
    const seed = planet.seed % 1000;
    const amp = this._amplitudeFor(planet);
    const scale = 0.0055;
    let h = fbm2D(x * scale, z * scale, 5, seed) * amp;
    h += ridged2D(x * scale * 2.1, z * scale * 2.1, 4, seed + 31) * amp * 0.35;
    // Flatten the landing site.
    const d = Math.hypot(x, z);
    const flat = THREE.MathUtils.smoothstep(d, 60, 190);
    h *= 0.25 + 0.75 * flat;
    // Basin edge so the player cannot walk off the world.
    const edge = THREE.MathUtils.smoothstep(d, WORLD_SIZE * 0.42, WORLD_SIZE * 0.49);
    h += edge * 120;
    return h;
  }

  _scatterProps(planet, rng) {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6a70, roughness: 0.95, metalness: 0.05, flatShading: true });
    const floraMat = new THREE.MeshStandardMaterial({
      color: planet.life ? 0x4f7d4a : 0x7a7a5a, roughness: 0.8, metalness: 0.0,
      emissive: planet.life ? 0x0a1a06 : 0x000000, emissiveIntensity: 0.5,
    });
    const count = 190;
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const floraGeo = new THREE.ConeGeometry(0.5, 2.2, 5);
    for (let i = 0; i < count; i++) {
      const a = rng.float(0, Math.PI * 2);
      const r = rng.float(30, WORLD_SIZE * 0.45);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const y = this.heightAt(x, z);
      const isFlora = planet.life && rng.chance(0.45) && y < 30;
      const mesh = new THREE.Mesh(isFlora ? floraGeo : rockGeo, isFlora ? floraMat : rockMat);
      const s = rng.float(0.5, isFlora ? 1.8 : 2.6);
      mesh.position.set(x, y + (isFlora ? 1.0 * s : 0.2 * s), z);
      mesh.scale.set(s, s * rng.float(0.6, 1.4), s);
      mesh.rotation.set(rng.float(0, 3), rng.float(0, 3), rng.float(0, 3));
      this.root.add(mesh);
    }
  }

  _addDistantLandmarks(rng, amplitude) {
    // A ring of monoliths on the horizon: something ancient shaped this place.
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + rng.float(-0.1, 0.1);
      const r = WORLD_SIZE * 0.47;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const h = rng.float(20, 60);
      const monolith = new THREE.Mesh(
        new THREE.BoxGeometry(6, h, 6),
        new THREE.MeshStandardMaterial({ color: 0x2e2a24, roughness: 0.7, metalness: 0.4, emissive: 0x120c04, emissiveIntensity: 0.8 })
      );
      monolith.position.set(x, this.heightAt(x, z) + h / 2 - 6, z);
      monolith.rotation.y = a;
      monolith.rotation.z = rng.float(-0.08, 0.08);
      this.root.add(monolith);
    }
  }

  _horizonColor(planet) {
    const p = planet.atmosphere;
    if (!p || p.pressure < 0.02) return '#0a0c14';
    return p.color ?? '#9ecbff';
  }

  _zenithColor(planet) {
    const p = planet.atmosphere;
    if (!p || p.pressure < 0.02) return '#02030a';
    const c = new THREE.Color(p.color ?? '#9ecbff');
    return c.clone().multiplyScalar(0.25).getStyle();
  }

  _sunIntensity(planet) {
    const dist = this.state.location.system?.planets.find((p) => p.id === planet.id);
    const au = dist?.orbitAu ?? 1;
    const lum = this.state.location.system?.star.luminosity ?? 1;
    return THREE.MathUtils.clamp(2.6 * Math.pow(Math.max(0.001, lum), 0.3) / Math.max(0.4, au * 0.5), 0.6, 4.2);
  }

  update(dt, camera) {
    this.time += dt;
    if (this.sky) {
      this.sky.position.copy(camera.position);
      this.sky.material.uniforms.uTime.value = this.time;
    }
    for (const prop of this.artifactProps) {
      prop.object.userData.body.rotation.y += dt * 0.8;
      prop.object.userData.ring.rotation.z += dt * 1.1;
      prop.object.userData.body.position.y = prop.object.position.y + Math.sin(this.time * 1.4 + prop.object.id) * 0.25;
    }
    for (const node of this.resourceNodes) {
      if (!node.depleted) {
        node.object.rotation.y += dt * 0.5;
        node.object.userData.halo.intensity = 1.0 + Math.sin(this.time * 3 + node.object.id) * 0.35;
      }
    }
  }

  /** Mine a node: returns the resources extracted. */
  mineNode(node, yieldMultiplier = 1) {
    if (node.depleted) return null;
    const amount = Math.max(4, Math.round(node.quantity * 0.25 * yieldMultiplier));
    const stored = this.state.resources.add(node.resourceId, amount);
    node.quantity -= amount;
    if (node.quantity <= 0 || stored < amount) {
      node.depleted = true;
      node.object.visible = false;
    }
    this.state.bus.emit('surface:mined', { resourceId: node.resourceId, amount: stored });
    return { resourceId: node.resourceId, amount: stored };
  }

  dispose() {
    this.root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose?.();
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.dispose?.();
      }
    });
    this.root.clear();
    this.resourceNodes = [];
    this.artifactProps = [];
    this.ruinProps = [];
    this.planet = null;
  }
}
