/**
 * Internationalisation.
 *
 * Two locales ship with the game: `en` and `zh` (Simplified Chinese). Dictionaries
 * live in `data/i18n/<locale>.json` and are loaded by DataLoader alongside the
 * other content packs.
 *
 * Usage
 *   i18n.t('panel.ship')                           -> "SHIP STATUS"
 *   i18n.t('map.distance', { ly: 42 })             -> "Distance: 42 ly"
 *   i18n.tp('hud.hostiles', 3, { n: 3 })           -> "3 hostiles" / "3 个敌对目标"
 *   i18n.content('resource', 'iron', 'Iron')       -> translated or the fallback
 *   i18n.reason(result)                            -> translated `reason`
 *
 * `t()` falls back to English and then to the key itself, so a missing entry is
 * visible in testing instead of silently blank. Content that has no translation
 * keeps its authored (English) text via `content()`.
 *
 * The chosen locale is persisted in localStorage and announced on the event bus
 * (`i18n:changed`), which every UI layer listens for and re-renders from.
 */
import { bus } from './EventBus.js';

export const LOCALES = [
  { id: 'en', label: 'English', native: 'English' },
  { id: 'zh', label: 'Chinese', native: '简体中文' },
];

const STORAGE_KEY = 'galaxyexplorer.locale';

function detectLocale() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && LOCALES.some((l) => l.id === stored)) return stored;
  } catch {
    /* storage can be unavailable */
  }
  const langs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const l of langs) {
    if (typeof l === 'string' && l.toLowerCase().startsWith('zh')) return 'zh';
  }
  return 'en';
}

export class I18n {
  constructor() {
    /** @type {Record<string, Record<string, string>>} */
    this.dicts = { en: {}, zh: {} };
    this.locale = 'en';
    this.ready = false;
    this._listeners = new Set();
  }

  /** Attach dictionaries (already parsed by the DataLoader). */
  load(packs) {
    for (const loc of LOCALES) {
      const pack = packs?.[loc.id];
      if (pack) this.dicts[loc.id] = pack;
    }
    this.ready = true;
    this.locale = detectLocale();
    return this;
  }

  get localeInfo() {
    return LOCALES.find((l) => l.id === this.locale) ?? LOCALES[0];
  }

  get available() {
    return LOCALES.filter((l) => Object.keys(this.dicts[l.id] ?? {}).length > 0);
  }

  has(key) {
    return Object.prototype.hasOwnProperty.call(this.dicts[this.locale] ?? {}, key)
      || Object.prototype.hasOwnProperty.call(this.dicts.en, key);
  }

  /** Translate a key, interpolating `{name}` placeholders. */
  t(key, vars) {
    const dict = this.dicts[this.locale] ?? {};
    let text = dict[key] ?? this.dicts.en[key] ?? key;
    if (vars) {
      for (const [name, value] of Object.entries(vars)) {
        text = text.split(`{${name}}`).join(String(value));
      }
    }
    return text;
  }

  /** Plural-aware lookup: `<key>.one` / `<key>.other`, falling back to `<key>`. */
  tp(key, count, vars = {}) {
    const form = count === 1 ? `${key}.one` : `${key}.other`;
    const text = this.has(form) ? this.t(form, { ...vars, n: count }) : this.t(key, { ...vars, n: count });
    return text;
  }

  /**
   * Translate a piece of game content by kind + id, e.g.
   * `content('resource', 'iron', 'Iron')` or `content('technology', id, name, 'desc')`.
   * Returns `fallback` when the pack has no entry, so untranslated content keeps
   * its authored (English) text instead of showing a raw key.
   */
  content(kind, id, fallback, field = '') {
    if (id === undefined || id === null) return fallback;
    const key = field ? `content.${kind}.${id}.${field}` : `content.${kind}.${id}`;
    return this.has(key) ? this.t(key) : fallback;
  }

  /** Translate a simulation result's failure reason (`reasonKey` wins). */
  reason(result, field = 'reason') {
    if (!result) return '';
    if (result.reasonKey) return this.t(result.reasonKey, result.reasonVars ?? {});
    return result[field] ?? '';
  }

  /** Switch locale, persist the choice and tell the world. */
  setLocale(id) {
    if (!LOCALES.some((l) => l.id === id) || id === this.locale) return false;
    this.locale = id;
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* storage can be unavailable */
    }
    this._applyDocument();
    bus.emit('i18n:changed', { locale: id });
    for (const fn of this._listeners) {
      try {
        fn(id);
      } catch (err) {
        console.error('[i18n] listener failed', err);
      }
    }
    return true;
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Keep <html lang> and every `data-i18n` element in sync. */
  _applyDocument(root = document) {
    if (typeof document === 'undefined') return;
    document.documentElement.lang = this.locale === 'zh' ? 'zh-CN' : 'en';
    const vars = (el) => {
      const raw = el.getAttribute('data-i18n-vars');
      if (!raw) return undefined;
      const out = {};
      for (const pair of raw.split(',')) {
        const idx = pair.indexOf(':');
        if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
      }
      return out;
    };
    for (const el of root.querySelectorAll('[data-i18n]')) {
      const key = el.getAttribute('data-i18n');
      const text = this.t(key, vars(el));
      if (el.getAttribute('data-i18n-attr') === 'placeholder') el.placeholder = text;
      else if (el.getAttribute('data-i18n-attr') === 'title') el.title = text;
      else el.textContent = text;
    }
    for (const el of root.querySelectorAll('[data-i18n-html]')) {
      el.innerHTML = this.t(el.getAttribute('data-i18n-html'));
    }
  }

  /** Apply translations to the whole document (call once after boot). */
  applyToDocument() {
    this._applyDocument();
  }
}

export const i18n = new I18n();
