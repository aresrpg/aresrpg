# 14 — Charnel Marches

> Entry level 75 · mobs level 75–108 · dungeon key `war_barrow_key` · sea level 102

Thirty-four mobs, the largest roster in the game, and every one of them is a **survivor of
something**: the deathless, the undying, the eternal, the ageless, the ancient. A _march_ is a
disputed borderland and _charnel_ is where the bodies go. This is a battlefield the size of a
country that never got cleared, and the things still standing on it are the ones that could not
be killed properly.

The design problem is population, not identity: nine biomes have to hold thirty-four mobs without
any of them becoming a soup. The answer is **each biome is one kind of survivor** — the frozen,
the cloistered, the webbed, the burnt, the drowned — and the barrows in the middle are where they
all came from.

## The roster

Thirty-four, grouped by where they end up rather than listed one by one:

| what they are          | mobs                                                                                                |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| **the deathless dead** | `deathless_paragon`, `soulless_regent`, `sir_deathless`, `hades_keeper`                             |
| **the cloistered**     | `ancient_hermit`, `patient_elder`, `abbot_of_ends`                                                  |
| **the frozen**         | `glacial_sovereign`, `yeti_the_deathless`, `grizzly_the_undying`, `aberrant_hulk`                   |
| **the webbed**         | `broodfather`, `white_widow`, `spinner_prime`, `scarak_overlord`, `cocoon_king`, `silklord_ageless` |
| **the drowned**        | `talokan_tidelord`, `void_crawler`, `titan_claw`, `saurian_warlord`                                 |
| **the mired**          | `fen_dread`, `mire_titan`, `titan_koa`, `plague_razmo`                                              |
| **the burnt**          | `pyre_ember_king`, `ramrage_eternal`                                                                |
| **the pack**           | `moonfang_alpha`, `fenrik_dire`, `tuskarr_the_eternal`, `wildlord`                                  |
| **the sky**            | `woolkin_celestial`, `tempest_lord`, `rootlord_ancient`                                             |
| **the dungeon**        | `kraken_leviathan` (boss, 78–82)                                                                    |

## The nine biomes

Temperature runs frozen march → burnt pyre; humidity runs bare down → drowned coast. **The
barrows sit dead centre**, and every other biome is a direction the survivors scattered in.

|               | humidity **low**  | humidity **mid**   | humidity **high** |
| ------------- | ----------------- | ------------------ | ----------------- |
| **temp low**  | `glacial_marches` | `hermit_cloisters` | `broodfather_web` |
| **temp mid**  | `celestial_downs` | `war_barrows`      | `charnel_mire`    |
| **temp high** | `moonfang_wold`   | `ember_king_pyres` | `tidelord_strand` |

---

### 1. `war_barrows` — mid_mid

Mound after mound to the horizon, each one somebody's regiment. **The world's default ground and
its dungeon's overworld tell.**

- **Mobs**: `deathless_paragon`, `soulless_regent`, `sir_deathless`, `hades_keeper`, `patient_elder`
- **Resources**: `wheat_white` (FARMER), `diamond` (MINER)
- **Profile**: humped, 80 → 175 — the same mound-field trick as world 5's barrow steppe, at twice
  the scale.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 80  | dirt / rich_soil / stone             |      |
| 0.16 | 102 |                                      |      |
| 0.22 | 117 | dry_grass / dirt / stone             | 0.03 |
| 0.30 | 150 |                                      |      |
| 0.38 | 128 |                                      |      |
| 0.50 | 160 |                                      |      |
| 0.60 | 135 |                                      |      |
| 0.72 | 168 |                                      |      |
| 0.84 | 142 |                                      |      |
| 1    | 175 |                                      |      |

- **Structures**: **kofun mounds with stone doorways**, the same build as world 03 and far more
  of them, plus a **war gate** — the one upright thing on the field.

### 2. `charnel_mire` — mid_high

The low ground the battle was fought over, still flooded. Things the size of houses stand in it.

