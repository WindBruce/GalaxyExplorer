/**
 * Modals: dialogue trees, dynamic event choices, station services, trade,
 * analysis results and generic information dialogs.
 */
function h(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined && text !== null) e.textContent = text;
  return e;
}

export class Modals {
  constructor(game) {
    this.game = game;
    this.i18n = game.i18n;
    this.root = document.getElementById('modal-root');
    this.current = null;
    this._dialogue = null;
    game.bus.on('ui:openTrade', ({ civId }) => this.openTrade(civId));
  }

  get state() {
    return this.game.state;
  }

  close() {
    this.root.innerHTML = '';
    this.root.classList.add('hidden');
    this.current = null;
    this._dialogue = null;
    if (this.game.state?.location?.mode === 'space') this.game.input.requestPointerLock();
  }

  isOpen() {
    return !this.root.classList.contains('hidden');
  }

  /** Generic modal. choices: [{text, disabled, onClick}] */
  open({ title, sub, paragraphs = [], choices = [], onClose = null, wide = false, rerender = null }) {
    this.root.innerHTML = '';
    const modal = h('div', 'modal');
    if (wide) modal.style.width = 'min(880px, 96vw)';
    const head = h('div', 'modal-head');
    head.append(h('div', 'm-title', title), h('div', 'm-sub', sub ?? ''));
    modal.appendChild(head);
    const body = h('div', 'modal-body');
    for (const p of paragraphs) {
      if (typeof p === 'string') body.appendChild(h('p', null, p));
      else body.appendChild(p);
    }
    modal.appendChild(body);
    if (choices.length) {
      const foot = h('div', 'modal-foot');
      for (const c of choices) {
        const btn = h('button', 'choice');
        btn.append(h('span', 'arrow', '▸'), h('span', null, c.text));
        if (c.disabled) btn.disabled = true;
        btn.onclick = () => c.onClick?.();
        foot.appendChild(btn);
      }
      modal.appendChild(foot);
    }
    this.root.appendChild(modal);
    this.root.classList.remove('hidden');
    // Keep the full spec so a language switch can rebuild the same modal.
    this.current = { title, sub, paragraphs, choices, onClose, wide, rerender };
    this.game.input.exitPointerLock();
    return modal;
  }

  // ---------------------------------------------------------------- Dialogue
  openDialogue(civId) {
    const civ = this.state.civs.meet(civId);
    if (!civ) return;
    const tree = civ.template.dialogue;
    this._dialogue = { civId, tree, nodeId: tree.greet ? 'greet' : Object.keys(tree)[0] };
    this._renderDialogue();
  }

  _renderDialogue() {
    const d = this._dialogue;
    if (!d) return;
    const civ = this.state.civs.get(d.civId);
    const node = d.tree[d.nodeId];
    if (!node || d.nodeId === 'END') {
      this.state.bus.emit('dialogue:end', { civId: d.civId });
      this.close();
      return;
    }
    const choices = (node.options ?? []).map((opt, i) => ({
      text: this.i18n.content('dialogue', `${d.civId}.${d.nodeId}`, opt.text, `option.${i}`),
      disabled: !this._optionAvailable(opt, civ),
      onClick: () => {
        if (opt.effects) this._applyDialogueEffects(opt.effects, d.civId);
        if (opt.next === 'END') {
          this.state.bus.emit('dialogue:end', { civId: d.civId });
          this.close();
        } else {
          d.nodeId = opt.next;
          this._renderDialogue();
        }
      },
    }));
    this.open({
      title: this.i18n.content('civilization', civ.id, civ.name, 'name'),
      sub: `${this.i18n.content('civilization', civ.id, civ.template.government, 'government')} · ${this.state.civs.reputationLabel(d.civId)}`,
      paragraphs: [this.i18n.content('dialogue', `${d.civId}.${d.nodeId}`, node.text)],
      choices,
      rerender: () => this._renderDialogue(),
    });
  }

  _optionAvailable(opt, civ) {
    const req = opt.requires ?? {};
    if (req.capability) {
      const caps = [...this.state.tech.capabilities(), ...this.state.skills.getEffects().capabilities];
      if (!caps.includes(req.capability)) return false;
    }
    if (req.reputation !== undefined && civ.reputation < req.reputation) return false;
    if (req.flag && !this.state.flags[req.flag]) return false;
    return true;
  }

  _applyDialogueEffects(effects, civId) {
    if (typeof effects.reputation === 'number') {
      this.state.civs.adjustReputation(civId, effects.reputation);
    }
    const out = this.state.civs.applyEffects(effects);
    for (const r of out) {
      if (r.type === 'credits' && r.amount < 0) {
        this.game.ui.notify(
          this.i18n.t('notify.creditsSpent'),
          this.i18n.t('missions.rewardCredits', { n: Math.abs(r.amount).toLocaleString() }),
          'info'
        );
      }
    }
  }

