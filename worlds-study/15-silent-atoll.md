# 15 — Silent Atoll

> Entry level 82 · mobs level 82–110 · dungeon key `kraken_key` · sea level 133 · no gatherables

A ring of land around a drowned caldera, and everything on it is **first**: primordial, ancient,
eternal, ageless, prime, crowned. Thirty-four mobs and almost none of them are a young version of
anything — this is where the oldest things went and stopped changing. The silence in the name is
not peace, it is _nothing has happened here in an age_.

Sea level 133 drowns most of the interior. The ring is narrow, the drop inside it goes to y 16, and
the first three worlds' worth of shore instincts are useless here: **you are always either on a
rim or over deep water**.

This is the last world with gatherable resources behind it — from here on the corpus authors none,
so these five worlds are pure combat country and their biomes are laid out for encounters, not
for routes between nodes.

## The roster

Thirty-four, grouped by where they belong:

| what they are           | mobs                                                                          |
| ----------------------- | ----------------------------------------------------------------------------- |
| **the ring's crowned**  | `crabito_the_crowned`, `sunken_claw`, `golden_matron`, `razmo_the_crowned`    |
| **the deep**            | `abyss_eel`, `deep_leviathan`, `talokan_ancient`, `piranha_tyrant`            |
| **the old forest**      | `rex_primordial`, `primal_tyrant`, `saurian_god_king`, `heartwood_ancient`    |
| **the void**            | `void_eye`, `void_spawn`, `void_spawnling`, `void_necromancer`                |
| **the bone reef**       | `bonelord`, `risen_prime`, `moonfang_ancient`, `koa_the_eternal`              |
| **the cold moor**       | `ancient_tusk`, `mammoth_king`, `titan_bear`, `saberfang_ageless`             |
| **the hive**            | `scarak_hive_prime`, `empress_of_widows`, `moonclaw_empress`, `razlord_prime` |
| **the burning caldera** | `pyre_titan`, `rex_the_world_eater`, `wildlord_bjorn_prime`, `thunderscorn`   |
| **the shrine**          | `the_first_hollow`, `primordial_koa`                                          |
| **the dungeon**         | `deadmaw_the_silent` (boss, 106–110)                                          |

## The nine biomes

Temperature runs cold windward arc → burning caldera; humidity runs bare spire → open abyss.
**The ring is the middle row**; everything else is either outside it or in the hole.

|               | humidity **low** | humidity **mid** | humidity **high**   |
| ------------- | ---------------- | ---------------- | ------------------- |
| **temp low**  | `mammoth_moor`   | `bone_reefs`     | `void_shoals`       |
| **temp mid**  | `hive_spires`    | `atoll_ring`     | `abyss_drop`        |
| **temp high** | `pyre_caldera`   | `hollow_shrine`  | `primordial_jungle` |

---

### 1. `atoll_ring` — mid_mid

The ring itself: a beach on both sides at once, never more than a short walk wide. **The world's
default ground and its only road.**

- **Mobs**: `crabito_the_crowned`, `sunken_claw`, `golden_matron`, `razmo_the_crowned`
- **Profile**: 86 → 184, low and even — the ring is a causeway, not a range.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 86  | wet_sand / coral_sand / limestone    |      |
| 0.20 | 113 |                                      |      |
| 0.26 | 137 | coral_sand / sand / limestone        | 0.03 |
| 0.36 | 152 |                                      |      |
| 0.48 | 143 |                                      |      |
| 0.62 | 164 |                                      |      |
| 0.76 | 154 |                                      |      |
| 0.90 | 176 |                                      |      |
| 1    | 184 |                                      |      |

- **Structures**: the **palm pack** + `tropical_rocks` — covered once the palms are imported.

### 2. `abyss_drop` — mid_high

The inside wall of the caldera going down. The reef crest at 0.5 is the last thing you can stand
on; after that the floor falls to y 16.

- **Profile**: **the deepest ground in the game, 16** — a 117-block drop under the surface, and the
  only biome whose curve rises and then falls all the way back.
- **Mobs**: `abyss_eel`, `deep_leviathan`, `talokan_ancient`, `piranha_tyrant`

| x    | y   | land                                 | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 16  | blackstone / deep_stone / deep_stone |      |
| 0.24 | 47  |                                      |      |
| 0.36 | 82  |                                      |      |
| 0.44 | 117 |                                      |      |
| 0.50 | 137 | coral / coral_sand / limestone       | 0.03 |
| 0.58 | 121 |                                      |      |
| 0.70 | 94  |                                      |      |
| 0.82 | 59  |                                      |      |
| 1    | 27  |                                      |      |

