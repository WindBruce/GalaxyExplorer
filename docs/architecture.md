# Galaxy Explorer — Architecture

A 3D galactic exploration / archaeology RPG. The whole game runs from a static
folder: no build step, no bundler, no runtime dependencies beyond a vendored
copy of Three.js. This document describes how the code is organised, why, and
how it scales.

```
npm start     # http://localhost:8080
npm test      # 54 headless tests (simulation, content, UI, render, playthrough)
npm run check # node --check over every source file
```

---

## 1. Layers

```
index.html            DOM shell: canvas + HUD + panels + modals + map overlay + menu
styles.css            complete UI skin
src/main.js           entry point: new Game() -> await game.boot() + fatal-error overlay
        |
src/Game.js           orchestrator: renderer, camera, input, state machine, loop,
        |             hotkeys, autosave, bus -> UI wiring
        +-------------------+--------------------+-------------------+
        |                   |                    |
   src/states/         src/render/          src/ui/
   StateMachine        Shaders (GLSL)       Notifications (toasts)
   SpaceState          Objects (factories)  HUD
   SurfaceState        Input                Panels (9 panels)
   MapState            FlightControls      Modals (dialogue/event/station/trade)
   (galactic map)      SpaceScene           GalacticMapUI
                       TerrainScene         MainMenu
                       GalaxyMapScene
        |
src/sim/              src/world/           src/core/
ShipSystem            StarSystemGenerator  Random (seeded PRNG, Rng class)
ResourceSystem        GalaxyGenerator      EventBus (+ global `bus`)
SkillSystem           NameGen              Time (GameClock)
TechSystem                                DataLoader (data/*.json)
ArchiveSystem                             SaveSystem (localStorage + JSON export)
ArchaeologySystem                         Noise (fbm / ridged, CPU)
CivilizationSystem
QuestSystem
EventSystem
FTLSystem
CombatSystem
GameState
```

**Dependency rule:** `core` depends on nothing, `world` on `core`, `sim` on
`core`+`world`, `render` on `core`+`sim`+`world`+Three, `states` on
`render`+`sim`+`ui`, `ui` on `sim`+`core`, `Game` on everything. Nothing in
`core`, `sim` or `world` touches the DOM, which is what makes the simulation
testable in Node (see §7).

---

## 2. Determinism

Every random draw comes from `Rng(seed)` in `src/core/Random.js` — a
mulberry32-style generator with the helpers the game needs (`float`, `int`,
`chance`, `pick`, `weighted`, `range`). Seeds are derived from:

| What | Seed source |
| --- | --- |
| Galaxy layout | player seed string (`MilkyWay-4471` by default) |
| Star system detail | `hash(systemId) ^ galaxySeed` |
| Planet terrain | `hash(planetId)` |
| Names | `hash(galaxySeed + nameIndex)` |
| Events | `hash(galaxySeed ^ stardate ^ context)` |
| Artifact analysis | `hash(artifactId)` |
| Hostiles / wrecks | `hash(galaxySeed ^ hostileId)` |

Consequences that the design relies on:

* A save file only stores the seed, discovery flags and player state — the
  galaxy itself is **regenerated deterministically** on load
  (`GameState.deserialize` calls `createGalaxy(save.galaxy.seed, …)` and then
  replays discovery). Saves stay tiny (≈7 kB) and cannot desync from content
  updates.
* Tests can assert exact outcomes (`tests/test_simulation.mjs`).

---

## 3. Data-driven content

All content lives in `data/*.json` and is loaded by `DataLoader.loadAllData()`,
which also strips documentation keys (`_comment`, …) and normalises wrappers.
Nothing in the simulation hardcodes a civilisation, planet type, resource,
quest, technology, skill, artifact or event.

