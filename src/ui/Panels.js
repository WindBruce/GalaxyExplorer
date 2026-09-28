/**
 * Panels: every major interface in the game.
 *
 * Ship status · Cargo & resources · Missions · Technology tree · Skills ·
 * Archaeology · Civilisation database · Galactic Civilization Archive ·
 * System map.
 *
 * Panels are rebuilt from live state every time they open, so they can never
 * show stale data, and every action re-renders.
 */
import { CATEGORY_LABELS } from '../sim/ArchiveSystem.js';
import { h, row, card } from './panelKit.js';

export class Panels {
  constructor(game) {
    this.game = game;
    this.i18n = game.i18n;
    this.root = document.getElementById('panel-root');
    this.current = null;
    this.onClose = null;
  }

  get state() {
    return this.game.state;
  }

  /** Localised content-name helpers: fall back to the authored data text. */
  res(id) {
    return this.i18n.content('resource', id, this.state.data.resources[id]?.name ?? id);
  }

  techName(id) {
    return this.i18n.content('technology', id, this.state.tech.nameOf(id) ?? id, 'name');
  }

  techDesc(id) {
    const def = this.state.data.technologies[id];
    return this.i18n.content('technology', id, def?.desc ?? '', 'desc');
  }

  skillName(id) {
    return this.i18n.content('skill', id, this.state.data.skills[id]?.name ?? id, 'name');
  }

  skillDesc(id) {
    const def = this.state.data.skills[id];
    return this.i18n.content('skill', id, def?.desc ?? '', 'desc');
  }

  moduleName(id) {
    const mod = this.state.shipSystem.getModule(id);
    return this.i18n.content('module', id, mod?.name ?? id, 'name');
  }

  moduleDesc(mod) {
    return this.i18n.content('module', mod.id, mod.desc ?? '', 'desc');
  }

  slotLabel(slot) {
    return this.i18n.t(`label.slot.${slot}`, {});
  }

  civName(id) {
    return this.i18n.content('civilization', id, this.state.civs.get(id)?.name ?? id, 'name');
  }

  artifact(def) {
    return {
      name: this.i18n.content('artifact', def.id, def.name, 'name'),
      desc: this.i18n.content('artifact', def.id, def.desc, 'desc'),
      evidence: this.i18n.content('artifact', def.id, def.evidenceText, 'evidenceText'),
      type: this.i18n.t(`label.artifacttype.${def.type}`, {}),
    };
  }

  quest(q) {
    return {
      title: this.i18n.content('quest', q.id, q.title, 'title'),
      giver: this.i18n.content('civilization', q.giver, q.giver ?? '', 'name'),
      category: this.i18n.t(`label.questcat.${q.category}`, {}),
      description: this.i18n.content('quest', q.id, q.description ?? '', 'desc'),
    };
  }

  isOpen() {
    return this.current !== null;
  }

  open(name) {
    if (this.current === name) {
      this.close();
      return;
    }
    this.close(true);
    const builders = {
      ship: () => this._ship(),
      cargo: () => this._cargo(),
      missions: () => this._missions(),
      tech: () => this._tech(),
      skills: () => this._skills(),
      archaeology: () => this._archaeology(),
      civs: () => this._civs(),
      archive: () => this._archive(),
      systemMap: () => this._systemMap(),
    };
    const build = builders[name];
    if (!build) return;
    const panel = build();
    panel.dataset.panel = name;
    this.root.appendChild(panel);
    this.root.classList.remove('hidden');
    this.current = name;
    this.game.input.exitPointerLock();
  }

  close(silent = false) {
    if (!this.current) return;
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
    this.current = null;
    if (!silent) this.onClose?.();
  }

  _frame(title, subtitle) {
    const panel = h('div', 'panel');
    const head = h('div', 'panel-head');
    head.appendChild(h('h2', null, title));
    if (subtitle) head.appendChild(h('div', 'hud-sub', subtitle));
    const closeBtn = h('button', 'close', this.i18n.t('panel.close'));
    closeBtn.onclick = () => this.close();
    head.appendChild(closeBtn);
    panel.appendChild(head);
    const body = h('div', 'panel-body');
    panel.appendChild(body);
    panel._body = body;
    return panel;
  }