- **Structures**: `tropical_rocks` corail on the crest only, nothing below — **covered today**.

### 3. `primordial_jungle` — high_high

The forest inside the ring, on the warm lee side. Trees older than the rest of the world and
lizards that were here before them.

- **Mobs**: `rex_primordial`, `primal_tyrant`, `saurian_god_king`, `heartwood_ancient`
- **Profile**: 94 → 231, a steady inland climb.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 94  | rich_soil / clay / limestone |      |
| 0.18 | 121 |                              |      |
| 0.24 | 145 | moss / rich_soil / limestone | 0.03 |
| 0.36 | 172 |                              |      |
| 0.48 | 160 |                              |      |
| 0.62 | 195 |                              |      |
| 0.76 | 180 |                              |      |
| 0.90 | 219 |                              |      |
| 1    | 231 |                              |      |

- **Structures**: `tropical_trees` at **maximum size and density** — **covered today**.

### 4. `hollow_shrine` — high_mid

Terraces cut into the ring's inner face, climbing to something that was a shrine before anyone
counted. **The world's landmark and the dungeon's overworld tell.**

- **Mobs**: `the_first_hollow`, `primordial_koa`, `moonclaw_empress`
- **Profile**: tread and riser, 90 → 246.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 90  | coral_sand / sand / limestone      |      |
| 0.18 | 117 |                                    |      |
| 0.24 | 141 | limestone / coral_sand / limestone | 0.03 |
| 0.34 | 149 |                                    |      |
| 0.40 | 172 |                                    |      |
| 0.54 | 180 |                                    |      |
| 0.60 | 203 |                                    |      |
| 0.74 | 211 |                                    |      |
| 0.86 | 234 |                                    |      |
| 1    | 246 |                                    |      |

- **Structures**: wants **the largest single build in the study** — a shrine complex climbing the
  terraces, half fallen. Everything else in this world is landscape; this is the thing a player
  remembers.

### 5. `void_shoals` — low_high

Shallow water on the windward side where something is bleeding through. The silt is the wrong
colour and the light does not behave.

- **Mobs**: `void_eye`, `void_spawn`, `void_spawnling`, `void_necromancer`
- **Profile**: breathes across sea level 133 — knee-deep almost everywhere, which is worse than
  deep.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 66  | void_silt / clay / deep_stone      |      |
| 0.26 | 94  |                                    |      |
| 0.36 | 109 |                                    |      |
| 0.44 | 137 | void_silt / void_silt / deep_stone | 0.04 |
| 0.54 | 121 |                                    |      |
| 0.66 | 109 |                                    |      |
| 0.78 | 135 |                                    |      |
| 0.90 | 119 |                                    |      |
| 1    | 141 |                                    |      |

- **Structures**: **crystal shards, wrong-coloured**, standing out of the shallows. Third and last
  use of the crystal pack, and the strangest.

### 6. `bone_reefs` — low_mid

Reefs built out of bone instead of coral, growing the same way coral does.

- **Mobs**: `bonelord`, `risen_prime`, `moonfang_ancient`, `koa_the_eternal`
- **Profile**: reef-shaped, 70 → 141, crest at 0.42.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 70  | bone_grit / coral_sand / limestone |      |
| 0.24 | 98  |                                    |      |
| 0.34 | 113 |                                    |      |
| 0.42 | 137 | bone_grit / bone_grit / limestone  | 0.03 |
| 0.52 | 123 |                                    |      |
| 0.64 | 111 |                                    |      |
| 0.76 | 135 |                                    |      |
| 0.88 | 121 |                                    |      |
| 1    | 141 |                                    |      |

- **Structures**: `tropical_rocks` corail, re-tinted bone-white by this world's `coral` colour —
  same trick as Palewood's birches. Covered today.

### 7. `mammoth_moor` — low_low

The cold outer arc, facing the weather. Open, grey-green, and the biggest animals in the game
standing on it.

- **Mobs**: `ancient_tusk`, `mammoth_king`, `titan_bear`, `saberfang_ageless`
- **Profile**: 90 → 242, open moorland.

| x    | y   | land                          | var  |
| ---- | --- | ----------------------------- | ---- |
| 0    | 90  | gravel / dirt / limestone     |      |
| 0.18 | 121 |                               |      |
| 0.24 | 149 | frostgrass / dirt / limestone | 0.03 |
| 0.36 | 176 |                               |      |
| 0.48 | 164 |                               |      |
| 0.62 | 203 |                               |      |
| 0.76 | 188 |                               |      |
| 0.90 | 231 |                               |      |
| 1    | 242 |                               |      |

- **Structures**: `taiga_trees` very sparse + `arctic_rocks` — **covered today**.

