# Galaxy Explorer

A playable 3D galactic exploration / archaeology RPG. One seeded string generates
a Milky Way slice of ~1,100 star systems; you fly it, land on its worlds, walk
them, mine what you can carry, and translate what the dead left behind — until
you can say what happened to them.

Everything runs from static files: no build step, no bundler, no CDN. Three.js is
vendored in `vendor/`.

```bash
npm start      # http://localhost:8080
npm test       # 75 headless tests
npm run check  # syntax check every source file
```

Docs: [`docs/design.md`](docs/design.md) (the game) ·
[`docs/architecture.md`](docs/architecture.md) (the code).

---

## What's in the slice

| Area | Status |
| --- | --- |
| 3D environments | Procedural star systems, planets, terrain, atmospheres, nebulae, ruins, stations, anomalies |
| Camera | First / third person in ship and on foot (`V`) |
| Controllable spaceship | 6DOF-lite flight, boost, brake, full stop, FTL jumps with fuel + range |
| Star system | 7 star classes, planet types, moons, rings, tidal locking, belts, hazards, life |
| Planetary exploration | Land (`G`), walk, sprint, jump, extract surface nodes |
| Celestial scanning | Target cycling (`Tab`), scanning (`T`), dossiers, system survey |
| Resource collection | 19 resources, cargo limits, mining yield, market prices |
| Ship upgrades | 14 slots, 57 modules, derived stats, power budget |
| Character progression | XP, levels, 41 skills across 8 archetypes |
| Galaxy map | 3D region cloud, jump range ring, route preview, system dossier, click to select |
| Alien ruins | 5 extinct civilisations, ruin sites, artifact excavation |
| Alien civilisations | 4 living cultures with dialogue, trade, reputation, politics |
| Quests | 12 quests with typed objectives and chains |
| Dialogue | Branching trees gated on reputation, capability and flags |
| Technology tree | 55 techs in 10 categories, incl. artifact-gated reconstruction |
| Save / load | 4 slots + autosave + JSON export/import |

Plus the things that hold it together: a Galactic Civilization Archive, an
archaeology journal with hypothesis/confirmation evidence, a reconstructed
timeline, and a six-stage main mystery (the Resonance) that is never explained
early.

## Controls

| Key | Action |
| --- | --- |
| `W` `S` | Thrust / reverse (ship) · walk (on foot) |
| `A` `D` | Yaw · strafe |
| `Q` `E` | Roll · excavate artifact (on foot) |
| Mouse | Look (click the canvas to capture the pointer) |
| `Shift` | Boost / sprint |
| `Space` | Brake · jump (on foot) |
| `X` | Full stop |
| `Tab` | Cycle target |
| `T` | Scan target |
| `G` | Land on planet / dock at station |
| `F` | Return to ship (on foot) · focus selection (map) |
| `V` | First / third person |
| `M` | Galactic map |
| `R` | Respawn after destruction · reset map view |
| `H` | Emergency rescue tow (when fuel is dry) |
| `E` | Scoop a nearby wreck (space) · excavate (on foot) |
| `I` `U` `K` `L` `J` `B` `A` `P` `N` | Cargo · ship · skills · tech · archaeology · civilisations · archive · missions · system map |
| `F2` | Settings: language, audio volumes, narration |
| `Esc` | Close modal → settings → panel → map → pause |

## Layout

```
index.html  styles.css     DOM shell + UI skin
src/main.js  src/Game.js   entry point + orchestrator
src/core/                 seeded RNG, event bus, clock, data loader, save system, noise
src/world/                galaxy + star system generators, name generator
src/sim/                  12 simulation systems (ship, resources, skills, tech, archive,
                          archaeology, civilisations, quests, events, FTL, combat, state)
src/render/               shaders, object factories, input, controls, 3 scenes
src/states/               state machine + space / surface / map states
src/ui/                   notifications, HUD, panels, modals, galactic map, main menu, settings
data/                     11 JSON content packs (all game content lives here)
data/i18n/                interface + content translations (`en`, `zh`)
vendor/three.module.js    Three.js r0.160.1
tests/                    simulation, content, UI, scene and playthrough suites
docs/                     design + architecture
```

All game content is data-driven: adding a civilisation, quest, technology,
resource or event is a JSON edit, validated by `tests/test_content.mjs`.

## Languages & narration

The interface is bilingual — English and Chinese — and the switch is global:
pick a language in the main menu or press `F2`, and the HUD, panels, modals,
galactic map, generated system descriptions, dialogue and quest text all change
at once, including whatever was already on screen. `data/i18n/` holds the
dictionaries; `zh` additionally carries a content pack that translates every
resource, technology, skill, civilization, artifact, quest, event, era and
dialogue line, plus the procedurally generated prose tables.
`tests/test_i18n.mjs` fails the build if a key is missing, dead or untranslated.

`F2` also holds the audio mix (master, music, SFX, ambience) and a narration
toggle: when on, transmissions, artifact analysis and mission reports are read
aloud through the browser's speech engine. Preferences persist across sessions;
with narration off the game is identical and silent.
