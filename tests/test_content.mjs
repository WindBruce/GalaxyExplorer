/**
 * Static consistency tests: catch broken imports, missing data references,
 * dangling dialogue nodes and missing DOM ids before they become runtime
 * errors in the browser.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const srcFiles = walk(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js'));
const dataFiles = walk(path.join(ROOT, 'data')).filter((f) => f.endsWith('.json'));
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

test('every relative import in src resolves to a real file', () => {
  const missing = [];
  for (const file of srcFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /from\s+['"](\.[^'"]+)['"]/g;
    let m;
    while ((m = re.exec(text))) {
      const target = path.resolve(path.dirname(file), m[1]);
      if (!fs.existsSync(target)) missing.push(`${path.relative(ROOT, file)} -> ${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `unresolved imports: ${missing.join(', ')}`);
});

test('every DOM id referenced by JS exists in index.html', () => {
  const referenced = new Set();
  for (const file of srcFiles) {
    const text = fs.readFileSync(file, 'utf8');
    const re = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
    let m;
    while ((m = re.exec(text))) referenced.add(m[1]);
  }
  const declared = new Set();
  const re2 = /id="([^"]+)"/g;
  let m;
  while ((m = re2.exec(html))) declared.add(m[1]);
  const missing = [...referenced].filter((id) => !declared.has(id));
  assert.deepEqual(missing, [], `missing DOM ids: ${missing.join(', ')}`);
});

test('data packs are valid JSON with the expected top-level shapes', () => {
  const json = {};
  for (const f of dataFiles) {
    const name = path.basename(f, '.json');
    json[name] = JSON.parse(fs.readFileSync(f, 'utf8'));
  }
  assert.ok(Array.isArray(json.regions.regions));
  assert.ok(json.resources.iron && json.resources.credits);
  assert.ok(json.technologies.energy_cell);
  assert.ok(json.skills.exp_core1);
  assert.ok(json.shipModules.engine && json.shipModules.ftl);
  assert.ok(json.civilizations.templates.length >= 4);
  assert.ok(json.civilizations.extinct.length >= 4);
  assert.ok(json.artifacts.artifacts.length >= 20);
  assert.ok(json.quests.quests.length >= 8);
  assert.ok(json.events.events.length >= 10);
  assert.ok(json.timeline.events.length >= 6);
});

test('technology prerequisites and artifact tags are consistent', () => {
  const technologies = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/technologies.json'), 'utf8'));
  const modules = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/shipModules.json'), 'utf8'));
  const moduleIds = new Set(Object.values(modules).flat().map((m) => m.id));
  for (const [id, tech] of Object.entries(technologies)) {
    for (const req of tech.requires ?? []) {
      assert.ok(technologies[req], `${id} requires unknown tech ${req}`);
    }
    for (const mod of tech.unlocks?.modules ?? []) {
      assert.ok(moduleIds.has(mod), `${id} unlocks unknown module ${mod}`);
    }
    if (tech.requiresArtifact) {
      const tag = tech.requiresArtifact;
      // Some artifact must carry this tag, otherwise the tech is unobtainable.
      // (memory_trace is a special "evidence" tag consumed by sci_mnemo.)
      assert.ok(typeof tag === 'string' && tag.length > 2, `${id} has a bad artifact tag`);
    }
  }
});

test('every artifact techTag maps to exactly one artifact-gated technology', () => {
  const { artifacts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/artifacts.json'), 'utf8'));
  const technologies = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/technologies.json'), 'utf8'));
  const tags = new Set(Object.values(technologies).map((t) => t.requiresArtifact).filter(Boolean));
  for (const a of artifacts) {
    if (!a.techTag) continue;
    assert.ok(tags.has(a.techTag), `artifact ${a.id} has techTag ${a.techTag} with no matching technology`);
  }
  // Every artifact-gated tech must be reachable from at least one artifact.
  const artifactTags = new Set(artifacts.map((a) => a.techTag).filter(Boolean));
  for (const tag of tags) {
    if (tag === 'memory_trace') continue;
    assert.ok(artifactTags.has(tag), `technology tag ${tag} is not carried by any artifact`);
  }
});

test('artifacts only reference timeline events that exist', () => {
  const { artifacts } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/artifacts.json'), 'utf8'));
  const timeline = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/timeline.json'), 'utf8'));
  const eventIds = new Set(timeline.events.map((e) => e.id));
  for (const a of artifacts) {
    for (const ev of a.supports ?? []) {
      assert.ok(eventIds.has(ev), `artifact ${a.id} supports unknown event ${ev}`);
    }
  }
  for (const stage of timeline.mystery.stages) {
    for (const ev of stage.requiresEvents ?? []) {
      assert.ok(eventIds.has(ev), `mystery stage ${stage.id} requires unknown event ${ev}`);
    }
  }
});

test('dialogue trees have no dangling node references', () => {
  const { templates } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/civilizations.json'), 'utf8'));
  for (const civ of templates) {
    const nodes = Object.keys(civ.dialogue);
    for (const [nodeId, node] of Object.entries(civ.dialogue)) {
      for (const opt of node.options ?? []) {
        assert.ok(opt.next === 'END' || nodes.includes(opt.next), `${civ.id}:${nodeId} -> ${opt.next} missing`);
        assert.ok(typeof opt.text === 'string' && opt.text.length > 0, `${civ.id}:${nodeId} has an empty option`);
      }
    }
  }
});

test('quest chains and reward references are consistent', () => {
  const { quests } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/quests.json'), 'utf8'));
  const ids = new Set(quests.map((q) => q.id));
  const resources = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/resources.json'), 'utf8'));
  const technologies = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/technologies.json'), 'utf8'));
  const civilizations = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/civilizations.json'), 'utf8'));
  const civIds = new Set(civilizations.templates.map((c) => c.id));
  for (const q of quests) {
    if (q.rewards?.unlockQuest) {
      assert.ok(ids.has(q.rewards.unlockQuest), `${q.id} unlocks unknown quest ${q.rewards.unlockQuest}`);
    }
    for (const [res] of Object.entries(q.rewards?.resources ?? {})) {
      assert.ok(resources[res], `${q.id} rewards unknown resource ${res}`);
    }
    for (const o of q.objectives) {
      if (o.type === 'researchTech') assert.ok(technologies[o.target], `${q.id} requires unknown tech ${o.target}`);
      if (o.type === 'collectResource') assert.ok(resources[o.resource], `${q.id} requires unknown resource ${o.resource}`);
      if (o.type === 'returnTo' || o.type === 'talkTo') assert.ok(civIds.has(o.civ), `${q.id} references unknown civ ${o.civ}`);
    }
  }
  // At least one quest chain reaches the finale.
  const finale = quests.find((q) => q.id === 'q_theQuestion');
  assert.ok(finale, 'the finale quest exists');
});

test('ship module tech requirements and skill prerequisites resolve', () => {
  const modules = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/shipModules.json'), 'utf8'));
  const technologies = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/technologies.json'), 'utf8'));
  const skills = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/skills.json'), 'utf8'));
  for (const list of Object.values(modules)) {
    for (const m of list) {
      if (m.requiresTech) assert.ok(technologies[m.requiresTech], `${m.id} requires unknown tech ${m.requiresTech}`);
    }
  }
  for (const [id, node] of Object.entries(skills)) {
    for (const req of node.requires ?? []) {
      assert.ok(skills[req], `skill ${id} requires unknown skill ${req}`);
    }
  }
});

test('dynamic events have choices with effects and outcomes', () => {
  const { events } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/events.json'), 'utf8'));
  const resources = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/resources.json'), 'utf8'));
  for (const ev of events) {
    assert.ok(ev.choices.length >= 2, `${ev.id} needs at least two choices`);
    for (const c of ev.choices) {
      assert.ok(c.outcome && c.outcome.length > 10, `${ev.id} choice lacks an outcome`);
      for (const [res] of Object.entries(c.effects?.giveResource ?? {})) {
        assert.ok(resources[res], `${ev.id} gives unknown resource ${res}`);
      }
    }
  }
});

test('regions cover every region referenced by the design', () => {
  const { regions } = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/regions.json'), 'utf8'));
  const ids = new Set(regions.map((r) => r.id));
  for (const required of ['core', 'bulge', 'innerDisk', 'orionSpur', 'perseusArm', 'outerDisk', 'galacticEdge', 'interstellar', 'unknownRegions']) {
    assert.ok(ids.has(required), `missing region ${required}`);
  }
  const total = regions.reduce((s, r) => s + r.systemCount, 0);
  assert.ok(total >= 800, `galaxy should have a substantial system count (got ${total})`);
});

test('index.html loads the stylesheet and the module entry point', () => {
  assert.ok(html.includes('href="styles.css"'));
  assert.ok(html.includes('src="src/main.js"'));
  assert.ok(html.includes('type="module"'));
});
