# 04 — Mistral Heights

> Entry level 14 · mobs level 14–30 · dungeon key `dungeon_key_goblin_cave` · sea level 84

The first world with real height, and the first where height is the _content_: a massif hammered
by a cold north wind, falling on one side into a fjord. Everything in the roster is either
holding on (rams on scree, wolves in the pines, a bird that lives on the wind) or hiding from the
wind (goblins in cave mouths, snails on dripping shelves, things that spin webs where it is
still). The hot vents in the rock are the reason anything survives up here at all.

**Water lives only at the fjord.** The engine fills liquid to sea level and no higher, so a pool
at altitude is impossible — the wet biomes up top are _dripping_, told by peat and moss, never by
standing water. That constraint shaped this world more than any other decision in it.

## The roster

| mob                      | lvl         | what the icon shows            | the habitat it asks for             |
| ------------------------ | ----------- | ------------------------------ | ----------------------------------- |
| `cinderwhisker`          | 14–18       | big gold rat                   | warm ground, spoil heaps            |
| `shore_crab`             | 15–22       | red crab, blue eyes            | tide rock — the fjord, nowhere else |
| `burnt_effigy`           | 15–22       | charred wooden figure          | where something burned              |
| `sproutkin`              | 15–22       | green sprout-headed figure     | wet moss                            |
| `glass_snail`            | 15–20       | pale blue snail, crystal shell | dripping shelves, cold water        |
| `swamp_sentinel`         | 16–22       | long low mossy ridge-thing     | wet moss, motionless                |
| `magmalug`               | 16–21       | cauldron of magma              | the vents                           |
| `razord`                 | 20–28       | armoured brown rat             | warrens                             |
| `timber_wolf`            | 20–28       | dark green-black wolf          | pines and ridges                    |
| `bannerwatch`            | 20–30       | tattered banner-bird           | the highest exposed ground          |
| `phacoch_cultist`        | 20–25       | pale ogre, red arm             | the moor, the terraces              |
| `aragog_child`           | 24–28       | pale green spider              | still air: pines, scree hollows     |
| `goblin_brute`           | 26–30       | green goblin                   | the cave mouths                     |
| `woolly_doom`            | 16–20 archi | orange ram, heavy horns        | scree and ridge                     |
| `noggin_the_chief`       | 17–22 archi | pale ogre chieftain            | the moor                            |
| `magmalug_the_gorged`    | 24–28 archi | void-purple cauldron           | the deepest vent                    |
| `vornest_the_galecaller` | 26–30 boss  | dark storm bird                | **dungeon only**                    |

## The nine biomes

Temperature runs wind-blasted rock → vent-warmed slope; humidity runs bare scree → cloud-wet.
The grid is a **mountain profile**: the cold column is the summit and its shoulders, the warm
column is the inhabited side where the ground heats itself.

|               | humidity **low**    | humidity **mid** | humidity **high**   |
| ------------- | ------------------- | ---------------- | ------------------- |
| **temp low**  | `windscour_ridge`   | `pine_shoulders` | `fjord_shore`       |
| **temp mid**  | `stone_scree`       | `banner_moor`    | `mist_shelves`      |
| **temp high** | `cindervent_slopes` | `goblin_warrens` | `mistfall_terraces` |

---

### 1. `banner_moor` — mid_mid

The high moor: peat, tussock, and old banner-stones nobody planted recently. The wind never
stops. **The world's default ground, and it sits at 110 — a player arrives already high.**

- **Mobs**: `bannerwatch`, `phacoch_cultist`, `noggin_the_chief`, `woolly_doom`
- **Resources**: `wheat_burnt` (FARMER), `aloe_vera` (HERBALIST)
- **Profile**: broad plateau swells, 71 → 214.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 71  | gravel / dirt / stone                |      |
| 0.14 | 107 |                                      |      |
| 0.20 | 143 | moss / rich_soil / stone             | 0.03 |
| 0.30 | 169 |                                      |      |
| 0.44 | 182 |                                      |      |
| 0.56 | 172 |                                      |      |
| 0.70 | 201 |                                      |      |
| 0.84 | 188 |                                      |      |
| 1    | 214 |                                      |      |

- **Structures**: wants **standing stones and a wind-torn gate** — rock pack for the stones, and
  a lone torii on an empty moor is the single strongest image available from the house pack.

### 2. `windscour_ridge` — low_low

The summit line. Bare rock, snow above the strata switch, and nothing alive that is not holding
on with claws.