  // ---------------------------------------------------------------- Events
  showEvent(ev) {
    const T = (k, v) => this.i18n.t(k, v);
    const title = this.i18n.content('event', ev.id, ev.title, 'title');
    const text = this.i18n.content('event', ev.id, ev.text, 'text');
    this.open({
      title,
      sub: T('modal.incoming'),
      paragraphs: [text, '—'],
      choices: ev.choices.map((c, i) => ({
        text: this.i18n.content('event', ev.id, c.text, `choice.${i}`),
        onClick: () => {
          const res = this.state.events.choose(i);
          this.open({
            title,
            sub: T('modal.outcome'),
            paragraphs: [this.i18n.content('event', ev.id, res.outcome ?? '', `outcome.${i}`)],
            choices: [{ text: T('modal.acknowledge'), onClick: () => this.close() }],
          });
        },
      })),
      rerender: () => this.showEvent(ev),
    });
    this.game.narrate(`${title}. ${text}`);
  }

  // ---------------------------------------------------------------- Station
  showStation(station) {
    const state = this.state;
    const T = (k, v) => this.i18n.t(k, v);
    const civ = station.owner ? state.civs.get(station.owner) : null;
    const civName = civ ? this.i18n.content('civilization', civ.id, civ.name, 'name') : null;
    const kind = this.i18n.t(`label.stationkind.${station.kind}`, {});
    const paragraphs = [
      `${kind}${station.derelict ? ` — ${T('modal.derelict')}` : ''}`,
      station.derelict
        ? T('modal.derelictText')
        : T('modal.operated', { name: civName ?? T('modal.unlisted') }),
    ];
    const choices = [];
    if (!station.derelict) {
      choices.push({
        text: T('modal.tradeWith', { name: civName ?? T('modal.tradeWithStation') }),
        onClick: () => this.openTrade(station.owner ?? 'terranConcord', station),
      });
      choices.push({
        text: T('modal.refuelRepair'),
        onClick: () => {
          const repair = Math.ceil((state.ship.maxHull - state.ship.hull) * 12);
          const fuel = Math.ceil((state.ship.maxFuel - state.ship.fuel) * state.ftl.fuelPrice(station.owner));
          const total = repair + fuel;
          if (state.player.credits < total) {
            this.open({
              title: T('modal.insufficient'),
              sub: T('modal.refused'),
              paragraphs: [T('modal.costLine', {
                total: total.toLocaleString(), have: state.player.credits.toLocaleString(),
              })],
              choices: [{ text: T('modal.back'), onClick: () => this.showStation(station) }],
            });
            return;
          }
          state.player.credits -= total;
          state.ship.repair(state.ship.maxHull);
          state.ship.fuel = state.ship.maxFuel;
          this.open({
            title: T('modal.serviced'),
            sub: T('modal.charged', { n: total.toLocaleString() }),
            paragraphs: [T('modal.servicedText')],
            choices: [{ text: T('modal.undock'), onClick: () => this.close() }],
          });
        },
      });
      if (civ) {
        choices.push({
          text: T('modal.speakWith', { name: civName }),
          onClick: () => this.openDialogue(civ.id),
        });
      }
    } else {
      choices.push({
        text: T('modal.salvage'),
        onClick: () => {
          const rng = Math.random();
          const loot = [
            { id: 'iron', quantity: 60 + Math.floor(rng * 120) },
            { id: 'hydrogen', quantity: 40 + Math.floor(rng * 80) },
          ];
          if (rng > 0.5) loot.push({ id: 'superconductor', quantity: 10 + Math.floor(rng * 25) });
          const got = [];
          for (const l of loot) {
            const stored = state.resources.add(l.id, l.quantity);
            if (stored > 0) got.push(T('modal.gain', {
              name: this.i18n.content('resource', l.id, state.data.resources[l.id]?.name ?? l.id),
              qty: stored,
            }));
          }
          if (rng > 0.75) {
            const def = state.archaeology.catalog[Math.floor(Math.random() * state.archaeology.catalog.length)];
            state.archaeology.collect(def.id, state.location.systemId, station.id);
            got.push(T('modal.artifact', {
              name: this.i18n.content('artifact', def.id, def.name, 'name'),
            }));
          }
          this.open({
            title: T('modal.salvageTitle'),
            sub: station.name,
            paragraphs: [got.length
              ? T('modal.salvageText', { list: got.join(', ') })
              : T('modal.stripped')],
            choices: [{ text: T('modal.undock'), onClick: () => this.close() }],
          });
        },
      });
    }
    choices.push({ text: T('modal.undock'), onClick: () => this.close() });
    this.open({
      title: station.name,
      sub: T('modal.station'),
      paragraphs,
      choices,
      rerender: () => this.showStation(station),
    });
  }

  // ---------------------------------------------------------------- Trade
  openTrade(civId, station = null) {
    const civ = this.state.civs.get(civId);
    if (!civ) return;
    this._trade = { civId, station };
    this._renderTrade();
  }

