/**
 * Settings overlay.
 *
 * Two sections matter to the player:
 *   - Language: switches the whole game (interface + every archive entry)
 *     between English and Simplified Chinese, immediately and persistently.
 *   - Voice & Audio: master mix, ambience, and browser speech-synthesis
 *     narration of new transmissions, analysis results and mission updates.
 *
 * The overlay is a DOM panel rebuilt on open, exactly like `Panels`, so it can
 * never show stale values. Preferences live in `localStorage` under
 * `galaxyexplorer.settings` and are independent of save slots, so a language
 * choice survives starting a new expedition.
 */
const STORAGE_KEY = 'galaxyexplorer.settings';

const DEFAULTS = {
  language: null,          // null = follow the browser
  master: 0.8,
  music: 0.5,
  sfx: 0.7,
  ambient: 0.6,
  narration: true,
  voice: '',               // '' = let the browser pick
  rate: 1,
};

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export class Settings {
  constructor(game) {
    this.game = game;
    this.i18n = game.i18n;
    this.root = document.getElementById('settings-root');
    this.current = null;
    this.values = this._load();
    this._voices = [];
    this.i18n.onChange(() => {
      if (this.isOpen()) this.open();
    });
    this._loadVoices();
  }

  // ------------------------------------------------------------------ store
  _load() {
    const out = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) Object.assign(out, JSON.parse(raw));
    } catch {
      /* storage unavailable: run with defaults */
    }
    return out;
  }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      /* storage unavailable: preferences are session-only */
    }
  }

  get(key) {
    return this.values[key];
  }

  set(key, value) {
    this.values[key] = value;
    this._save();
  }

  // ------------------------------------------------------------------ speech
  get speechSupported() {
    return typeof window !== 'undefined' && 'speechSynthesis' in window;
  }

  _loadVoices() {
    if (!this.speechSupported) return;
    const read = () => {
      this._voices = window.speechSynthesis.getVoices() ?? [];
      if (this.isOpen()) this.open();
    };
    read();
    window.speechSynthesis.addEventListener?.('voiceschanged', read);
  }

  /** Voices that can speak the active language. */
  voices() {
    const want = this.i18n.locale === 'zh' ? 'zh' : 'en';
    const list = this._voices.slice();
    const matching = list.filter((v) => (v.lang ?? '').toLowerCase().startsWith(want));
    return matching.length ? matching : list;
  }

  /** Speak a line if narration is enabled. Safe to call with narration off. */
  speak(text) {
    if (!this.values.narration || !this.speechSupported || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(String(text));
      const voices = this.voices();
      const picked = voices.find((v) => v.voiceURI === this.values.voice) ?? voices[0];
      if (picked) u.voice = picked;
      u.lang = picked?.lang ?? (this.i18n.locale === 'zh' ? 'zh-CN' : 'en-US');
      u.rate = Number(this.values.rate) || 1;
      u.volume = Math.max(0, Math.min(1, Number(this.values.master) || 0));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch {
      /* speech is a nice-to-have; never break the game over it */
    }
  }

  // -------------------------------------------------------------------- view
  isOpen() {
    return !!this.root && !this.root.classList.contains('hidden');
  }

  open() {
    if (!this.root) return;
    this.root.innerHTML = '';
    this.root.classList.remove('hidden');
    this.root.appendChild(this._frame());
    this.game.input.exitPointerLock();
  }

  close() {
    if (!this.root || !this.isOpen()) return;
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
    this.game.ui?.notify?.(
      this.i18n.t('settings.saved'),
      this.i18n.t('settings.savedBody'),
      'good',
      3000
    );
  }

  _frame() {
    const T = (k, v) => this.i18n.t(k, v);
    const panel = h('div', 'panel settings');
    const head = h('div', 'panel-head');
    head.append(h('h2', null, T('settings.title')));
    const closeBtn = h('button', 'close', T('settings.close'));
    closeBtn.onclick = () => this.close();
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const body = h('div', 'panel-body');
    body.appendChild(this._languageSection());
    body.appendChild(this._voiceSection());
    panel.appendChild(body);
    return panel;
  }

  _languageSection() {
    const T = (k) => this.i18n.t(k);
    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, T('settings.language')));
    sec.appendChild(h('div', 'card-sub', T('settings.languageHint')));
    const row = h('div', 'btn-row');
    for (const loc of this.i18n.available) {
      const active = loc.id === this.i18n.locale;
      const btn = h('button', `btn small${active ? ' primary' : ''}`, loc.native);
      btn.dataset.lang = loc.id;
      btn.onclick = () => {
        if (this.i18n.setLocale(loc.id)) this.set('language', loc.id);
      };
      row.appendChild(btn);
    }
    sec.appendChild(row);
    return sec;
  }

  _voiceSection() {
    const T = (k) => this.i18n.t(k);
    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, T('settings.voice')));
    sec.appendChild(h('div', 'card-sub', T('settings.voiceHint')));

    const grid = h('div', 'settings-grid');

    const slider = (key, labelKey, format) => {
      const wrap = h('div', 'settings-row');
      const label = h('label');
      const name = h('span', 'settings-name', T(labelKey));
      const readout = h('span', 'dim settings-readout', format(this.values[key]));
      label.append(name, readout);
      const input = h('input', 'settings-slider');
      input.type = 'range';
      input.min = key === 'rate' ? '0.6' : '0';
      input.max = key === 'rate' ? '1.6' : '1';
      input.step = key === 'rate' ? '0.05' : '0.05';
      input.value = String(this.values[key]);
      input.oninput = () => {
        this.set(key, Number(input.value));
        readout.textContent = format(this.values[key]);
      };
      label.appendChild(input);
      wrap.appendChild(label);
      return wrap;
    };

    const pct = (v) => `${Math.round(v * 100)}%`;
    grid.append(
      slider('master', 'settings.master', pct),
      slider('music', 'settings.music', pct),
      slider('sfx', 'settings.sfx', pct),
      slider('ambient', 'settings.ambient', pct),
      slider('rate', 'settings.rate', (v) => `${v.toFixed(2)}x`),
    );

    const toggleWrap = h('div', 'settings-row');
    const toggleLabel = h('label');
    const toggleName = h('span', 'settings-name');
    toggleName.append(
      h('span', null, T('settings.narration')),
      h('span', 'dim', T('settings.narrationHint'))
    );
    const box = h('input', 'settings-toggle');
    box.type = 'checkbox';
    box.checked = !!this.values.narration;
    box.onchange = () => {
      this.set('narration', box.checked);
      if (box.checked) this.speak(T('settings.voiceHint'));
    };
    toggleLabel.append(toggleName, box);
    toggleWrap.appendChild(toggleLabel);
    grid.appendChild(toggleWrap);
    sec.appendChild(grid);

    if (this.speechSupported) {
      const voices = this.voices();
      const vWrap = h('div', 'settings-row');
      const vLabel = h('label');
      vLabel.appendChild(h('span', 'settings-name', T('settings.voiceSelect')));
      const select = h('select', 'settings-select');
      const auto = h('option', null, this.i18n.locale === 'zh' ? '自动' : 'Automatic');
      auto.value = '';
      select.appendChild(auto);
      for (const v of voices) {
        const opt = h('option', null, `${v.name} (${v.lang})`);
        opt.value = v.voiceURI;
        select.appendChild(opt);
      }
      select.value = this.values.voice ?? '';
      select.onchange = () => this.set('voice', select.value);
      vLabel.appendChild(select);
      vWrap.appendChild(vLabel);
      sec.appendChild(vWrap);

      const actions = h('div', 'btn-row');
      const test = h('button', 'btn small primary', T('settings.test'));
      test.onclick = () => this.speak(this.i18n.locale === 'zh'
        ? '语音播报测试。银河正在倾听。'
        : 'Voice narration test. The galaxy is listening.');
      actions.appendChild(test);
      sec.appendChild(actions);
    }

    return sec;
  }
}
