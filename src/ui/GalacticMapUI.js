/**
 * Galactic map overlay UI: region legend, selected-system dossier, jump
 * controls. The 3D map itself lives in render/GalaxyMapScene.js.
 */
import { summarizeSystem } from '../world/StarSystemGenerator.js';

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export class GalacticMapUI {
  constructor(game) {
    this.game = game;
    this.i18n = game.i18n;
    this.root = document.getElementById('map-ui');
    this.info = document.getElementById('map-info');
    this.legend = document.getElementById('map-legend');
    this.mapState = null;
    this.scene = null;
    this._wire();
  }

  _wire() {
    document.getElementById('map-jump').onclick = () => this.mapState?.jump();
    document.getElementById('map-focus').onclick = () => {
      this.scene?.focus(this.mapState?.selectedId);
    };
    document.getElementById('map-close').onclick = () => {
      this.game.states.change('space');
    };
  }

  show(mapScene, mapState) {
    this.scene = mapScene;
    this.mapState = mapState;
    this.root.classList.remove('hidden');
    document.getElementById('map-seedline').textContent = this.i18n.t('map.seedline', {
      seed: this.game.state.galaxy.seed,
      n: this.game.state.galaxy.allSystems().length,
      r: this.game.state.galaxy.regionInfo().length,
    });
    this._buildLegend();
    this.updateSelection(mapState.selectedId);
  }

  /** Rebuild the one-line dossier so it follows the active language. */
  _summary(sys) {
    return summarizeSystem(sys);
  }

  hide() {
    this.root.classList.add('hidden');
  }

  _buildLegend() {
    this.legend.innerHTML = '';
    for (const r of this.game.state.galaxy.regionInfo()) {
      const row = h('div', 'legend-row');
      const dot = h('span', 'legend-dot');
      dot.style.background = r.color;
      dot.style.color = r.color;
      const name = this.i18n.content('region', r.id, r.name);
      row.append(dot, h('span', null, this.i18n.t('map.legend', {
        name, n: r.count, p: (r.hazard * 100).toFixed(0),
      })));
      this.legend.appendChild(row);
    }
  }

  updateSelection(systemId) {
    const state = this.game.state;
    const sys = state.galaxy.getSystem(systemId);
    if (!sys) {
      this.info.classList.add('hidden');
      return;
    }
    this.info.classList.remove('hidden');
    document.getElementById('mi-name').textContent = sys.name;
    const region = state.galaxy.regions.find((r) => r.id === sys.regionId);
    document.getElementById('mi-region').textContent =
      `${this.i18n.content('region', sys.regionId, region?.name ?? sys.regionId)} · ${this.i18n.content('starclass', sys.star.classId, sys.star.classLabel, 'label')}`;

    const dist = state.galaxy.distanceLy(state.location.systemId, sys.id);
    const check = state.ftl.canJump(state.location.systemId, sys.id);
    const here = sys.id === state.location.systemId;
    const T = (k, v) => this.i18n.t(k, v);
    const body = [
      here ? T('map.youAreHere') : T('map.distance', { n: dist.toFixed(0) }),
      T('map.fuelCost', {
        cost: check.fuelCost, range: state.shipSystem.stats.jumpRange.toFixed(0),
      }),
      this._summary(sys),
      sys.civId
        ? T('map.claimed', { name: state.civs.get(sys.civId)?.name ?? sys.civId })
        : T('map.unclaimed'),
    ].join('\n');    document.getElementById('mi-body').textContent = body;

    const moons = sys.planets.reduce((s, p) => s + p.moons.length, 0);
    const life = sys.planets.filter((p) => p.life).length;
    const status = sys.visited ? 'visited' : sys.discovered ? 'detected' : 'uncharted';
    const stats = [
      T('map.starLine', {
        label: this.i18n.content('starclass', sys.star.classId, sys.star.classLabel, 'label'),
        spectral: sys.star.spectral, temp: sys.star.temp,
      }),
      T('map.counts', { p: sys.planets.length, m: moons }),
      T('map.life', { n: life }),
      T('map.sites', { r: sys.ruins.length, s: sys.stations.length, a: sys.anomalies.length }),
      T('map.status', { status: T(`map.status.${status}`) }),
      T('map.position', {
        x: sys.position.x.toFixed(2), y: sys.position.y.toFixed(2), z: sys.position.z.toFixed(2),
      }),
    ];
    document.getElementById('mi-stats').innerHTML = stats.map((s) => `<div>${s}</div>`).join('');

    const jumpBtn = document.getElementById('map-jump');
    jumpBtn.disabled = !check.ok;
    jumpBtn.textContent = here
      ? this.i18n.t('map.current')
      : check.ok
        ? this.i18n.t('map.jump', { n: check.fuelCost })
        : this.i18n.reason(check).toUpperCase();
  }
}
