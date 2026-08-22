# 02 — Verdant Hollow

> Entry level 1 · mobs level 1–15 · dungeon key `root_cellar_key` · sea level 148

A deep green valley of farmsteads that nobody works any more. The roster is almost entirely
**domestic** — a hen, a chick, a ram, two sheep, a barn cat, a scarecrow, a wheat snake, a thing
living in a crate — and the dungeon is a **root cellar** under a farm whose boss is _Hogrune the
Sown_. This is not wilderness. It is somebody's land, still fenced, still terraced, with the
people gone. The world's shape should say that before a single mob appears: hedgerows that still
divide fields, terraces that still hold, an orchard still in rows.

Second starter world, so it shares world 01's level floor — a player picks between a coast and a
farm valley, not between easy and hard.

## The roster

| mob                  | lvl        | what the icon shows          | the habitat it asks for            |
| -------------------- | ---------- | ---------------------------- | ---------------------------------- |
| `plaza_pecker`       | 1–3        | yellow chick                 | a yard, near people                |
| `koaletin`           | 1–4        | small blue toad              | the creek                          |
| `stray_kit`          | 2–4        | dark barn cat                | hedgerows, outbuildings            |
| `wooligan`           | 3–6        | dark brown sheep, white face | pasture                            |
| `pecker`             | 3–5        | magenta bird                 | the rooftops that are left         |
| `koa`                | 5–12       | blue toad, grown             | slow water                         |
| `cluckling`          | 5–8        | white hen, red comb          | the yard                           |
| `strawman`           | 6–10       | wooden scarecrow figure      | the standing crop                  |
| `wheat_slither`      | 6–9        | golden wheat-coloured snake  | the standing crop                  |
| `young_parasite`     | 1–6        | crate with glowing eyes      | stores, cellars                    |
| `nerakling_marrow`   | 8–14       | small skeleton               | under the ground, in the wet       |
| `hornhead`           | 8–14       | white ram, gold horns        | the dry ridge                      |
| `tikling`            | 8–14       | small gold cat               | sunny walls, orchard               |
| `silkling`           | 9–14       | pale cocoon                  | eaves, hollow trees                |
| `wanilla_the_pretty` | 4–6 archi  | white sheep                  | the best pasture                   |
| `hogrune_the_sown`   | 11–15 boss | boar lit green from inside   | **dungeon only** — the root cellar |

## The nine biomes

Temperature runs shaded valley floor → sunny southern slope; humidity runs bare ridge → creek.
The hollow is ringed by one dry limestone ridge, and everything inside it is farmed ground at
some stage of going back to seed.

|               | humidity **low**  | humidity **mid**  | humidity **high** |
| ------------- | ----------------- | ----------------- | ----------------- |
| **temp low**  | `hornstone_ridge` | `mosswood_dell`   | `sunken_garths`   |
| **temp mid**  | `bramble_hedge`   | `hollow_meadow`   | `willow_creek`    |
| **temp high** | `orchard_rows`    | `barley_terraces` | `shrine_copse`    |

---

### 1. `hollow_meadow` — mid_mid

The valley floor: grazed grass, a fence line going over every rise, sheep that nobody counts.
**The starter biome.**

- **Mobs**: `wooligan`, `wanilla_the_pretty`, `cluckling`, `koaletin`
- **Resources**: `wheat_barley` (FARMER)
- **Profile**: creek bed at 136 rising to a 229 shoulder — gentle rolls, nothing to climb.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 136 | rich_soil / clay / limestone         |      |
| 0.16 | 154 |                                      |      |
| 0.20 | 167 | meadow / dirt / limestone            | 0.03 |
| 0.34 | 185 |                                      |      |
| 0.48 | 176 |                                      |      |
| 0.62 | 204 |                                      |      |
| 0.78 | 195 |                                      |      |
| 0.90 | 219 |                                      |      |
| 1    | 229 |                                      |      |

- **Structures**: `grassland_trees` (birch/oak, thinned to a field-margin density) + `grassland_rocks`
  today. Wants **fence lines, a field gate, a stone trough** — the smallest props in the Japanese
  house pack read as exactly this once colour is stripped.

### 2. `willow_creek` — mid_high

The creek that made the hollow. Willows in the water, gravel bars, frogs.