- **Mobs**: `bannerwatch`, `timber_wolf`, `woolly_doom`
- **Resources**: `moonstone` (MINER)
- **Profile**: **the world's roof, 383** — real relief, the first in the game. The 0.18→0.24 run
  is a 94-block face; everything above x 0.42 wears snow.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 78  | gravel / stone / deep_stone |      |
| 0.12 | 127 |                             |      |
| 0.18 | 179 |                             |      |
| 0.24 | 273 | stone / gravel / deep_stone | 0.02 |
| 0.32 | 243 |                             |      |
| 0.42 | 331 | snow / stone / deep_stone   | 0.03 |
| 0.50 | 289 |                             |      |
| 0.60 | 364 |                             |      |
| 0.72 | 318 |                             |      |
| 0.84 | 383 |                             |      |
| 1    | 347 |                             |      |

- **Structures**: rock-pack **crags and spires**, sparse. Nothing built survives up here, and it
  should look like it.

### 3. `pine_shoulders` — low_mid

The forested shoulders under the summit: firs, deadfall, deep needle floor, wolves.

- **Mobs**: `timber_wolf`, `razord`, `aragog_child`
- **Resources**: `aloe_vera` (HERBALIST), `moonstone` (MINER)
- **Profile**: a long steady climb, 75 → 227.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 75  | dirt / rich_soil / stone |      |
| 0.16 | 114 |                          |      |
| 0.22 | 140 | moss / rich_soil / stone | 0.03 |
| 0.34 | 169 |                          |      |
| 0.46 | 156 |                          |      |
| 0.60 | 192 |                          |      |
| 0.74 | 179 |                          |      |
| 0.88 | 214 |                          |      |
| 1    | 227 |                          |      |

- **Structures**: `taiga_trees` + `taiga_rocks` — **covered today**, and this is what that pack
  was made for.

### 4. `fjord_shore` — low_high

The only water in the world: a cold arm of sea between walls. Weed on the rock, crabs in the
cracks, snails on the wet stone, and the wall going straight up out of it.

- **Mobs**: `shore_crab`, `glass_snail`, `sproutkin`
- **Resources**: `aloe_vera` (HERBALIST)
- **Profile**: water at 84 for the first half, then the far wall climbs to 266. **Do not smooth
  the 0.6→0.78 run** — the sheer wall out of deep water is the whole picture.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 49  | gravel / gravel / deep_stone |      |
| 0.18 | 71  |                              |      |
| 0.26 | 81  |                              |      |
| 0.32 | 89  | wet_sand / gravel / stone    | 0.03 |
| 0.40 | 83  |                              |      |
| 0.50 | 94  | moss / clay / stone          | 0.03 |
| 0.60 | 88  |                              |      |
| 0.70 | 130 |                              |      |
| 0.78 | 211 |                              |      |
| 0.90 | 243 |                              |      |
| 1    | 266 |                              |      |

- **Structures**: rock-pack **wet slabs and boulder falls** at the waterline, `taiga_trees`
  clinging along the top edge.

### 5. `stone_scree` — mid_low

Loose rock aprons under every crag. Nothing holds; the rams stand on it anyway.

- **Mobs**: `woolly_doom`, `burnt_effigy`, `aragog_child`
- **Resources**: `moonstone` (MINER)
- **Profile**: 81 → 208, stepped like the scree cones themselves.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 81  | gravel / stone / deep_stone |      |
| 0.16 | 117 |                             |      |
| 0.26 | 149 |                             |      |
| 0.38 | 140 | stone / gravel / deep_stone | 0.03 |
| 0.50 | 172 |                             |      |
| 0.62 | 159 |                             |      |
| 0.76 | 195 |                             |      |
| 0.90 | 182 |                             |      |
| 1    | 208 |                             |      |

- **Structures**: `temperate_rocks` today; wants rock-pack **scree cones and split blocks**.

### 6. `mist_shelves` — mid_high

Ledges that live inside the cloud. Everything drips, nothing pools. Moss over peat, and the
motionless things that grow on it.

- **Mobs**: `swamp_sentinel`, `glass_snail`, `sproutkin`
- **Resources**: `aloe_vera` (HERBALIST), `wheat_burnt` (FARMER)
- **Profile**: flat treads with risers, 75 → 185 — shelves, not slopes.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 75  | clay / clay / stone      |      |
| 0.18 | 110 |                          |      |
| 0.24 | 136 | moss / peat / stone      | 0.03 |
| 0.34 | 143 |                          |      |
| 0.44 | 153 |                          |      |
| 0.54 | 146 |                          |      |
| 0.66 | 166 | rich_soil / peat / stone | 0.03 |
| 0.78 | 159 |                          |      |
| 0.90 | 179 |                          |      |
| 1    | 185 |                          |      |

