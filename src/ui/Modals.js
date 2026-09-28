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
  open({ title, sub, paragraphs = [], choices = [], onClose = null, wide = false }) {
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
    this.current = { title, onClose };
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
    const choices = (node.options ?? []).map((opt) => ({
      text: opt.text,
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
      title: civ.name,
      sub: `${civ.template.government} · ${this.state.civs.reputationLabel(d.civId)}`,
      paragraphs: [node.text],
      choices,
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
        this.game.ui.notify('Credits spent', `¢${Math.abs(r.amount).toLocaleString()}`, 'info');
      }
    }
  }

  // ---------------------------------------------------------------- Events
  showEvent(ev) {
    this.open({
      title: ev.title,
      sub: 'INCOMING TRANSMISSION',
      paragraphs: [ev.text, '—'],
      choices: ev.choices.map((c, i) => ({
        text: c.text,
        onClick: () => {
          const res = this.state.events.choose(i);
          this.open({
            title: ev.title,
            sub: 'OUTCOME',
            paragraphs: [res.outcome ?? ''],
            choices: [{ text: 'Acknowledge', onClick: () => this.close() }],
          });
        },
      })),
    });
  }

  // ---------------------------------------------------------------- Station
  showStation(station) {
    const state = this.state;
    const civ = station.owner ? state.civs.get(station.owner) : null;
    const paragraphs = [
      `${station.kind}${station.derelict ? ' — DERELICT' : ''}`,
      station.derelict
        ? 'The station is dark. Life support is offline, but the docking clamp still works and there may be salvage aboard.'
        : `Operated by ${civ?.name ?? 'an unlisted operator'}. Standard services available.`,
    ];
    const choices = [];
    if (!station.derelict) {
      choices.push({ text: `Trade with ${civ?.name ?? 'the station'}`, onClick: () => this.openTrade(station.owner ?? 'terranConcord', station) });
      choices.push({
        text: 'Refuel and repair',
        onClick: () => {
          const repair = Math.ceil((state.ship.maxHull - state.ship.hull) * 12);
          const fuel = Math.ceil((state.ship.maxFuel - state.ship.fuel) * state.ftl.fuelPrice(station.owner));
          const total = repair + fuel;
          if (state.player.credits < total) {
            this.open({
              title: 'Insufficient credits',
              sub: 'REFUSED',
              paragraphs: [`Services cost ¢${total.toLocaleString()}; you hold ¢${state.player.credits.toLocaleString()}.`],
              choices: [{ text: 'Back', onClick: () => this.showStation(station) }],
            });
            return;
          }
          state.player.credits -= total;
          state.ship.repair(state.ship.maxHull);
          state.ship.fuel = state.ship.maxFuel;
          this.open({
            title: 'Serviced',
            sub: `¢${total.toLocaleString()} CHARGED`,
            paragraphs: ['Hull restored to full integrity. Fuel tanks full. The station AI logs your departure without comment.'],
            choices: [{ text: 'Undock', onClick: () => this.close() }],
          });
        },
      });
      if (civ) {
        choices.push({ text: `Speak with ${civ.name} representative`, onClick: () => this.openDialogue(civ.id) });
      }
    } else {
      choices.push({
        text: 'Salvage what you can',
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
            if (stored > 0) got.push(`${state.data.resources[l.id]?.name ?? l.id} +${stored}`);
          }
          if (rng > 0.75) {
            const def = state.archaeology.catalog[Math.floor(Math.random() * state.archaeology.catalog.length)];
            state.archaeology.collect(def.id, state.location.systemId, station.id);
            got.push(`Artifact: ${def.name}`);
          }
          this.open({
            title: 'Salvage recovered',
            sub: station.name,
            paragraphs: [got.length ? `Recovered: ${got.join(', ')}.` : 'The station has already been stripped. Nothing remains but dust patterns in the wrong places.'],
            choices: [{ text: 'Undock', onClick: () => this.close() }],
          });
        },
      });
    }
    choices.push({ text: 'Undock', onClick: () => this.close() });
    this.open({ title: station.name, sub: 'STATION SERVICES', paragraphs, choices });
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
    const { civId, station } = this._trade;
    const civ = state.civs.get(civId);
    const offers = state.civs.market(civId);
    const manifest = state.resources.manifest();

    const table = h('div');
    const head = h('div', 'trade-row head');
    ['Resource', 'Price', 'Stock', 'You hold', 'Action'].forEach((t) => head.appendChild(h('span', null, t)));
    table.appendChild(head);

    const rows = [
      ...offers.slice(0, 7).map((o) => ({ ...o, kind: 'buy' })),
      ...manifest.map((m) => ({ ...m, kind: 'sell', price: state.resources.price(m.id, civId) })),
    ];
    for (const item of rows) {
      const r = h('div', 'trade-row');
      r.appendChild(h('span', null, item.name));
      r.appendChild(h('span', null, `¢${item.price}`));
      r.appendChild(h('span', null, item.kind === 'buy' ? `${item.stock}t` : '—'));
      r.appendChild(h('span', null, `${item.qty ?? item.playerHas ?? 0}t`));
      const btn = h('button', 'btn small', item.kind === 'buy' ? 'BUY 10' : 'SELL 10');
      btn.onclick = () => {
        const res = item.kind === 'buy'
          ? state.resources.buy(item.id, 10, civId)
          : state.resources.sell(item.id, 10, civId);
        this.game.ui.notify(
          res.ok ? (item.kind === 'buy' ? 'Purchased' : 'Sold') : 'Failed',
          res.ok ? `${item.name} — ¢${res.price.toLocaleString()}` : res.reason,
          res.ok ? 'good' : 'warn'
        );
        this._renderTrade();
      };
      r.appendChild(btn);
      table.appendChild(r);
    }

    this.open({
      title: `TRADE — ${civ.name}`,
      sub: station ? station.name : 'remote exchange',
      paragraphs: [
        `Credits: ¢${state.player.credits.toLocaleString()} · Cargo: ${state.resources.used}/${state.resources.capacity} t`,
        table,
      ],
      choices: [{ text: 'Close', onClick: () => this.close() }],
      wide: true,
    });
  }

  // ---------------------------------------------------------------- Analysis
  showAnalysis(res) {
    const paragraphs = [`Artifact: ${res.artifact.name} (${res.artifact.type}, tier ${res.artifact.tier})`];
    if (res.success) {
      paragraphs.push('Translation successful.');
      paragraphs.push(res.reading);
      if (res.newEvents.length) {
        const titles = res.newEvents.map((e) => this.state.data.timeline.events.find((x) => x.id === e)?.title ?? e);
        paragraphs.push(`New hypothesis formed: ${titles.join(', ')}.`);
      }
      if (res.confirmedEvents.length) {
        const titles = res.confirmedEvents.map((e) => this.state.data.timeline.events.find((x) => x.id === e)?.title ?? e);
        paragraphs.push(`CONFIRMED historical event: ${titles.join(', ')}. The timeline has shifted.`);
      }
      if (res.techUnlocked) {
        paragraphs.push(`Technology reconstructed from the artifact: ${res.techUnlocked.name}. It cannot be researched conventionally.`);
      }
      paragraphs.push(`+${res.researchGain} research points`);
    } else {
      paragraphs.push('The inscription resists translation. You have a partial reading only — more evidence, or a better archaeology module, will be required.');
      paragraphs.push(res.reading);
    }
    this.open({
      title: 'ANALYSIS',
      sub: res.success ? 'DECODED' : 'PARTIAL',
      paragraphs,
      choices: [{ text: 'File in archive', onClick: () => this.close() }],
    });
  }

  // ---------------------------------------------------------------- Scan result
  showScanResult(body, info) {
    const paragraphs = [info];
    const d = body.data;
    if (body.kind === 'planet' && d.landable) paragraphs.push('The world is landable.');
    if (body.kind === 'ruin') paragraphs.push('A ruin site. Land on the parent planet and excavate to recover artifacts.');
    this.open({
      title: body.name,
      sub: (body.label ?? '').toUpperCase(),
      paragraphs,
      choices: [{ text: 'Close', onClick: () => this.close() }],
    });
  }
}
