# Galaxy Explorer — Design

> A 3D galactic exploration and archaeology RPG. You are not the hero of a war.
> You are the person who works out what happened here — and what is still
> happening — from what the dead left behind.

---

## 1. Pillars

1. **The universe is older than you.** Every ruin, artifact and extinct
   civilisation predates the player by millions of years. Nothing was placed
   there for you. There is no quest marker on history.
2. **Knowledge is the progression.** Credits buy hull; only understanding buys
   the end of the game. Technology is *reconstructed* from alien artifacts, not
   purchased from a shop.
3. **Distance is the difficulty.** Fuel, jump range, radiation, hull integrity
   and hostile space decide where you can go. Deep space is rewarding precisely
   because it is expensive.
4. **Relations, not factions.** Civilisations are not "humans vs aliens". Four
   living cultures with real economies, war/peace cycles and dialogue that
   changes as your reputation moves.
5. **Everything is seeded.** One string generates the galaxy. The same string
   always generates the same galaxy.

---

## 2. The player fantasy

You command one ship and one spacesuit. You survey star systems, land on
worlds, walk terrain, mine what you can carry, scan what you cannot, and bring
artifacts home to be translated. Over hours of play the picture assembles: a
quantum network that linked thousands of worlds, a war fought with stellar
ignition weapons, a synchronised vanishing, and something that catalogued it all
— the **Resonance**.

The main mystery is never explained early. It advances through six stages, each
gated on *confirmed* timeline events (`data/timeline.json` → `mystery.stages`):

| Stage | Label | Gate |
| --- | --- | --- |
| m0 | Unexplained | — |
| m1 | Something is wrong with the ruins | `evFirstCities` |
| m2 | The disappearances were coordinated | `evVanishing`, `evNetworkBuild` |
| m3 | A signal predates the network | `evCoreSignal`, `evSunderingWar` |
| m4 | The Shepherd | `evShepherd`, `evStarKilling` |
| m5 | The Resonance | `evShepherd`, `evCoreSignal`, `evVanishing`, `evStarKilling` |

The final revelation reinterprets earlier events: the "necessary" star killings
(`evStarKilling`), the signal that was already waiting (`evCoreSignal`) and the
empty vaults stop being mysteries and become *cataloguing*.

---

## 3. Time budget (target balance)

| Activity | Target | Where it lives |
| --- | --- | --- |
| Exploration | ~30% | system flight, planetary landings, anomalies, region variety |
| Gathering | ~20% | asteroid mining, surface nodes, salvage, market arbitrage |
| Progression | ~15% | XP/levels, 41 skills, 55 techs, 57 ship modules |
| Civilisation interaction | ~15% | dialogue, trade, reputation, politics, missions |
| Combat | ~10% | pirates, drones, zealot patrols, Shepherd servitors |
| Archaeology | ~10% | excavation, translation, evidence, the mystery |

Combat is deliberately a minority activity: it exists to make risk real (hull,
cargo, fuel) rather than to carry the game. Every hostile type can be outrun by
a boosting ship; every hostile type can end a careless one.

---

## 4. Systems

### 4.1 The galaxy
Nine regions from the galactic bulge to the unknown regions, each with its own
palette, hazard profile and civilisation bias. ~1,100 systems in the slice,
generated from the seed with log-spiral arms; system detail is produced lazily
so the structure streams to millions (see `architecture.md` §4).

### 4.2 Flight and FTL
6DOF-lite flight with inertial drift, boost, brake and full stop; first- and
third-person cameras (`V`). Jump range is a derived ship stat; fuel cost grows
sub-linearly with distance, so short hops are cheap and galaxy-crossing jumps
are a project. `canJump()` is the single authority — the map, HUD and quests all
ask it.

### 4.3 Planetary surfaces
Procedural CPU noise terrain with per-biome colouring by height and slope,
atmosphere, scattered props, resource nodes and ruin sites. Walking is
first/third person with sprint and jump. Hazards are real: radiation, toxicity
and gravity eat hull unless life support and skills offset them.

### 4.4 Scanning
`Tab` cycles targets, `T` scans. Scan range and resolution are ship stats;
scanning a body yields a dossier, archive entry and XP, and is a prerequisite
for survey missions. Anomalies and ruins have their own scan results.

### 4.5 Resources and economy
19 resources with tier, category, base price and volatility. Cargo capacity is
a ship stat; mining yield is a ship stat; market prices move with a
civilisation's economic profile. Station services price repairs at 12 ¢ per hull
point and fuel at the local `fuelPrice`.

### 4.6 Ship development
14 slots, 57 modules. Derived stats (thrust, jump range/efficiency, power
output/draw, shield and regen, hull and regen, weapon damage/rate/range, cargo,
mining yield/rate, scan range/resolution, analysis/translation/excavation,
research, hazard resist, drones, automation) are recomputed from the loadout,
then modified by skills and technology capabilities. Overloaded power browns out
shields and thrust.