### 8. `hive_spires` — mid_low

Limestone spires on the outer rim, bored through by the hive until they became one structure.

- **Mobs**: `scarak_hive_prime`, `empress_of_widows`, `moonclaw_empress`, `razlord_prime`
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 117-block face.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 90  | gravel / limestone / deep_stone    |      |
| 0.14 | 133 |                                    |      |
| 0.18 | 164 | limestone / limestone / deep_stone | 0.02 |
| 0.20 | 281 |                                    |      |
| 0.28 | 305 | bone_grit / limestone / deep_stone | 0.03 |
| 0.42 | 289 |                                    |      |
| 0.56 | 336 |                                    |      |
| 0.70 | 313 |                                    |      |
| 0.84 | 363 |                                    |      |
| 1    | 383 |                                    |      |

- **Structures**: rock-pack **spires**, tall and clustered.

### 9. `pyre_caldera` — high_low

A second crater on the ring, this one still burning. Black glass floor, ash rim, and the four
largest fire-things in the game living in it.

- **Mobs**: `pyre_titan`, `rex_the_world_eater`, `wildlord_bjorn_prime`, `thunderscorn`
- **Profile**: inverted — rim 203, floor 82. Dry: the floor sits well above sea level, so this
  crater holds fire, not water.

| x    | y   | land                             | var  |
| ---- | --- | -------------------------------- | ---- |
| 0    | 203 | cinder / ash / blackstone        |      |
| 0.14 | 172 |                                  |      |
| 0.24 | 129 |                                  |      |
| 0.36 | 98  | blackstone / cinder / blackstone | 0.03 |
| 0.50 | 82  |                                  |      |
| 0.62 | 98  |                                  |      |
| 0.74 | 137 | cinder / ash / blackstone        | 0.03 |
| 0.88 | 180 |                                  |      |
| 1    | 211 |                                  |      |

- **Structures**: `scorched_rocks` + `scorched_ruins` — **covered today**.

---

## Materials

| name                                 | color                 | preset         | used by                                                  |
| ------------------------------------ | --------------------- | -------------- | -------------------------------------------------------- |
| `limestone`                          | `#958d75`             | stone          | the ring's bone                                          |
| `deep_stone`                         | `#465258`             | stone          | the abyss, spire filler                                  |
| `gravel`                             | `#766f61`             | stone          | moor, spires                                             |
| `blackstone`                         | `#373737`             | stone          | the abyss floor, the pyre caldera                        |
| `coral`                              | `#d8cfba`             | stone          | **bone-white for this world** — reef and bone reef alike |
| `clay`                               | `#76514b`             | earth          | jungle, shoals                                           |
| `rich_soil`                          | `#493a2d`             | earth          | the jungle                                               |
| `dirt`                               | `#654d36`             | earth          | the moor                                                 |
| `ash`                                | `#55504a`             | earth          | the pyre rim                                             |
| `cinder`                             | `#3a3330`             | earth          | the pyre crust                                           |
| `void_silt`                          | `#2e2a3a`             | earth          | the shoals — the one wrong colour in the world           |
| `moss`                               | `#456a4b`             | grass          | the jungle                                               |
| `frostgrass`                         | `#8fa08d`             | grass          | the moor                                                 |
| `bone_grit`                          | `#d9cfb4`             | sand           | bone reefs, spire caps                                   |
| `sand`                               | `#b9a77e`             | sand           | the ring                                                 |
| `coral_sand`                         | `#cdbb90`             | sand           | ring, shrine, reefs                                      |
| `wet_sand`                           | `#9d896b`             | sand           | the tide line                                            |
| `water`                              | `#2e609e`             | water          | everything outside the ring                              |
| `tropical_wood` / `tropical_foliage` | `#5c3c2b` / `#2b6b42` | wood / foliage | jungle and palms                                         |
| `taiga_wood` / `taiga_foliage`       | `#554536` / `#315346` | wood / foliage | the moor's few trees                                     |

## Mob rows