- **Mobs**: `fen_dread`, `mire_titan`, `titan_koa`, `plague_razmo`
- **Resources**: `cursed_fungus` (HERBALIST), `witherbloom` (HERBALIST)
- **Profile**: breathes across sea level 102, 58 → 109.

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 58  | peat / clay / stone     |      |
| 0.24 | 84  |                         |      |
| 0.32 | 95  |                         |      |
| 0.38 | 108 | rot_moss / peat / stone | 0.03 |
| 0.48 | 95  |                         |      |
| 0.58 | 106 |                         |      |
| 0.70 | 93  |                         |      |
| 0.82 | 108 |                         |      |
| 0.92 | 98  |                         |      |
| 1    | 109 |                         |      |

- **Structures**: `swamp_trees` — **covered today**.

### 3. `glacial_marches` — low_low

The frozen end of the march, where the war stopped because the ground did. Ice over stone,
sovereigns walking on it.

- **Mobs**: `glacial_sovereign`, `yeti_the_deathless`, `grizzly_the_undying`, `aberrant_hulk`
- **Resources**: `diamond` (MINER)
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 102-block ice wall.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 84  | gravel / stone / deep_stone |      |
| 0.14 | 139 |                             |      |
| 0.18 | 190 | ice / stone / deep_stone    | 0.02 |
| 0.20 | 292 |                             |      |
| 0.28 | 314 | snow / stone / deep_stone   | 0.03 |
| 0.42 | 303 |                             |      |
| 0.56 | 343 |                             |      |
| 0.70 | 321 |                             |      |
| 0.84 | 368 |                             |      |
| 1    | 383 |                             |      |

- **Structures**: `glacier_rocks` + `arctic_rocks` — **covered today**, and at last used at the
  scale they were drawn for.

### 4. `hermit_cloisters` — low_mid

Cells cut along a cold wooded shoulder, one to a hermit, all of them still occupied by people who
should have died a century ago.

- **Mobs**: `ancient_hermit`, `patient_elder`, `abbot_of_ends`, `soulless_regent`
- **Resources**: `cursed_fungus` (HERBALIST), `diamond` (MINER)
- **Profile**: tread and riser, 80 → 223 — cells stand on flat cuts.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 80  | moss / rich_soil / stone |      |
| 0.18 | 106 |                          |      |
| 0.24 | 128 | rich_soil / dirt / stone | 0.03 |
| 0.34 | 135 |                          |      |
| 0.40 | 157 |                          |      |
| 0.54 | 164 |                          |      |
| 0.60 | 186 |                          |      |
| 0.74 | 193 |                          |      |
| 0.86 | 215 |                          |      |
| 1    | 223 |                          |      |

- **Structures**: wants **a row of small cells and one hall**, spaced along the contour. Japanese
  monastery buildings; the same family as world 11's shrines, colder and poorer.

### 5. `broodfather_web` — low_high

A wood the flood took, webbed from crown to crown by six different things that all spin.

- **Mobs**: `broodfather`, `white_widow`, `spinner_prime`, `scarak_overlord`, `cocoon_king`, `silklord_ageless`
- **Resources**: `witherbloom` (HERBALIST)
- **Profile**: drowned, 62 → 113 — the trunks stand in water and the webs are above it.

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 62  | clay / clay / stone     |      |
| 0.26 | 88  |                         |      |
| 0.36 | 98  |                         |      |
| 0.44 | 111 | rot_moss / clay / stone | 0.03 |
| 0.54 | 100 |                         |      |
| 0.66 | 91  |                         |      |
| 0.78 | 109 |                         |      |
| 0.90 | 98  |                         |      |
| 1    | 113 |                         |      |

- **Structures**: `swamp_trees` drowned, at **maximum density** — **covered today**. Six spinners
  in one biome is the highest mob density in the game; the trees only have to be thick enough
  that you meet them one at a time.

### 6. `moonfang_wold` — high_low

Open dry upland where the packs run. Nothing to hide behind for a kilometre in any direction.

