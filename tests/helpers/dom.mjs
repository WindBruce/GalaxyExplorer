/**
 * Shared test helper: install a jsdom DOM (plus a 2D canvas stub) as Node
 * globals so browser-facing modules can be exercised headlessly. Returns null
 * when jsdom is unavailable, which lets suites skip themselves.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function loadJsdom() {
  const candidates = ['/tmp/node_modules/jsdom/lib/api.js', 'jsdom'];
  for (const spec of candidates) {
    try {
      return (await import(spec)).JSDOM;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

/** Minimal 2D context: enough for gradient-based drawing in the UI and maps. */
export function fake2DContext() {
  const gradient = { addColorStop() {} };
  const ctx = {
    canvas: null,
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createPattern: () => null,
    measureText: () => ({ width: 10 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {},
    drawImage() {},
    fillRect() {}, clearRect() {}, strokeRect() {},
    beginPath() {}, closePath() {}, arc() {}, rect() {}, moveTo() {}, lineTo() {},
    fill() {}, stroke() {}, clip() {}, save() {}, restore() {},
    fillText() {}, strokeText() {},
  };
  return ctx;
}

/**
 * Install a DOM. `html` may be a document string or a path relative to the
 * repo root. Returns { window, restore } or null if jsdom is missing.
 */
export async function installDom(html) {
  const JSDOM = await loadJsdom();
  if (!JSDOM) return null;
  const markup = html.includes('<') ? html : fs.readFileSync(path.join(ROOT, html), 'utf8');
  const dom = new JSDOM(markup, { pretendToBeVisual: true, url: 'http://localhost:8080/' });
  const { window } = dom;

  window.HTMLCanvasElement.prototype.getContext = function (type) {
    if (type !== '2d') return null;
    const ctx = fake2DContext();
    ctx.canvas = this;
    return ctx;
  };
  window.URL.createObjectURL = () => 'blob:fake';
  window.URL.revokeObjectURL = () => {};

  const prev = [];
  const setGlobal = (key, value) => {
    prev.push({ key, desc: Object.getOwnPropertyDescriptor(globalThis, key) });
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true, enumerable: true });
  };
  const globals = {
    window,
    document: window.document,
    navigator: window.navigator,
    localStorage: window.localStorage,
    requestAnimationFrame: window.requestAnimationFrame,
    cancelAnimationFrame: window.cancelAnimationFrame,
    HTMLElement: window.HTMLElement,
    HTMLCanvasElement: window.HTMLCanvasElement,
    Image: window.Image,
    Blob: window.Blob,
    URL: window.URL,
    performance: window.performance,
    getComputedStyle: window.getComputedStyle,
    CustomEvent: window.CustomEvent,
    Event: window.Event,
    MouseEvent: window.MouseEvent,
  };
  for (const [k, v] of Object.entries(globals)) setGlobal(k, v);

  return {
    window,
    restore() {
      for (const { key, desc } of prev.reverse()) {
        if (desc) Object.defineProperty(globalThis, key, desc);
        else delete globalThis[key];
      }
    },
  };
}