| File | Contents |
| --- | --- |
| `regions.json` | 9 galactic regions (core → unknown regions) with system counts, palette, hazard, civ bias |
| `resources.json` | 19 resources: tier, category, base price, volatility, uses |
| `shipModules.json` | 57 modules across 14 slots, each with `cost`, `stats`, `requiresTech`, `mass`, `powerDraw` |
| `technologies.json` | 55 techs in 10 categories, incl. the artifact-gated `unknown` category |
| `skills.json` | 41 skill nodes across 8 archetypes with `statMods` / `flat` / `bonuses` |
| `civilizations.json` | 4 living civs (dialogue trees, economy, politics) + 5 extinct civs |
| `species.json` | species profiles per civ |
| `artifacts.json` | 26 artifacts: tier, civTag, era, `supports` (timeline events), `techTag` |
| `quests.json` | 12 quests with objective graphs and chains |
| `timeline.json` | 8 eras, 8 scripted events, and the 6-stage main mystery (`m0`–`m5`) |
| `events.json` | 14 dynamic narrative events with weighted, context-gated choices |

Adding a new ruin type, civilization or quest is a JSON edit plus (at most) a
new entry in a label map — no engine changes. `tests/test_content.mjs` fails the
build if a pack references an id that does not exist (dangling dialogue nodes,
unknown tech prerequisites, artifact tags with no matching technology, quest
chains that point at missing quests, …).

### Internationalisation

`src/core/I18n.js` is a dependency-free, DOM-aware dictionary. Two locales ship
in the repo and a third is a data edit away:

```
data/i18n/en.json          interface strings, key -> English text
data/i18n/zh.json          the same keys -> Chinese text
data/i18n/content/zh.json  data-pack prose -> Chinese text
```

`DataLoader.loadI18nPacks()` merges `i18n/<locale>` then
`i18n/content/<locale>` into one flat map, so `en` falls back to the authored
data packs and only `zh` needs a content overlay.

| Call | Purpose |
| --- | --- |
| `t(key, vars)` | interface string, `{name}` interpolation, returns the key when unknown |
| `tp(key, count, vars)` | plural-aware variant (`key.one` / `key.other`) |
| `content(kind, id, fallback, field)` | prose for a data record: translation, else the pack's own text |
| `reason(result)` | localises a simulation failure carrying `reasonKey` / `reasonVars` |
| `setLocale(id)` | switches, persists to `localStorage`, re-renders the document, emits `i18n:changed` |
| `applyToDocument()` | rewrites every `data-i18n`, `data-i18n-attr`, `data-i18n-html` and `data-i18n-vars` node |

Unknown keys return the key itself rather than throwing, so a gap is visible in
the UI instead of crashing. `Game._onLocaleChanged()` re-applies the document,
then re-opens whatever panel, modal or map was on screen so the whole interface
switches at once. Simulation prose that is generated from a seed
(`StarSystemGenerator`, `describeLife`, `describeRuin`) reads the locale at
generation time and never perturbs the RNG, so the galaxy stays identical in
both languages.

`tests/test_i18n.mjs` enforces the contract: key-for-key parity between
locales, no key the code asks for is missing, no dictionary key is dead, and
every id in every data pack (including generated prose tables) has a Chinese
translation.

### Voice & audio settings

`src/ui/Settings.js` owns the overlay (F2). Language, master/music/SFX/ambient
volumes, narration on/off, voice choice and speaking rate persist to
`localStorage['galaxyexplorer.settings']`. Narration is one sink:
`Notifications.onSpeak` -> `Settings.speak()` -> `speechSynthesis`, and
`Game.narrate(text)` is the single call site for transmissions, analysis
readings and mission reports. When narration is off (or the browser has no
speech engine) `speak()` is a no-op, so the game stays fully playable.

### Derived ship stats

`ShipSystem.recompute()` rebuilds every stat from the installed modules plus
skill modifiers plus technology capabilities. Module data uses compact stat
names that collide between slots (`range` on scanner vs weapon, `regen` on
shield vs armour), so `SLOT_STAT_ALIAS` resolves them per slot. Power draw is
budgeted against power output and browns out shield/thrust when overloaded.

