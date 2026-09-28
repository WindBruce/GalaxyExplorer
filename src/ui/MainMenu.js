/** Main menu: new expedition, continue, load, briefing. */
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

const BRIEFING_SECTIONS = ['premise', 'flight', 'interfaces', 'onFoot', 'archaeology', 'risk'];

export class MainMenu {
  constructor(game) {
    this.game = game;
    this.i18n = game.i18n;
    this.root = document.getElementById('main-menu');
    this.boxMain = document.getElementById('menu-main');
    this.boxSaves = document.getElementById('menu-saves');
    this.boxHelp = document.getElementById('menu-help');
    this.seedInput = document.getElementById('seed-input');
    document.getElementById('btn-new-game').onclick = () => this.newGame();
    document.getElementById('btn-continue').onclick = () => this.continueGame();
    document.getElementById('btn-load').onclick = () => this.showSaves();
    document.getElementById('btn-help').onclick = () => this.showHelp();
    document.getElementById('btn-saves-back').onclick = () => this.showMain();
    document.getElementById('btn-help-back').onclick = () => this.showMain();
    this.langRow = document.getElementById('menu-lang');
    if (this.langRow) {
      for (const loc of this.i18n.available) {
        const btn = h('button', 'btn small lang-btn', loc.native);
        btn.dataset.lang = loc.id;
        btn.onclick = () => this.i18n.setLocale(loc.id);
        this.langRow.appendChild(btn);
      }
    }
    this._renderBriefing();
    this._refreshContinue();
  }

  /** The briefing is authored once per language and re-rendered on switch. */
  _renderBriefing() {
    const box = document.getElementById('help-content');
    box.innerHTML = '';
    const T = (k) => this.i18n.t(`brief.${k}`);
    for (const section of BRIEFING_SECTIONS) {
      const head = document.createElement('h4');
      head.textContent = this.i18n.t(`brief.head.${section}`);
      const body = document.createElement('div');
      body.className = 'brief-section';
      body.innerHTML = T(section);
      box.append(head, body);
    }
  }

  _refreshContinue() {
    const autosave = this.game.save.peek('autosave');
    const btn = document.getElementById('btn-continue');
    if (autosave) {
      btn.disabled = false;
      btn.textContent = this.i18n.t('menu.continueWith', {
        sd: (autosave.stardate ?? 0).toFixed(0),
        player: autosave.player ?? this.i18n.t('cargo.unknown'),
        level: autosave.level ?? 1,
      });
    } else {
      btn.disabled = true;
      btn.textContent = this.i18n.t('menu.continue');
    }
  }

  show() {
    this.root.classList.remove('hidden');
    this._renderBriefing();
    this.showMain();
    this._refreshContinue();
    this._refreshLang();
  }

  /** Highlight the active language button. */
  _refreshLang() {
    if (!this.langRow) return;
    for (const btn of this.langRow.querySelectorAll('.lang-btn')) {
      btn.classList.toggle('primary', btn.dataset.lang === this.i18n.locale);
    }
  }

  hide() {
    this.root.classList.add('hidden');
  }

  showMain() {
    this.boxMain.classList.remove('hidden');
    this.boxSaves.classList.add('hidden');
    this.boxHelp.classList.add('hidden');
  }

  showSaves() {
    this.boxMain.classList.add('hidden');
    this.boxSaves.classList.remove('hidden');
    this.boxHelp.classList.add('hidden');
    const list = document.getElementById('save-slots');
    list.innerHTML = '';
    const slots = this.game.save.allSlots();
    let any = false;
    for (const s of slots) {
      if (!s) continue;
      any = true;
      const row = h('div', 'save-slot');
      const info = h('div', 's-info');
      info.innerHTML = `<b>${s.slot}</b> — ${s.player ?? 'unknown'} · LVL ${s.level ?? 1} · ¢${(s.credits ?? 0).toLocaleString()}<br>` +
        `<span class="dim">${new Date(s.savedAt).toLocaleString()} · ${s.archiveEntries ?? 0} archive entries · ${s.questsCompleted ?? 0} missions</span>`;
      const actions = h('div', 's-actions');
      const load = h('button', 'btn small primary', this.i18n.t('menu.slotLoad'));
      load.onclick = () => {
        const res = this.game.loadGame(s.slot);
        this.game.ui.notify(
          res.ok ? this.i18n.t('notify.saved') : this.i18n.t('notify.saveFailed'),
          res.ok
            ? this.i18n.t('menu.slotLoaded', { name: this.game.state.location.system?.name ?? this.i18n.t('cargo.unknown') })
            : this.i18n.reason(res),
          res.ok ? 'good' : 'danger'
        );
        if (res.ok) this.hide();
      };
      const del = h('button', 'btn small danger', this.i18n.t('menu.slotDel'));
      del.onclick = () => {
        this.game.save.remove(s.slot);
        this.showSaves();
      };
      actions.append(load, del);
      row.append(info, actions);
      list.appendChild(row);
    }
    if (!any) list.appendChild(h('div', 'card-sub', this.i18n.t('menu.savesEmpty')));
  }

  showHelp() {
    this.boxMain.classList.add('hidden');
    this.boxSaves.classList.add('hidden');
    this.boxHelp.classList.remove('hidden');
  }

  newGame() {
    const seed = (this.seedInput.value || 'MilkyWay-4471').trim();
    this.game.newGame(seed);
    this.hide();
  }

  continueGame() {
    const res = this.game.loadGame('autosave');
    if (res.ok) this.hide();
    else this.game.ui.notify(this.i18n.t('menu.noAutosave'), this.i18n.reason(res), 'warn');
  }
}
