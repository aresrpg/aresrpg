# worlds-study — biome design for the 20 worlds

One spec per world. Each spec turns a world's NAME + its EXISTING mob roster into a set of
biomes: names that fit both, a mob→biome assignment, a landscape spline per biome, and the
structure packs that biome wants (with the search terms to hunt them on
planetminecraft.com/projects/tag/pack/?share=schematic).

**Nothing here reassigns a mob to another world.** A world's roster is fixed truth; the study
only decides which _biome inside that world_ each mob lives in.

## The method (per world)

1. **Read the world's name.** `01_first_shore` is a shore. It gets no mountains.
2. **Read the roster's icons**, not their slugs. `wooling` is a baby sheep → it needs grass.
   `bonelet` is a small skeleton → it needs a place where things died.
3. **Group the roster by family** (see [00-mob-families.md](00-mob-families.md)) and read what
   habitat each family is asking for.
4. **Name 9 biomes** that satisfy both the world name and the habitats. Shore + baby sheep →
   `shore_plains`. The name is the design brief: "shore plains" already tells you the spline
   (low, green, near the water) and the structures (hedges, a fishing hut).
5. **Write the spline + strata + structure packs** from that name, and hand the pack list to
   the schematic hunt.

## The authoring contract (from the engine, not invented here)

A world's `terrain` block in `seed/content/worlds.json`:

- `seed` (string), `sea_level` (0–383), `liquid` (a material name), `materials`, `biomes`,
  `biome_slots`.
- **`biome_slots` is a 3×3 grid**: `<temperature>_<humidity>`, each of `low|mid|high`, all nine
  required, each naming an authored biome. Bands are full through 0.3 / 0.4–0.6 / from 0.7 with
  0.1 smooth transitions, so all nine slots are genuinely visible. A biome may fill several
  slots. Climate fields have an 8,192-block period — a biome region is far bigger than a zone.
- **A biome** = `name` + `landscape` (the spline) + optional `structure_packs`.
- **The spline** is a piecewise-linear curve over the _ground_ field: `x` 0→1 (strictly
  increasing), `y` = surface height in the absolute 0–383 block domain. The ground field's scale
  is ~2,000 blocks, so a player crosses several knots inside one horizon. A knot may carry
  `land: {surface, subsurface, filler}` — the strata from that x onward — plus `variance`
  (≤0.25) to fuzz that material border. The first knot MUST carry `land`.
  Slope also exposes strata: ≥2 shows subsurface, ≥4 shows filler. A cliff face therefore
  shows what you author under the turf.
- **Every world reaches y 383 somewhere; individual biomes do not.** The full world must use the
  vertical budget without erasing its relief hierarchy: beaches stay low, shores rise into hills,
  ravines cut below them, and only fitting peaks, rims, spires or walls reach the ceiling. Sea level
  belongs to the world and may move to make that composition work. Never paste a meaningless y 383
  spike into every biome or stretch shallow terrain until its gameplay identity disappears.
- **Materials**: `{ color: '#rrggbb', preset }` where preset ∈ stone, earth, grass, wood,
  foliage, sand, snow, ice, water. Max 64 compiled materials per world. Ground clutter
  (grasses, flowers, pebbles) derives from the preset + color — a biome never authors decoration.
- **Structure packs** live in `seed/content/structure_packs.json`; a biome only names them.
  A pack = category (`trees` | `rocks` | `ruins`), `spacing`, `density_bp`, `max_slope`, `bury`,
  and weighted `types`. The types are voxel schematics in `seed/structures/types.json`.
- **THE PACK NAMING LAW**: `scripts/import_schematics.ts` derives a schematic's materials from
  the _first token of its type name_. `driftwood_pine_g1` → logs/planks become `driftwood_wood`,
  leaves become `driftwood_foliage`, and **those materials must exist in the world's palette**
  or the seed validator reds. Stone→`stone`, sand→`sand`, gravel→`gravel`, grass/moss→`moss`,
  ice→`ice`, snow→`snow`, mud/podzol→`rich_soil`, dirt→`dirt` (fixed rules, not authored).
  Every spec below lists the materials each new pack prefix requires.
- **Mob rows**: once a world has terrain, `mobs` stops being a `{name: weight}` map and becomes
  rows of `{ mob_type, weight_bp, biomes: [names] }` — a mob's biome set is a fact of the MOB
  (DECISIONS 2026-08-14). Same for `resources`. A row naming an unknown biome reds the gate.
  Weights bias the pick; there is no per-zone family cap.
- **Biome id = index in the `biomes` array** (u8, ≤255) and the chain learns each zone's biome
  from `scripts/derive_biome_map.mjs`, which runs the engine's own sampler. Reordering the
  array after a publish changes every zone's biome — append, never reorder.

Study gate: `bun scripts/check_world_specs.ts`. Seed gate: `bun scripts/validate_seed.mjs`.
Preview: the /demo composition lab renders an edited recipe live (spline edits rebuild real
voxels).

## Index

All twenty specs are written and **machine-validated**: every knot table below was parsed back
out of its own markdown and run through the engine's `validate_world_recipe` plus
`sample_biome_grid`, along with checks that every mob and resource in the corpus lands in a biome,
that no spec invents one, that all nine climate slots are filled, and that every material a
stratum names exists in that world's palette. All twenty pass.

