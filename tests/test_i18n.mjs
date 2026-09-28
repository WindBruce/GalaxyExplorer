/**
 * Internationalisation tests.
 *
 * These guard the contract that makes global language switching safe:
 *   - `en` and `zh` describe exactly the same keys (no silent gaps),
 *   - every key the code asks for actually exists (no raw keys on screen),
 *   - every key in the dictionary is actually used (no dead strings),
 *   - generated content keeps a translation for every id in the data packs,
 *   - switching locale is immediate, persistent and announced on the bus.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDom } from './helpers/dom.mjs';
import { loadI18nPacks, loadAllData } from '../src/core/DataLoader.js';
import { i18n, LOCALES } from '../src/core/I18n.js';
import { Settings } from '../src/ui/Settings.js';
import { STAR_CLASSES, PLANET_TYPES, generateSystem } from '../src/world/StarSystemGenerator.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src');

function sources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) out.push(full);
    }
  };
  walk(SRC);
  out.push(path.join(ROOT, 'index.html'));
  return out;
}

/**
 * Every key the source asks i18n for.
 *  - `literal`   : fully static keys, must exist verbatim
 *  - `prefixes`  : `t(`prefix.${x}`)` - the literal prefix must resolve
 *  - `contentIds`: `content('kind', 'id')` pairs, must be translatable
 */
