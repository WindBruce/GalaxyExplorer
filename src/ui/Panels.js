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

function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

function row(k, v, cls = '') {
  const r = h('div', 'row');
  r.appendChild(h('span', 'k', k));
  r.appendChild(h('span', `v ${cls}`.trim(), v));
  return r;
}

function card(title, sub, text, tags = []) {
  const c = h('div', 'card');
  const t = h('div', 'card-title');
  t.appendChild(h('span', null, title));
  c.appendChild(t);
  if (sub) c.appendChild(h('div', 'card-sub', sub));
  if (text) c.appendChild(h('div', 'card-text', text));
  if (tags.length) {
    const tagRow = h('div');
    for (const tag of tags) {
      const cls = typeof tag === 'string' ? '' : tag.cls;
      tagRow.appendChild(h('span', `tag ${cls}`.trim(), typeof tag === 'string' ? tag : tag.text));
    }
    c.appendChild(tagRow);
  }
  return c;
}

export class Panels {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('panel-root');
    this.current = null;
    this.onClose = null;
  }

  get state() {
    return this.game.state;
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
    const closeBtn = h('button', 'close', 'CLOSE [ESC]');
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
    const panel = this._frame('SHIP STATUS', 'Modular loadout & derived performance');
    const body = panel._body;

    const stats = state.shipSystem.stats;
    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, 'Derived performance'));
    const grid = h('div');
    grid.append(
      row('Hull integrity', `${Math.round(state.ship.hull)} / ${state.ship.maxHull}`),
      row('Shield capacity', `${Math.round(state.ship.maxShield)}`),
      row('Shield regen', `${state.shipSystem.stats.shieldRegen.toFixed(1)}/s`),
      row('Main thrust', `${stats.thrust.toFixed(0)} kN`),
      row('FTL range', `${stats.jumpRange.toFixed(1)} ly`),
      row('FTL efficiency', `${stats.jumpEfficiency.toFixed(2)}x`),
      row('Jump charge', `${stats.chargeTime.toFixed(1)} s`),
      row('Power output', `${stats.powerOutput.toFixed(0)} MW`, stats.overloaded ? 'bad' : 'good'),
      row('Power draw', `${stats.powerDraw.toFixed(0)} MW`),
      row('Cargo capacity', `${state.resources.capacity} t`),
      row('Scanner range', `${stats.scanRange.toFixed(2)}x`),
      row('Anomaly sensitivity', `${stats.anomalySense.toFixed(2)}x`),
      row('Mining yield', `${stats.miningYield.toFixed(2)}x`),
      row('Archaeology', `${stats.analysis.toFixed(2)}x analysis · ${stats.translation.toFixed(2)}x translation`),
      row('Research', `${stats.research.toFixed(2)}x`),
      row('Hazard resistance', `${stats.hazardResist.toFixed(2)}x`),
      row('Weapon damage', stats.damage > 0 ? stats.damage.toFixed(0) : 'Unarmed', stats.damage > 0 ? '' : 'warn'),
      row('Ship mass', `${stats.mass.toFixed(0)} t`),
    );
    sec.appendChild(grid);
    body.appendChild(sec);

    // Loadout.
    const lo = h('div', 'panel-section');
    lo.appendChild(h('h3', null, 'Installed modules'));
    const all = state.shipSystem.allModules();
    for (const { slot, module } of state.shipSystem.loadoutSummary()) {
      const c = h('div', 'card');
      const t = h('div', 'card-title');
      t.appendChild(h('span', null, module ? module.name : 'Empty'));
      t.appendChild(h('span', null, slot.toUpperCase()));
      c.appendChild(t);
      if (module) {
        c.appendChild(h('div', 'card-sub', `Tier ${module.tier} · ${module.mass}t · ${module.powerDraw} MW draw`));
        c.appendChild(h('div', 'card-text', module.desc));
      }
      const actions = h('div', 'btn-row');
      // Available upgrades for this slot.
      const options = (state.data.shipModules[slot] ?? []).filter((m) => m.id !== module?.id);
      for (const opt of options.slice(0, 4)) {
        const owned = !!all[opt.id];
        const techOk = !opt.requiresTech || state.tech.has(opt.requiresTech);
        const afford = state.resources.canAfford(opt.cost?.resources ?? {}) && state.player.credits >= (opt.cost?.credits ?? 0);
        const btn = h('button', 'btn small', `${owned ? '↺ ' : ''}${opt.name}${opt.cost?.credits ? ` (¢${opt.cost.credits.toLocaleString()})` : ''}`);
        btn.disabled = !techOk || !afford;
        btn.title = !techOk
          ? `Requires technology: ${state.tech.nameOf(opt.requiresTech)}`
          : !afford
            ? 'Insufficient credits or materials'
            : opt.desc;
        btn.onclick = () => {
          const res = state.shipSystem.install(opt.id);
          this.game.ui.notify(res.ok ? 'Module installed' : 'Cannot install', res.ok ? opt.name : res.reason, res.ok ? 'good' : 'warn');
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
    svc.appendChild(h('h3', null, 'Services'));
    if (station) {
      const repairCost = Math.ceil((state.ship.maxHull - state.ship.hull) * 12);
      const fuelCost = Math.ceil((state.ship.maxFuel - state.ship.fuel) * state.ftl.fuelPrice(station.owner));
      const actions = h('div', 'btn-row');
      const repair = h('button', 'btn', `REPAIR HULL (¢${repairCost.toLocaleString()})`);
      repair.disabled = state.ship.hull >= state.ship.maxHull || state.player.credits < repairCost;
      repair.onclick = () => {
        if (state.player.credits < repairCost) return;
        state.player.credits -= repairCost;
        state.ship.repair(state.ship.maxHull);
        this.game.ui.notify('Repaired', 'Hull restored to full integrity.', 'good');
        this.open('ship');
      };
      const refuel = h('button', 'btn', `REFUEL (¢${fuelCost.toLocaleString()})`);
      refuel.disabled = state.ship.fuel >= state.ship.maxFuel || state.player.credits < fuelCost;
      refuel.onclick = () => {
        if (state.player.credits < fuelCost) return;
        state.player.credits -= fuelCost;
        state.ship.fuel = state.ship.maxFuel;
        this.game.ui.notify('Refuelled', 'Tanks full.', 'good');
        this.open('ship');
      };
      actions.append(repair, refuel);
      svc.appendChild(h('div', 'card-sub', `Docked services available at ${station.name}.`));
      svc.appendChild(actions);
    } else {
      svc.appendChild(h('div', 'card-sub', 'No station in range. Dock at a station for repairs and refuelling.'));
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
    const panel = this._frame('CARGO & RESOURCES', `${state.resources.used} / ${state.resources.capacity} t · ¢${state.player.credits.toLocaleString()}`);
    const body = panel._body;

    const civId = this._nearbyStation()?.owner ?? 'terranConcord';
    const civ = state.civs.get(civId);

    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, `Manifest — market: ${civ?.name ?? 'unknown'}`));
    const manifest = state.resources.manifest();
    if (!manifest.length) {
      sec.appendChild(h('div', 'card-sub', 'Hold is empty. Mine asteroids or surface deposits.'));
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
      nameWrap.append(dot, h('span', null, item.name));
      t.append(nameWrap, h('span', null, `${item.qty} t`));
      c.appendChild(t);
      const price = state.resources.price(item.id, civId);
      c.appendChild(h('div', 'card-sub', `${item.category} · market ¢${price}/t · hold value ¢${(price * item.qty).toLocaleString()}`));
      const actions = h('div', 'btn-row');
      const sellAll = h('button', 'btn small primary', `SELL ALL (¢${(price * item.qty * 0.8).toLocaleString()})`);
      sellAll.onclick = () => {
        const res = state.resources.sell(item.id, item.qty, civId);
        this.game.ui.notify('Sold', `${item.name} x${res.price ? Math.round(res.price / Math.max(1, price * 0.8)) : 0} for ¢${res.price?.toLocaleString()}`, 'good');
        this.open('cargo');
      };
      const sell10 = h('button', 'btn small', 'SELL 10');
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
    mkt.appendChild(h('h3', null, 'Available for purchase'));
    const offers = state.civs.market(civId);
    for (const offer of offers.slice(0, 8)) {
      const c = h('div', 'card');
      const t = h('div', 'card-title');
      t.append(h('span', null, offer.name), h('span', null, `¢${offer.price}/t`));
      c.appendChild(t);
      c.appendChild(h('div', 'card-sub', `${offer.category} · demand: ${offer.demand} · stock ${offer.stock}t · you hold ${offer.playerHas}t`));
      const actions = h('div', 'btn-row');
      const buy10 = h('button', 'btn small', 'BUY 10');
      buy10.onclick = () => {
        const res = state.resources.buy(offer.id, 10, civId);
        this.game.ui.notify(res.ok ? 'Purchased' : 'Cannot buy', res.ok ? `${offer.name} x10 for ¢${res.price.toLocaleString()}` : res.reason, res.ok ? 'good' : 'warn');
        this.open('cargo');
      };
      const buy50 = h('button', 'btn small', 'BUY 50');
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
    const panel = this._frame('MISSIONS', `${state.quests.active.length} active · ${state.quests.completed.length} complete`);
    const body = panel._body;

    const avail = state.quests.available();
    if (avail.length) {
      const sec = h('div', 'panel-section');
      sec.appendChild(h('h3', null, 'Available contracts'));
      for (const q of avail) {
        const c = card(q.title, `${q.giver} · ${q.category}`, q.description);
        const btn = h('button', 'btn small primary', 'ACCEPT');
        btn.onclick = () => {
          const res = state.quests.start(q.id);
          this.game.ui.notify(res.ok ? 'Contract accepted' : 'Cannot accept', res.ok ? q.title : res.reason, res.ok ? 'good' : 'warn');
          this.open('missions');
        };
        c.appendChild(btn);
        sec.appendChild(c);
      }
      body.appendChild(sec);
    }

    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, 'Active'));
    if (!state.quests.active.length) sec.appendChild(h('div', 'card-sub', 'No active missions. Speak to civilisations at stations to find work.'));
    for (const q of state.quests.active) {
      const c = card(q.title, `${q.giver} · ${q.chain}`, q.description);
      for (const o of state.quests.describe(q)) {
        const line = h('div', 'row');
        line.appendChild(h('span', 'k', o.done ? '✔' : '○'));
        line.appendChild(h('span', 'v', `${o.text}${o.progress ? ` (${o.progress})` : ''}${o.target ? ` — ${o.target}` : ''}`));
        c.appendChild(line);
      }
      const r = q.rewards ?? {};
      const rew = [];
      if (r.credits) rew.push(`¢${r.credits.toLocaleString()}`);
      if (r.research) rew.push(`${r.research} research`);
      if (r.xp) rew.push(`${r.xp} XP`);
      if (r.resources) rew.push(Object.entries(r.resources).map(([k, v]) => `${v} ${k}`).join(', '));
      c.appendChild(h('div', 'card-sub', `Rewards: ${rew.join(' · ') || '—'}`));
      const btn = h('button', 'btn small danger', 'ABANDON');
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
      done.appendChild(h('h3', null, 'Completed'));
      for (const q of state.quests.completed) {
        done.appendChild(card(q.title, q.giver ?? '', q.description ?? ''));
      }
      body.appendChild(done);
    }
    return panel;
  }

  // ---------------------------------------------------------------- Tech
  _tech() {
    const state = this.state;
    const panel = this._frame('TECHNOLOGY', `${state.research.points.toLocaleString()} research points · ${state.research.completed.length} known`);
    const body = panel._body;
    const tree = state.tech.tree();

    const CAT_NAMES = {
      energy: 'Energy', propulsion: 'Propulsion', materials: 'Materials', weapons: 'Weapons & Shields',
      ai: 'Artificial Intelligence', quantum: 'Quantum Technology', biotech: 'Biotechnology',
      spatial: 'Spatial Technology', civilization: 'Civilisation Technology', unknown: 'Unknown Technology',
    };

    for (const [cat, nodes] of Object.entries(tree)) {
      const sec = h('div', 'tech-cat');
      sec.appendChild(h('h3', null, CAT_NAMES[cat] ?? cat));
      for (const n of nodes) {
        const cls = n.researched ? 'done' : n.canResearch ? 'available' : '';
        const c = h('div', `tech-node ${cls}`.trim());
        const title = h('div', 'nm');
        title.append(h('span', null, n.name), h('span', 't', `T${n.tier}`));
        c.appendChild(title);
        c.appendChild(h('div', 'ds', n.desc));
        const costBits = [`${n.cost.research} RP`];
        for (const [id, qty] of Object.entries(n.cost.resources ?? {})) costBits.push(`${qty} ${state.data.resources[id]?.name ?? id}`);
        const costLine = h('div', 'cost', `Cost: ${costBits.join(' · ')}`);
        c.appendChild(costLine);
        if (n.requires?.length) {
          c.appendChild(h('div', 'cost', `Requires: ${n.requires.map((r) => state.tech.nameOf(r)).join(', ')}`));
        }
        if (n.artifactGated && !n.researched) {
          c.appendChild(h('div', 'cost', '◈ Cannot be researched — must be reconstructed from an archaeological artifact.'));
        }
        if (!n.researched) {
          const btn = h('button', 'btn small', n.canResearch ? 'RESEARCH' : 'LOCKED');
          btn.disabled = !n.canResearch;
          btn.onclick = () => {
            const check = state.tech.canResearch(n.id);
            if (!check.ok) {
              this.game.ui.notify('Cannot research', check.reason, 'warn');
              return;
            }
            const res = state.tech.research(n.id);
            this.game.ui.notify('Technology researched', n.name, 'good');
            this.open('tech');
          };
          c.appendChild(btn);
        } else {
          c.appendChild(h('div', 'cost', '✔ Researched'));
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
    const panel = this._frame('CHARACTER', `${state.player.name} · Level ${state.player.level} · ${state.player.skillPoints} skill point${state.player.skillPoints === 1 ? '' : 's'}`);
    const body = panel._body;
    const tree = state.skills.tree();

    const ARCH_NAMES = {
      explorer: 'Explorer', scientist: 'Scientist', engineer: 'Engineer', archaeologist: 'Archaeologist',
      diplomat: 'Diplomat', soldier: 'Soldier', xenobiologist: 'Xenobiologist', aiResearcher: 'AI Researcher',
    };

    const progress = state.skills.archetypeProgress();
    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, 'Build summary'));
    sec.appendChild(h('div', 'card-sub', Object.keys(progress).length
      ? Object.entries(progress).map(([a, n]) => `${ARCH_NAMES[a] ?? a} ×${n}`).join(' · ')
      : 'No skills learned yet. Hybrid builds are encouraged.'));
    body.appendChild(sec);

    for (const [arch, nodes] of Object.entries(tree)) {
      const sec2 = h('div', 'skill-arch');
      sec2.appendChild(h('h3', null, ARCH_NAMES[arch] ?? arch));
      for (const n of nodes) {
        const cls = n.unlocked ? 'unlocked' : n.canUnlock ? '' : 'locked';
        const c = h('div', `skill-node ${cls}`.trim());
        c.append(h('span', 'tier', `T${n.tier}`));
        const info = h('div');
        info.appendChild(h('div', 'nm', n.name));
        info.appendChild(h('div', 'ds', n.desc));
        c.appendChild(info);
        if (n.unlocked) {
          c.appendChild(h('span', 'tag good', 'LEARNED'));
        } else {
          const btn = h('button', 'btn small', `${n.cost} SP`);
          btn.disabled = !n.canUnlock;
          const check = state.skills.canUnlock(n.id);
          btn.title = check.ok ? 'Unlock this skill' : check.reason;
          btn.onclick = () => {
            const res = state.skills.unlock(n.id);
            this.game.ui.notify(res.ok ? 'Skill learned' : 'Cannot learn', res.ok ? n.name : res.reason, res.ok ? 'good' : 'warn');
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
    const panel = this._frame('ARCHAEOLOGY', `${arch.analyzed.length} analysed · ${arch.collected.length - arch.analyzed.length} awaiting translation`);
    const body = panel._body;

    // Main mystery.
    const mystery = arch.mysteryStage();
    const m = h('div', 'mystery');
    m.appendChild(h('div', 'm-title', mystery.name.toUpperCase()));
    m.appendChild(h('div', 'm-stage', `Current understanding: ${mystery.stage.label}`));
    m.appendChild(h('div', 'm-desc', mystery.summary));
    const stages = h('div', 'm-stages');
    for (const s of mystery.stages) {
      stages.appendChild(h('div', s.reached ? 'on' : ''));
    }
    m.appendChild(stages);
    body.appendChild(m);

    // Inventory.
    const inv = h('div', 'panel-section');
    inv.appendChild(h('h3', null, 'Recovered artifacts'));
    const unanalyzed = arch.collected.filter((i) => !i.analyzed);
    const analyzed = arch.analyzed;
    if (!arch.collected.length) {
      inv.appendChild(h('div', 'card-sub', 'No artifacts recovered. Land at ruin sites and excavate.'));
    }
    for (const inst of unanalyzed) {
      const def = arch.artifactDef(inst.artifactId);
      const c = card(def.name, `${def.type} · ${def.civTag} · tier ${def.tier}`, def.desc);
      const chance = arch.analysisChance(def);
      c.appendChild(h('div', 'card-sub', `Translation confidence: ${(chance * 100).toFixed(0)}%`));
      const btn = h('button', 'btn small primary', 'ANALYSE');
      btn.onclick = () => {
        const res = arch.analyze(inst.uid);
        if (!res.ok) {
          this.game.ui.notify('Cannot analyse', res.reason, 'warn');
          return;
        }
        this.game.ui.showAnalysis(res);
        this.open('archaeology');
      };
      c.appendChild(btn);
      inv.appendChild(c);
    }
    if (analyzed.length) {
      inv.appendChild(h('h3', null, 'Analysed evidence'));
      for (const inst of analyzed) {
        const def = arch.artifactDef(inst.artifactId);
        inv.appendChild(card(def.name, `${def.type} · ${def.civTag}`, def.evidenceText, [{ text: 'ANALYSED', cls: 'good' }]));
      }
    }
    body.appendChild(inv);

    // Hypotheses.
    const hyps = arch.hypotheses();
    if (hyps.length) {
      const sec = h('div', 'panel-section');
      sec.appendChild(h('h3', null, 'Working hypotheses'));
      for (const hyp of hyps) {
        const c = card(hyp.title, `Confidence ${(hyp.confidence * 100).toFixed(0)}%`, hyp.text);
        sec.appendChild(c);
      }
      body.appendChild(sec);
    }

    // Timeline.
    const tl = h('div', 'panel-section');
    tl.appendChild(h('h3', null, 'Reconstructed galactic timeline'));
    for (const era of arch.timeline()) {
      const e = h('div', 'era');
      e.appendChild(h('div', 'era-name', era.name));
      e.appendChild(h('div', 'era-range', `${era.startBya} – ${era.endBya} billion years ago · ${era.known}/${era.events.length} events reconstructed`));
      e.appendChild(h('div', 'era-desc', era.desc));
      for (const ev of era.events) {
        if (ev.status === 'unknown') continue;
        const ec = h('div', `event ${ev.status}`);
        const title = h('div', 'ev-title');
        title.append(h('span', null, ev.title), h('span', 'ev-state', ev.status === 'confirmed' ? 'CONFIRMED' : 'HYPOTHESIS'));
        ec.appendChild(title);
        ec.appendChild(h('div', 'ev-text', ev.summary));
        ec.appendChild(h('div', 'ev-ev', `Evidence: ${ev.evidenceNames.join(', ')}`));
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
    const panel = this._frame('CIVILISATION DATABASE', `${state.civs.discovered().length} contacted`);
    const body = panel._body;

    const sec = h('div', 'panel-section');
    sec.appendChild(h('h3', null, 'Living civilisations'));
    for (const civ of state.civs.all()) {
      const tpl = civ.template;
      const c = card(
        civ.name,
        `Tech level ${tpl.techLevel} · ${tpl.government} · reputation: ${state.civs.reputationLabel(civ.id)} (${civ.reputation > 0 ? '+' : ''}${civ.reputation.toFixed(2)})`,
        tpl.background
      );
      c.appendChild(h('div', 'card-text', `Philosophy: ${tpl.philosophy}`));
      const tags = [];
      for (const t of tpl.traits ?? []) tags.push({ text: t, cls: '' });
      if (civ.warWith?.length) tags.push({ text: `AT WAR: ${civ.warWith.join(', ')}`, cls: 'bad' });
      if (civ.alliedWith?.length) tags.push({ text: `ALLIED: ${civ.alliedWith.join(', ')}`, cls: 'good' });
      if (civ.politics && civ.politics !== 'stable') tags.push({ text: civ.politics.toUpperCase(), cls: 'warn' });
      const tagRow = h('div');
      for (const t of tags) tagRow.appendChild(h('span', `tag ${t.cls}`.trim(), t.text));
      c.appendChild(tagRow);
      c.appendChild(h('div', 'card-text', `Existential problem: ${tpl.existentialProblem}`));
      c.appendChild(h('div', 'card-sub', `Known systems: ${civ.knownSystemIds.length} · language: ${tpl.language.family}`));
      if (civ.met) {
        const btn = h('button', 'btn small', 'OPEN DIALOGUE');
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
    ext.appendChild(h('h3', null, 'Extinct civilisations (archaeological record)'));
    for (const civ of state.civs.extinct()) {
      const events = state.archaeology.eventRecords().filter((e) => e.status !== 'unknown' && e.era === civ.era);
      ext.appendChild(card(
        civ.name,
        `${civ.bya} billion years ago · signature: ${civ.signature}`,
        civ.desc,
        events.length ? [{ text: `${events.length} timeline event(s) reconstructed`, cls: 'accent' }] : [{ text: 'NO EVIDENCE RECOVERED', cls: 'warn' }]
      ));
    }
    body.appendChild(ext);
    return panel;
  }

  // ---------------------------------------------------------------- Archive
  _archive() {
    const state = this.state;
    const counts = state.archive.counts();
    const panel = this._frame('GALACTIC CIVILIZATION ARCHIVE', `${state.archive.total} entries recorded`);
    const body = panel._body;

    const overview = h('div', 'panel-section');
    overview.appendChild(h('h3', null, 'Encyclopedia coverage'));
    const grid = h('div', 'grid three');
    for (const [cat, label] of Object.entries(CATEGORY_LABELS)) {
      const c = h('div', 'res-chip');
      c.append(h('span', null, label), h('span', 'qty', String(counts[cat] ?? 0)));
      grid.appendChild(c);
    }
    overview.appendChild(grid);
    overview.appendChild(h('div', 'card-sub', 'Every civilisation, species, planet, star, artifact, ruin, historical event, anomaly and phenomenon you have encountered is preserved here permanently.'));
    body.appendChild(overview);

    for (const cat of Object.keys(CATEGORY_LABELS)) {
      const entries = state.archive.byCategory(cat);
      if (!entries.length) continue;
      const sec = h('div', 'panel-section');
      sec.appendChild(h('h3', null, `${CATEGORY_LABELS[cat]} (${entries.length})`));
      for (const e of entries) {
        sec.appendChild(card(e.name, `Recorded SD ${e.discoveredAt?.toFixed?.(1) ?? e.discoveredAt}`, e.summary));
      }
      body.appendChild(sec);
    }
    return panel;
  }

  // ---------------------------------------------------------------- System map
  _systemMap() {
    const state = this.state;
    const sys = state.location.system;
    const panel = this._frame('SYSTEM MAP', sys ? sys.name : '—');
    const body = panel._body;

    if (!sys) {
      body.appendChild(h('div', 'card-sub', 'No system loaded.'));
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
    sec.appendChild(h('h3', null, 'System bodies'));
    const starCard = card(sys.star.name, `${sys.star.classLabel} · ${sys.star.temp}K · ${sys.star.mass.toFixed(2)} M☉ · age ${sys.star.ageGyr.toFixed(1)} Gyr`, sys.summary);
    sec.appendChild(starCard);
    for (const p of sys.planets) {
      const c = card(p.name, `${p.typeLabel} · ${p.orbitAu.toFixed(2)} AU · ${p.tempK.toFixed(0)}K · ${p.gravity.toFixed(2)}g`, p.description);
      const tags = [];
      if (p.life) tags.push({ text: 'LIFE', cls: 'good' });
      if (p.breathable) tags.push({ text: 'BREATHABLE', cls: 'good' });
      if (p.tidallyLocked) tags.push({ text: 'TIDALLY LOCKED', cls: 'warn' });
      if (p.ruinSiteIds.length) tags.push({ text: `${p.ruinSiteIds.length} RUIN(S)`, cls: 'accent' });
      if (p.ring) tags.push({ text: 'RINGED', cls: '' });
      if (!p.landable) tags.push({ text: 'NOT LANDABLE', cls: 'bad' });
      const tagRow = h('div');
      for (const t of tags) tagRow.appendChild(h('span', `tag ${t.cls}`.trim(), t.text));
      c.appendChild(tagRow);
      c.appendChild(h('div', 'card-sub', `Resources: ${p.resources.map((r) => `${r.id} ×${r.quantity}`).join(', ')}`));
      sec.appendChild(c);
    }
    for (const s of sys.stations) {
      sec.appendChild(card(s.name, `${s.kind} · ${s.orbitAu.toFixed(2)} AU${s.derelict ? ' · DERELICT' : ''}`, `Owner: ${s.owner ?? 'none'}`));
    }
    for (const r of sys.ruins) {
      sec.appendChild(card(r.name, `${r.size} ruin · attributed to ${r.civTag} · age ${r.ageGyr.toFixed(1)} Gyr`, r.description, [{ text: r.scanned ? 'SCANNED' : 'UNSCANNED', cls: r.scanned ? 'good' : 'warn' }]));
    }
    for (const a of sys.anomalies) {
      sec.appendChild(card(a.name, `Anomaly (${a.kind}) · hazard ${(a.hazard * 100).toFixed(0)}%`, `Resources: ${a.resources.join(', ')}`));
    }
    body.appendChild(sec);
    return panel;
  }
}
