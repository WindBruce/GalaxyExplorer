const STUB = new URL('./three-stub.mjs', import.meta.url).href;

/** Redirect Three.js imports to the WebGL-free stub (except inside the stub). */
export function resolve(specifier, context, next) {
  if (specifier.includes('vendor/three.module.js') && context.parentURL !== STUB) {
    return { url: STUB, shortCircuit: true };
  }
  return next(specifier, context);
}