  _renderTrade() {
    const state = this.state;
    const T = (k, v) => this.i18n.t(k, v);
    const { civId, station } = this._trade;
    const civ = state.civs.get(civId);
    const offers = state.civs.market(civId);
    const manifest = state.resources.manifest();

    const table = h('div');
    const head = h('div', 'trade-row head');
    ['trade.resource', 'trade.price', 'trade.stock', 'trade.youHold', 'trade.action']
      .forEach((k) => head.appendChild(h('span', null, this.i18n.t(k))));
    table.appendChild(head);

    const rows = [
      ...offers.slice(0, 7).map((o) => ({ ...o, kind: 'buy' })),
      ...manifest.map((m) => ({ ...m, kind: 'sell', price: state.resources.price(m.id, civId) })),
    ];
    for (const item of rows) {
      const r = h('div', 'trade-row');
      r.appendChild(h('span', null, this.i18n.content('resource', item.id, item.name)));
      r.appendChild(h('span', null, T('missions.rewardCredits', { n: item.price })));
      r.appendChild(h('span', null, item.kind === 'buy' ? `${item.stock}t` : T('trade.dash')));
      r.appendChild(h('span', null, `${item.qty ?? item.playerHas ?? 0}t`));
      const btn = h('button', 'btn small', item.kind === 'buy' ? T('cargo.buy10') : T('cargo.sell10'));
      btn.onclick = () => {
        const res = item.kind === 'buy'
          ? state.resources.buy(item.id, 10, civId)
          : state.resources.sell(item.id, 10, civId);
        this.game.ui.notify(
          res.ok ? (item.kind === 'buy' ? T('notify.purchased') : T('notify.sold')) : T('notify.failed'),
          res.ok
            ? `${this.i18n.content('resource', item.id, item.name)} — ${T('missions.rewardCredits', { n: res.price.toLocaleString() })}`
            : this.i18n.reason(res),
          res.ok ? 'good' : 'warn'
        );
        this._renderTrade();
      };
      r.appendChild(btn);
      table.appendChild(r);
    }

    this.open({
      title: T('modal.tradeTitle', {
        civ: this.i18n.content('civilization', civId, civ.name, 'name'),
      }),
      sub: station ? station.name : T('modal.remote'),
      paragraphs: [
        T('modal.credits', {
          credits: state.player.credits.toLocaleString(),
          used: state.resources.used, cap: state.resources.capacity,
        }),
        table,
      ],
      choices: [{ text: T('modal.close'), onClick: () => this.close() }],
      wide: true,
      rerender: () => this._renderTrade(),
    });
  }

  // ---------------------------------------------------------------- Analysis
  showAnalysis(res) {
    const T = (k, v) => this.i18n.t(k, v);
    const art = res.artifact ?? {};
    const artName = this.i18n.content('artifact', art.id, art.name, 'name');
    const paragraphs = [T('analysis.artifact', {
      name: artName, type: T(`label.artifacttype.${art.type}`, {}), tier: art.tier,
    })];
    if (res.success) {
      paragraphs.push(T('analysis.success'));
      paragraphs.push(this.i18n.content('artifact', art.id, res.reading, 'evidenceText'));
      if (res.newEvents.length) {
        const titles = res.newEvents.map((e) => {
          const ev = this.state.data.timeline.events.find((x) => x.id === e);
          return this.i18n.content('timeline', 'event.' + e, ev?.title ?? e, 'title');
        });
        paragraphs.push(T('analysis.newHypothesis', { titles: titles.join(', ') }));
      }
      if (res.confirmedEvents.length) {
        const titles = res.confirmedEvents.map((e) => {
          const ev = this.state.data.timeline.events.find((x) => x.id === e);
          return this.i18n.content('timeline', 'event.' + e, ev?.title ?? e, 'title');
        });
        paragraphs.push(T('analysis.confirmed', { titles: titles.join(', ') }));
      }
      if (res.techUnlocked) {
        paragraphs.push(T('analysis.tech', {
          name: this.i18n.content('technology', res.techUnlocked.id, res.techUnlocked.name, 'name'),
        }));
      }
      paragraphs.push(T('analysis.rp', { n: res.researchGain }));
    } else {
      paragraphs.push(T('analysis.failed'));
      paragraphs.push(this.i18n.content('artifact', art.id, res.reading, 'evidenceText'));
    }
    this.open({
      title: T('analysis.title'),
      sub: res.success ? T('analysis.decoded') : T('analysis.partial'),
      paragraphs,
      choices: [{ text: T('analysis.file'), onClick: () => this.close() }],
      rerender: () => this.showAnalysis(res),
    });
    this.game.narrate(`${T('analysis.title')}: ${artName}. ${paragraphs[paragraphs.length - 1]}`);
  }

  // ---------------------------------------------------------------- Scan result
  showScanResult(body, info) {
    const T = (k, v) => this.i18n.t(k, v);
    const paragraphs = [info];
    const d = body.data;
    if (body.kind === 'planet' && d.landable) paragraphs.push(T('scan.landable'));
    if (body.kind === 'ruin') paragraphs.push(T('scan.ruin'));
    this.open({
      title: body.name,
      sub: (body.label ?? '').toUpperCase(),
      paragraphs,
      choices: [{ text: T('modal.close'), onClick: () => this.close() }],
      rerender: () => this.showScanResult(body, info),
    });
  }
}
