/**
 * Tiny Web Audio mixer. No sample files: tones and filtered noise only.
 * Volumes come from Settings (master / music / sfx / ambient).
 */
export class GameAudio {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.sfxGain = null;
    this.ambGain = null;
    this.musGain = null;
    this._amb = null;
    this._thrust = null;
    this._music = null;
    this._mode = null;
  }

  _ensure() {
    if (this.ctx) return true;
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return false;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.sfxGain = this.ctx.createGain();
      this.ambGain = this.ctx.createGain();
      this.musGain = this.ctx.createGain();
      this.sfxGain.connect(this.master);
      this.ambGain.connect(this.master);
      this.musGain.connect(this.master);
      this.master.connect(this.ctx.destination);
      this._applyVolumes();
      return true;
    } catch {
      return false;
    }
  }

  resume() {
    if (!this._ensure()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume?.();
  }

  _applyVolumes() {
    if (!this.master) return;
    const v = this.settings?.values ?? {};
    const master = Number(v.master ?? 0.8);
    this.master.gain.value = master;
    this.sfxGain.gain.value = Number(v.sfx ?? 0.7);
    this.ambGain.gain.value = Number(v.ambient ?? 0.6);
    this.musGain.gain.value = Number(v.music ?? 0.5);
  }

  /** Call when sliders move or each tick. */
  sync() {
    this._applyVolumes();
  }

  /**
   * @param {'menu'|'space'|'surface'|'combat'} mode
   */
  setAmbience(mode) {
    if (this._mode === mode) return;
    this._mode = mode;
    if (!this._ensure()) return;
    this._stopNode(this._amb);
    this._stopNode(this._music);
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const g = ctx.createGain();
    g.gain.value = 0.04;
    if (mode === 'surface') {
      osc.frequency.value = 72;
      filter.frequency.value = 420;
    } else if (mode === 'combat') {
      osc.frequency.value = 48;
      filter.frequency.value = 900;
      g.gain.value = 0.05;
    } else if (mode === 'menu') {
      osc.frequency.value = 110;
      filter.frequency.value = 600;
    } else {
      osc.frequency.value = 55;
      filter.frequency.value = 280;
    }
    osc.type = 'sine';
    osc.connect(filter);
    filter.connect(g);
    g.connect(this.ambGain);
    osc.start();
    this._amb = { osc, g };

    // Sparse fifth as a stand-in for music.
    const mus = ctx.createOscillator();
    mus.type = 'triangle';
    mus.frequency.value = mode === 'combat' ? 196 : 130.8;
    const mg = ctx.createGain();
    mg.gain.value = 0.018;
    mus.connect(mg);
    mg.connect(this.musGain);
    mus.start();
    this._music = { osc: mus, g: mg };
  }

  setThrust(level) {
    if (!this._ensure()) return;
    const lvl = Math.max(0, Math.min(1, level || 0));
    if (lvl < 0.02) {
      this._stopNode(this._thrust);
      this._thrust = null;
      return;
    }
    if (!this._thrust) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 400;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      osc.connect(f);
      f.connect(g);
      g.connect(this.sfxGain);
      osc.start();
      this._thrust = { osc, g, f };
    }
    this._thrust.osc.frequency.value = 40 + lvl * 80;
    this._thrust.g.gain.value = 0.015 * lvl;
  }

  sfx(kind) {
    if (!this._ensure()) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    g.connect(this.sfxGain);
    osc.connect(g);
    const table = {
      ui: { f: 880, t: 0.08, type: 'square', v: 0.04 },
      scan: { f: 1400, t: 0.25, type: 'sine', v: 0.05 },
      fire: { f: 180, t: 0.12, type: 'sawtooth', v: 0.07 },
      hit: { f: 90, t: 0.18, type: 'square', v: 0.08 },
      jump: { f: 220, t: 0.4, type: 'sine', v: 0.06 },
      notify: { f: 660, t: 0.15, type: 'triangle', v: 0.04 },
    };
    const spec = table[kind] ?? table.ui;
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.f, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, spec.f * 0.4), now + spec.t);
    g.gain.setValueAtTime(spec.v, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + spec.t);
    osc.start(now);
    osc.stop(now + spec.t + 0.02);
  }

  _stopNode(n) {
    if (!n) return;
    try { n.osc.stop(); } catch { /* already stopped */ }
    try { n.osc.disconnect(); n.g.disconnect(); } catch { /* */ }
  }
}
