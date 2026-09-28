/**
 * Galactic map overlay UI: region legend, selected-system dossier, jump
 * controls. The 3D map itself lives in render/GalaxyMapScene.js.
 */
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export class GalacticMapUI {
  constructor(game) {
    this.game = game;
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
    document.getElementById('map-seedline').textContent =
      `Seed ${this.game.state.galaxy.seed} · ${this.game.state.galaxy.allSystems().length} systems · ${this.game.state.galaxy.regionInfo().length} regions`;
    this._buildLegend();
    this.updateSelection(mapState.selectedId);
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
      row.append(dot, h('span', null, `${r.name} · ${r.count} systems · hazard ${(r.hazard * 100).toFixed(0)}%`));
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
    document.getElementById('mi-region').textContent = `${region?.name ?? sys.regionId} · ${sys.star.classLabel}`;

    const dist = state.galaxy.distanceLy(state.location.systemId, sys.id);
    const check = state.ftl.canJump(state.location.systemId, sys.id);
    const here = sys.id === state.location.systemId;
    const body = [
      here ? 'You are here.' : `Distance: ${dist.toFixed(0)} ly`,
      `Fuel cost: ${check.fuelCost} · Range: ${state.shipSystem.stats.jumpRange.toFixed(0)} ly`,
      sys.summary,
      sys.civId ? `Claimed by ${state.civs.get(sys.civId)?.name ?? sys.civId}.` : 'Unclaimed.',
    ].join('\n');
    document.getElementById('mi-body').textContent = body;

    const stats = [
      `Star: ${sys.star.classLabel} (${sys.star.spectral}), ${sys.star.temp}K`,
      `Planets: ${sys.planets.length} · Moons: ${sys.planets.reduce((s, p) => s + p.moons.length, 0)}`,
      `Life: ${sys.planets.filter((p) => p.life).length} world(s)`,
      `Ruins: ${sys.ruins.length} · Stations: ${sys.stations.length} · Anomalies: ${sys.anomalies.length}`,
      `Status: ${sys.visited ? 'visited' : sys.discovered ? 'detected' : 'uncharted'}`,
      `Position: ${sys.position.x.toFixed(2)}, ${sys.position.y.toFixed(2)}, ${sys.position.z.toFixed(2)} kpc`,
    ];
    document.getElementById('mi-stats').innerHTML = stats.map((s) => `<div>${s}</div>`).join('');

    const jumpBtn = document.getElementById('map-jump');
    jumpBtn.disabled = !check.ok;
    jumpBtn.textContent = here ? 'CURRENT SYSTEM' : check.ok ? `JUMP (${check.fuelCost} FUEL)` : check.reason.toUpperCase();
  }
}