```json
{ "mob_type": "bonelord",             "weight_bp": 8000, "biomes": ["bone_reefs"] },
{ "mob_type": "ancient_tusk",         "weight_bp": 8000, "biomes": ["mammoth_moor"] },
{ "mob_type": "heartwood_ancient",    "weight_bp": 8000, "biomes": ["primordial_jungle"] },
{ "mob_type": "pyre_titan",           "weight_bp": 8000, "biomes": ["pyre_caldera"] },
{ "mob_type": "rex_primordial",       "weight_bp": 8000, "biomes": ["primordial_jungle"] },
{ "mob_type": "abyss_eel",            "weight_bp": 8000, "biomes": ["abyss_drop"] },
{ "mob_type": "risen_prime",          "weight_bp": 8000, "biomes": ["bone_reefs"] },
{ "mob_type": "void_eye",             "weight_bp": 8000, "biomes": ["void_shoals"] },
{ "mob_type": "deep_leviathan",       "weight_bp": 8000, "biomes": ["abyss_drop"] },
{ "mob_type": "titan_bear",           "weight_bp": 8000, "biomes": ["mammoth_moor"] },
{ "mob_type": "void_spawn",           "weight_bp": 8000, "biomes": ["void_shoals"] },
{ "mob_type": "razlord_prime",        "weight_bp": 8000, "biomes": ["hive_spires","atoll_ring"] },
{ "mob_type": "moonfang_ancient",     "weight_bp": 8000, "biomes": ["bone_reefs","mammoth_moor"] },
{ "mob_type": "void_necromancer",     "weight_bp": 8000, "biomes": ["void_shoals"] },
{ "mob_type": "void_spawnling",       "weight_bp": 8000, "biomes": ["void_shoals"] },
{ "mob_type": "primordial_koa",       "weight_bp": 8000, "biomes": ["hollow_shrine","abyss_drop"] },
{ "mob_type": "sunken_claw",          "weight_bp": 8000, "biomes": ["atoll_ring","abyss_drop"] },
{ "mob_type": "mammoth_king",         "weight_bp": 8000, "biomes": ["mammoth_moor"] },
{ "mob_type": "primal_tyrant",        "weight_bp": 8000, "biomes": ["primordial_jungle"] },
{ "mob_type": "moonclaw_empress",     "weight_bp": 8000, "biomes": ["hive_spires","hollow_shrine"] },
{ "mob_type": "saberfang_ageless",    "weight_bp": 8000, "biomes": ["mammoth_moor"] },
{ "mob_type": "talokan_ancient",      "weight_bp": 8000, "biomes": ["abyss_drop"] },
{ "mob_type": "piranha_tyrant",       "weight_bp": 8000, "biomes": ["abyss_drop"] },
{ "mob_type": "crabito_the_crowned",  "weight_bp": 8000, "biomes": ["atoll_ring"] },
{ "mob_type": "golden_matron",        "weight_bp": 8000, "biomes": ["atoll_ring"] },
{ "mob_type": "scarak_hive_prime",    "weight_bp": 8000, "biomes": ["hive_spires"] },
{ "mob_type": "razmo_the_crowned",    "weight_bp": 8000, "biomes": ["atoll_ring"] },
{ "mob_type": "wildlord_bjorn_prime", "weight_bp": 8000, "biomes": ["pyre_caldera"] },
{ "mob_type": "empress_of_widows",    "weight_bp": 8000, "biomes": ["hive_spires"] },
{ "mob_type": "koa_the_eternal",      "weight_bp": 8000, "biomes": ["bone_reefs"] },
{ "mob_type": "saurian_god_king",     "weight_bp": 8000, "biomes": ["primordial_jungle"] },
{ "mob_type": "thunderscorn",         "weight_bp": 8000, "biomes": ["pyre_caldera"] },
{ "mob_type": "rex_the_world_eater",  "weight_bp": 8000, "biomes": ["pyre_caldera"] },
{ "mob_type": "the_first_hollow",     "weight_bp": 8000, "biomes": ["hollow_shrine"] }
```

Resources: **none** — the corpus authors no gatherables for worlds 15–20.
Dungeon: unchanged (`kraken_key`).

## Structures — have / want

| biome               | reuse today                                         | want                                                                               |
| ------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `abyss_drop`        | `tropical_rocks` corail on the crest — **covered**  | —                                                                                  |
| `primordial_jungle` | `tropical_trees` at max — **covered**               | —                                                                                  |
| `bone_reefs`        | `tropical_rocks`, bone-tinted — **covered**         | —                                                                                  |
| `mammoth_moor`      | `taiga_trees` sparse + `arctic_rocks` — **covered** | —                                                                                  |
| `pyre_caldera`      | `scorched_rocks` + `scorched_ruins` — **covered**   | —                                                                                  |
| `atoll_ring`        | —                                                   | the palm pack                                                                      |
| `hive_spires`       | —                                                   | tall clustered spires                                                              |
| `void_shoals`       | —                                                   | wrong-coloured crystal shards                                                      |
| `hollow_shrine`     | —                                                   | **a fallen shrine complex climbing the terraces — the biggest build in the study** |

Five biomes ship. The one thing worth real effort is the shrine: at level 82 a player has walked
through fourteen worlds, and this should be the first structure that makes them stop.