---

## 4. Scaling to a galaxy of millions

The slice ships ~1,100 named systems, but nothing pre-generates the galaxy as a
flat array of fully-detailed systems:

* `Galaxy` stores **system descriptors** (id, name, region, position, star class,
  seed, flags). Full planet/moon/ruin/station detail is produced lazily by
  `StarSystemGenerator` the first time a system is entered
  (`galaxy.getSystem(id)` → `ensureDetailed`).
* Positions are generated from the seed with log-spiral arms, so distance
  queries (`distanceLy`, `systemsWithinLy`) work on descriptors only.
* The galactic map renders the descriptor cloud as a single `Points` object with
  per-point colour by region — one draw call for the whole galaxy, and picking
  uses `Raycaster.params.Points.threshold` with a `distanceToRay` tiebreak.
* The same structure streams to millions of systems: descriptors are ~200 bytes,
  so a million-system galaxy is ~200 MB of descriptors (or a few MB with the
  region+index scheme already used by `serialize`). Nothing in the engine
  assumes a small count.

Fuel economy is tuned against this scale: the stock drive reaches ~2,200 ly
(five neighbouring systems), tier 2 ~6,000 ly, tier 3 ~18,000 ly, the antimatter
drive ~38,000 ly and the recovered resonance gate ~60,000 ly — the anchor system
of the main mystery sits 58,120 ly from home, i.e. an end-game journey.

---

## 5. Simulation

`GameState` is the single source of truth: player, ship, location, research,
flags, stats, and one subsystem per domain. Subsystems never import each other;
they talk through `state` and the global `bus` (`src/core/EventBus.js`).

Notable contracts:

* `state.shipSystem.stats` — derived stats, only valid after `recompute()`.
* `state.resources` — cargo-bounded resource ledger (`amount/add/remove/spend/
  canAfford/price/buy/sell/mine/manifest/used/capacity`).
* `state.ship.applyDamage(amount, type)` — delegates to `ShipSystem`, so combat,
  surface hazards and event effects share one damage path.
* `state.archaeology` — the evidence model (see `docs/design.md` §5): collect →
  analyse → hypothesis/confirmation, gated on `analysis`/`translation` stats.
* `state.ftl.canJump(from, to)` — the single authority on range, fuel and
  charge time; the map, the flight HUD and the quest system all use it.

The bus carries ~30 events (`resource:gained`, `tech:researched`,
`artifact:analyzed`, `civ:politics`, `ship:destroyed`, `travel:complete`, …).
`Game._wireBus()` turns them into notifications; the UI never polls the
simulation.

---

## 5.1 State machine contract

`StateMachine.change(name, payload, force)`:

* **Scenes are created lazily.** `Game` constructs its states in the
  constructor, *before* `boot()` creates the `GameState` - so `SpaceState` and
  `SurfaceState` build their `SpaceScene` / `TerrainScene` on `enter()`, via
  `_ensureScene()`, which also rebuilds when the `GameState` object is replaced
  (new game / load). Capturing `game.state` at construction time was the cause
  of the `Cannot read properties of null (reading 'update')` crash: `enter()`
  threw, and every subsequent frame then ticked a state whose `controls` had
  never been assigned.
* **`force` re-enters the current state.** Loading a save changes the world
  under the current state, so `loadGame()` passes `force = true`.
* **Re-entering the same state skips `exit()`.** Its `enter()` rebuilds the
  scene; exiting afterwards would dispose what was just built.
* **`payload` is normalised to `undefined`** when absent, so state defaults
  (`enter(payload = {})`) apply - passing `null` crashed `SurfaceState.enter`
  on `payload.planet`.
* **A failing `enter()` is contained.** The error is logged once and the
  machine stays on (or recovers to) the previous state, instead of ticking a
  half-initialised state every frame. States also guard `update()` with
  `if (!state || !this.scene || !this.controls) return;`.

