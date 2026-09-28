/**
 * Procedural object factories: every mesh in the game is generated in code.
 *
 * Bodies are exaggerated in size for playability (see SCALE in
 * StarSystemGenerator) but carry their real physical values for the UI.
 */
import * as THREE from '../../vendor/three.module.js';
import { SCALE } from '../world/StarSystemGenerator.js';
import {
  SKY_VERT, SKY_FRAG, PLANET_VERT, PLANET_FRAG, ATMO_VERT, ATMO_FRAG,
  STAR_VERT, STAR_FRAG, DISK_VERT, DISK_FRAG, NEBULA_VERT, NEBULA_FRAG,
  SCAN_VERT, SCAN_FRAG, PLUME_VERT, PLUME_FRAG,
} from './Shaders.js';
import { Rng } from '../core/Random.js';

const tmpColor = new THREE.Color();

/** Visual radius of a planet from its real radius (exaggerated for play). */
export function planetVisualRadius(radiusKm) {
  return Math.max(2.2, radiusKm / SCALE.kmPerUnit);
}

/** Deep-space backdrop. */
export function makeSkybox(seed = 1, bandColor = '#4a6fa5', exposure = 1.0) {
  const mat = new THREE.ShaderMaterial({
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uBandColor: { value: new THREE.Color(bandColor) },
      uSeed: { value: (seed % 1000) * 0.137 },
      uExposure: { value: exposure },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(60000, 48, 32), mat);
  mesh.name = 'skybox';
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}

/** A star: shader core + corona billboards + light. */
export function makeStar(star) {
  const group = new THREE.Group();
  group.name = `star:${star.name}`;
  const radius = star.radiusUnits;

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uColorHot: { value: new THREE.Color(star.color).lerp(tmpColor.set('#ffffff'), 0.55) },
        uColorCool: { value: new THREE.Color(star.color) },
        uTime: { value: 0 },
        uSeed: { value: (star.name.length % 97) * 0.31 },
        uIntensity: { value: 1.35 },
      },
    })
  );
  core.name = 'starCore';
  group.add(core);

  if (star.classId !== 'blackHole') {
    // Corona: two additive billboards facing the camera.
    for (let i = 0; i < 2; i++) {
      const size = radius * (i === 0 ? 4.2 : 2.4);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: makeGlowTexture(star.color, i === 0 ? 0.16 : 0.3),
        color: new THREE.Color(star.color),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: i === 0 ? 0.55 : 0.85,
      }));
      sprite.scale.set(size, size, 1);
      sprite.name = `corona${i}`;
      group.add(sprite);
    }
  }

  // Point light so ships/planets are lit consistently.
  const light = new THREE.PointLight(new THREE.Color(star.color), star.classId === 'blackHole' ? 0.05 : 3.2, 0, 1.4);
  light.name = 'starLight';
  group.add(light);

  group.userData = { kind: 'star', star, radius, core, light };
  return group;
}

/** A black hole: event horizon + accretion disk + photon ring. */
export function makeBlackHole(star) {
  const group = new THREE.Group();
  group.name = `blackhole:${star.name}`;
  const radius = star.radiusUnits;

  const horizon = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  horizon.name = 'horizon';
  group.add(horizon);

  const disk = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * 22, radius * 22, 1, 1),
    new THREE.ShaderMaterial({
      vertexShader: DISK_VERT,
      fragmentShader: DISK_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uInner: { value: new THREE.Color('#fff3c4') },
        uOuter: { value: new THREE.Color('#ff5722') },
        uIntensity: { value: 1.5 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    })
  );
  disk.rotation.x = -Math.PI / 2;
  disk.rotation.z = 0.4;
  disk.name = 'accretionDisk';
  group.add(disk);

  // Photon ring.
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.35, radius * 1.62, 96),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffe9b0'),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.name = 'photonRing';
  group.add(ring);

  const light = new THREE.PointLight(0xff8844, 1.2, 0, 1.6);
  group.add(light);

  group.userData = { kind: 'blackhole', star, radius, core: horizon, disk, light };
  return group;
}