- **Mobs**: `moonfang_alpha`, `fenrik_dire`, `tuskarr_the_eternal`, `wildlord`
- **Resources**: `wheat_white` (FARMER), `diamond` (MINER)
- **Profile**: 84 → 212, long and open.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 84  | gravel / dirt / stone    |      |
| 0.18 | 109 |                          |      |
| 0.24 | 131 | dry_grass / dirt / stone | 0.03 |
| 0.36 | 157 |                          |      |
| 0.48 | 146 |                          |      |
| 0.62 | 179 |                          |      |
| 0.76 | 164 |                          |      |
| 0.90 | 201 |                          |      |
| 1    | 212 |                          |      |

- **Structures**: `grassland_trees` very sparse + `grassland_rocks` — **covered today**.

### 7. `ember_king_pyres` — high_mid

Where they burned the dead and never stopped. Ash to the knee, and pyres still standing lit.

- **Mobs**: `pyre_ember_king`, `ramrage_eternal`, `deathless_paragon`
- **Resources**: `witherbloom` (HERBALIST)
- **Profile**: 88 → 201.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 88  | ash / cinder / stone      |      |
| 0.18 | 113 |                           |      |
| 0.24 | 131 | cinder / ash / blackstone | 0.03 |
| 0.36 | 150 |                           |      |
| 0.48 | 139 |                           |      |
| 0.62 | 168 |                           |      |
| 0.76 | 157 |                           |      |
| 0.90 | 190 |                           |      |
| 1    | 201 |                           |      |

- **Structures**: `scorched_rocks` + `scorched_ruins` — **covered today**.

### 8. `tidelord_strand` — high_high

The coast the march runs into: warm, shallow, and full of things that came up out of it during
the war and stayed.

- **Mobs**: `talokan_tidelord`, `void_crawler`, `titan_claw`, `saurian_warlord`
- **Resources**: `cursed_fungus` (HERBALIST)
- **Profile**: breathes across sea level 102, 55 → 111.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 55  | gravel / clay / stone     |      |
| 0.24 | 80  |                           |      |
| 0.32 | 91  |                           |      |
| 0.38 | 108 | wet_sand / gravel / stone | 0.03 |
| 0.48 | 95  |                           |      |
| 0.58 | 106 |                           |      |
| 0.70 | 93  |                           |      |
| 0.82 | 108 |                           |      |
| 0.92 | 97  |                           |      |
| 1    | 111 |                           |      |

- **Structures**: rock-pack **tide slabs and groynes**; wants nothing built — the strand should
  look like the war never reached it, which makes what came out of the water worse.

### 9. `celestial_downs` — mid_low

Pale chalk downs standing higher than the barrows, where the sky-things come down. The cleanest
ground in a filthy world.

- **Mobs**: `woolkin_celestial`, `tempest_lord`, `rootlord_ancient`, `ramrage_eternal`
- **Resources**: `wheat_white` (FARMER), `cursed_fungus` (HERBALIST)
- **Profile**: 84 → 226, open and bright.

| x    | y   | land                          | var  |
| ---- | --- | ----------------------------- | ---- |
| 0    | 84  | gravel / dirt / limestone     |      |
| 0.18 | 113 |                               |      |
| 0.24 | 139 | pale_grass / dirt / limestone | 0.03 |
| 0.36 | 164 |                               |      |
| 0.48 | 153 |                               |      |
| 0.62 | 190 |                               |      |
| 0.76 | 175 |                               |      |
| 0.90 | 215 |                               |      |
| 1    | 226 |                               |      |

- **Structures**: `temperate_rocks` + rock-pack **standing stones**, in rings. The only place in
  the world that looks arranged rather than fought over.

---

## Materials