  // ---------------------------------------------------------------- Ship
  _ship() {
    const state = this.state;
    const T = (k, v) => this.i18n.t(k, v);
    const panel = this._frame(T('panel.ship'), T('ship.sub'));
    const body = panel._body;

    const stats = state.shipSystem.stats;
    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, T('ship.derived')));
    const grid = h('div');
    grid.append(
      row(T('stat.hull'), `${Math.round(state.ship.hull)} / ${state.ship.maxHull}`),
      row(T('stat.shieldCapacity'), `${Math.round(state.ship.maxShield)}`),
      row(T('stat.shieldRegen'), `${state.shipSystem.stats.shieldRegen.toFixed(1)}/s`),
      row(T('stat.thrust'), `${stats.thrust.toFixed(0)} kN`),
      row(T('stat.ftlRange'), `${stats.jumpRange.toFixed(1)} ly`),
      row(T('stat.ftlEfficiency'), `${stats.jumpEfficiency.toFixed(2)}x`),
      row(T('stat.jumpCharge'), `${stats.chargeTime.toFixed(1)} s`),
      row(T('stat.powerOutput'), `${stats.powerOutput.toFixed(0)} MW${stats.overloaded ? ` · ${T('stat.overloaded')}` : ''}`, stats.overloaded ? 'bad' : 'good'),
      row(T('stat.powerDraw'), `${stats.powerDraw.toFixed(0)} MW`),
      row(T('stat.cargoCapacity'), `${state.resources.capacity} t`),
      row(T('stat.scanRange'), `${stats.scanRange.toFixed(2)}x`),
      row(T('stat.anomalySense'), `${stats.anomalySense.toFixed(2)}x`),
      row(T('stat.miningYield'), `${stats.miningYield.toFixed(2)}x`),
      row(T('stat.archaeology'), T('stat.archaeologyValue', {
        a: stats.analysis.toFixed(2), t: stats.translation.toFixed(2),
      })),
      row(T('stat.research'), `${stats.research.toFixed(2)}x`),
      row(T('stat.hazardResist'), `${stats.hazardResist.toFixed(2)}x`),
      row(T('stat.weaponDamage'), stats.damage > 0 ? stats.damage.toFixed(0) : T('stat.unarmed'), stats.damage > 0 ? '' : 'warn'),
      row(T('stat.mass'), `${stats.mass.toFixed(0)} t`),
    );
    sec.appendChild(grid);
    body.appendChild(sec);

    // Loadout.
    const lo = h('div', 'panel-section');
    lo.appendChild(h('h3', null, T('ship.modules')));
    const all = state.shipSystem.allModules();
    for (const { slot, module } of state.shipSystem.loadoutSummary()) {
      const c = h('div', 'card');
      const t = h('div', 'card-title');
      t.appendChild(h('span', null, module ? this.moduleName(module.id) : T('ship.empty')));
      t.appendChild(h('span', null, this.slotLabel(slot)));
      c.appendChild(t);
      if (module) {
        c.appendChild(h('div', 'card-sub', T('ship.tierLine', {
          tier: module.tier, mass: module.mass, power: module.powerDraw,
        })));
        c.appendChild(h('div', 'card-text', this.moduleDesc(module)));
      }
      const actions = h('div', 'btn-row');
      // Available upgrades for this slot.
      const options = (state.data.shipModules[slot] ?? []).filter((m) => m.id !== module?.id);
      for (const opt of options.slice(0, 4)) {
        const owned = !!all[opt.id];
        const techOk = !opt.requiresTech || state.tech.has(opt.requiresTech);
        const afford = state.resources.canAfford(opt.cost?.resources ?? {}) && state.player.credits >= (opt.cost?.credits ?? 0);
        const price = opt.cost?.credits ? T('ship.price', { n: opt.cost.credits.toLocaleString() }) : '';
        const label = owned
          ? T('ship.owned', { name: this.moduleName(opt.id) })
          : this.moduleName(opt.id);
        const btn = h('button', 'btn small', `${label}${price ? ` (${price})` : ''}`);
        btn.disabled = !techOk || !afford;
        btn.title = !techOk
          ? T('ship.requiresTech', { name: this.techName(opt.requiresTech) })
          : !afford
            ? T('ship.cannotAfford')
            : this.moduleDesc(opt);
        btn.onclick = () => {
          const res = state.shipSystem.install(opt.id);
          this.game.ui.notify(
            res.ok ? T('notify.moduleInstalled') : T('notify.cannotInstall'),
            res.ok ? this.moduleName(opt.id) : this.i18n.reason(res),
            res.ok ? 'good' : 'warn'
          );
          this.open('ship');
        };
        actions.appendChild(btn);
      }
      c.appendChild(actions);
      lo.appendChild(c);
    }
    body.appendChild(lo);

    // Station services.
    const station = this._nearbyStation();
    const svc = h('div', 'panel-section');
    svc.appendChild(h('h3', null, T('ship.services')));
    if (station) {
      const repairCost = Math.ceil((state.ship.maxHull - state.ship.hull) * 12);
      const fuelCost = Math.ceil((state.ship.maxFuel - state.ship.fuel) * state.ftl.fuelPrice(station.owner));
      const actions = h('div', 'btn-row');
      const repair = h('button', 'btn', T('ship.repair', { n: repairCost.toLocaleString() }));
      repair.disabled = state.ship.hull >= state.ship.maxHull || state.player.credits < repairCost;
      repair.onclick = () => {
        if (state.player.credits < repairCost) return;
        state.player.credits -= repairCost;
        state.ship.repair(state.ship.maxHull);
        this.game.ui.notify(T('notify.repaired'), T('notify.repairedBody'), 'good');
        this.open('ship');
      };
      const refuel = h('button', 'btn', T('ship.refuel', { n: fuelCost.toLocaleString() }));
      refuel.disabled = state.ship.fuel >= state.ship.maxFuel || state.player.credits < fuelCost;
      refuel.onclick = () => {
        if (state.player.credits < fuelCost) return;
        state.player.credits -= fuelCost;
        state.ship.fuel = state.ship.maxFuel;
        this.game.ui.notify(T('notify.refuelled'), T('notify.refuelledBody'), 'good');
        this.open('ship');
      };
      actions.append(repair, refuel);
      svc.appendChild(h('div', 'card-sub', T('ship.docked', { name: station.name })));
      svc.appendChild(actions);
    } else {
      svc.appendChild(h('div', 'card-sub', T('ship.noStation')));
    }
    body.appendChild(svc);
    return panel;
  }

  _nearbyStation() {
    const state = this.state;
    const sys = state.location.system;
    if (!sys) return null;
    const station = sys.stations.find((s) => !s.derelict);
    return station ?? null;
  }

  // ---------------------------------------------------------------- Cargo
  _cargo() {
    const state = this.state;
    const T = (k, v) => this.i18n.t(k, v);
    const panel = this._frame(T('panel.cargo'), T('cargo.sub', {
      used: state.resources.used, cap: state.resources.capacity,
      credits: state.player.credits.toLocaleString(),
    }));
    const body = panel._body;

    const civId = this._nearbyStation()?.owner ?? 'terranConcord';
    const civ = state.civs.get(civId);

    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, T('cargo.manifest', { civ: this.civName(civId) })));
    const manifest = state.resources.manifest();
    if (!manifest.length) {
      sec.appendChild(h('div', 'card-sub', T('cargo.empty')));
    }
    for (const item of manifest) {
      const c = h('div', 'card');
      const t = h('div', 'card-title');
      const dot = h('span', 'res-dot');
      dot.style.background = item.color;
      dot.style.color = item.color;
      const nameWrap = h('span');
      nameWrap.style.display = 'flex';
      nameWrap.style.alignItems = 'center';
      nameWrap.style.gap = '7px';
      nameWrap.append(dot, h('span', null, this.res(item.id)));
      t.append(nameWrap, h('span', null, `${item.qty} t`));
      c.appendChild(t);
      const price = state.resources.price(item.id, civId);
      c.appendChild(h('div', 'card-sub', T('cargo.marketLine', {
        cat: T(`label.category.${item.category}`),
        price,
        value: (price * item.qty).toLocaleString(),
      })));
      const actions = h('div', 'btn-row');
      const sellAll = h('button', 'btn small primary', T('cargo.sellAll', { n: (price * item.qty * 0.8).toLocaleString() }));
      sellAll.onclick = () => {
        const res = state.resources.sell(item.id, item.qty, civId);
        this.game.ui.notify(T('notify.sold'), `${this.res(item.id)} x${res.price ? Math.round(res.price / Math.max(1, price * 0.8)) : 0} for ${T('missions.rewardCredits', { n: res.price?.toLocaleString() })}`, 'good');
        this.open('cargo');
      };
      const sell10 = h('button', 'btn small', T('cargo.sell10'));
      sell10.onclick = () => {
        const res = state.resources.sell(item.id, 10, civId);
        this.open('cargo');
      };
      actions.append(sellAll, sell10);
      c.appendChild(actions);
      sec.appendChild(c);
    }
    body.appendChild(sec);

    // Market (buy).
    const mkt = h('div', 'panel-section');
    mkt.appendChild(h('h3', null, T('cargo.market')));
    const offers = state.civs.market(civId);
    for (const offer of offers.slice(0, 8)) {
      const c = h('div', 'card');
      const t = h('div', 'card-title');
      t.append(h('span', null, this.res(offer.id)), h('span', null, `${T('missions.rewardCredits', { n: offer.price })}/t`));
      c.appendChild(t);
      c.appendChild(h('div', 'card-sub', T('cargo.offerLine', {
        cat: T(`label.category.${offer.category}`),
        demand: offer.demand, stock: offer.stock, has: offer.playerHas,
      })));
      const actions = h('div', 'btn-row');
      const buy10 = h('button', 'btn small', T('cargo.buy10'));
      buy10.onclick = () => {
        const res = state.resources.buy(offer.id, 10, civId);
        this.game.ui.notify(
          res.ok ? T('notify.purchased') : T('notify.cannotBuy'),
          res.ok ? `${this.res(offer.id)} x10 for ${T('missions.rewardCredits', { n: res.price.toLocaleString() })}` : this.i18n.reason(res),
          res.ok ? 'good' : 'warn'
        );
        this.open('cargo');
      };
      const buy50 = h('button', 'btn small', T('cargo.buy50'));
      buy50.onclick = () => {
        const res = state.resources.buy(offer.id, 50, civId);
        this.open('cargo');
      };
      actions.append(buy10, buy50);
      c.appendChild(actions);
      mkt.appendChild(c);
    }
    body.appendChild(mkt);
    return panel;
  }

  // ---------------------------------------------------------------- Missions
  _missions() {
    const state = this.state;
    const T = (k, v) => this.i18n.t(k, v);
    const panel = this._frame(T('panel.missions'), T('missions.sub', {
      a: state.quests.active.length, c: state.quests.completed.length,
    }));
    const body = panel._body;

    const avail = state.quests.available();
    if (avail.length) {
      const sec = h('div', 'panel-section');
      sec.appendChild(h('h3', null, T('missions.available')));
      for (const q of avail) {
        const qq = this.quest(q);
        const c = card(qq.title, `${qq.giver} · ${qq.category}`, qq.description);
        const btn = h('button', 'btn small primary', T('missions.accept'));
        btn.onclick = () => {
          const res = state.quests.start(q.id);
          this.game.ui.notify(
            res.ok ? T('notify.contractAccepted') : T('notify.cannotAccept'),
            res.ok ? qq.title : this.i18n.reason(res),
            res.ok ? 'good' : 'warn'
          );
          this.open('missions');
        };
        c.appendChild(btn);
        sec.appendChild(c);
      }
      body.appendChild(sec);
    }

    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, T('missions.active')));
    if (!state.quests.active.length) sec.appendChild(h('div', 'card-sub', T('missions.none')));
    for (const q of state.quests.active) {
      const qq = this.quest(q);
      const c = card(qq.title, `${qq.giver} · ${q.chain}`, qq.description);
      for (const o of state.quests.describe(q)) {
        const line = h('div', 'row');
        line.appendChild(h('span', 'k', o.done ? '✔' : '○'));
        line.appendChild(h('span', 'v', `${o.text}${o.progress ? ` (${o.progress})` : ''}${o.target ? ` — ${o.target}` : ''}`));
        c.appendChild(line);
      }
      const r = q.rewards ?? {};
      const rew = [];
      if (r.credits) rew.push(T('missions.rewardCredits', { n: r.credits.toLocaleString() }));
      if (r.research) rew.push(T('missions.rewardResearch', { n: r.research }));
      if (r.xp) rew.push(T('missions.rewardXp', { n: r.xp }));
      if (r.resources) rew.push(Object.entries(r.resources)
        .map(([k, v]) => T('missions.rewardResources', { qty: v, name: this.res(k) })).join(', '));
      c.appendChild(h('div', 'card-sub', T('missions.rewards', { list: rew.join(' · ') || '—' })));
      const btn = h('button', 'btn small danger', T('missions.abandon'));
      btn.onclick = () => {
        state.quests.abandon(q.id);
        this.open('missions');
      };
      c.appendChild(btn);
      sec.appendChild(c);
    }
    body.appendChild(sec);

    if (state.quests.completed.length) {
      const done = h('div', 'panel-section');
      done.appendChild(h('h3', null, T('missions.completed')));
      for (const q of state.quests.completed) {
        const qq = this.quest(q);
        done.appendChild(card(qq.title, qq.giver, qq.description));
      }
      body.appendChild(done);
    }
    return panel;
  }

  // ---------------------------------------------------------------- Tech
  _tech() {
    const state = this.state;
    const T = (k, v) => this.i18n.t(k, v);
    const panel = this._frame(T('panel.tech'), T('tech.sub', {
      rp: state.research.points.toLocaleString(), n: state.research.completed.length,
    }));
    const body = panel._body;
    const tree = state.tech.tree();

    for (const [cat, nodes] of Object.entries(tree)) {
      const sec = h('div', 'tech-cat');
      sec.appendChild(h('h3', null, T(`label.techcat.${cat}`, {})));
      for (const n of nodes) {
        const cls = n.researched ? 'done' : n.canResearch ? 'available' : '';
        const c = h('div', `tech-node ${cls}`.trim());
        const title = h('div', 'nm');
        title.append(h('span', null, this.techName(n.id)), h('span', 't', `T${n.tier}`));
        c.appendChild(title);
        c.appendChild(h('div', 'ds', this.techDesc(n.id)));
        const costBits = [`${n.cost.research} RP`];
        for (const [id, qty] of Object.entries(n.cost.resources ?? {})) costBits.push(`${qty} ${this.res(id)}`);
        const costLine = h('div', 'cost', T('tech.cost', { bits: costBits.join(' · ') }));
        c.appendChild(costLine);
        if (n.requires?.length) {
          c.appendChild(h('div', 'cost', T('tech.requires', {
            list: n.requires.map((r) => this.techName(r)).join(', '),
          })));
        }
        if (n.artifactGated && !n.researched) {
          c.appendChild(h('div', 'cost', T('tech.artifactGated')));
        }
        if (!n.researched) {
          const btn = h('button', 'btn small', n.canResearch ? T('tech.research') : T('tech.locked'));
          btn.disabled = !n.canResearch;
          btn.onclick = () => {
            const check = state.tech.canResearch(n.id);
            if (!check.ok) {
              this.game.ui.notify(T('notify.cannotResearch'), this.i18n.reason(check), 'warn');
              return;
            }
            state.tech.research(n.id);
            this.game.ui.notify(T('notify.techResearched'), this.techName(n.id), 'good');
            this.open('tech');
          };
          c.appendChild(btn);
        } else {
          c.appendChild(h('div', 'cost', T('tech.researched')));
        }
        sec.appendChild(c);
      }
      body.appendChild(sec);
    }
    return panel;
  }

  // ---------------------------------------------------------------- Skills
  _skills() {
    const state = this.state;
    const T = (k, v) => this.i18n.t(k, v);
    const panel = this._frame(T('panel.skills'), this.i18n.tp('skills.sub', state.player.skillPoints, {
      name: state.player.name,
      level: state.player.level,
      n: state.player.skillPoints,
    }));
    const body = panel._body;
    const tree = state.skills.tree();

    const progress = state.skills.archetypeProgress();
    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, T('skills.build')));
    sec.appendChild(h('div', 'card-sub', Object.keys(progress).length
      ? Object.entries(progress).map(([a, n]) => `${T(`label.arch.${a}`, {})} ×${n}`).join(' · ')
      : T('skills.none')));
    body.appendChild(sec);

    for (const [arch, nodes] of Object.entries(tree)) {
      const sec2 = h('div', 'skill-arch');
      sec2.appendChild(h('h3', null, T(`label.arch.${arch}`, {})));
      for (const n of nodes) {
        const cls = n.unlocked ? 'unlocked' : n.canUnlock ? '' : 'locked';
        const c = h('div', `skill-node ${cls}`.trim());
        c.append(h('span', 'tier', `T${n.tier}`));
        const info = h('div');
        info.appendChild(h('div', 'nm', this.skillName(n.id)));
        info.appendChild(h('div', 'ds', this.skillDesc(n.id)));
        c.appendChild(info);
        if (n.unlocked) {
          c.appendChild(h('span', 'tag good', T('skills.learned')));
        } else {
          const btn = h('button', 'btn small', T('skills.cost', { n: n.cost }));
          btn.disabled = !n.canUnlock;
          const check = state.skills.canUnlock(n.id);
          btn.title = check.ok ? T('skills.unlock') : this.i18n.reason(check);
          btn.onclick = () => {
            const res = state.skills.unlock(n.id);
            this.game.ui.notify(
              res.ok ? T('notify.skillLearned') : T('notify.cannotLearn'),
              res.ok ? this.skillName(n.id) : this.i18n.reason(res),
              res.ok ? 'good' : 'warn'
            );
            this.open('skills');
          };
          c.appendChild(btn);
        }
        sec2.appendChild(c);
      }
      body.appendChild(sec2);
    }
    return panel;
  }

  // ---------------------------------------------------------------- Archaeology
  _archaeology() {
    const state = this.state;
    const arch = state.archaeology;
    const T = (k, v) => this.i18n.t(k, v);
    const panel = this._frame(T('panel.arch'), T('arch.sub', {
      a: arch.analyzed.length, u: arch.collected.length - arch.analyzed.length,
    }));
    const body = panel._body;

    // Main mystery.
    const mystery = arch.mysteryStage();
    const m = h('div', 'mystery');
    m.appendChild(h('div', 'm-title', this.i18n.content('mystery', 'name', mystery.name, 'name').toUpperCase()));
    m.appendChild(h('div', 'm-stage', T('arch.understanding', {
      label: this.i18n.content('mystery', 'stage.' + mystery.stage.id, mystery.stage.label),
    })));
    m.appendChild(h('div', 'm-desc', this.i18n.content('mystery', 'summary', mystery.summary, 'summary')));
    const stages = h('div', 'm-stages');
    for (const s of mystery.stages) {
      stages.appendChild(h('div', s.reached ? 'on' : ''));
    }
    m.appendChild(stages);
    body.appendChild(m);

    // Inventory.
    const inv = h('div', 'panel-section');
    inv.appendChild(h('h3', null, T('arch.inventory')));
    const unanalyzed = arch.collected.filter((i) => !i.analyzed);
    const analyzed = arch.analyzed;
    if (!arch.collected.length) {
      inv.appendChild(h('div', 'card-sub', T('arch.none')));
    }
    for (const inst of unanalyzed) {
      const def = arch.artifactDef(inst.artifactId);
      const a = this.artifact(def);
      const c = card(a.name, T('arch.artifactMeta', {
        type: T(`label.artifacttype.${def.type}`, {}), civ: def.civTag, tier: def.tier,
      }), a.desc);
      const chance = arch.analysisChance(def);
      c.appendChild(h('div', 'card-sub', T('arch.confidence', { p: (chance * 100).toFixed(0) })));
      const btn = h('button', 'btn small primary', T('arch.analyze'));
      btn.onclick = () => {
        const res = arch.analyze(inst.uid);
        if (!res.ok) {
          this.game.ui.notify(T('notify.cannotAnalyse'), this.i18n.reason(res), 'warn');
          return;
        }
        this.game.ui.showAnalysis(res);
        this.open('archaeology');
      };
      c.appendChild(btn);
      inv.appendChild(c);
    }
    if (analyzed.length) {
      inv.appendChild(h('h3', null, T('arch.analysed')));
      for (const inst of analyzed) {
        const def = arch.artifactDef(inst.artifactId);
        const a = this.artifact(def);
        inv.appendChild(card(a.name, `${T(`label.artifacttype.${def.type}`, {})} · ${def.civTag}`, a.evidence, [{ text: T('arch.tagAnalysed'), cls: 'good' }]));
      }
    }
    body.appendChild(inv);

    // Hypotheses.
    const hyps = arch.hypotheses();
    if (hyps.length) {
      const sec = h('div', 'panel-section');
      sec.appendChild(h('h3', null, T('arch.hypotheses')));
      for (const hyp of hyps) {
        const c = card(hyp.title, T('arch.hypConfidence', { p: (hyp.confidence * 100).toFixed(0) }), hyp.text);
        sec.appendChild(c);
      }
      body.appendChild(sec);
    }

    // Timeline.
    const tl = h('div', 'panel-section');
    tl.appendChild(h('h3', null, T('arch.timeline')));
    for (const era of arch.timeline()) {
      const e = h('div', 'era');
      e.appendChild(h('div', 'era-name', this.i18n.content('timeline', 'era.' + era.id, era.name, 'name')));
      e.appendChild(h('div', 'era-range', T('arch.eraRange', {
        start: era.startBya, end: era.endBya, known: era.known, total: era.events.length,
      })));
      e.appendChild(h('div', 'era-desc', this.i18n.content('timeline', 'era.' + era.id, era.desc, 'desc')));
      for (const ev of era.events) {
        if (ev.status === 'unknown') continue;
        const ec = h('div', `event ${ev.status}`);
        const title = h('div', 'ev-title');
        title.append(
          h('span', null, this.i18n.content('timeline', 'event.' + ev.id, ev.title, 'title')),
          h('span', 'ev-state', ev.status === 'confirmed' ? T('arch.confirmed') : T('arch.hypothesis'))
        );
        ec.appendChild(title);
        ec.appendChild(h('div', 'ev-text', this.i18n.content('timeline', 'event.' + ev.id, ev.summary, 'summary')));
        ec.appendChild(h('div', 'ev-ev', T('arch.evidence', { names: ev.evidenceNames.join(', ') })));
        e.appendChild(ec);
      }
      tl.appendChild(e);
    }
    body.appendChild(tl);
    return panel;
  }

  // ---------------------------------------------------------------- Civilisations
  _civs() {
    const state = this.state;
    const T = (k, v) => this.i18n.t(k, v);
    const panel = this._frame(T('panel.civs'), T('civs.sub', { n: state.civs.discovered().length }));
    const body = panel._body;

    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, T('civs.living')));
    for (const civ of state.civs.all()) {
      const tpl = civ.template;
      const c = card(
        this.civName(civ.id),
        T('civs.cardLine', {
          n: tpl.techLevel,
          gov: this.i18n.content('civilization', civ.id, tpl.government, 'government'),
          rep: state.civs.reputationLabel(civ.id),
          value: `${civ.reputation > 0 ? '+' : ''}${civ.reputation.toFixed(2)}`,
        }),
        this.i18n.content('civilization', civ.id, tpl.background, 'background')
      );
      c.appendChild(h('div', 'card-text', T('civs.philosophy', {
        text: this.i18n.content('civilization', civ.id, tpl.philosophy, 'philosophy'),
      })));
      const tags = [];
      for (const t of tpl.traits ?? []) tags.push({ text: t, cls: '' });
      if (civ.warWith?.length) tags.push({ text: T('civs.atWar', { list: civ.warWith.join(', ') }), cls: 'bad' });
      if (civ.alliedWith?.length) tags.push({ text: T('civs.allied', { list: civ.alliedWith.join(', ') }), cls: 'good' });
      if (civ.politics && civ.politics !== 'stable') tags.push({ text: T(`label.politics.${civ.politics}`, {}), cls: 'warn' });
      const tagRow = h('div');
      for (const t of tags) tagRow.appendChild(h('span', `tag ${t.cls}`.trim(), t.text));
      c.appendChild(tagRow);
      c.appendChild(h('div', 'card-text', T('civs.problem', {
        text: this.i18n.content('civilization', civ.id, tpl.existentialProblem, 'existentialProblem'),
      })));
      c.appendChild(h('div', 'card-sub', T('civs.known', {
        n: civ.knownSystemIds.length,
        lang: this.i18n.content('civilization', civ.id, tpl.language.family, 'language'),
      })));
      if (civ.met) {
        const btn = h('button', 'btn small', T('civs.dialogue'));
        btn.onclick = () => {
          this.close();
          this.game.ui.openDialogue(civ.id);
        };
        c.appendChild(btn);
      }
      sec.appendChild(c);
    }
    body.appendChild(sec);

    const ext = h('div', 'panel-section');
    ext.appendChild(h('h3', null, T('civs.extinct')));
    for (const civ of state.civs.extinct()) {
      const events = state.archaeology.eventRecords().filter((e) => e.status !== 'unknown' && e.era === civ.era);
      ext.appendChild(card(
        this.i18n.content('extinct', civ.id, civ.name, 'name'),
        T('civs.extinctSub', {
          bya: civ.bya,
          sig: this.i18n.content('extinct', civ.id, civ.signature, 'signature'),
        }),
        this.i18n.content('extinct', civ.id, civ.desc, 'desc'),
        events.length
          ? [{ text: T('civs.events', { n: events.length }), cls: 'accent' }]
          : [{ text: T('civs.noEvidence'), cls: 'warn' }]
      ));
    }
    body.appendChild(ext);
    return panel;
  }

  // ---------------------------------------------------------------- Archive
  _archive() {
    const state = this.state;
    const counts = state.archive.counts();
    const T = (k, v) => this.i18n.t(k, v);
    const panel = this._frame(T('panel.archive'), T('archive.sub', { n: state.archive.total }));
    const body = panel._body;

    const overview = h('div', 'panel-section');
    overview.appendChild(h('h3', null, T('archive.coverage')));
    const grid = h('div', 'grid three');
    for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
      const c = h('div', 'res-chip');
      c.append(h('span', null, label), h('span', 'qty', String(counts[cat] ?? 0)));
      grid.appendChild(c);
    }
    overview.appendChild(grid);
    overview.appendChild(h('div', 'card-sub', T('archive.blurb')));
    body.appendChild(overview);

    for (const cat of Object.keys(CATEGORY_LABELS)) {
      const entries = state.archive.byCategory(cat);
      if (!entries.length) continue;
      const sec = h('div', 'panel-section');
      sec.appendChild(h('h3', null, T('archive.count', { label: CATEGORY_LABELS[cat], n: entries.length })));
      for (const e of entries) {
        sec.appendChild(card(e.name, T('archive.recorded', {
          sd: e.discoveredAt?.toFixed?.(1) ?? e.discoveredAt,
        }), e.summary));
      }
      body.appendChild(sec);
    }
    return panel;
  }

  // ---------------------------------------------------------------- System map
  _systemMap() {
    const state = this.state;
    const sys = state.location.system;
    const T = (k, v) => this.i18n.t(k, v);
    const panel = this._frame(T('panel.sysmap'), sys ? sys.name : T('hud.unknown'));
    const body = panel._body;

    if (!sys) {
      body.appendChild(h('div', 'card-sub', T('sysmap.noSystem')));
      return panel;
    }

    // Orbital diagram on a canvas.
    const canvas = h('canvas');
    canvas.width = 520;
    canvas.height = 380;
    canvas.style.width = '100%';
    canvas.style.background = 'rgba(0,0,0,0.35)';
    canvas.style.border = '1px solid rgba(102,238,255,0.15)';
    body.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const maxAu = Math.max(2, ...sys.planets.map((p) => p.orbitAu)) * 1.15;
    const scale = (Math.min(cx, cy) - 18) / maxAu;

    // Star.
    const starColor = sys.star.color ?? '#ffd97d';
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, starColor);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.fill();

    const selected = new Set();
    sys.planets.forEach((p, i) => {
      const r = p.orbitAu * scale;
      ctx.strokeStyle = 'rgba(102,238,255,0.14)';
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      const a = i * 1.7 + 0.6;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      const pr = Math.max(3, Math.min(11, p.radiusKm / 1400));
      ctx.fillStyle = p.life ? '#7dffa8' : p.landable ? '#9ecbff' : '#8a8a8a';
      ctx.beginPath();
      ctx.arc(x, y, pr, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(216,230,240,0.75)';
      ctx.font = '9px monospace';
      ctx.fillText(p.name, x + pr + 3, y + 3);
      if (p.ruinSiteIds.length) {
        ctx.strokeStyle = '#ffd166';
        ctx.beginPath();
        ctx.arc(x, y, pr + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    });

    // Body list.
    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, T('sysmap.bodies')));
    const starCard = card(sys.star.name, T('sysmap.starLine', {
      label: this.i18n.content('starclass', sys.star.classId, sys.star.classLabel, 'label'),
      temp: sys.star.temp, mass: sys.star.mass.toFixed(2), age: sys.star.ageGyr.toFixed(1),
    }), this.i18n.content('starclass', sys.star.classId, sys.summary, 'desc'));
    sec.appendChild(starCard);
    for (const p of sys.planets) {
      const c = card(p.name, T('sysmap.planetLine', {
        type: this.i18n.content('planettype', p.type, p.typeLabel, 'label'),
        au: p.orbitAu.toFixed(2), temp: p.tempK.toFixed(0), grav: p.gravity.toFixed(2),
      }), p.description);
      const tags = [];
      if (p.life) tags.push({ text: T('sysmap.life'), cls: 'good' });
      if (p.breathable) tags.push({ text: T('sysmap.breathable'), cls: 'good' });
      if (p.tidallyLocked) tags.push({ text: T('sysmap.tidallyLocked'), cls: 'warn' });
      if (p.ruinSiteIds.length) tags.push({ text: T('sysmap.ruins', { n: p.ruinSiteIds.length }), cls: 'accent' });
      if (p.ring) tags.push({ text: T('sysmap.ringed'), cls: '' });
      if (!p.landable) tags.push({ text: T('sysmap.notLandable'), cls: 'bad' });
      const tagRow = h('div');
      for (const t of tags) tagRow.appendChild(h('span', `tag ${t.cls}`.trim(), t.text));
      c.appendChild(tagRow);
      c.appendChild(h('div', 'card-sub', T('sysmap.resources', {
        list: p.resources.map((r) => T('sysmap.resourceList', { id: this.res(r.id), qty: r.quantity })).join(', '),
      })));
      sec.appendChild(c);
    }
    for (const s of sys.stations) {
      sec.appendChild(card(s.name, T('sysmap.stationLine', {
        kind: T(`label.stationkind.${s.kind}`, {}),
        au: s.orbitAu.toFixed(2),
        derelict: s.derelict ? T('sysmap.derelict') : '',
      }), T('sysmap.owner', { name: s.owner ?? T('cargo.unknown') })));
    }
    for (const r of sys.ruins) {
      sec.appendChild(card(r.name, T('sysmap.ruinLine', {
        size: r.size,
        civ: this.i18n.content('ruinCiv', r.civTag, r.civTag),
        age: r.ageGyr.toFixed(1),
      }), r.description, [{ text: r.scanned ? T('sysmap.scanned') : T('sysmap.unscanned'), cls: r.scanned ? 'good' : 'warn' }]));
    }
    for (const a of sys.anomalies) {
      sec.appendChild(card(a.name, T('sysmap.anomalyLine', {
        kind: this.i18n.content('anomalyKind', a.kind, a.kind), p: (a.hazard * 100).toFixed(0),
      }), T('sysmap.resources', {
        list: a.resources.map((id) => this.res(id)).join(', '),
      })));
    }
    body.appendChild(sec);
    return panel;
  }
}