- **Mobs**: `koa`, `koaletin`, `nerakling_marrow`
- **Resources**: `red_orchid` (HERBALIST)
- **Profile**: the water table is the design — everything breathes ±15 around sea level 148.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 111 | clay / gravel / limestone    |      |
| 0.18 | 136 |                              |      |
| 0.26 | 145 |                              |      |
| 0.32 | 158 | rich_soil / clay / limestone | 0.03 |
| 0.40 | 142 |                              |      |
| 0.50 | 161 | moss / rich_soil / limestone | 0.03 |
| 0.60 | 145 |                              |      |
| 0.72 | 164 |                              |      |
| 0.84 | 148 |                              |      |
| 0.94 | 170 |                              |      |
| 1    | 154 |                              |      |

- **Structures**: `swamp_trees` — the willow/dead-tree set is already right. Wants **a plank
  footbridge and a water wheel**; both exist in any Japanese village pack.

### 3. `barley_terraces` — high_mid

The terraces, still holding, still full of standing crop that reseeds itself. Scarecrows that
were never taken in.

- **Mobs**: `strawman`, `wheat_slither`, `plaza_pecker`, `pecker`
- **Resources**: `wheat_barley` (FARMER), `amber` (MINER — in the terrace walls)
- **Profile**: flat treads with step risers. The steps are the whole point; do not smooth them.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 142 | dirt / rich_soil / limestone |      |
| 0.18 | 167 |                              |      |
| 0.22 | 185 | meadow / dirt / limestone    | 0.03 |
| 0.36 | 192 |                              |      |
| 0.42 | 216 |                              |      |
| 0.56 | 222 |                              |      |
| 0.62 | 247 |                              |      |
| 0.78 | 253 |                              |      |
| 0.86 | 278 | grass / dirt / limestone     | 0.03 |
| 1    | 284 |                              |      |

- **Structures**: nothing existing fits. Wants **terrace retaining walls, a rice/grain barn, a
  drying rack, a farmhouse shell** — the Japanese pack's rural buildings, which are terraced
  farmland architecture by default.

### 4. `orchard_rows` — high_low

The sunny side: fruit trees still in their planted rows, grass gone to hay between them, a cat
on every wall.

- **Mobs**: `tikling`, `stray_kit`, `pecker`, `silkling`
- **Resources**: `amber` (MINER)
- **Profile**: a long open slope, 148 → 278.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 148 | dirt / rich_soil / limestone |      |
| 0.16 | 173 |                              |      |
| 0.22 | 195 | grass / dirt / limestone     | 0.03 |
| 0.34 | 219 |                              |      |
| 0.46 | 210 |                              |      |
| 0.60 | 241 |                              |      |
| 0.72 | 232 |                              |      |
| 0.86 | 266 |                              |      |
| 1    | 278 |                              |      |

- **Structures**: `grassland_trees` — but the pack must be **re-cut for rows**: an orchard reads
  as an orchard only because the trees line up, and the placement rule is a grove field, not a
  grid. If rows are impossible, the biome still works as a hay slope with scattered fruit trees.

### 5. `bramble_hedge` — mid_low

Field country where the hedges won. Banked hedgerows two blocks high dividing plots nobody
sowed, and everything small living inside them.

- **Mobs**: `stray_kit`, `tikling`, `silkling`
- **Resources**: `wheat_barley` (FARMER)
- **Profile**: lumpy — the hedge banks themselves are terrain, not decoration.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 142 | dirt / rich_soil / stone |      |
| 0.14 | 167 |                          |      |
| 0.20 | 182 | grass / dirt / stone     | 0.03 |
| 0.30 | 210 |                          |      |
| 0.38 | 192 |                          |      |
| 0.50 | 225 |                          |      |
| 0.60 | 204 |                          |      |
| 0.72 | 241 |                          |      |
| 0.84 | 216 |                          |      |
| 1    | 253 |                          |      |

- **Structures**: `grassland_rocks` + `temperate_trees`. Wants **hedge-bank props: a stile, a
  gate, a collapsed dry wall**. Low value — the terrain carries this one.

### 6. `mosswood_dell` — low_mid

The shaded north side, where the wood was never cleared. Deep leaf mould, mushrooms, and the
things that live in what people left behind.

- **Mobs**: `young_parasite`, `nerakling_marrow`, `silkling`
- **Resources**: `red_orchid` (HERBALIST)
- **Profile**: a steady climb into closed canopy, 136 → 259.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 136 | moss / rich_soil / stone |      |
| 0.16 | 161 |                          |      |
| 0.24 | 179 |                          |      |
| 0.36 | 198 | rich_soil / dirt / stone | 0.03 |
| 0.48 | 188 |                          |      |
| 0.60 | 216 | moss / rich_soil / stone | 0.03 |
| 0.74 | 207 |                          |      |
| 0.88 | 241 |                          |      |
| 1    | 259 |                          |      |