| name                                   | color                 | preset         | used by                 |
| -------------------------------------- | --------------------- | -------------- | ----------------------- |
| `stone`                                | `#707777`             | stone          | filler across the march |
| `deep_stone`                           | `#465258`             | stone          | under the ice           |
| `limestone`                            | `#958d75`             | stone          | the downs               |
| `gravel`                               | `#766f61`             | stone          | wold, strand, downs     |
| `blackstone`                           | `#373737`             | stone          | under the pyres         |
| `clay`                                 | `#76514b`             | earth          | mire, web, strand       |
| `rich_soil`                            | `#493a2d`             | earth          | barrows, cloisters      |
| `dirt`                                 | `#654d36`             | earth          | barrows, wold, downs    |
| `peat`                                 | `#3b3125`             | earth          | the mire                |
| `ash`                                  | `#55504a`             | earth          | the pyres               |
| `cinder`                               | `#3a3330`             | earth          | the pyres' crust        |
| `moss`                                 | `#456a4b`             | grass          | the cloisters           |
| `rot_moss`                             | `#3d5236`             | grass          | mire, web               |
| `dry_grass`                            | `#9a9457`             | grass          | barrows, wold           |
| `pale_grass`                           | `#b6bb9a`             | grass          | the downs               |
| `snow`                                 | `#f4f6f3`             | snow           | the glacial march       |
| `ice`                                  | `#74ccf4`             | ice            | the glacial wall        |
| `wet_sand`                             | `#9d896b`             | sand           | the strand              |
| `water`                                | `#2e609e`             | water          | mire, web, strand       |
| `taiga_wood` / `taiga_foliage`         | `#554536` / `#315346` | wood / foliage | the cloister wood       |
| `swamp_wood` / `swamp_foliage`         | `#493d32` / `#395d42` | wood / foliage | mire and web            |
| `grassland_wood` / `grassland_foliage` | `#5a4736` / `#6b7d44` | wood / foliage | the wold's lone trees   |
| `temperate_wood` / `temperate_foliage` | `#624936` / `#416f49` | wood / foliage | the downs               |

## Mob rows

```json
{ "mob_type": "aberrant_hulk",       "weight_bp": 8000, "biomes": ["glacial_marches"] },
{ "mob_type": "plague_razmo",        "weight_bp": 8000, "biomes": ["charnel_mire","war_barrows"] },
{ "mob_type": "cocoon_king",         "weight_bp": 8000, "biomes": ["broodfather_web"] },
{ "mob_type": "moonfang_alpha",      "weight_bp": 8000, "biomes": ["moonfang_wold"] },
{ "mob_type": "scarak_overlord",     "weight_bp": 8000, "biomes": ["broodfather_web"] },
{ "mob_type": "wildlord",            "weight_bp": 8000, "biomes": ["moonfang_wold","war_barrows"] },
{ "mob_type": "ancient_hermit",      "weight_bp": 8000, "biomes": ["hermit_cloisters"] },
{ "mob_type": "saurian_warlord",     "weight_bp": 8000, "biomes": ["tidelord_strand"] },
{ "mob_type": "void_crawler",        "weight_bp": 8000, "biomes": ["tidelord_strand","charnel_mire"] },
{ "mob_type": "titan_koa",           "weight_bp": 8000, "biomes": ["charnel_mire"] },
{ "mob_type": "titan_claw",          "weight_bp": 8000, "biomes": ["tidelord_strand"] },
{ "mob_type": "white_widow",         "weight_bp": 8000, "biomes": ["broodfather_web"] },
{ "mob_type": "fen_dread",           "weight_bp": 8000, "biomes": ["charnel_mire"] },
{ "mob_type": "glacial_sovereign",   "weight_bp": 8000, "biomes": ["glacial_marches"] },
{ "mob_type": "silklord_ageless",    "weight_bp": 8000, "biomes": ["broodfather_web"] },
{ "mob_type": "broodfather",         "weight_bp": 8000, "biomes": ["broodfather_web"] },
{ "mob_type": "tempest_lord",        "weight_bp": 8000, "biomes": ["celestial_downs"] },
{ "mob_type": "woolkin_celestial",   "weight_bp": 8000, "biomes": ["celestial_downs"] },
{ "mob_type": "deathless_paragon",   "weight_bp": 8000, "biomes": ["war_barrows","ember_king_pyres"] },
{ "mob_type": "spinner_prime",       "weight_bp": 8000, "biomes": ["broodfather_web"] },
{ "mob_type": "rootlord_ancient",    "weight_bp": 8000, "biomes": ["celestial_downs","hermit_cloisters"] },
{ "mob_type": "mire_titan",          "weight_bp": 8000, "biomes": ["charnel_mire"] },
{ "mob_type": "patient_elder",       "weight_bp": 8000, "biomes": ["hermit_cloisters","war_barrows"] },
{ "mob_type": "soulless_regent",     "weight_bp": 8000, "biomes": ["war_barrows","hermit_cloisters"] },
{ "mob_type": "hades_keeper",        "weight_bp": 8000, "biomes": ["war_barrows"] },
{ "mob_type": "talokan_tidelord",    "weight_bp": 8000, "biomes": ["tidelord_strand"] },
{ "mob_type": "abbot_of_ends",       "weight_bp": 8000, "biomes": ["hermit_cloisters"] },
{ "mob_type": "fenrik_dire",         "weight_bp": 8000, "biomes": ["moonfang_wold"] },
{ "mob_type": "pyre_ember_king",     "weight_bp": 8000, "biomes": ["ember_king_pyres"] },
{ "mob_type": "ramrage_eternal",     "weight_bp": 8000, "biomes": ["ember_king_pyres","celestial_downs"] },
{ "mob_type": "tuskarr_the_eternal", "weight_bp": 8000, "biomes": ["moonfang_wold"] },
{ "mob_type": "grizzly_the_undying", "weight_bp": 8000, "biomes": ["glacial_marches"] },
{ "mob_type": "sir_deathless",       "weight_bp": 8000, "biomes": ["war_barrows"] },
{ "mob_type": "yeti_the_deathless",  "weight_bp": 8000, "biomes": ["glacial_marches"] }
```