- **Structures**: `swamp_trees` — dripping dead trees at altitude read exactly right — plus
  `temperate_rocks`. Covered today.

### 7. `cindervent_slopes` — high_low

Where the mountain heats itself. Ash over black crust, vents, and the cauldron-things that sit
in them.

- **Mobs**: `magmalug`, `magmalug_the_gorged`, `burnt_effigy`, `cinderwhisker`
- **Resources**: `moonstone` (MINER), `wheat_burnt` (FARMER)
- **Profile**: 81 → 237, a warm slope with no vegetation line.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 81  | gravel / ash / blackstone |      |
| 0.16 | 120 |                           |      |
| 0.24 | 149 | ash / cinder / blackstone | 0.03 |
| 0.36 | 179 |                           |      |
| 0.46 | 162 |                           |      |
| 0.58 | 204 |                           |      |
| 0.70 | 185 |                           |      |
| 0.84 | 224 |                           |      |
| 1    | 237 |                           |      |

- **Structures**: `scorched_rocks` + `scorched_ruins` — **covered today**.

### 8. `goblin_warrens` — high_mid

Cave mouths in a broken slope, spoil heaps below each one, shacks built out of what came out.
**The dungeon's overworld tell.**

- **Mobs**: `goblin_brute`, `razord`, `cinderwhisker`
- **Resources**: `moonstone` (MINER)
- **Profile**: broken ground, 78 → 192 — every dip is a spoil hollow.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 78  | dirt / gravel / stone    |      |
| 0.16 | 114 |                          |      |
| 0.22 | 136 | dirt / rich_soil / stone | 0.03 |
| 0.32 | 159 |                          |      |
| 0.40 | 143 |                          |      |
| 0.52 | 172 |                          |      |
| 0.64 | 153 |                          |      |
| 0.76 | 182 |                          |      |
| 0.88 | 162 |                          |      |
| 1    | 192 |                          |      |

- **Structures**: wants **a cave mouth with a timber frame, spoil heaps, lean-to shacks**. Small
  Japanese outbuildings, half-buried, plus rock-pack rubble. This is the world's dungeon door.

### 9. `mistfall_terraces` — high_high

Terraced fields cut into the warm side, in and out of the cloud, worked by whatever the cultists
are now. The one place on the mountain where somebody made ground flat on purpose.

- **Mobs**: `phacoch_cultist`, `sproutkin`, `swamp_sentinel`
- **Resources**: `wheat_burnt` (FARMER), `aloe_vera` (HERBALIST)
- **Profile**: tread/riser, 75 → 201. The steps are the design.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 75  | dirt / rich_soil / stone |      |
| 0.18 | 107 |                          |      |
| 0.24 | 130 | meadow / dirt / stone    | 0.03 |
| 0.36 | 133 |                          |      |
| 0.42 | 153 |                          |      |
| 0.56 | 156 |                          |      |
| 0.62 | 175 |                          |      |
| 0.78 | 179 |                          |      |
| 0.86 | 198 |                          |      |
| 1    | 201 |                          |      |

- **Structures**: wants **terrace retaining walls and a mountain temple**. A cloud-level temple
  compound above terraced fields is the exact image the Japanese pack exists to give, and it is
  the landmark the whole world should be navigable by.

---

## Materials

| name                           | color                 | preset         | used by                       |
| ------------------------------ | --------------------- | -------------- | ----------------------------- |
| `stone`                        | `#707777`             | stone          | the mountain itself           |
| `deep_stone`                   | `#465258`             | stone          | filler under every high biome |
| `gravel`                       | `#766f61`             | stone          | scree, shore, warren spoil    |
| `blackstone`                   | `#373737`             | stone          | under the vents               |
| `dirt`                         | `#654d36`             | earth          | shoulders, terraces, warrens  |
| `rich_soil`                    | `#493a2d`             | earth          | pines, moor, terraces         |
| `clay`                         | `#76514b`             | earth          | fjord, shelves                |
| `peat`                         | `#3b3125`             | earth          | the dripping shelves          |
| `ash`                          | `#55504a`             | earth          | vent slopes                   |
| `cinder`                       | `#3a3330`             | earth          | vent crust                    |
| `moss`                         | `#456a4b`             | grass          | moor, pines, shelves, fjord   |
| `meadow`                       | `#89984e`             | grass          | the terraces                  |
| `snow`                         | `#f4f6f3`             | snow           | the summit                    |
| `wet_sand`                     | `#9d896b`             | sand           | the fjord waterline           |
| `water`                        | `#2e609e`             | water          | the fjord                     |
| `taiga_wood` / `taiga_foliage` | `#554536` / `#315346` | wood / foliage | pine shoulders, fjord rim     |
| `swamp_wood` / `swamp_foliage` | `#493d32` / `#395d42` | wood / foliage | mist shelves                  |

