/**
 * Node has no WebGL. Re-export the real vendored Three.js build and replace
 * only WebGLRenderer with a no-op, so the full Game can be constructed and
 * driven headlessly (everything else — scenes, maths, controls — is pure CPU).
 */
export * from '../../vendor/three.module.js';

export class WebGLRenderer {
  constructor(options = {}) {
    this.domElement = options.canvas ?? {
      addEventListener() {}, removeEventListener() {}, style: {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    };
    this.capabilities = { isWebGL2: true };
    this.info = { render: { calls: 0, triangles: 0 } };
    this.renderCalls = 0;
  }
  setPixelRatio() {}
  setSize() {}
  setClearColor() {}
  clear() {}
  render() { this.renderCalls++; }
  dispose() {}
  forceContextLoss() {}
}
