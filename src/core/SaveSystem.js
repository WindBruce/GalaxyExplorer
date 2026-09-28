/**
 * Save/load system.
 *
 * Saves live in localStorage (browser) with three manual slots plus an
 * autosave slot, and can be exported/imported as JSON files. All persistence
 * goes through GameState.serialize(), so the format is versioned by
 * construction.
 */
const PREFIX = 'galaxyexplorer.save.';
export const SLOTS = ['autosave', 'slot1', 'slot2', 'slot3'];

function storage() {
  try {
    if (typeof localStorage !== 'undefined') return localStorage;
  } catch {
    /* access can throw in sandboxed contexts */
  }
  return null;
}

export class SaveSystem {
  constructor() {
    this.lastError = null;
  }

  save(slot, state) {
    const store = storage();
    if (!store) {
      this.lastError = 'localStorage unavailable';
      return { ok: false, reason: this.lastError };
    }
    try {
      const payload = JSON.stringify(state.serialize());
      store.setItem(PREFIX + slot, payload);
      this.lastError = null;
      return { ok: true, slot, bytes: payload.length };
    } catch (err) {
      this.lastError = String(err);
      return { ok: false, reason: this.lastError };
    }
  }

  load(slot, state) {
    const store = storage();
    if (!store) return { ok: false, reason: 'localStorage unavailable' };
    const raw = store.getItem(PREFIX + slot);
    if (!raw) return { ok: false, reason: 'Empty slot' };
    try {
      const parsed = JSON.parse(raw);
      const ok = state.deserialize(parsed);
      return ok ? { ok: true, slot, save: parsed } : { ok: false, reason: 'Corrupt save' };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }

  peek(slot) {
    const store = storage();
    if (!store) return null;
    const raw = store.getItem(PREFIX + slot);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return {
        slot,
        savedAt: parsed.savedAt,
        stardate: parsed.clock?.stardate,
        player: parsed.player?.name,
        level: parsed.player?.level,
        credits: parsed.player?.credits,
        system: parsed.location?.systemId,
        archiveEntries: parsed.archive?.length ?? 0,
        questsCompleted: parsed.quests?.completed?.length ?? 0,
        version: parsed.version,
      };
    } catch {
      return null;
    }
  }

  allSlots() {
    return SLOTS.map((s) => this.peek(s));
  }

  remove(slot) {
    storage()?.removeItem(PREFIX + slot);
  }

  /** Export a save as a downloadable JSON file (browser only). */
  exportFile(state, filename = 'galaxy-explorer-save.json') {
    if (typeof document === 'undefined') return { ok: false, reason: 'Not in a browser' };
    const payload = JSON.stringify(state.serialize(), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    return { ok: true, bytes: payload.length };
  }

  /** Import a save from a JSON string. */
  importJSON(state, text) {
    try {
      const parsed = JSON.parse(text);
      return state.deserialize(parsed) ? { ok: true } : { ok: false, reason: 'Corrupt save' };
    } catch (err) {
      return { ok: false, reason: String(err) };
    }
  }
}

export const saveSystem = new SaveSystem();