- **Structures**: `temperate_trees` + `temperate_rocks` — covered today, nothing needed.

### 7. `sunken_garths` — low_high

The kitchen gardens below the farms, waterlogged since the ditches stopped being cleared. Cellar
mouths open at ground level and go dark. **The dungeon's overworld tell.**

- **Mobs**: `nerakling_marrow`, `koa`, `young_parasite`
- **Resources**: `red_orchid` (HERBALIST)
- **Profile**: peat and standing water breathing around sea level 148 — half the ground field is under water, which is what makes it _waterlogged_ rather than merely damp.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 111 | clay / clay / limestone      |      |
| 0.20 | 133 |                              |      |
| 0.28 | 142 |                              |      |
| 0.34 | 158 | rich_soil / clay / limestone | 0.03 |
| 0.44 | 139 |                              |      |
| 0.54 | 154 | moss / peat / limestone      | 0.03 |
| 0.66 | 136 |                              |      |
| 0.78 | 158 |                              |      |
| 0.90 | 142 |                              |      |
| 1    | 161 |                              |      |

- **Structures**: `swamp_trees` + `swamp_ruins`. Wants **a cellar mouth / stone doorway set into
  a bank** — one small type, placed often. This is the single most valuable new structure in the
  world, because it is the dungeon door.

### 8. `hornstone_ridge` — low_low

The dry limestone rim that makes the hollow a hollow. Thin turf, bare rock, rams on the skyline.

- **Mobs**: `hornhead`, `wooligan`
- **Resources**: `amber` (MINER)
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 117-block scarp, so the slope rule
  strips the turf and shows limestone — the ridge reads as rock, not as a grass hill.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 142 | gravel / limestone / deep_stone    |      |
| 0.14 | 179 |                                    |      |
| 0.18 | 204 | limestone / limestone / deep_stone | 0.02 |
| 0.20 | 321 |                                    |      |
| 0.28 | 340 | dry_grass / dirt / limestone       | 0.03 |
| 0.42 | 327 |                                    |      |
| 0.56 | 358 |                                    |      |
| 0.70 | 334 |                                    |      |
| 0.84 | 364 |                                    |      |
| 1    | 383 |                                    |      |

- **Structures**: `taiga_rocks` as a stand-in today; wants **limestone scars and cairns** — one
  cheap pull from the rock/crystal pack.

### 9. `shrine_copse` — high_high

The warm wet copse at the head of the valley, with the shrine the farms used to walk to. Still
swept by nobody.

- **Mobs**: `cluckling`, `tikling`, `hornhead`, `silkling`
- **Resources**: `red_orchid` (HERBALIST), `amber` (MINER)
- **Profile**: a low wooded knoll, 130 → 247.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 130 | rich_soil / clay / limestone |      |
| 0.18 | 154 |                              |      |
| 0.24 | 173 | moss / rich_soil / limestone | 0.03 |
| 0.36 | 195 |                              |      |
| 0.50 | 182 |                              |      |
| 0.62 | 213 |                              |      |
| 0.76 | 201 |                              |      |
| 0.90 | 235 |                              |      |
| 1    | 247 |                              |      |

- **Structures**: `temperate_trees` today. Wants **a small shrine and a gate** — the one build in
  this world that should be unmistakable from a distance, because it is the only thing in the
  hollow that was not built to feed anybody.

---

## Materials

| name                                   | color                 | preset         | used by                               |
| -------------------------------------- | --------------------- | -------------- | ------------------------------------- |
| `stone`                                | `#707777`             | stone          | filler, hedge/dell                    |
| `deep_stone`                           | `#465258`             | stone          | ridge filler                          |
| `limestone`                            | `#958d75`             | stone          | the ridge, every filler in the valley |
| `gravel`                               | `#766f61`             | stone          | creek bars, ridge foot                |
| `dirt`                                 | `#654d36`             | earth          | field subsurface                      |
| `rich_soil`                            | `#493a2d`             | earth          | valley floor, dell                    |
| `clay`                                 | `#76514b`             | earth          | creek, garths                         |
| `peat`                                 | `#3b3125`             | earth          | the waterlogged garths                |
| `grass`                                | `#668047`             | grass          | orchard, hedge, terrace tops          |
| `meadow`                               | `#89984e`             | grass          | the hollow floor, the terraces        |
| `moss`                                 | `#456a4b`             | grass          | dell, creek, copse                    |
| `dry_grass`                            | `#9a9457`             | grass          | the ridge cap                         |
| `water`                                | `#2e609e`             | water          | the creek                             |
| `grassland_wood` / `grassland_foliage` | `#76543a` / `#64843e` | wood / foliage | orchard, hedge, meadow margins        |
| `temperate_wood` / `temperate_foliage` | `#624936` / `#416f49` | wood / foliage | dell, copse                           |
| `swamp_wood` / `swamp_foliage`         | `#493d32` / `#395d42` | wood / foliage | creek willows, garths                 |