## 6. Rendering

* Three.js r0.160.1 is vendored at `vendor/three.module.js` and imported with a
  relative specifier — the game works offline with no CDN and no bundler.
* `Shaders.js` holds every GLSL chunk (procedural star surface with granulation
  and flares, planet terrain with biome colouring by height/slope, atmospheric
  rim scattering, accretion disk, nebula volumes, scan pulse, engine plume).
* `Objects.js` factories return `Group`/`Mesh` objects tagged in `userData`
  (`kind`, `radius`, …) so the scene graph doubles as the entity list. Scenes
  (`SpaceScene`, `TerrainScene`, `GalaxyMapScene`) only compose factories.
* Two control rigs: `FlightControls` (6DOF-lite with inertial drift, boost,
  brake, first/third person) and `CharacterControls` (walk/sprint/jump, ground
  snapping, first/third person). Both are pure CPU code and are unit-tested.
* The state machine owns which scene graph is attached to the renderer; the
  render loop lives in `Game._tick` and is paused while the main menu is open.

## 7. Testing

| Suite | What it proves |
| --- | --- |
| `tests/test_simulation.mjs` | 17 tests: galaxy determinism, system variety, new-game invariants, module stats + gating, cargo limits, skills, research, artifact analysis → evidence → mystery stages, quests, civ reputation/dialogue/markets, events, combat, FTL, save round trip |
| `tests/test_content.mjs` | 12 tests: every relative import resolves, every DOM id referenced by JS exists in `index.html`, all packs are well-formed, no dangling references anywhere in the content |
| `tests/test_ui.mjs` | 11 tests: jsdom drives the real HUD, all nine panels, dialogue, events, station/trade, analysis, galactic map and main menu |
| `tests/test_scenes.mjs` | 5 tests: real Three.js scene construction, animation loops, controls, object factories |
| `tests/test_boot.mjs` | 6 tests: constructs the real `Game` with only `WebGLRenderer` stubbed (`tests/helpers/three-stub.mjs`, installed via `node --import ./tests/helpers/register.mjs`) and drives boot -> new game -> flight -> save/load -> page-reload continue -> surface resume -> contained `enter()` failure |
| `tests/test_playthrough.mjs` + `tests/test_gameplay.mjs` | 9 tests: fly → target → scan → map → jump → land → excavate → mine → fight → dock → save/load, through the real state machine |

The DOM-dependent suites need jsdom; if it is not installed they skip
themselves, so `npm test` stays green in a bare checkout. `tests/helpers/dom.mjs`
installs jsdom as Node globals (minus `performance`, whose jsdom implementation
recurses under Node).

Bugs this harness caught during development (all fixed): broken vendor import
depth in `src/render` + `src/states`, a `_comment` key leaking into the
technology table, a missing `makeBolt` import (first shot crashed), the weapon
rate-of-fire stat being dropped by the slot alias table, combat/hazard/event
damage calling a non-existent `state.ship.applyDamage`, an FTL range that made
the galaxy unreachable, flight damping that capped the ship below its own
`maxSpeed`, hostiles that could never close to weapon range, and the state
machine bugs in section 5.1 (states built before the `GameState` existed, a
state machine that exited the state it had just re-entered, a `null` payload
crashing `SurfaceState.enter`, and a failed `enter()` being ticked every frame).

## 8. Persistence

`SaveSystem` keeps four slots in `localStorage` (`autosave`, `slot1`–`slot3`),
plus JSON export/import for moving a save between machines. Everything goes
through `GameState.serialize()`/`deserialize()`; `SaveSystem.peek/allSlots/
remove` back the main menu. Autosave runs every 120 s.

## 9. Conventions

* ES modules everywhere, named exports, no default exports except none.
* 2-space indent, single quotes, semicolons; `node --check` clean.
* Comments explain *why*; JSDoc on public methods.
* New gameplay content → JSON first, engine second.
* Any new cross-module call site must be reflected in a test.