/** Palette selection per planet type. */
const PLANET_PALETTES = {
  terrestrial: { ocean: '#1b4f72', shallow: '#2e86c1', land: '#3f7d4e', high: '#8a7f5c', sand: '#c2b280', ice: '#eef6fb', typeMix: 0, clouds: 0.45, water: 0.02, iceCaps: 0.12 },
  ocean: { ocean: '#0b3d5c', shallow: '#1f7a9c', land: '#4a7c59', high: '#7d8a5a', sand: '#cbb98a', ice: '#eaf6fb', typeMix: 0, clouds: 0.5, water: -0.06, iceCaps: 0.1 },
  desert: { ocean: '#6b4f2a', shallow: '#a37b3f', land: '#c19a6b', high: '#8c6b45', sand: '#e0c9a0', ice: '#f2efe6', typeMix: 1, clouds: 0.12, water: 0.5, iceCaps: 0.06 },
  barren: { ocean: '#4a4a4a', shallow: '#6e6e6e', land: '#8a8a8a', high: '#a9a9a9', sand: '#b5b5b5', ice: '#d8d8d8', typeMix: 1, clouds: 0.02, water: 0.5, iceCaps: 0.04 },
  ice: { ocean: '#7fb3c8', shallow: '#a8d8e8', land: '#dfeef5', high: '#f2fafd', sand: '#e8f4f8', ice: '#ffffff', typeMix: 2, clouds: 0.3, water: -0.1, iceCaps: 0.02 },
  volcanic: { ocean: '#5a1a10', shallow: '#8c2d16', land: '#4a3226', high: '#6b4a34', sand: '#7a5a3a', ice: '#ffd9c0', typeMix: 3, clouds: 0.22, water: 0.5, iceCaps: 0.0 },
  toxic: { ocean: '#4a5a2a', shallow: '#6f8a3a', land: '#8f9e6b', high: '#a8b878', sand: '#c2cc94', ice: '#e8f0d0', typeMix: 4, clouds: 0.4, water: 0.5, iceCaps: 0.03 },
  tidallyLocked: { ocean: '#3d4a5c', shallow: '#5c7a9c', land: '#a98c6b', high: '#c4a884', sand: '#d8c4a0', ice: '#f0f4f8', typeMix: 0.5, clouds: 0.35, water: 0.0, iceCaps: 0.05 },
  molten: { ocean: '#3d0d06', shallow: '#7a1c08', land: '#2a1408', high: '#5c2a10', sand: '#6b3a18', ice: '#ffb08a', typeMix: 3, clouds: 0.05, water: 0.5, iceCaps: 0.0 },
  gasGiant: { ocean: '#a8794a', shallow: '#d8b28c', land: '#c49a68', high: '#e8d0a8', sand: '#f0dcb8', ice: '#fff4e0', typeMix: 0.8, clouds: 0.75, water: 0.5, iceCaps: 0.0 },
  exotic: { ocean: '#4a2a6b', shallow: '#7a4a9c', land: '#b07fe0', high: '#d8a8f0', sand: '#e0c0f8', ice: '#f4e8ff', typeMix: 4, clouds: 0.5, water: 0.2, iceCaps: 0.02 },
};

/** A planet: shader surface, atmosphere, optional rings. */
export function makePlanet(planet, starColor = '#ffd97d') {
  const group = new THREE.Group();
  group.name = `planet:${planet.name}`;
  const radius = planetVisualRadius(planet.radiusKm);
  const pal = PLANET_PALETTES[planet.type] ?? PLANET_PALETTES.terrestrial;
  const rng = new Rng(planet.seed);

  const surface = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 64, 44),
    new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      uniforms: {
        uLightDir: { value: new THREE.Vector3(1, 0, 0) },
        uLightColor: { value: new THREE.Color(starColor) },
        uOcean: { value: new THREE.Color(pal.ocean) },
        uShallow: { value: new THREE.Color(pal.shallow) },
        uLand: { value: new THREE.Color(pal.land) },
        uHigh: { value: new THREE.Color(pal.high) },
        uSand: { value: new THREE.Color(pal.sand) },
        uIce: { value: new THREE.Color(pal.ice) },
        uSeed: { value: (planet.seed % 1000) * 0.021 },
        uTime: { value: 0 },
        uWaterLevel: { value: pal.water },
        uIceCaps: { value: pal.iceCaps },
        uCloudAmount: { value: pal.clouds },
        uRoughness: { value: rng.float(0.6, 1.4) },
        uTypeMix: { value: pal.typeMix },
        uNightLights: { value: planet.life ? rng.float(0.15, 0.6) : 0.0 },
        uAtmoColor: { value: new THREE.Color(planet.atmosphere.color ?? '#9ecbff') },
      },
    })
  );
  surface.name = 'surface';
  group.add(surface);

  // Atmospheric shell.
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.045, 48, 32),
    new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT,
      fragmentShader: ATMO_FRAG,
      uniforms: {
        uLightDir: { value: new THREE.Vector3(1, 0, 0) },
        uColor: { value: new THREE.Color(planet.atmosphere.color ?? '#9ecbff') },
        uIntensity: { value: planet.atmosphere.pressure > 0.05 ? 1.1 : 0.25 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false,
    })
  );
  atmo.name = 'atmosphere';
  group.add(atmo);

  if (planet.ring) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 1.5, radius * 2.6, 128),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#c8b08a'),
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2 + 0.35;
    ring.name = 'ring';
    group.add(ring);
  }

  group.userData = {
    kind: 'planet',
    planet,
    radius,
    surface,
    atmo,
    orbitAu: planet.orbitAu,
    phase: rng.float(0, Math.PI * 2),
    spin: rng.float(0.02, 0.12),
    tilt: rng.float(-0.4, 0.4),
  };
  return group;
}