## Resource rows

```json
{ "item_type": "cursed_fungus", "job": "HERBALIST", "tier": 11, "protector": "protector_cursed_gaia",     "rare_item_type": "", "biomes": ["charnel_mire","hermit_cloisters","tidelord_strand","celestial_downs"] },
{ "item_type": "diamond",       "job": "MINER",     "tier": 11, "protector": "protector_diamond",         "rare_item_type": "", "biomes": ["glacial_marches","war_barrows","moonfang_wold","hermit_cloisters"] },
{ "item_type": "wheat_white",   "job": "FARMER",    "tier": 11, "protector": "protector_cursed_bricheton","rare_item_type": "", "biomes": ["war_barrows","moonfang_wold","celestial_downs"] },
{ "item_type": "witherbloom",   "job": "HERBALIST", "tier": 8,  "protector": "protector_wither_gaia",     "rare_item_type": "", "biomes": ["broodfather_web","charnel_mire","ember_king_pyres"] }
```

Dungeon: unchanged (`war_barrow_key`).

## Structures — have / want

| biome              | reuse today                                                | want                                                  |
| ------------------ | ---------------------------------------------------------- | ----------------------------------------------------- |
| `charnel_mire`     | `swamp_trees` — **covered**                                | —                                                     |
| `glacial_marches`  | `glacier_rocks` + `arctic_rocks` — **covered**             | —                                                     |
| `broodfather_web`  | `swamp_trees` drowned, max density — **covered**           | —                                                     |
| `moonfang_wold`    | `grassland_trees` sparse + `grassland_rocks` — **covered** | —                                                     |
| `ember_king_pyres` | `scorched_rocks` + `scorched_ruins` — **covered**          | —                                                     |
| `tidelord_strand`  | —                                                          | tide slabs, groynes — **nothing built, deliberately** |
| `celestial_downs`  | `temperate_rocks`                                          | standing stones in rings                              |
| `hermit_cloisters` | —                                                          | **a row of cells and one hall**                       |
| `war_barrows`      | —                                                          | **kofun mounds at scale + one war gate**              |

The largest world in the game is also one of the cheapest: five biomes ship as they are, because
by world 14 the existing packs finally match the register. The two builds — cells and mounds —
are both re-dresses of things worlds 03 and 11 already want.
