/**
 * Data loader for the JSON content packs in /data.
 *
 * Content is data-driven: resources, technologies, skills, ship modules,
 * civilisation templates, species, artifacts, quests, regions, the galactic
 * timeline and dynamic events all live in JSON so designers can extend the
 * game without touching engine code.
 *
 * In the browser this fetches the files; under Node (unit tests) it falls back
 * to reading from disk, so the exact same data is exercised everywhere. The
 * Node-only modules are imported dynamically so this file stays browser-safe.
 */
const isNode = typeof process !== 'undefined' && !!process.versions?.node;

let fs = null;
let path = null;
let fileURLToPath = null;
let DATA_DIR = null;

if (isNode) {
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const urlMod = await import('node:url');
  fs = fsMod.default ?? fsMod;
  path = pathMod.default ?? pathMod;
  fileURLToPath = urlMod.fileURLToPath;
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  DATA_DIR = path.resolve(__dirname, '../../data');
}

/** Load and parse a JSON data file (cached). */
export async function loadData(name) {
  const file = name.endsWith('.json') ? name : `${name}.json`;
  if (loadData._cache.has(file)) return loadData._cache.get(file);
  let text;
  if (isNode) {
    text = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
  } else {
    const res = await fetch(`data/${file}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load data/${file}: ${res.status}`);
    text = await res.text();
  }
  const json = JSON.parse(text);
  loadData._cache.set(file, json);
  return json;
}
loadData._cache = new Map();

/** Load every data pack the game needs. */
/** Recursively drop documentation-only keys so packs stay authorable. */
function stripDocs(node) {
  if (Array.isArray(node)) {
    for (const item of node) stripDocs(item);
  } else if (node && typeof node === 'object') {
    for (const key of Object.keys(node)) {
      if (key.startsWith('_')) delete node[key];
      else stripDocs(node[key]);
    }
  }
}

export async function loadAllData() {
  const names = [
    'regions',
    'resources',
    'technologies',
    'skills',
    'shipModules',
    'civilizations',
    'species',
    'artifacts',
    'quests',
    'timeline',
    'events',
  ];
  const out = {};
  await Promise.all(names.map(async (n) => { out[n] = await loadData(n); }));
  // Strip documentation keys (`_comment`, `_notes`, ...) so content authors can
  // annotate packs without leaking into the simulation.
  for (const n of Object.keys(out)) stripDocs(out[n]);
  // Normalise wrappers so consumers always get arrays/objects directly.
  out.regions = out.regions.regions;
  return out;
}

/**
 * Load the interface dictionaries plus the per-locale content packs.
 * Returns `{ en: {...}, zh: {...} }`, ready for `i18n.load()`.
 *
 * English has no separate content pack: the data files themselves are the
 * English source, and `i18n.content()` falls back to them.
 */
export async function loadI18nPacks() {
  const locales = ['en', 'zh'];
  const packs = {};
  await Promise.all(locales.map(async (loc) => {
    const ui = await loadData(`i18n/${loc}`);
    const merged = { ...ui };
    try {
      const content = await loadData(`i18n/content/${loc}`);
      Object.assign(merged, content);
    } catch {
      /* no content pack for this locale: data files stay the source */
    }
    packs[loc] = merged;
  }));
  return packs;
}
