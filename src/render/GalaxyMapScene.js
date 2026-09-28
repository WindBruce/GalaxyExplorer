/**
 * GalaxyMapScene: the 3D galactic map.
 *
 * Renders the whole Milky Way as a point cloud coloured by region, with the
 * player's jump range, visited/discovered state, and a plotted route. Custom
 * orbit camera (no external controls dependency).
 */
import * as THREE from '../../vendor/three.module.js';
import { makeGlowTexture } from './Objects.js';

export class GalaxyMapScene {
  /** @param {import('../sim/GameState.js').GameState} state */
  constructor(state) {
    this.state = state;
    this.root = new THREE.Group();
    this.points = null;
    this.systemIndex = []; // parallel array of system records
    this.selectedId = null;
    this.hoverId = null;
    this.routeLine = null;
    this.rangeMesh = null;
    this.time = 0;
    this.filter = { visited: false, jumpable: false, bookmarked: false };
    this.bookmarks = new Set();

    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 4000);
    this.camera.position.set(0, 26, 30);
    this.target = new THREE.Vector3(0, 0, 0);
    this._drag = { active: false, x: 0, y: 0 };
    this._theta = Math.PI / 2;
    this._phi = 1.05;
    this._radius = 30;
    this._bindInput();
  }

  _bindInput() {
    this._onDown = (e) => {
      this._drag.active = true;
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
    };
    this._onUp = () => { this._drag.active = false; };
    this._onMove = (e) => {
      if (!this._drag.active) return;
      const dx = e.clientX - this._drag.x;
      const dy = e.clientY - this._drag.y;
      this._drag.x = e.clientX;
      this._drag.y = e.clientY;
      this._theta -= dx * 0.005;
      this._phi = THREE.MathUtils.clamp(this._phi - dy * 0.005, 0.12, Math.PI - 0.12);
    };
    this._onWheel = (e) => {
      this._radius = THREE.MathUtils.clamp(this._radius * (1 + e.deltaY * 0.0012), 6, 900);
      e.preventDefault();
    };
    window.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('wheel', this._onWheel, { passive: false });
  }

  dispose() {
    window.removeEventListener('mousedown', this._onDown);
    window.removeEventListener('mouseup', this._onUp);
    window.removeEventListener('mousemove', this._onMove);
    window.removeEventListener('wheel', this._onWheel);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose?.();
      if (o.material) o.material.dispose?.();
    });
    this.root.clear();
  }

  /** Build the point cloud from the galaxy. */
  build() {
    const galaxy = this.state.galaxy;
    const systems = galaxy.allSystems();
    const count = systems.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const regionColors = {};
    for (const r of galaxy.regions) regionColors[r.id] = new THREE.Color(r.color);

    this.systemIndex = [];
    systems.forEach((s, i) => {
      positions[i * 3] = s.position.x;
      positions[i * 3 + 1] = s.position.y * 0.55;
      positions[i * 3 + 2] = s.position.z;
      const c = regionColors[s.regionId] ?? new THREE.Color('#ffffff');
      const dim = s.visited ? 1.0 : s.discovered ? 0.6 : 0.22;
      colors[i * 3] = c.r * dim;
      colors[i * 3 + 1] = c.g * dim;
      colors[i * 3 + 2] = c.b * dim;
      sizes[i] = s.visited ? 3.4 : s.discovered ? 2.6 : 1.6;
      this.systemIndex.push(s);
    });

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geom.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uSelected: { value: -1 },
        uHover: { value: -1 },
        uPixelRatio: { value: 1 },
      },
      vertexShader: /* glsl */ `
        attribute float aSize;
        varying vec3 vColor;
        uniform float uSelected;
        uniform float uHover;
        uniform float uPixelRatio;
        void main() {
          vColor = color;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          float size = aSize;
          if (gl_VertexID == int(uSelected)) size *= 3.2;
          else if (gl_VertexID == int(uHover)) size *= 2.2;
          gl_PointSize = size * uPixelRatio * (320.0 / max(1.0, -mv.z));
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec3 vColor;
        void main() {
          vec2 p = gl_PointCoord - 0.5;
          float d = length(p);
          if (d > 0.5) discard;
          float core = smoothstep(0.5, 0.05, d);
          float halo = smoothstep(0.5, 0.25, d) * 0.45;
          gl_FragColor = vec4(vColor * (1.0 + halo), core + halo);
        }
      `,
      transparent: true,
      depthWrite: false,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
    });

    this.points = new THREE.Points(geom, mat);
    this.points.frustumCulled = false;
    this.root.add(this.points);

    // Galactic core glow.
    const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture('#ffd6a5', 0.12), color: 0xffd6a5,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.75,
    }));
    coreGlow.scale.set(9, 6, 1);
    coreGlow.name = 'coreGlow';
    this.root.add(coreGlow);

    this.setSelected(this.state.location.systemId);
    this.applyFilter();
    return this;
  }

  toggleBookmark(id) {
    if (!id) return false;
    if (this.bookmarks.has(id)) this.bookmarks.delete(id);
    else this.bookmarks.add(id);
    this.applyFilter();
    return this.bookmarks.has(id);
  }

  setFilter(partial) {
    Object.assign(this.filter, partial);
    this.applyFilter();
  }

  applyFilter() {
    if (!this.points) return;
    const sizes = this.points.geometry.getAttribute('aSize');
    if (!sizes) return;
    const here = this.state.location.systemId;
    const range = this.state.shipSystem.stats.jumpRange;
    for (let i = 0; i < this.systemIndex.length; i++) {
      const s = this.systemIndex[i];
      let show = true;
      if (this.filter.visited && !s.visited) show = false;
      if (this.filter.bookmarked && !this.bookmarks.has(s.id)) show = false;
      if (this.filter.jumpable) {
        const d = this.state.galaxy.distanceLy(here, s.id);
        if (!(d <= range) && s.id !== here) show = false;
      }
      const base = s.visited ? 3.4 : s.discovered ? 2.6 : 1.6;
      sizes.setX(i, show ? base : 0);
    }
    sizes.needsUpdate = true;
  }

  /** Jump-range indicator around the player's current system. */
  updateRangeMesh() {
    if (this.rangeMesh) {
      this.root.remove(this.rangeMesh);
      this.rangeMesh.geometry.dispose();
      this.rangeMesh.material.dispose();
    }
    const here = this.state.galaxy.getSystem(this.state.location.systemId);
    if (!here) return;
    const range = this.state.shipSystem.stats.jumpRange / 3261.56; // ly -> kpc
    const geom = new THREE.SphereGeometry(Math.max(0.4, range), 24, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x66ffee, wireframe: true, transparent: true, opacity: 0.12, depthWrite: false,
    });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(here.position.x, here.position.y * 0.55, here.position.z);
    mesh.name = 'jumpRange';
    this.root.add(mesh);
    this.rangeMesh = mesh;
  }

  setSelected(id) {
    this.selectedId = id;
    const idx = this.systemIndex.findIndex((s) => s.id === id);
    if (this.points) this.points.material.uniforms.uSelected.value = idx;
    this.updateRoute();
  }

  setHover(id) {
    this.hoverId = id;
    const idx = this.systemIndex.findIndex((s) => s.id === id);
    if (this.points) this.points.material.uniforms.uHover.value = idx;
  }

  /** Route line from the player to the selected system. */
  updateRoute() {
    if (this.routeLine) {
      this.root.remove(this.routeLine);
      this.routeLine.geometry.dispose();
      this.routeLine.material.dispose();
      this.routeLine = null;
    }
    const from = this.state.galaxy.getSystem(this.state.location.systemId);
    const to = this.state.galaxy.getSystem(this.selectedId);
    if (!from || !to || from.id === to.id) return;
    const pts = [];
    const a = new THREE.Vector3(from.position.x, from.position.y * 0.55, from.position.z);
    const b = new THREE.Vector3(to.position.x, to.position.y * 0.55, to.position.z);
    const dist = a.distanceTo(b);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += dist * 0.18;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    for (let i = 0; i <= 48; i++) pts.push(curve.getPoint(i / 48));
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const inRange = dist * 3261.56 <= this.state.shipSystem.stats.jumpRange;
    this.routeLine = new THREE.Line(geom, new THREE.LineBasicMaterial({
      color: inRange ? 0x66ffee : 0xff5566, transparent: true, opacity: 0.85,
    }));
    this.root.add(this.routeLine);
  }

  /** Screen-space pick: find the system under the mouse. */
  pick(clientX, clientY, canvas) {
    if (!this.points) return null;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, this.camera);
    // Raycast against a slightly thickened invisible proxy: use the points
    // geometry directly with a generous threshold.
    raycaster.params.Points = { threshold: 0.55 };
    const hits = raycaster.intersectObject(this.points);
    if (!hits.length) return null;
    // Choose the nearest hit by actual distance (threshold is spherical).
    let best = hits[0];
    for (const h of hits) if (h.distanceToRay < best.distanceToRay) best = h;
    return this.systemIndex[best.index] ?? null;
  }

  update(dt) {
    this.time += dt;
    const sinPhi = Math.sin(this._phi);
    this.camera.position.set(
      this.target.x + this._radius * sinPhi * Math.cos(this._theta),
      this.target.y + this._radius * Math.cos(this._phi),
      this.target.z + this._radius * sinPhi * Math.sin(this._theta)
    );
    this.camera.lookAt(this.target);
    if (this.points) this.points.material.uniforms.uTime.value = this.time;
    if (this.rangeMesh) this.rangeMesh.rotation.y += dt * 0.1;
    if (this.routeLine) this.routeLine.material.opacity = 0.55 + 0.35 * Math.sin(this.time * 3);
  }

  /** Focus the camera on a system. */
  focus(id) {
    const s = this.state.galaxy.getSystem(id);
    if (!s) return;
    this.target.set(s.position.x, s.position.y * 0.55, s.position.z);
    this._radius = Math.max(4, this._radius * 0.6);
    this.setSelected(id);
  }

  resetView() {
    this.target.set(0, 0, 0);
    this._radius = 30;
    this._theta = Math.PI / 2;
    this._phi = 1.05;
  }
}
