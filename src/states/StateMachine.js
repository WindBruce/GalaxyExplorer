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

  change(name, payload = null) {
    if (this.currentName === name) return;
    const next = this.states.get(name);
    if (!next) {
      console.error(`[StateMachine] unknown state "${name}"`);
      return;
    }
    if (this.current?.exit) this.current.exit();
    this.currentName = name;
    this.current = next;
    if (next.enter) next.enter(payload);
    this.game.bus.emit('state:changed', { name, payload });
  }

  update(dt) {
    this.current?.update?.(dt);
  }
}
