/**
 * The Galactic Civilization Archive - the player's personal encyclopedia.
 *
 * Every civilisation, species, planet, star, artifact, ruin, historical
 * event, anomaly and phenomenon the player has ever encountered is recorded
 * here, permanently, and survives save/load.
 */
export const ARCHIVE_CATEGORIES = [
  'civilization', 'species', 'planet', 'star', 'artifact', 'ruin',
  'event', 'anomaly', 'phenomenon', 'resource', 'technology', 'region',
];

export const CATEGORY_LABELS = {
  civilization: 'Civilisations',
  species: 'Species',
  planet: 'Planets',
  star: 'Stars',
  artifact: 'Artifacts',
  ruin: 'Ruins & Sites',
  event: 'Historical Events',
  anomaly: 'Anomalies',
  phenomenon: 'Phenomena',
  resource: 'Resources',
  technology: 'Technologies',
  region: 'Regions',
};

export class ArchiveSystem {
  constructor(state) {
    this.state = state;
    /** @type {Map<string, {category,id,name,summary,discoveredAt,meta}>} */
    this.entries = new Map();
  }

  static key(category, id) {
    return `${category}:${id}`;
  }

  has(category, id) {
    return this.entries.has(ArchiveSystem.key(category, id));
  }

  add(category, id, entry = {}) {
    const k = ArchiveSystem.key(category, id);
    if (this.entries.has(k)) {
      // Merge new information into the existing record.
      const existing = this.entries.get(k);
      this.entries.set(k, { ...existing, ...entry, meta: { ...existing.meta, ...entry.meta } });
      return { record: this.entries.get(k), isNew: false };
    }
    const record = {
      category,
      id,
      name: entry.name ?? id,
      summary: entry.summary ?? '',
      discoveredAt: this.state.clock.stardate,
      discoveredBy: entry.discoveredBy ?? null,
      meta: entry.meta ?? {},
    };
    this.entries.set(k, record);
    this.state.bus.emit('archive:added', record);
    return { record, isNew: true };
  }

  get(category, id) {
    return this.entries.get(ArchiveSystem.key(category, id)) ?? null;
  }

  byCategory(category) {
    return [...this.entries.values()].filter((e) => e.category === category);
  }

  counts() {
    const out = {};
    for (const cat of ARCHIVE_CATEGORIES) out[cat] = 0;
    for (const e of this.entries.values()) out[e.category] = (out[e.category] ?? 0) + 1;
    return out;
  }

  /** Total known entries across all categories. */
  get total() {
    return this.entries.size;
  }

  serialize() {
    return [...this.entries.values()];
  }

  deserialize(list) {
    this.entries.clear();
    for (const e of list ?? []) {
      this.entries.set(ArchiveSystem.key(e.category, e.id), e);
    }
  }
}
