/** Minimal typed event bus used for cross-system communication. */
export class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this._map = new Map();
  }

  on(type, fn) {
    if (!this._map.has(type)) this._map.set(type, new Set());
    this._map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off(type, fn) {
    this._map.get(type)?.delete(fn);
  }

  emit(type, payload) {
    const set = this._map.get(type);
    if (set) {
      for (const fn of [...set]) {
        try {
          fn(payload);
        } catch (err) {
          console.error(`[EventBus] listener for "${type}" failed:`, err);
        }
      }
    }
    // Wildcard listeners (used by the debug console / telemetry).
    const all = this._map.get('*');
    if (all) {
      for (const fn of [...all]) {
        try {
          fn({ type, payload });
        } catch (err) {
          console.error('[EventBus] wildcard listener failed:', err);
        }
      }
    }
  }

  clear() {
    this._map.clear();
  }
}

/** Global bus shared by all systems and UI. */
export const bus = new EventBus();