## Mob rows

```json
{ "mob_type": "young_parasite",     "weight_bp": 8000, "biomes": ["mosswood_dell","sunken_garths"] },
{ "mob_type": "plaza_pecker",       "weight_bp": 8000, "biomes": ["barley_terraces"] },
{ "mob_type": "koaletin",           "weight_bp": 8000, "biomes": ["willow_creek","hollow_meadow"] },
{ "mob_type": "stray_kit",          "weight_bp": 8000, "biomes": ["bramble_hedge","orchard_rows"] },
{ "mob_type": "wooligan",           "weight_bp": 8000, "biomes": ["hollow_meadow","hornstone_ridge"] },
{ "mob_type": "pecker",             "weight_bp": 8000, "biomes": ["orchard_rows","barley_terraces"] },
{ "mob_type": "koa",                "weight_bp": 8000, "biomes": ["willow_creek","sunken_garths"] },
{ "mob_type": "cluckling",          "weight_bp": 8000, "biomes": ["hollow_meadow","shrine_copse"] },
{ "mob_type": "strawman",           "weight_bp": 8000, "biomes": ["barley_terraces"] },
{ "mob_type": "wheat_slither",      "weight_bp": 8000, "biomes": ["barley_terraces"] },
{ "mob_type": "nerakling_marrow",   "weight_bp": 8000, "biomes": ["sunken_garths","mosswood_dell","willow_creek"] },
{ "mob_type": "hornhead",           "weight_bp": 8000, "biomes": ["hornstone_ridge","shrine_copse"] },
{ "mob_type": "tikling",            "weight_bp": 8000, "biomes": ["orchard_rows","bramble_hedge","shrine_copse"] },
{ "mob_type": "silkling",           "weight_bp": 8000, "biomes": ["orchard_rows","bramble_hedge","mosswood_dell","shrine_copse"] },
{ "mob_type": "wanilla_the_pretty", "weight_bp": 1131, "biomes": ["hollow_meadow"] }
```

## Resource rows

```json
{ "item_type": "amber",        "job": "MINER",     "tier": 2, "protector": "protector_amber",             "rare_item_type": "", "biomes": ["hornstone_ridge","barley_terraces","orchard_rows","shrine_copse"] },
{ "item_type": "red_orchid",   "job": "HERBALIST", "tier": 2, "protector": "protector_orchid_gaia",       "rare_item_type": "", "biomes": ["mosswood_dell","willow_creek","sunken_garths","shrine_copse"] },
{ "item_type": "wheat_barley", "job": "FARMER",    "tier": 2, "protector": "protector_barley_bricheton",  "rare_item_type": "", "biomes": ["barley_terraces","hollow_meadow","bramble_hedge"] }
```

Dungeon: unchanged (`root_cellar_key`; `young_parasite`+`plaza_pecker`, `koa`+`cluckling`,
`hogrune_the_sown`+`silkling`).

## Structures — have / want

| biome             | reuse today                                         | want                                                        |
| ----------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `mosswood_dell`   | `temperate_trees` + `temperate_rocks` — **covered** | —                                                           |
| `willow_creek`    | `swamp_trees` — **covered**                         | plank footbridge, water wheel                               |
| `bramble_hedge`   | `grassland_rocks`, `temperate_trees`                | stile, gate, collapsed wall                                 |
| `hollow_meadow`   | `grassland_trees`, `grassland_rocks`                | fence line, field gate, trough                              |
| `orchard_rows`    | `grassland_trees` (wants row placement)             | —                                                           |
| `sunken_garths`   | `swamp_trees`, `swamp_ruins`                        | **a cellar mouth in a bank — the dungeon door**             |
| `hornstone_ridge` | `taiga_rocks` as stand-in                           | limestone scars, cairns                                     |
| `barley_terraces` | nothing                                             | **terrace walls, grain barn, drying rack, farmhouse shell** |
| `shrine_copse`    | `temperate_trees`                                   | **a shrine and its gate**                                   |

The Japanese house pack covers the terraces, the farmhouse, the barn, the shrine and the gate in
one download — rural Japanese architecture _is_ terraced-farm architecture, which is what this
world is. The rock/crystal pack covers the ridge. Nothing else is needed to ship it.
