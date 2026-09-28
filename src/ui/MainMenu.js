/** Main menu: new expedition, continue, load, briefing. */
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

const BRIEFING = `
<h4>THE PREMISE</h4>
You command a survey ship on the edge of charted space. The Milky Way is old —
older than any civilisation in it. Somewhere in its ruins is the answer to why
every advanced species that ever lived disappeared without trace.
<br><br>
Explore. Scan. Land. Gather. Investigate. Discover. Research. Upgrade. Go deeper.
The history you reconstruct is yours alone.

<h4>FLIGHT CONTROLS</h4>
<kbd>Mouse</kbd> steer &nbsp; <kbd>W</kbd>/<kbd>S</kbd> thrust &nbsp; <kbd>A</kbd>/<kbd>D</kbd> yaw<br>
<kbd>Q</kbd>/<kbd>E</kbd> roll &nbsp; <kbd>R</kbd>/<kbd>F</kbd> vertical &nbsp; <kbd>Shift</kbd> boost<br>
<kbd>Space</kbd> brake &nbsp; <kbd>X</kbd> full stop &nbsp; <kbd>Tab</kbd> cycle target<br>
<kbd>T</kbd> scan target &nbsp; <kbd>G</kbd> land / dock &nbsp; <kbd>LMB</kbd> weapons &nbsp; <kbd>RMB</kbd> mining laser<br>
<kbd>V</kbd> camera view &nbsp; <kbd>M</kbd> galactic map &nbsp; <kbd>N</kbd> system map<br>
<kbd>Esc</kbd> pause menu

<h4>INTERFACES</h4>
<kbd>I</kbd> cargo &amp; market &nbsp; <kbd>U</kbd> ship status &amp; modules<br>
<kbd>K</kbd> character skills &nbsp; <kbd>L</kbd> technology tree<br>
<kbd>J</kbd> archaeology &amp; timeline &nbsp; <kbd>B</kbd> civilisation database<br>
<kbd>A</kbd> Galactic Civilization Archive &nbsp; <kbd>P</kbd> missions

<h4>ON FOOT</h4>
<kbd>WASD</kbd> walk &nbsp; <kbd>Shift</kbd> sprint &nbsp; <kbd>Space</kbd> jump<br>
<kbd>LMB</kbd> extract resource &nbsp; <kbd>E</kbd> excavate artifact &nbsp; <kbd>F</kbd> return to ship

<h4>ARCHAEOLOGY</h4>
Artifacts are evidence, not loot. One piece of evidence forms a HYPOTHESIS.
A second, independent piece CONFIRMS the event. Confirmed events reconstruct
the galactic timeline and advance the main mystery. Some artifacts contain
schematics for technologies that cannot be researched any other way.

<h4>RISK</h4>
Fuel is finite. Hulls break. Radiation kills. Anomalies do not care whether
you are ready. Decide constantly: push deeper, or come home with what you have.
`;

export class MainMenu {
  constructor(game) {
    this.game = game;
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
    document.getElementById('help-content').innerHTML = BRIEFING;
    this._refreshContinue();
  }

  _refreshContinue() {
    const autosave = this.game.save.peek('autosave');
    const btn = document.getElementById('btn-continue');
    if (autosave) {
      btn.disabled = false;
      btn.textContent = `CONTINUE — ${autosave.player ?? 'unknown'} · LVL ${autosave.level ?? 1}`;
    } else {
      btn.disabled = true;
      btn.textContent = 'CONTINUE';
    }
  }

  show() {
    this.root.classList.remove('hidden');
    this.showMain();
    this._refreshContinue();
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
      const load = h('button', 'btn small primary', 'LOAD');
      load.onclick = () => {
        const res = this.game.loadGame(s.slot);
        this.game.ui.notify(res.ok ? 'Save loaded' : 'Load failed', res.ok ? `Resumed in ${this.game.state.location.system?.name ?? 'deep space'}` : res.reason, res.ok ? 'good' : 'danger');
        if (res.ok) this.hide();
      };
      const del = h('button', 'btn small danger', 'DEL');
      del.onclick = () => {
        this.game.save.remove(s.slot);
        this.showSaves();
      };
      actions.append(load, del);
      row.append(info, actions);
      list.appendChild(row);
    }
    if (!any) list.appendChild(h('div', 'card-sub', 'No saves found. Start a new expedition.'));
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
    else this.game.ui.notify('No autosave', res.reason, 'warn');
  }
}