/** Ring system for gas giants. */
export function makeRing(planet) {
  const radius = planetVisualRadius(planet.radiusKm);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 1.4, radius * 2.4, 128),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color('#cbb28a'),
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  ring.rotation.x = -Math.PI / 2 + 0.3;
  return ring;
}

/** Orbital path line. */
export function makeOrbitLine(radiusAu, color = '#3a5a7a', segments = 256) {
  const r = radiusAu * SCALE.unitsPerAu;
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
  }
  const geom = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geom, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 }));
}

/** A station: procedural habitation + docks. */
export function makeStation(station) {
  const group = new THREE.Group();
  group.name = `station:${station.name}`;
  const rng = new Rng(station.id.length * 7919);

  const hullMat = new THREE.MeshStandardMaterial({
    color: station.derelict ? 0x4a4a52 : 0x8a93a3,
    metalness: 0.85,
    roughness: 0.42,
    emissive: new THREE.Color(station.derelict ? 0x110a06 : 0x0a1424),
    emissiveIntensity: station.derelict ? 0.4 : 1.0,
  });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 26, 16), hullMat);
  body.rotation.z = Math.PI / 2;
  group.add(body);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(14, 1.6, 10, 40), hullMat);
  ring.rotation.y = Math.PI / 2;
  group.add(ring);

  const spine = new THREE.Mesh(new THREE.BoxGeometry(30, 2.4, 2.4), hullMat);
  group.add(spine);

  for (let i = 0; i < 4; i++) {
    const spoke = new THREE.Mesh(new THREE.BoxGeometry(2, 5.5, 2), hullMat);
    const a = (i / 4) * Math.PI * 2;
    spoke.position.set(Math.cos(a) * 13, Math.sin(a) * 13, 0);
    spoke.rotation.z = a;
    group.add(spoke);
  }

  // Docking lights.
  const lightMat = new THREE.MeshBasicMaterial({ color: station.derelict ? 0x553311 : 0x66ffee });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), lightMat);
    lamp.position.set(Math.cos(a) * 13, Math.sin(a) * 13, 1.4);
    group.add(lamp);
  }

  const beacon = new THREE.PointLight(station.derelict ? 0xff8844 : 0x66ddff, station.derelict ? 1.2 : 2.2, 260);
  group.add(beacon);

  group.userData = { kind: 'station', station, radius: 16, ring, body };
  return group;
}

