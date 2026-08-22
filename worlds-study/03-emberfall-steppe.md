# 03 — Emberfall Steppe

> Entry level 10 · mobs level 10–24 · dungeon key `phacochere_key` · sea level 145

The first world that is not somebody's land. A vast dry grassland under a sky that drops embers,
running west into a grey shale coast. Three things live here and they do not get on: **herds**
(the chief's woolly ram, tusklets, wolves), **wildlings** — a people, with camps, spears and a
chief — and **the dead**, in mounds the wildlings walk around. Gulls scavenge the shore edge,
which is why a shore gull is in a steppe world's roster and should not be explained away.

The dungeon key is `phacochere_key` — a warthog's den — and the boss, _Maldur the Gravehog_, is a
boar lit green from the inside. The barrows and the boar are the same story.

## The roster

| mob                   | lvl         | what the icon shows         | the habitat it asks for                   |
| --------------------- | ----------- | --------------------------- | ----------------------------------------- |
| `great_razmo`         | 10–16       | big black rat               | camps and mounds, wherever there is spoil |
| `parasite`            | 10–16       | crate with glowing eyes     | stores, ash drifts                        |
| `scuttler`            | 10–15       | blue-and-gold crab          | tide rock                                 |
| `wildling_spear`      | 10–16       | pale muscled ogre, red arm  | the camp                                  |
| `campcaw`             | 10–16       | white gull                  | the camp midden                           |
| `gull_campcaw`        | 10–18       | the same gull, "Shore Gull" | the shore itself                          |
| `chief_wooligan`      | 11–19       | shaggy grey ram             | open grazing                              |
| `tusklet`             | 11–16       | orange boar piglet          | grass and scrub                           |
| `draugr_retarded`     | 12–16       | shambling skeleton          | the mounds                                |
| `wolfling`            | 12–18       | brown wolf                  | anywhere the herds are                    |
| `wildling_huntress`   | 12–18       | pale ogre                   | the camp, ranging out                     |
| `emberbat`            | 12–16       | red bat, burning wings      | gulches, ash country                      |
| `slothling`           | 12–20       | grey-brown sloth            | slow damp country                         |
| `zephyr_silkweaver`   | 13–22       | pale cocoon                 | dry sheltered gulches                     |
| `koard`               | 13–22       | blue toad, grown            | brackish pools                            |
| `koa_the_bloated`     | 10–15 archi | swollen blue toad           | the warm pools                            |
| `maldur_the_gravehog` | 20–24 boss  | boar lit green              | **dungeon only** — the den                |

## The nine biomes

Temperature runs sea-cold rim → ember-warm interior; humidity runs cut gulches → standing water.
The steppe itself is the middle of the grid, which is where a player will spend most of their
time, and it should feel **big and empty on purpose** — the camps and the mounds are the events.

|               | humidity **low**  | humidity **mid**  | humidity **high** |
| ------------- | ----------------- | ----------------- | ----------------- |
| **temp low**  | `gull_cliffs`     | `barrow_steppe`   | `windward_downs`  |
| **temp mid**  | `silk_gulches`    | `ashgrass_steppe` | `shale_shore`     |
| **temp high** | `emberfall_flats` | `wildling_camps`  | `bloatpools`      |

---

### 1. `ashgrass_steppe` — mid_mid

Grass to the horizon with grey ash in it, bending all one way. Herds, and the wolves that follow
them. **The world's default ground.**

- **Mobs**: `chief_wooligan`, `tusklet`, `wolfling`, `great_razmo`
- **Resources**: `wheat_malt` (FARMER)
- **Profile**: long low swells, 124 → 238. Nothing to climb; the horizon is the feature.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 124 | gravel / dirt / stone                |      |
| 0.16 | 150 |                                      |      |
| 0.22 | 171 | dry_grass / dirt / stone             | 0.03 |
| 0.36 | 192 |                                      |      |
| 0.50 | 181 |                                      |      |
| 0.64 | 212 |                                      |      |
| 0.78 | 199 |                                      |      |
| 0.90 | 228 |                                      |      |
| 1    | 238 |                                      |      |

- **Structures**: `grassland_trees` at **quarter density** — the acacias finally belong somewhere,
  standing alone — plus `grassland_rocks`. Covered today.

### 2. `barrow_steppe` — low_mid

The same grass, humped with burial mounds. The mounds are terrain, not props: you walk over them
before you understand what they are.

- **Mobs**: `draugr_retarded`, `great_razmo`, `tusklet`
- **Resources**: `jade` (MINER), `wheat_malt` (FARMER)
- **Profile**: deliberately lumpy — each rise between 0.3 and 0.9 is a mound field.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 129 | dirt / rich_soil / stone |      |
| 0.14 | 155 |                          |      |
| 0.20 | 171 | dry_grass / dirt / stone | 0.03 |
| 0.30 | 207 |                          |      |
| 0.38 | 181 |                          |      |
| 0.50 | 217 |                          |      |
| 0.60 | 186 |                          |      |
| 0.72 | 223 |                          |      |
| 0.84 | 192 |                          |      |
| 1    | 228 |                          |      |

- **Structures**: wants **a kofun** — a keyhole burial mound with a stone doorway and a few
  standing markers. The Japanese pack has these; they are the single most on-theme build in the
  world. Plus `grassland_rocks` for the markers.

### 3. `wildling_camps` — high_mid

Trampled ground, fire pits, a palisade of stakes, drying frames. The wildlings are a people and
their world should look inhabited — this is the only biome here with anything upright in it.

- **Mobs**: `wildling_spear`, `wildling_huntress`, `chief_wooligan`
- **Resources**: `wheat_malt` (FARMER), `ivory_shrooms` (HERBALIST)
- **Profile**: low knolls the camps sit on, 129 → 233.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 129 | dirt / rich_soil / stone |      |
| 0.16 | 155 |                          |      |
| 0.22 | 171 | dry_grass / dirt / stone | 0.03 |
| 0.34 | 192 |                          |      |
| 0.46 | 181 |                          |      |
| 0.60 | 207 |                          |      |
| 0.74 | 197 |                          |      |
| 0.88 | 223 |                          |      |
| 1    | 233 |                          |      |

- **Structures**: wants **a camp set — stake palisade, longhouse frame, drying racks, a fire
  ring**. Japanese pack rural outbuildings and fences carry all of it once colour is stripped.

### 4. `emberfall_flats` — high_low

Where the embers land. Grey ash over black crust, nothing growing, and things in it that like
that.

- **Mobs**: `emberbat`, `parasite`, `draugr_retarded`
- **Resources**: `jade` (MINER)
- **Profile**: near-flat on purpose, 135 → 176. Flatness is the effect; do not add relief.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 135 | gravel / ash / blackstone |      |
| 0.22 | 155 |                           |      |
| 0.34 | 166 | ash / ash / blackstone    | 0.03 |
| 0.50 | 171 |                           |      |
| 0.66 | 163 | cinder / ash / blackstone | 0.04 |
| 0.82 | 176 |                           |      |
| 1    | 171 |                           |      |

- **Structures**: `scorched_rocks` + `scorched_ruins` — **covered today**, and the altar stub
  finally has a world where it makes sense.

### 5. `silk_gulches` — mid_low

Dry cuts in the plateau, deep enough to be out of the wind, which is why everything that spins
silk lives down there.

- **Mobs**: `zephyr_silkweaver`, `slothling`, `emberbat`
- **Resources**: `jade` (MINER), `ivory_shrooms` (HERBALIST)
- **Profile**: inverted — high rim at both ends, cut floor in the middle. The gulch is the terrain.

| x    | y   | land                            | var  |
| ---- | --- | ------------------------------- | ---- |
| 0    | 248 | dry_grass / dirt / limestone    |      |
| 0.12 | 228 |                                 |      |
| 0.22 | 181 |                                 |      |
| 0.34 | 160 | gravel / limestone / deep_stone | 0.03 |
| 0.50 | 150 |                                 |      |
| 0.64 | 166 |                                 |      |
| 0.76 | 192 | dry_grass / dirt / limestone    | 0.03 |
| 0.88 | 228 |                                 |      |
| 1    | 248 |                                 |      |

- **Structures**: `desert_rocks` + `temperate_rocks` today. Wants **overhang slabs** from the rock
  pack, so the gulch reads as roofed in places.

### 6. `shale_shore` — mid_high

The grey coast: flat shale ledges, weed, standing water between the slabs. Crabs and gulls.

- **Mobs**: `scuttler`, `gull_campcaw`, `koard`, `koa_the_bloated`
- **Resources**: `ivory_shrooms` (HERBALIST)
- **Profile**: breathes ±10 around sea level 145 — every dip is a rock pool.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 104 | gravel / gravel / slate   |      |
| 0.20 | 129 |                           |      |
| 0.28 | 140 |                           |      |
| 0.34 | 153 | wet_sand / gravel / slate | 0.03 |
| 0.44 | 142 |                           |      |
| 0.54 | 155 | saltgrass / clay / slate  | 0.03 |
| 0.66 | 145 |                           |      |
| 0.78 | 158 |                           |      |
| 0.90 | 148 |                           |      |
| 1    | 163 |                           |      |

- **Structures**: wants **flat shale slabs and weed-covered ledges** — a cheap pull from the rock
  pack. `tropical_rocks` corail would read wrong here; this coast is cold.

### 7. `gull_cliffs` — low_low

Where the steppe stops. A sheer shale cliff with the whole colony on it, screaming.

- **Mobs**: `campcaw`, `gull_campcaw`, `scuttler`
- **Resources**: `jade` (MINER)
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 150-block face — the slope rule
  strips the turf and the cliff shows slate all the way down.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 104 | gravel / slate / deep_stone |      |
| 0.14 | 135 |                             |      |
| 0.18 | 155 | slate / slate / deep_stone  | 0.02 |
| 0.20 | 305 |                             |      |
| 0.26 | 326 | saltgrass / dirt / slate    | 0.03 |
| 0.40 | 316 |                             |      |
| 0.55 | 347 |                             |      |
| 0.68 | 326 |                             |      |
| 0.80 | 362 |                             |      |
| 1    | 383 |                             |      |

- **Structures**: wants **sea stacks** — free from the rock pack, and they turn the cliff line into
  a place instead of an edge.

### 8. `windward_downs` — low_high

The cold wet side, where the sea fog stays all day. Smooth green swells, stunted firs, slow
animals.

- **Mobs**: `slothling`, `wolfling`, `campcaw`
- **Resources**: `ivory_shrooms` (HERBALIST), `wheat_malt` (FARMER)
- **Profile**: the smoothest curve in the world, 119 → 228 — a deliberate rest from the gulches.

| x    | y   | land                           | var  |
| ---- | --- | ------------------------------ | ---- |
| 0    | 119 | moss / rich_soil / stone       |      |
| 0.18 | 145 |                                |      |
| 0.24 | 160 | frostgrass / rich_soil / stone | 0.03 |
| 0.38 | 181 |                                |      |
| 0.52 | 171 |                                |      |
| 0.66 | 202 |                                |      |
| 0.80 | 189 |                                |      |
| 0.92 | 217 |                                |      |
| 1    | 228 |                                |      |

- **Structures**: `taiga_trees` at low density — wind-stunted firs. Covered today.

### 9. `bloatpools` — high_high

Warm shallow water lying on clay where the ember-warmed ground meets the fog. It stinks and the
toads love it.

- **Mobs**: `koa_the_bloated`, `koard`, `parasite`
- **Resources**: none — this biome is for fighting, not gathering
- **Profile**: marsh, breathing across sea level 145 — the dips hold water, the rises are stinking clay.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 109 | clay / clay / limestone     |      |
| 0.20 | 129 |                             |      |
| 0.28 | 140 |                             |      |
| 0.34 | 153 | rot_moss / clay / limestone | 0.03 |
| 0.44 | 137 |                             |      |
| 0.54 | 150 | moss / peat / limestone     | 0.03 |
| 0.66 | 135 |                             |      |
| 0.78 | 153 |                             |      |
| 0.90 | 140 |                             |      |
| 1    | 155 |                             |      |

- **Structures**: `swamp_trees` — covered today.

---

## Materials

| name                                   | color                 | preset         | used by                       |
| -------------------------------------- | --------------------- | -------------- | ----------------------------- |
| `stone`                                | `#707777`             | stone          | steppe filler                 |
| `deep_stone`                           | `#465258`             | stone          | cliff and gulch filler        |
| `limestone`                            | `#958d75`             | stone          | gulch walls, pool filler      |
| `slate`                                | `#5a5f66`             | stone          | the shale coast and the cliff |
| `blackstone`                           | `#373737`             | stone          | under the ash                 |
| `gravel`                               | `#766f61`             | stone          | shore, steppe cuts            |
| `dirt`                                 | `#654d36`             | earth          | steppe subsurface             |
| `rich_soil`                            | `#493a2d`             | earth          | downs, barrows                |
| `clay`                                 | `#76514b`             | earth          | pools, shore                  |
| `peat`                                 | `#3b3125`             | earth          | bloatpools                    |
| `ash`                                  | `#55504a`             | earth          | the ember flats               |
| `cinder`                               | `#3a3330`             | earth          | burnt crust                   |
| `dry_grass`                            | `#9a9457`             | grass          | the steppe itself             |
| `frostgrass`                           | `#8fa08d`             | grass          | the fog-wet downs             |
| `saltgrass`                            | `#7e8f5f`             | grass          | cliff top, shore banks        |
| `moss`                                 | `#456a4b`             | grass          | downs, pools                  |
| `rot_moss`                             | `#3d5236`             | grass          | bloatpool margins             |
| `wet_sand`                             | `#9d896b`             | sand           | shore                         |
| `water`                                | `#2e609e`             | water          | shore, pools                  |
| `grassland_wood` / `grassland_foliage` | `#76543a` / `#64843e` | wood / foliage | the lone steppe trees         |
| `taiga_wood` / `taiga_foliage`         | `#554536` / `#315346` | wood / foliage | windward firs                 |
| `swamp_wood` / `swamp_foliage`         | `#493d32` / `#395d42` | wood / foliage | bloatpools                    |

## Mob rows

```json
{ "mob_type": "great_razmo",        "weight_bp": 8000, "biomes": ["ashgrass_steppe","barrow_steppe","wildling_camps"] },
{ "mob_type": "parasite",           "weight_bp": 8000, "biomes": ["emberfall_flats","bloatpools"] },
{ "mob_type": "scuttler",           "weight_bp": 8000, "biomes": ["shale_shore","gull_cliffs"] },
{ "mob_type": "wildling_spear",     "weight_bp": 8000, "biomes": ["wildling_camps"] },
{ "mob_type": "campcaw",            "weight_bp": 8000, "biomes": ["gull_cliffs","windward_downs"] },
{ "mob_type": "gull_campcaw",       "weight_bp": 8000, "biomes": ["shale_shore","gull_cliffs"] },
{ "mob_type": "chief_wooligan",     "weight_bp": 8000, "biomes": ["ashgrass_steppe","wildling_camps"] },
{ "mob_type": "tusklet",            "weight_bp": 8000, "biomes": ["ashgrass_steppe","barrow_steppe"] },
{ "mob_type": "draugr_retarded",    "weight_bp": 8000, "biomes": ["barrow_steppe","emberfall_flats"] },
{ "mob_type": "wolfling",           "weight_bp": 8000, "biomes": ["ashgrass_steppe","windward_downs"] },
{ "mob_type": "wildling_huntress",  "weight_bp": 8000, "biomes": ["wildling_camps"] },
{ "mob_type": "emberbat",           "weight_bp": 8000, "biomes": ["emberfall_flats","silk_gulches"] },
{ "mob_type": "slothling",          "weight_bp": 8000, "biomes": ["windward_downs","silk_gulches"] },
{ "mob_type": "zephyr_silkweaver",  "weight_bp": 8000, "biomes": ["silk_gulches"] },
{ "mob_type": "koard",              "weight_bp": 8000, "biomes": ["shale_shore","bloatpools"] },
{ "mob_type": "koa_the_bloated",    "weight_bp": 8000, "biomes": ["bloatpools","shale_shore"] }
```

## Resource rows

```json
{ "item_type": "ivory_shrooms", "job": "HERBALIST", "tier": 3, "protector": "protector_ivory_gaia",     "rare_item_type": "", "biomes": ["windward_downs","silk_gulches","shale_shore","wildling_camps"] },
{ "item_type": "jade",          "job": "MINER",     "tier": 3, "protector": "protector_jade",           "rare_item_type": "", "biomes": ["gull_cliffs","silk_gulches","emberfall_flats","barrow_steppe"] },
{ "item_type": "wheat_malt",    "job": "FARMER",    "tier": 3, "protector": "protector_malt_bricheton", "rare_item_type": "", "biomes": ["ashgrass_steppe","wildling_camps","barrow_steppe","windward_downs"] }
```

Dungeon: unchanged (`phacochere_key`).

## Structures — have / want

| biome             | reuse today                                       | want                                                             |
| ----------------- | ------------------------------------------------- | ---------------------------------------------------------------- |
| `emberfall_flats` | `scorched_rocks` + `scorched_ruins` — **covered** | —                                                                |
| `bloatpools`      | `swamp_trees` — **covered**                       | —                                                                |
| `windward_downs`  | `taiga_trees` — **covered**                       | —                                                                |
| `ashgrass_steppe` | `grassland_trees` at ¼ density, `grassland_rocks` | —                                                                |
| `silk_gulches`    | `desert_rocks`, `temperate_rocks`                 | overhang slabs                                                   |
| `shale_shore`     | —                                                 | flat shale ledges                                                |
| `gull_cliffs`     | —                                                 | sea stacks                                                       |
| `barrow_steppe`   | `grassland_rocks`                                 | **a kofun — mound, stone doorway, markers**                      |
| `wildling_camps`  | —                                                 | **camp set: palisade, longhouse frame, drying racks, fire ring** |

Two builds carry this world: the kofun and the camp. Both come out of the Japanese pack — a
keyhole tomb and a fenced rural compound — and the rock pack covers the other four wants.
