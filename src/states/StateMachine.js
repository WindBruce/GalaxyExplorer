/**
 * Minimal state machine. Each state owns a THREE.Group added to the shared
 * scene and exposes enter/exit/update/renderUI.
 */
export class StateMachine {
  constructor(game) {
    this.game = game;
    this.states = new Map();
    this.current = null;
    this.currentName = null;
  }

  register(name, state) {
    this.states.set(name, state);
    return state;
  }

  /**
   * Switch states.
   *
   * `force` re-runs enter() even when the name is unchanged — a save load
   * needs that, because the world changed under the current state.
   *
   * Re-entering the *same* state skips exit(): its enter() rebuilds its own
   * scene, and exiting afterwards would tear down what was just built.
   *
   * A failing enter() is contained: the machine logs once and recovers to the
   * previous state instead of ticking a half-initialised one every frame.
   */
  change(name, payload = null, force = false) {
    if (!force && this.currentName === name) return false;
    const next = this.states.get(name);
    if (!next) {
      console.error(`[StateMachine] unknown state "${name}"`);
      return false;
    }
    const prev = this.current;
    const prevName = this.currentName;
    const same = prev === next;

    if (!same && prev?.exit) {
      try {
        prev.exit();
      } catch (err) {
        console.error(`[StateMachine] failed to exit "${prevName}":`, err);
      }
    }

    if (next.enter) {
      try {
        next.enter(payload ?? undefined);
      } catch (err) {
        console.error(`[StateMachine] failed to enter "${name}":`, err);
        if (prev && !same) {
          // Put the player back where they were if we can.
          try {
            prev.enter?.();
            this.current = prev;
            this.currentName = prevName;
          } catch {
            this.current = null;
            this.currentName = null;
          }
        }
        return false;
      }
    }

    this.currentName = name;
    this.current = next;
    this.game.bus.emit('state:changed', { name, payload });
    return true;
  }

  update(dt) {
    this.current?.update?.(dt);
  }
}