## Mob rows

```json
{ "mob_type": "cinderwhisker",        "weight_bp": 8000, "biomes": ["cindervent_slopes","goblin_warrens"] },
{ "mob_type": "shore_crab",           "weight_bp": 8000, "biomes": ["fjord_shore"] },
{ "mob_type": "burnt_effigy",         "weight_bp": 8000, "biomes": ["cindervent_slopes","stone_scree"] },
{ "mob_type": "sproutkin",            "weight_bp": 8000, "biomes": ["mist_shelves","mistfall_terraces","fjord_shore"] },
{ "mob_type": "glass_snail",          "weight_bp": 8000, "biomes": ["mist_shelves","fjord_shore"] },
{ "mob_type": "swamp_sentinel",       "weight_bp": 8000, "biomes": ["mist_shelves","mistfall_terraces"] },
{ "mob_type": "magmalug",             "weight_bp": 8000, "biomes": ["cindervent_slopes"] },
{ "mob_type": "razord",               "weight_bp": 8000, "biomes": ["goblin_warrens","pine_shoulders"] },
{ "mob_type": "timber_wolf",          "weight_bp": 8000, "biomes": ["pine_shoulders","windscour_ridge"] },
{ "mob_type": "bannerwatch",          "weight_bp": 8000, "biomes": ["banner_moor","windscour_ridge"] },
{ "mob_type": "phacoch_cultist",      "weight_bp": 8000, "biomes": ["banner_moor","mistfall_terraces"] },
{ "mob_type": "aragog_child",         "weight_bp": 8000, "biomes": ["pine_shoulders","stone_scree"] },
{ "mob_type": "goblin_brute",         "weight_bp": 8000, "biomes": ["goblin_warrens"] },
{ "mob_type": "woolly_doom",          "weight_bp": 8000, "biomes": ["stone_scree","banner_moor","windscour_ridge"] },
{ "mob_type": "noggin_the_chief",     "weight_bp": 8000, "biomes": ["banner_moor"] },
{ "mob_type": "magmalug_the_gorged",  "weight_bp": 8000, "biomes": ["cindervent_slopes"] }
```

## Resource rows

```json
{ "item_type": "aloe_vera",   "job": "HERBALIST", "tier": 4, "protector": "protector_aloe_gaia",       "rare_item_type": "", "biomes": ["mist_shelves","fjord_shore","pine_shoulders","mistfall_terraces","banner_moor"] },
{ "item_type": "moonstone",   "job": "MINER",     "tier": 4, "protector": "protector_moonstone",       "rare_item_type": "", "biomes": ["windscour_ridge","stone_scree","goblin_warrens","cindervent_slopes","pine_shoulders"] },
{ "item_type": "wheat_burnt", "job": "FARMER",    "tier": 4, "protector": "protector_burnt_bricheton", "rare_item_type": "", "biomes": ["mistfall_terraces","banner_moor","cindervent_slopes","mist_shelves"] }
```

Dungeon: unchanged (`dungeon_key_goblin_cave`).

## Structures — have / want

| biome               | reuse today                                       | want                                                         |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `pine_shoulders`    | `taiga_trees` + `taiga_rocks` — **covered**       | —                                                            |
| `cindervent_slopes` | `scorched_rocks` + `scorched_ruins` — **covered** | —                                                            |
| `mist_shelves`      | `swamp_trees` + `temperate_rocks` — **covered**   | —                                                            |
| `stone_scree`       | `temperate_rocks`                                 | scree cones, split blocks                                    |
| `windscour_ridge`   | —                                                 | crags and spires, sparse                                     |
| `fjord_shore`       | `taiga_trees` along the rim                       | wet slabs, boulder falls                                     |
| `banner_moor`       | —                                                 | standing stones + **one lone gate on an empty moor**         |
| `goblin_warrens`    | —                                                 | **timber-framed cave mouth, spoil heaps, lean-to shacks**    |
| `mistfall_terraces` | —                                                 | **terrace walls + a mountain temple — the world's landmark** |

Three of nine biomes ship with what exists. The rock pack covers four more. Only the warrens and
the temple need the house pack, and the temple is worth doing properly: it is the thing a player
should see from the moor and decide to walk toward.