function referencedKeys() {
  const literal = new Set();
  const prefixes = new Set();
  const contentIds = [];
  // i18n.t('k') / i18n.tp('k') / T('k') where T is the local alias.
  // A boundary guard is required: bare `t(` also matches the tail of `split(`.
  const call = /(?:^|[^A-Za-z0-9_$])(?:i18n\.)?(?:t|tp)\(\s*(['"`])([^'"`]+)\1/g;
  const alias = /(?:^|[^A-Za-z0-9_$.])T\(\s*(['"`])([^'"`]+)\1/g;
  // i18n.content('kind', 'id', ...) with both arguments static.
  const content = /content\(\s*(['"])([a-zA-Z0-9_]+)\1\s*,\s*(['"`])([^'"`$]+)\3/g;
  for (const file of sources()) {
    const text = fs.readFileSync(file, 'utf8');
    for (const re of [call, alias]) {
      for (const m of text.matchAll(re)) {
        const key = m[2];
        if (key.includes('${')) prefixes.add(key.slice(0, key.indexOf('${')));
        else if (/^[a-z][a-zA-Z0-9_.]*$/.test(key)) literal.add(key);
      }
    }
    for (const m of text.matchAll(content)) contentIds.push([m[2], m[4]]);
  }
  return { literal, prefixes, contentIds };
}

let packs = null;
let en = null;
let zh = null;

test('i18n', async (t) => {
  packs = await loadI18nPacks();
  en = packs.en;
  zh = packs.zh;

  await t.test('both locales load with content', () => {
    for (const loc of LOCALES) {
      assert.ok(packs[loc.id], `${loc.id} pack present`);
      assert.ok(Object.keys(packs[loc.id]).length > 300, `${loc.id} has a full dictionary`);
    }
  });

  await t.test('en and zh describe exactly the same interface keys', () => {
    // `content.*` keys are translations of the data packs, which are authored in
    // English: only zh carries them, and en falls back to the data itself.
    const ui = (d) => new Set(Object.keys(d).filter((k) => !k.startsWith('_') && !k.startsWith('content.')));
    const enKeys = ui(en);
    const zhKeys = ui(zh);
    const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
    const extraInZh = [...zhKeys].filter((k) => !enKeys.has(k));
    assert.deepEqual(missingInZh, [], 'every English key has a Chinese translation');
    assert.deepEqual(extraInZh, [], 'no Chinese key without an English source');
  });

  await t.test('the Chinese content pack only translates real content', () => {
    const contentKeys = Object.keys(zh).filter((k) => k.startsWith('content.'));
    assert.ok(contentKeys.length > 400, `content pack is substantial (${contentKeys.length} keys)`);
    // Every key must be `content.<kind>.<id>[.<field>]` - no typos in the kind.
    const kinds = new Set(contentKeys.map((k) => k.split('.')[1]));
    assert.ok(kinds.has('resource') && kinds.has('technology') && kinds.has('dialogue'),
      `kinds look right: ${[...kinds].sort().join(', ')}`);
  });

  await t.test('every key the code asks for exists in the dictionary', () => {
    const { literal, prefixes } = referencedKeys();
    const missing = [...literal].filter((k) => !(k in en)).sort();
    assert.deepEqual(missing, [], 'no raw keys will reach the screen');
    // A prefix may live in the interface dictionary or in the content pack.
    const allKeys = [...Object.keys(en), ...Object.keys(zh)];
    const orphanPrefixes = [...prefixes].filter((p) => !allKeys.some((k) => k.startsWith(p))).sort();
    assert.deepEqual(orphanPrefixes, [], 'dynamic key prefixes resolve to real keys');
  });

  await t.test('static content() lookups resolve to real translations', async () => {
    const { contentIds } = referencedKeys();
    const data = await loadAllData();
    const known = {
      resource: Object.keys(data.resources),
      region: data.regions.map((r) => r.id),
      technology: Object.keys(data.technologies),
      skill: Object.keys(data.skills),
      module: Object.values(data.shipModules).flat().map((m) => m.id),
      artifact: data.artifacts.artifacts.map((a) => a.id),
      civilization: data.civilizations.templates.map((c) => c.id),
      extinct: data.civilizations.extinct.map((c) => c.id),
      starclass: Object.keys(STAR_CLASSES),
      planettype: Object.keys(PLANET_TYPES),
      ruinCiv: ['aelthera', 'synthari', 'korrathi', 'veshari', 'unknown', 'shepherd'],
      anomalyKind: ['gravimetric', 'temporal', 'quantum', 'unknown'],
      atmosphere: ['Hydrogen-Helium', 'None (trace)', 'Thin Methane', 'Nitrogen-Oxygen',
        'Carbon Dioxide', 'Thin Argon', 'Methane-Ammonia', 'Sulphur Dioxide', 'Exotic Halides'],
    };
    const bad = contentIds.filter(([kind, id]) => known[kind] && !known[kind].includes(id));
    assert.deepEqual(bad, [], 'content() ids exist in the data packs');
  });

  await t.test('no dictionary key is dead', () => {
    // Keys reached only through composition are listed here with a reason.
    const composed = new Set([
      'gen.planets_one', 'gen.ruin_one',          // tp() plural siblings
      'map.status.visited', 'map.status.detected', 'map.status.uncharted',
      'hud.hostiles.one', 'hud.hostiles.other',   // tp() siblings
      'skills.sub_one',
      'label.category.basic', 'label.category.advanced', 'label.category.ancient',
      'label.category.unknown', 'label.category.meta',
      'label.techcat.energy', 'label.techcat.propulsion', 'label.techcat.materials',
      'label.techcat.weapons', 'label.techcat.ai', 'label.techcat.quantum',
      'label.techcat.biotech', 'label.techcat.spatial', 'label.techcat.civilization',
      'label.techcat.unknown',
      'label.arch.explorer', 'label.arch.scientist', 'label.arch.engineer',
      'label.arch.archaeologist', 'label.arch.diplomat', 'label.arch.soldier',
      'label.arch.xenobiologist', 'label.arch.aiResearcher',
      'label.slot.engine', 'label.slot.ftl', 'label.slot.power', 'label.slot.shield',
      'label.slot.armor', 'label.slot.weapon', 'label.slot.cargo', 'label.slot.mining',
      'label.slot.scanner', 'label.slot.archaeology', 'label.slot.lab',
      'label.slot.lifesupport', 'label.slot.drone', 'label.slot.ai',
      'label.ptype.terrestrial', 'label.ptype.ocean', 'label.ptype.desert',
      'label.ptype.ice', 'label.ptype.volcanic', 'label.ptype.toxic', 'label.ptype.barren',
      'label.ptype.molten', 'label.ptype.tidallyLocked', 'label.ptype.gasGiant',
      'label.ptype.exotic',
      'label.starclass.redDwarf', 'label.starclass.yellow', 'label.starclass.blueGiant',
      'label.starclass.binary', 'label.starclass.blackHole', 'label.starclass.neutron',
      'label.starclass.whiteDwarf',
      'label.stationkind.research', 'label.stationkind.trade', 'label.stationkind.military',
      'label.stationkind.outpost', 'label.stationkind.relay',
      'label.artifacttype.inscription', 'label.artifacttype.relic', 'label.artifacttype.starMap',
      'label.artifacttype.quantumRecording', 'label.artifacttype.database',
      'label.artifacttype.aiMemory', 'label.artifacttype.energySignature',
      'label.artifacttype.architecture', 'label.artifacttype.weapon',
      'label.objtype.travelTo', 'label.objtype.scanSystem', 'label.objtype.scanBody',
      'label.objtype.landOnPlanet', 'label.objtype.collectResource', 'label.objtype.returnTo',
      'label.objtype.analyzeArtifact', 'label.objtype.researchTech', 'label.objtype.discoverRuin',
      'label.objtype.scanAnomaly', 'label.objtype.defeatHostiles',
      'label.politics.stable', 'label.politics.unrest', 'label.politics.crisis',
      'label.politics.reform', 'label.politics.expansion', 'label.politics.isolation',
      'label.questcat.main', 'label.questcat.side',
      'brief.head.premise', 'brief.head.flight', 'brief.head.interfaces',
      'brief.head.onFoot', 'brief.head.archaeology', 'brief.head.risk',
      'settings.on', 'settings.off',
      'state.selfDestruct', 'state.ftlCompleteBody',
    ]);
    const { literal, prefixes } = referencedKeys();
    const haystack = sources().map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const dead = Object.keys(en)
      .filter((k) => !k.startsWith('_') && !composed.has(k) && !literal.has(k))
      .filter((k) => ![...prefixes].some((p) => k.startsWith(p)))
      .filter((k) => !haystack.includes(`'${k}'`) && !haystack.includes(`"${k}"`))
      .sort();
    assert.deepEqual(dead, [], 'no unused dictionary entries');
  });

  await t.test('every generated id has a Chinese translation', async () => {
    const data = await loadAllData();
    const need = (kind, ids, suffix = '.name') => {
      const missing = ids.filter((id) => !(`content.${kind}.${id}${suffix}` in zh));
      assert.deepEqual(missing.sort(), [], `content.${kind}.*${suffix} translated`);
    };
    need('technology', Object.keys(data.technologies));
    need('skill', Object.keys(data.skills));
    need('artifact', data.artifacts.artifacts.map((a) => a.id));
    need('quest', data.quests.quests.map((q) => q.id), '.title');
    for (const q of data.quests.quests) {
      assert.ok(`content.quest.${q.id}.desc` in zh, `${q.id}.desc translated`);
    }
    need('civilization', data.civilizations.templates.map((c) => c.id));
    need('extinct', data.civilizations.extinct.map((c) => c.id));
    need('resource', Object.keys(data.resources), '');
    for (const id of Object.keys(data.resources)) {
      if (data.resources[id].desc) assert.ok(`content.resource.${id}.desc` in zh, `${id}.desc translated`);
    }
    need('region', data.regions.map((r) => r.id), '');
    // Dynamic events: text, every choice and every outcome.
    for (const ev of data.events.events) {
      assert.ok(`content.event.${ev.id}.title` in zh, `${ev.id}.title translated`);
      assert.ok(`content.event.${ev.id}.text` in zh, `${ev.id}.text translated`);
      (ev.choices ?? []).forEach((c, i) => {
        assert.ok(`content.event.${ev.id}.choice.${i}` in zh, `${ev.id}.choice.${i} translated`);
        if (c.outcome) assert.ok(`content.event.${ev.id}.outcome.${i}` in zh, `${ev.id}.outcome.${i} translated`);
      });
    }
    // Quest objectives are authored per index.
    for (const q of data.quests.quests) {
      (q.objectives ?? []).forEach((_, i) => {
        assert.ok(`content.quest.${q.id}.obj.${i}` in zh, `${q.id}.obj.${i} translated`);
      });
    }
    // Timeline + mystery drive the archaeology panel.
    for (const era of data.timeline.eras) {
      assert.ok(`content.timeline.era.${era.id}.name` in zh, `era ${era.id} translated`);
    }
    for (const ev of data.timeline.events) {
      assert.ok(`content.timeline.event.${ev.id}.title` in zh, `event ${ev.id} translated`);
    }
    for (const stage of data.timeline.mystery.stages) {
      assert.ok(`content.mystery.stage.${stage.id}` in zh, `mystery stage ${stage.id} translated`);
    }
    // Dialogue: every node and option of every civilisation.
    for (const civ of data.civilizations.templates) {
      for (const [nodeId, node] of Object.entries(civ.dialogue ?? {})) {
        assert.ok(`content.dialogue.${civ.id}.${nodeId}` in zh, `dialogue ${civ.id}.${nodeId} translated`);
        (node.options ?? []).forEach((_, i) => {
          assert.ok(`content.dialogue.${civ.id}.${nodeId}.option.${i}` in zh,
            `dialogue ${civ.id}.${nodeId}.option.${i} translated`);
        });
      }
    }

  });
});

test('generated prose tables are fully translated', async () => {
      const pack = await loadAllData();
      const rows = pack.regions.map((r) => [r.id, Object.keys(STAR_CLASSES)[0], 0]);
      rows.push(['orionSpur', 'yellow', 3]);
      const miss = [];
      const want = (k) => { if (!(k in zh)) miss.push(k); };
      for (const [regionId, starClass, index] of rows) {
        const sys = generateSystem(`i18n-cov-${regionId}-${starClass}-${index}`, { regionId, starClass, index });
        for (const p of sys.planets) {
          want(`content.planettype.${p.type}`);
          // `life` is a biome id, or a boolean when the world has no biome table.
          if (p.life && typeof p.life === 'string') want(`content.life.${p.life}`);
          if (p.atmosphere?.name) want(`content.atmosphere.${p.atmosphere.name}`);
          if (p.ruin) {
            want(`content.ruinCiv.${p.ruin.civId}`);
            want(`content.ruinSize.${p.ruin.size}`);
          }
        }
        for (const s of sys.species ?? []) want(`content.species.${s}`);
        for (const a of sys.anomalies ?? []) want(`content.anomalyKind.${a.kind}`);
        want(`content.starclass.${starClass}.label`);
      }
      want('content.ruinTail.0');
      want('content.ruinTail.5');
      assert.deepEqual(miss, [], 'generated prose tables are translated');
    });