/** An ancient ruin: layered monoliths, arches and a faint energy core. */
export function makeRuin(ruin) {
  const group = new THREE.Group();
  group.name = `ruin:${ruin.name}`;
  const rng = new Rng(ruin.seed);
  const scale = ruin.size === 'megastructure' ? 3.4 : ruin.size === 'city' ? 1.5 : 1.0;

  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color().setHSL(0.08, 0.25, 0.42).getHex(),
    metalness: 0.7,
    roughness: 0.55,
    emissive: new THREE.Color('#2a1c08'),
    emissiveIntensity: 0.6,
  });

  const count = ruin.size === 'outpost' ? 7 : ruin.size === 'city' ? 22 : 40;
  for (let i = 0; i < count; i++) {
    const h = rng.float(6, 30) * scale;
    const w = rng.float(2, 7) * scale;
    const shape = rng.pick(['box', 'cyl', 'oct']);
    let mesh;
    if (shape === 'box') mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    else if (shape === 'cyl') mesh = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.4, w * 0.6, h, 7), mat);
    else mesh = new THREE.Mesh(new THREE.OctahedronGeometry(w * 0.8), mat);
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(4, 60) * scale;
    mesh.position.set(Math.cos(a) * r, h / 2 - rng.float(0, 3), Math.sin(a) * r);
    mesh.rotation.set(rng.float(-0.2, 0.2), rng.float(0, Math.PI), rng.float(-0.2, 0.2));
    mesh.castShadow = false;
    group.add(mesh);
  }

  // Central energy signature.
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(3.2 * scale, 1),
    new THREE.MeshBasicMaterial({ color: 0x66e0ff, wireframe: true, transparent: true, opacity: 0.85 })
  );
  core.position.y = 8 * scale;
  group.add(core);
  const glow = new THREE.PointLight(0x66e0ff, 2.4, 200 * scale);
  glow.position.copy(core.position);
  group.add(glow);

  // Faint floor disc so the site reads from the air.
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(70 * scale, 48),
    new THREE.MeshBasicMaterial({ color: 0x1a1408, transparent: true, opacity: 0.35 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.2;
  group.add(floor);

  group.userData = { kind: 'ruin', ruin, radius: 70 * scale, core, glow };
  return group;
}

/** Asteroid / comet. */
export function makeAsteroid(seed = 1, radius = 6) {
  const rng = new Rng(seed);
  const geom = new THREE.IcosahedronGeometry(radius, 2);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const n = 1 + (rng.next() - 0.5) * 0.55;
    pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n * 0.85, pos.getZ(i) * n);
  }
  geom.computeVertexNormals();
  const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({
    color: 0x6b6157, metalness: 0.35, roughness: 0.9, flatShading: true,
  }));
  mesh.userData = { kind: 'asteroid', radius, spin: rng.float(-0.4, 0.4) };
  return mesh;
}

