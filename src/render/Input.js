/**
 * Input: keyboard + mouse with pointer lock, plus edge detection.
 * A single instance is shared by every game state.
 */
export class Input {
  constructor(element) {
    this.element = element;
    this.keys = new Set();
    this.pressed = new Set();
    this.released = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.buttons = new Set();
    this.clicked = new Set();
    this.pointerLocked = false;
    this.enabled = true;
    this.clientX = 0;
    this.clientY = 0;
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onKeyUp = this._onKeyUp.bind(this);
    this._onMouseMove = this._onMouseMove.bind(this);
    this._onMouseDown = this._onMouseDown.bind(this);
    this._onMouseUp = this._onMouseUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._onLockChange = this._onLockChange.bind(this);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('mousemove', this._onMouseMove);
    element.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    element.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('pointerlockchange', this._onLockChange);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('mousemove', this._onMouseMove);
    this.element.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.element.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('pointerlockchange', this._onLockChange);
  }

  _onKeyDown(e) {
    if (!this.enabled) return;
    // Never steal keys from UI inputs.
    const tag = (e.target?.tagName ?? '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || e.target?.isContentEditable) return;
    if (!this.keys.has(e.code)) this.pressed.add(e.code);
    this.keys.add(e.code);
    if (['Space', 'Tab', 'F5', 'Slash'].includes(e.code)) e.preventDefault();
  }

  _onKeyUp(e) {
    this.keys.delete(e.code);
    this.released.add(e.code);
  }

  _onMouseMove(e) {
    this.clientX = e.clientX;
    this.clientY = e.clientY;
    if (this.pointerLocked) {
      this.mouseDX += e.movementX ?? 0;
      this.mouseDY += e.movementY ?? 0;
    }
  }

  _onMouseDown(e) {
    if (!this.enabled) return;
    this.buttons.add(e.button);
    this.clicked.add(e.button);
  }

  _onMouseUp(e) {
    this.buttons.delete(e.button);
  }

  _onWheel(e) {
    if (!this.enabled) return;
    this.wheel += e.deltaY;
    e.preventDefault();
  }

  _onLockChange() {
    this.pointerLocked = document.pointerLockElement === this.element;
  }

  requestPointerLock() {
    if (!this.pointerLocked) this.element.requestPointerLock?.();
  }

  exitPointerLock() {
    if (this.pointerLocked) document.exitPointerLock?.();
  }

  isDown(code) {
    return this.keys.has(code);
  }

  anyDown(...codes) {
    return codes.some((c) => this.keys.has(c));
  }

  justPressed(code) {
    return this.pressed.has(code);
  }

  justClicked(button = 0) {
    return this.clicked.has(button);
  }

  /** Call at the end of every frame. */
  endFrame() {
    this.pressed.clear();
    this.released.clear();
    this.clicked.clear();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
  }
}
