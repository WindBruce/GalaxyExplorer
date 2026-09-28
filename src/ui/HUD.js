/**
 * Heads-up display: ship vitals, target dossier, prompts, scan progress.
 * Pure DOM, updated from game state each frame.
 */
export class HUD {
  constructor(game) {
    this.game = game;
    this.i18n = game.i18n;
    this.el = document.getElementById('hud');
    this.crosshair = document.getElementById('crosshair');
    this.prompt = document.getElementById('hud-prompt');
    this.targetPanel = document.getElementById('hud-target');
    this.scanBar = document.getElementById('scan-bar');
    this.scanFill = document.getElementById('scan-fill');
    this.alerts = document.getElementById('hud-alerts');
    this._alertTimers = new Map();
    this._cache = {};
  }

  show() {
    this.el.classList.remove('hidden');
    this.crosshair.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
    this.crosshair.classList.add('hidden');
    this.setPrompt(null);
  }

  _txt(id, value) {
    const el = document.getElementById(id);
    if (el && this._cache[id] !== value) {
      el.textContent = value;
      this._cache[id] = value;
    }
  }

  _bar(id, pct) {
    const el = document.getElementById(id);
    if (el) el.style.width = `${Math.max(0, Math.min(100, pct * 100)).toFixed(1)}%`;
  }

  setSystem(system) {
    this._txt('hud-system-name', system?.name ?? this.i18n.t('hud.unknown'));
  }

  setPlanet(planet, ruin) {
    this._txt('hud-system-name', planet
      ? this.i18n.t('hud.surface', { planet: planet.name })
      : this.i18n.t('hud.unknown'));
    this._txt('hud-region', ruin
      ? this.i18n.t('hud.ruin', { name: ruin.name })
      : this.i18n.content('planettype', planet?.type, planet?.typeLabel ?? '', 'label'));
  }

  setPrompt(text) {
    if (!text) {
      this.prompt.classList.add('hidden');
      this.prompt.textContent = '';
      return;
    }
    this.prompt.classList.remove('hidden');
    this.prompt.textContent = text;
  }

  setScan(scan) {
    if (!scan || !scan.active) {
      this.scanBar.classList.add('hidden');
      return;
    }
    this.scanBar.classList.remove('hidden');
    this.scanFill.style.width = `${(scan.progress * 100).toFixed(0)}%`;
  }

  alert(text, ttl = 5000) {
    const el = document.createElement('div');
    el.className = 'hud-alert';
    el.textContent = text;
    this.alerts.appendChild(el);
    setTimeout(() => el.remove(), ttl);
  }

  update(d) {
    if (!d) return;
    const state = this.game.state;

    if (!d.surface) {
      this._txt('hud-region', d.region || '');
      this._txt('hud-stardate', this.i18n.t('hud.stardate', { sd: d.stardate.toFixed(2) }));
    } else {
      this._txt('hud-stardate', this.i18n.t('hud.stardate', { sd: d.stardate.toFixed(2) }));
    }

    // Vitals.
    this._bar('bar-hull', d.hull / Math.max(1, d.maxHull));
    this._txt('val-hull', `${Math.round(d.hull)}/${Math.round(d.maxHull)}`);
    this._bar('bar-shield', d.shield / Math.max(1, d.maxShield));
    this._txt('val-shield', `${Math.round(d.shield)}/${Math.round(d.maxShield)}`);
    this._bar('bar-fuel', d.fuel / Math.max(1, d.maxFuel));
    this._txt('val-fuel', `${Math.round(d.fuel)}/${Math.round(d.maxFuel)}`);
    this._bar('bar-cargo', d.cargoUsed / Math.max(1, d.cargoMax));
    this._txt('val-cargo', `${d.cargoUsed}/${d.cargoMax}`);

    // Ship block.
    this._txt('hud-power', this.i18n.t('hud.power', {
      a: Math.round(d.power ?? 0), b: Math.round(d.powerDraw ?? 0),
    }));
    this._txt('hud-modules', d.modules ?? '');
    this._txt('hud-credits', this.i18n.t('hud.credits', { credits: state.player.credits.toLocaleString() }));
    this._txt('hud-level', this.i18n.t('hud.level', {
      level: state.player.level,
      xp: state.player.xp,
      need: state.xpForLevel(state.player.level),
    }));

    // Speed.
    if (d.speed !== undefined) {
      this._txt('speed-val', String(Math.round(d.speed)));
      document.getElementById('hud-boost')?.classList.toggle('hidden', !d.boost);
    }

    // Target dossier.
    if (d.target) {
      this.targetPanel.classList.remove('hidden');
      this._txt('target-name', d.target.name);
      this._txt('target-label', d.target.label);
      this._txt('target-dist', this.i18n.t('hud.unit', { n: Math.round(d.target.distance) }));
      this._txt('target-scan', d.target.scanned ? this.i18n.t('hud.scanned') : this.i18n.t('hud.scanPrompt'));
    } else {
      this.targetPanel.classList.add('hidden');
    }
    this.setScan(d.scanning);

    if (d.combat) {
      this._txt('hud-region', `${d.region || ''} · ${this.i18n.tp('hud.hostiles', d.combat, { n: d.combat })}`);
    }
    if (d.surface && d.hazard > 0.4) {
      this._txt('hud-region', this.i18n.t('hud.hazard', {
        p: (d.hazard * 100).toFixed(0), r: (d.resist ?? 1).toFixed(1),
      }));
    }
  }
}