/** Anomaly: wireframe shell + shader haze. */
export function makeAnomaly(anomaly) {
  const group = new THREE.Group();
  group.name = `anomaly:${anomaly.name}`;
  const shell = new THREE.Mesh(
    new THREE.IcosahedronGeometry(40, 2),
    new THREE.MeshBasicMaterial({ color: 0xf72585, wireframe: true, transparent: true, opacity: 0.5 })
  );
  group.add(shell);
  const haze = new THREE.Mesh(
    new THREE.SphereGeometry(52, 24, 16),
    new THREE.ShaderMaterial({
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      uniforms: {
        uColorA: { value: new THREE.Color('#f72585') },
        uColorB: { value: new THREE.Color('#4cc9f0') },
        uSeed: { value: 3.7 },
        uTime: { value: 0 },
        uIntensity: { value: 0.55 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  group.add(haze);
  group.userData = { kind: 'anomaly', anomaly, radius: 52, shell, haze };
  return group;
}

/** Volumetric-ish nebula clouds for the system scene. */
export function makeNebulaClouds(seed, colors = ['#8338ec', '#3a86ff']) {
  const group = new THREE.Group();
  group.name = 'nebulaClouds';
  const rng = new Rng(seed);
  for (let i = 0; i < 14; i++) {
    const size = rng.float(900, 2600);
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShaderMaterial({
        vertexShader: NEBULA_VERT,
        fragmentShader: NEBULA_FRAG,
        uniforms: {
          uColorA: { value: new THREE.Color(rng.pick(colors)) },
          uColorB: { value: new THREE.Color(rng.pick(colors)) },
          uSeed: { value: rng.float(0, 20) },
          uTime: { value: 0 },
          uIntensity: { value: rng.float(0.25, 0.6) },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    const dir = new THREE.Vector3(rng.float(-1, 1), rng.float(-0.35, 0.35), rng.float(-1, 1)).normalize();
    mesh.position.copy(dir.multiplyScalar(rng.float(1200, 4200)));
    mesh.rotation.z = rng.float(0, Math.PI);
    mesh.userData.billboard = true;
    group.add(mesh);
  }
  return group;
}

/** Player ship: procedural hull that grows visually with the loadout. */
export function makeShip(loadout = {}) {
  const group = new THREE.Group();
  group.name = 'playerShip';

  const hullMat = new THREE.MeshStandardMaterial({
    color: 0xb8c4d4, metalness: 0.9, roughness: 0.35,
    emissive: new THREE.Color('#101822'), emissiveIntensity: 0.6,
  });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x39424f, metalness: 0.8, roughness: 0.5 });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0a1a2a, metalness: 0.4, roughness: 0.1,
    emissive: new THREE.Color('#1b3a55'), emissiveIntensity: 0.8,
  });

  // Fuselage.
  const fuselage = new THREE.Mesh(new THREE.CapsuleGeometry(1.5, 6, 8, 16), hullMat);
  fuselage.rotation.x = Math.PI / 2;
  group.add(fuselage);

  // Nose.
  const nose = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3.4, 16), hullMat);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -5.2;
  group.add(nose);

  // Cockpit glass.
  const cockpit = new THREE.Mesh(new THREE.SphereGeometry(1.15, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
  cockpit.position.set(0, 0.75, -1.6);
  cockpit.rotation.x = -0.25;
  group.add(cockpit);

  // Wings.
  const wingGeo = new THREE.BoxGeometry(5.2, 0.28, 2.6);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(wingGeo, hullMat);
    wing.position.set(side * 3.4, -0.1, 1.2);
    wing.rotation.z = side * 0.16;
    wing.rotation.y = side * -0.22;
    group.add(wing);
    // Engine nacelle under each wing.
    const nacelle = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.72, 3.2, 12), darkMat);
    nacelle.rotation.x = Math.PI / 2;
    nacelle.position.set(side * 3.4, -0.35, 2.6);
    group.add(nacelle);
  }

  // Dorsal fin.
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.9, 2.4), hullMat);
  fin.position.set(0, 1.3, 2.2);
  group.add(fin);

  // Cargo pod (grows with cargo module tier).
  const cargoTier = loadout.cargo ?? 1;
  if (cargoTier >= 2) {
    const pod = new THREE.Mesh(new THREE.BoxGeometry(2.6, 2.0, 3.4), darkMat);
    pod.position.set(0, -1.1, 1.6);
    group.add(pod);
  }

  // Weapon pods.
  if (loadout.weapon) {
    for (const side of [-1, 1]) {
      const gun = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 3.0, 8), darkMat);
      gun.rotation.x = Math.PI / 2;
      gun.position.set(side * 1.5, -0.2, -4.2);
      group.add(gun);
    }
  }

  // Engine plumes.
  const plumes = [];
  const plumeMat = new THREE.ShaderMaterial({
    vertexShader: PLUME_VERT,
    fragmentShader: PLUME_FRAG,
    uniforms: {
      uColor: { value: new THREE.Color('#66ccff') },
      uIntensity: { value: 0.0 },
      uTime: { value: 0 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const plume = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 7), plumeMat.clone());
    plume.position.set(side * 3.4, -0.35, 5.4);
    plume.rotation.y = Math.PI / 2;
    group.add(plume);
    plumes.push(plume);
  }
  const centre = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 8), plumeMat.clone());
  centre.position.set(0, 0, 5.6);
  centre.rotation.y = Math.PI / 2;
  group.add(centre);
  plumes.push(centre);

  // Running lights.
  const lightGeo = new THREE.SphereGeometry(0.14, 6, 5);
  for (const side of [-1, 1]) {
    const lamp = new THREE.Mesh(lightGeo, new THREE.MeshBasicMaterial({ color: side < 0 ? 0xff3344 : 0x33ff66 }));
    lamp.position.set(side * 5.9, -0.1, 1.2);
    group.add(lamp);
  }

  group.userData = { kind: 'ship', plumes, radius: 7, cargoTier, weapon: !!loadout.weapon };
  return group;
}

/** Mining/extraction laser beam. */
export function makeBeam(color = '#ffaa33', length = 600) {
  const geom = new THREE.CylinderGeometry(0.22, 0.5, length, 6, 1, true);
  geom.translate(0, length / 2, 0);
  const mat = new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.85,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData = { kind: 'beam' };
  return mesh;
}

/** Weapon bolt. */
export function makeBolt(color = '#ff5577') {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.7, 8, 6),
    new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.95, depthWrite: false })
  );
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(color, 0.5), color, blending: THREE.AdditiveBlending,
    transparent: true, depthWrite: false,
  }));
  glow.scale.set(6, 6, 1);
  mesh.add(glow);
  mesh.userData = { kind: 'bolt', life: 2.2 };
  return mesh;
}