| #   | World                                          | Entry | Levels  | Dungeon key               | Biomes | Roof | What it is                                            |
| --- | ---------------------------------------------- | ----- | ------- | ------------------------- | ------ | ---- | ----------------------------------------------------- |
| 01  | [The First Shore](01-first-shore.md)           | 1     | 1–12    | `sounding_hull_key`       | 9      | 383  | **rebuilds** the 9 generic biomes it ships today      |
| 02  | [Verdant Hollow](02-verdant-hollow.md)         | 1     | 1–15    | `root_cellar_key`         | 9      | 383  | farm valley gone quiet                                |
| 03  | [Emberfall Steppe](03-emberfall-steppe.md)     | 10    | 10–24   | `phacochere_key`          | 9      | 383  | steppe, camps, barrows, a grey shore                  |
| 04  | [Mistral Heights](04-mistral-heights.md)       | 14    | 14–30   | `dungeon_key_goblin_cave` | 9      | 383  | first real mountain; water only at the fjord          |
| 05  | [Drowned Fen](05-drowned-fen.md)               | 18    | 18–32   | `flooded_nave_key`        | 9      | 383  | wading depth everywhere; fen gas burns                |
| 06  | [Pandora Reach](06-pandora-reach.md)           | 22    | 22–38   | `hollow_root_key`         | 9      | 383  | three countries in one horizon                        |
| 07  | [Cinderforge Depths](07-cinderforge-depths.md) | 30    | 30–47   | `core_forge_key`          | 8      | 383  | descent, not caves                                    |
| 08  | [Palewood](08-palewood.md)                     | 34    | 34–50   | `ensable_key`             | 8      | 383  | white wood standing in water; re-tinted packs         |
| 09  | [Coral Throne](09-coral-throne.md)             | 40    | 40–60   | `tide_throne_key`         | 9      | 383  | island inside its reef; the palms land here           |
| 10  | [Sunspire Dunes](10-sunspire-dunes.md)         | 45    | 45–65   | `nerak_key`               | 9      | 383  | burial desert; water is an event                      |
| 11  | [Rootheart](11-rootheart.md)                   | 52    | 52–72   | `key_aragog`              | 9      | 383  | snow on top, roots warm underneath                    |
| 12  | [Static Fields](12-static-fields.md)           | 60    | 60–80   | `charged_vault_key`       | 6      | 383  | flat on purpose; the sky is the content               |
| 13  | [Mirrormere](13-mirrormere.md)                 | 68    | 68–90   | `sunken_mere_key`         | 8      | 383  | a lake that doubles everything                        |
| 14  | [Charnel Marches](14-charnel-marches.md)       | 75    | 75–108  | `war_barrow_key`          | 9      | 383  | 34 mobs, one kind of survivor per biome               |
| 15  | [Silent Atoll](15-silent-atoll.md)             | 82    | 82–110  | `kraken_key`              | 9      | 383  | ring of land round a drowned caldera                  |
| 16  | [The Sundering](16-the-sundering.md)           | 95    | 100–125 | `hades_key`               | 5      | 383  | no wood at all; shards and a gate                     |
| 17  | [Obsidian Choir](17-obsidian-choir.md)         | 110   | 110–145 | `velkarion_key`           | 5      | 383  | a cathedral made by a volcano                         |
| 18  | [Abyssal Weald](18-abyssal-weald.md)           | 125   | 125–165 | `anglerdeep_key`          | 6      | 383  | **needs no download** — every biome ships today       |
| 19  | [Hollow Crown](19-hollow-crown.md)             | 145   | 145–185 | `gods_maw_key`            | 6      | 383  | the game's roof; a maw that drops 227                 |
| 20  | [Zenith Scar](20-zenith-scar.md)               | 170   | 170–200 | `wound_key`               | 5      | 383  | a wound being stitched; smallest builds, most of them |

Only world 01 has a terrain recipe today; 02–20 have mobs, resources and a dungeon but no terrain
at all, so they cannot be entered. Each spec is what makes its world enterable.

## The asset budget these specs were written against

We are not designing for assets we might buy later. Everything below is what exists now or is one
free download away:

- **168 structure types in 18 packs** — the legacy dapp's terrain schematics (82 trees, 82 rocks)
  plus 4 generated ruin stubs. No built structure exists in the game today: no house, no wall, no
  boat, no tower.
- **A palm pack**, a **10,000-piece rock and crystal pack**, an **800-build Japanese house pack**,
  and a second **rocks pack**. Rocks and crystals are effectively unlimited; every building in
  every world comes from the Japanese pack.
- `misc/schematics.zip` adds 8 boulders (Sponge **v3**, which the importer cannot read — it parses
  v2 only) and 29 of Luna's palms, of which 11 import clean today. The rest fail on `skull`,
  `player_wall_head`, `jungle_trapdoor`, `composter` and `chiseled_quartz_block`; each needs one
  line in `scripts/import_schematics.ts`.

**Japanese architecture is not a compromise here, it is the house style.** All twelve character
classes are Japanese words (`shugo`, `tomoda`, `rojin`, `yajin`, `tokei`, `asobi`, `iyashi`,
`senshi`, `yogan`, `mori`, `ikari`, `shusen`), and the roster already contains a _yurei_ abbot and
a nine-tailed kitsune. A rural Japanese pack gives terraced farms, shrines, gates, stilt houses,
storehouses, tomb roads and cliff temples — which is, biome for biome, the exact list these twenty
worlds ask for.

**Two design levers cost nothing.** Materials are authored per world, so the same pack looks
different in each one — `grassland_trees` is brown oak in world 02 and bone-white birch in world 08. And a biome may leave its structure list empty: the salt pans, the mirror shallows and the
oracle sink are deliberately bare, and that reads as intent rather than as missing content.

**One want no pack can fill**: a root arch you can walk under (worlds 06 and 11). It is likely a
generated type, the way the four existing ruins are.