### 4.7 Character progression
XP from scans, landings, kills, excavations, analysis and jumps. Levels grant
skill points; 41 skill nodes across 8 archetypes (explorer, scientist, engineer,
archaeologist, diplomat, soldier, xenobiologist, AI researcher) feed ship stats
and interaction odds.

### 4.8 Technology
55 technologies in 10 categories, researched with research points + materials.
The `unknown` category is gated by `requiresArtifact`: those technologies can
only be *reconstructed* by analysing the right artifact, which is what makes
exploration the source of power.

---

## 5. Archaeology — the core loop

Ruins are historical puzzle pieces, not loot containers.

1. **Find** a ruin (scan the system, land, walk to the site).
2. **Excavate** an artifact (`E`). It enters the journal with a tier, a
   civilisation tag and an era — but no explanation.
3. **Analyse** it in the lab. Success depends on the ship's `analysis` and
   `translation` stats and skills. Failure still yields a *partial reading*.
4. Each artifact `supports` one or more scripted timeline events. One supporting
   artifact = a **hypothesis**; two independent artifacts = **confirmed
   evidence**. Three scripted hypotheses deliberately conflict, and conflicting
   readings stay in the journal until resolved.
5. Confirmed events advance the mystery stage and can reconstruct an `unknown`
   technology.

Artifacts also unlock technologies (`techTag` → `requiresArtifact`), feed the
Galactic Civilization Archive, and complete archaeology quests. There are no
immediate answers: the journal is a hypothesis workspace, and the timeline view
is reconstructed from *your* evidence.

---

## 6. Civilisations

Four living cultures, each with a template describing economy, politics,
dialogue tree, species and region bias:

| Civ | Character |
| --- | --- |
| Terran Concord | Expansionist, bureaucratic, the player's starting frame of reference |
| Vherrathi | Militaristic honour culture; patrols their space; war and peace are reachable states |
| Kelthari | Song/archive culture; trades in knowledge and strange physics |
| Ashen Remnant | Post-catastrophe survivors; suspicious, useful, fragile |

Five extinct civilisations (Aelthera, Synthari, Korrathi, Veshari, Shepherd) are
known only through their ruins and artifacts.

Relations evolve dynamically: reputation moves from dialogue, missions, trade
and combat; it gates dialogue options (`requires.capability/reputation/flag`),
market prices, station services and whether a system is claimed, contested or
open. Nothing is a binary ally/enemy switch.

---

## 7. Quests and events

12 quests, from the opening survey (`q_firstSurvey`) through archaeology
(`q_ruinSignal`, `q_translation`), civilisation arcs (`q_veshari`,
`q_kelthariSongs`, `q_perseusSurvey`) and the finale (`q_vanishing`,
`q_theQuestion`). Objectives are typed (`scanSystem`, `collectResource`,
`analyzeArtifact`, `researchTech`, `reachRegion`, `talkTo`, `returnTo`, …), so
progress is tracked by the simulation rather than by scripts.

14 dynamic events are weighted and context-gated (in system, near a ruin, near a
black hole, deep space, civilisation present, anomaly density). Every choice has
a written outcome and persistent effects — flags, reputation, damage, artifacts,
credits. Events are narrative moments, not random loot rolls.

---

## 8. Risk and reward in deep space

* **Fuel** — every jump costs fuel; refuelling costs credits; running dry means a
  rescue tow at a steep price.
* **Hull** — combat, hazards and landings all damage the same hull; destruction
  costs 4,000 ¢ and your position.
* **Power** — modules draw power; overload browns out shields and engines.
* **Radiation / toxicity / gravity** — surface exposure scales with the world and
  is offset by life support and skills.
* **Navigation** — jump range limits which regions are reachable at all; the
  unknown regions are gated behind drive tier and hazard resist.
* **Hostiles** — pirates, drones, zealot patrols and Shepherd servitors scale
  with region danger; bounties and wreck salvage pay for the risk.
* **Anomalies** — high hazard, high yield: exotic resources and artifact caches.

---

## 9. Content authoring

Add a civilisation: a `civilizations.json` template (dialogue tree, economy,
politics, species) — the generator places it in its home region automatically.
Add a quest: a `quests.json` entry with typed objectives. Add a technology: a
`technologies.json` entry; gate it behind an artifact by giving it
`requiresArtifact` and a matching `techTag` on an artifact. Add an event: an
`events.json` entry with `requires` context and choices. `tests/test_content.mjs`
validates every cross-reference, so a typo fails the test run instead of the
game.

## 10. Out of scope for the slice (and why)

* **Multi-crew / base building** — the vertical slice is one ship, one suit, one
  mystery; the architecture (data-driven quests, civ templates, ship slots) is
  built to absorb them.
* **Full galaxy at billions of systems** — the slice ships ~1,100 detailed
  systems with lazy generation; the descriptor format is designed to stream
  (see `architecture.md` §4).
* **Procedural dialogue text** — dialogue is authored (voice matters more than
  volume); only names, summaries and event text are generated.