/** Explosion burst. */
export function makeExplosion() {
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(1, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffdd88, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  const flash = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture('#ffcc66', 0.45), color: 0xffaa44,
    blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  }));
  flash.scale.set(30, 30, 1);
  group.add(core, flash);
  group.userData = { kind: 'explosion', life: 1.1, maxLife: 1.1 };
  return group;
}

/** Scan pulse ring that expands around a target. */
export function makeScanPulse(color = '#66ffee') {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: SCAN_VERT,
      fragmentShader: SCAN_FRAG,
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uProgress: { value: 0 },
        uIntensity: { value: 1.0 },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  mesh.userData = { kind: 'scanPulse', life: 1.6, maxLife: 1.6 };
  return mesh;
}

/** Resource node on a planetary surface (crystal / ore deposit). */
export function makeResourceNode(resourceId, color = '#caa472') {
  const group = new THREE.Group();
  const rng = new Rng(resourceId.length * 131 + resourceId.charCodeAt(0));
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    metalness: 0.6, roughness: 0.3,
    emissive: new THREE.Color(color).multiplyScalar(0.35), emissiveIntensity: 0.8,
  });
  const shards = rng.int(3, 6);
  for (let i = 0; i < shards; i++) {
    const h = rng.float(1.2, 3.2);
    const shard = new THREE.Mesh(new THREE.ConeGeometry(rng.float(0.35, 0.7), h, 5), mat);
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(0, 0.9);
    shard.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    shard.rotation.set(rng.float(-0.3, 0.3), rng.float(0, 3), rng.float(-0.3, 0.3));
    group.add(shard);
  }
  const halo = new THREE.PointLight(new THREE.Color(color), 1.2, 26);
  halo.position.y = 1.5;
  group.add(halo);
  group.userData = { kind: 'resourceNode', radius: 3.2, halo };
  return group;
}

/** Excavated artifact: a glowing relic on the surface. */
export function makeArtifactProp() {
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.8, 0),
    new THREE.MeshStandardMaterial({
      color: 0x2a2118, metalness: 0.9, roughness: 0.25,
      emissive: new THREE.Color('#caa472'), emissiveIntensity: 1.4,
    })
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.5, 0.06, 8, 40),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending })
  );
  ring.rotation.x = Math.PI / 2.4;
  const light = new THREE.PointLight(0xffd9a0, 2.0, 30);
  group.add(body, ring, light);
  group.userData = { kind: 'artifact', radius: 2.2, body, ring };
  return group;
}

/** Astronaut / explorer character. */
export function makeCharacter() {
  const group = new THREE.Group();
  group.name = 'character';
  const suit = new THREE.MeshStandardMaterial({ color: 0xd8dee6, metalness: 0.35, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x2c3440, metalness: 0.6, roughness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1a26, metalness: 0.5, roughness: 0.08,
    emissive: new THREE.Color('#123048'), emissiveIntensity: 1.0,
  });

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.6, 6, 12), suit);
  torso.position.y = 1.05;
  group.add(torso);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), glass);
  head.position.y = 1.62;
  group.add(head);

  const backpack = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.24), dark);
  backpack.position.set(0, 1.12, 0.3);
  group.add(backpack);

  const limbs = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), suit);
    arm.position.set(side * 0.42, 1.05, 0);
    group.add(arm);
    limbs.push(arm);
    const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.6, 4, 8), dark);
    leg.position.set(side * 0.18, 0.36, 0);
    group.add(leg);
    limbs.push(leg);
  }

  // Suit lights.
  const lamp = new THREE.SpotLight(0xcfe8ff, 6, 60, 0.5, 0.4, 1.2);
  lamp.position.set(0, 1.6, 0);
  lamp.target.position.set(0, 1.4, -10);
  group.add(lamp);
  group.add(lamp.target);

  group.userData = { kind: 'character', limbs, radius: 0.9 };
  return group;
}

/** Radial glow texture used by sprites (generated once, cached). */
let _glowCache = new Map();
export function makeGlowTexture(color = '#ffffff', softness = 0.35) {
  const key = `${color}_${softness}`;
  if (_glowCache.has(key)) return _glowCache.get(key);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const c = new THREE.Color(color);
  const rgb = `${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)}`;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(255,255,255,1)`);
  grad.addColorStop(softness, `rgba(${rgb},0.55)`);
  grad.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _glowCache.set(key, tex);
  return tex;
}
