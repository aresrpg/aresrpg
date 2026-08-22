# 10 — Sunspire Dunes

> Entry level 45 · mobs level 45–65 · dungeon key `nerak_key` · sea level 60

A desert with a spire in it. Sea level drops to 60 — the lowest in the game so far — so **water
is an event**: three oases and one cut wadi, and everything that swims is crowded into them.
That is why a world of dunes has two fish in its roster and nobody should try to explain them
away as sand-swimmers.

The other half of the roster is dead and organised: a marrow king, a lich, a herald, an acolyte,
a silent abbot. This is a burial desert. The living things here — a goblin duke with a market, a
horse, a bull, an armoured lizard — are all **passing through**, and the dead are what lives here.

## The roster

| mob                 | lvl         | what the icon shows     | the habitat it asks for    |
| ------------------- | ----------- | ----------------------- | -------------------------- |
| `wild_talokan`      | 45–60       | blue fish               | open water — oasis or wadi |
| `talokan_aero`      | 45–60       | green fish              | the oasis                  |
| `woolice`           | 45–55       | dark bull, red horns    | salt flats, barrens        |
| `boneherald`        | 45–60       | brown skeleton          | dunes and tombs            |
| `goblin_duke`       | 45–55       | goblin dressed in money | the market                 |
| `armorscale`        | 45–55       | orange armoured lizard  | hot rock                   |
| `sand_lich`         | 45–50       | blue skeleton           | the deep dunes             |
| `silk_lancer`       | 45–55       | wooden box, blue eyes   | caravan goods, barrens     |
| `kweebec_heartwood` | 46–52       | brown tree-folk         | the only green ground      |
| `marrow_acolyte`    | 48–53       | brown skeleton          | the necropolis             |
| `scarak_seeker`     | 48–60       | white-and-teal insect   | dunes, market spoil        |
| `koloss`            | 50–65       | huge rock-bodied thing  | mesas and canyon           |
| `pale_mare`         | 50–62       | dark horse              | barrens, flats             |
| `magmaclaw`         | 50–62       | orange-purple crab      | the hot wadi               |
| `stormhawk`         | 50–62       | white-green hawk        | the mesas                  |
| `the_silent_abbot`  | 48–54 archi | brown skeleton          | the cloister               |
| `nerak_marrow_king` | 48–52 boss  | dark skeleton king      | **dungeon only**           |

## The nine biomes

Temperature runs cold night-side mesa → sun-hammered dune; humidity runs salt pan → standing
water. **The wet column is tiny in area and enormous in importance** — every player route in this
world is drawn between water sources.

|               | humidity **low**  | humidity **mid**    | humidity **high** |
| ------------- | ----------------- | ------------------- | ----------------- |
| **temp low**  | `stormhawk_mesas` | `pale_barrens`      | `abbot_cloister`  |
| **temp mid**  | `salt_pans`       | `duke_bazaar`       | `magmaclaw_wadis` |
| **temp high** | `sunspire_dunes`  | `marrow_necropolis` | `talokan_oasis`   |

---

### 1. `duke_bazaar` — mid_mid

Hard pan where the caravan road crosses itself, and the goblin duke's market grew on top of it.
**The world's default ground and its only crowd.**

- **Mobs**: `goblin_duke`, `silk_lancer`, `scarak_seeker`
- **Resources**: `wheat_draconize` (FARMER)
- **Profile**: flat trodden ground, 52 → 137 — the market needs somewhere level to stand.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 52  | gravel / limestone / deep_stone      |      |
| 0.18 | 73  |                                      |      |
| 0.24 | 89  | red_sand / sand / limestone          | 0.03 |
| 0.36 | 105 |                                      |      |
| 0.48 | 97  |                                      |      |
| 0.62 | 117 |                                      |      |
| 0.76 | 109 |                                      |      |
| 0.90 | 129 |                                      |      |
| 1    | 137 |                                      |      |

- **Structures**: wants **a market street — stalls, awnings, a walled compound, a gate**. The
  Japanese pack's town buildings, packed tight along one line so the road reads as a road.

### 2. `sunspire_dunes` — high_low

The great dunes, and the only place in the game where the terrain moves this much: 24 to 126 in
sharp ridges with deep slacks between them.

- **Mobs**: `sand_lich`, `boneherald`, `scarak_seeker`
- **Resources**: `cursed_gem` (MINER)
- **Profile**: alternating ridge and slack — **the biggest relief swing of any biome so far**, and
  it is all sand.

| x    | y   | land                           | var  |
| ---- | --- | ------------------------------ | ---- |
| 0    | 48  | sand / sand / limestone        |      |
| 0.16 | 77  |                                |      |
| 0.20 | 97  | golden_sand / sand / limestone | 0.04 |
| 0.30 | 157 |                                |      |
| 0.36 | 113 |                                |      |
| 0.46 | 198 |                                |      |
| 0.54 | 133 |                                |      |
| 0.66 | 226 |                                |      |
| 0.78 | 149 |                                |      |
| 0.90 | 254 |                                |      |
| 1    | 210 |                                |      |

- **Structures**: `desert_rocks` half-buried, very sparse — **covered today**. A dune field is
  ruined by clutter; the emptiness is the feature.

### 3. `marrow_necropolis` — high_mid

Tombs cut into sandstone terraces, tier on tier, still swept. **The dungeon's overworld tell.**

- **Mobs**: `marrow_acolyte`, `boneherald`, `the_silent_abbot`
- **Resources**: `cursed_gem` (MINER), `dragonlily` (HERBALIST)
- **Profile**: tread and riser, 52 → 206 — a cut staircase, not a hill.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 52  | sand / limestone / deep_stone      |      |
| 0.18 | 77  |                                    |      |
| 0.24 | 101 | limestone / limestone / deep_stone | 0.03 |
| 0.34 | 109 |                                    |      |
| 0.40 | 133 |                                    |      |
| 0.54 | 141 |                                    |      |
| 0.60 | 165 |                                    |      |
| 0.74 | 173 |                                    |      |
| 0.86 | 198 |                                    |      |
| 1    | 206 |                                    |      |

- **Structures**: wants **tomb doorways and rows of gates**. A line of torii marching up a
  terraced hillside is the most recognisable image the Japanese pack offers, and it costs one
  small type repeated.

### 4. `talokan_oasis` — high_high

Water, palms, and everything alive within a day's walk. Small, green, loud.

- **Mobs**: `wild_talokan`, `talokan_aero`, `kweebec_heartwood`
- **Resources**: `dragonlily` (HERBALIST), `wheat_draconize` (FARMER)
- **Profile**: breathes across sea level 60 — most of the biome is open water.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 24  | clay / clay / limestone      |      |
| 0.22 | 44  |                              |      |
| 0.30 | 54  |                              |      |
| 0.36 | 67  | rich_soil / clay / limestone | 0.03 |
| 0.46 | 52  |                              |      |
| 0.56 | 65  |                              |      |
| 0.68 | 50  |                              |      |
| 0.80 | 67  |                              |      |
| 0.90 | 56  |                              |      |
| 1    | 73  |                              |      |

- **Structures**: the **palm pack** again (`tropical_palm_g*`) plus `tropical_rocks`. Covered once
  the palms are in.

### 5. `magmaclaw_wadis` — mid_high

A cut wadi: hot black walls, a thread of water in the bottom, and crabs in it that should not be
that colour.

- **Mobs**: `magmaclaw`, `wild_talokan`, `armorscale`
- **Resources**: `cursed_gem` (MINER)
- **Profile**: water at the bottom for two-thirds of the range, then the far wall climbs to 238.
  **Do not soften the 0.64→0.84 run** — the wall out of the water is the picture.

| x    | y   | land                             | var  |
| ---- | --- | -------------------------------- | ---- |
| 0    | 28  | gravel / blackstone / deep_stone |      |
| 0.20 | 48  |                                  |      |
| 0.28 | 60  |                                  |      |
| 0.34 | 73  | ash / cinder / blackstone        | 0.03 |
| 0.44 | 56  |                                  |      |
| 0.54 | 69  |                                  |      |
| 0.64 | 52  |                                  |      |
| 0.74 | 121 |                                  |      |
| 0.84 | 194 |                                  |      |
| 1    | 238 |                                  |      |

- **Structures**: `scorched_rocks` on the walls — **covered today** — plus rock-pack slabs at the
  waterline.

### 6. `salt_pans` — mid_low

White, level, blinding, and empty. A bull standing on it is visible from anywhere.

- **Mobs**: `woolice`, `pale_mare`, `armorscale`
- **Resources**: `cursed_gem` (MINER)
- **Profile**: the flattest biome in the game, 48 → 81. **Nothing is placed here on purpose.**

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 48  | salt / clay / limestone |      |
| 0.22 | 65  |                         |      |
| 0.34 | 73  | salt / salt / limestone | 0.03 |
| 0.50 | 77  |                         |      |
| 0.66 | 71  |                         |      |
| 0.82 | 81  |                         |      |
| 1    | 77  |                         |      |

- **Structures**: **none**. The one biome in the game with an empty pack list, deliberately.

### 7. `stormhawk_mesas` — low_low

Flat-topped mesas on the cold side, and the sunspire itself standing off the highest of them.

- **Mobs**: `stormhawk`, `koloss`, `armorscale`
- **Resources**: `cursed_gem` (MINER)
- **Profile**: **the world's roof, 383** — the tallest ground in the first ten worlds. The
  0.18→0.20 run is a 157-block mesa wall.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 56  | gravel / limestone / deep_stone    |      |
| 0.14 | 97  |                                    |      |
| 0.18 | 125 | limestone / limestone / deep_stone | 0.02 |
| 0.20 | 282 |                                    |      |
| 0.28 | 306 | red_sand / limestone / deep_stone  | 0.03 |
| 0.42 | 294 |                                    |      |
| 0.56 | 339 |                                    |      |
| 0.70 | 314 |                                    |      |
| 0.84 | 363 |                                    |      |
| 1    | 383 |                                    |      |

- **Structures**: rock-pack **mesa caps and talus**, plus **the sunspire** — one tall tower on the
  highest mesa. A pagoda silhouette at 383 blocks is visible from every biome in the world, and
  the world is named after it. This is the single best use of the house pack in the game.

### 8. `pale_barrens` — low_mid

Grey grit and dead scrub between the mesas and the flats. Cold at night, and the horse is out in
it.

- **Mobs**: `pale_mare`, `woolice`, `silk_lancer`
- **Resources**: `dragonlily` (HERBALIST), `wheat_draconize` (FARMER)
- **Profile**: 52 → 157, low and monotonous on purpose.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 52  | gravel / dirt / limestone    |      |
| 0.18 | 77  |                              |      |
| 0.24 | 97  | dry_grass / dirt / limestone | 0.03 |
| 0.36 | 117 |                              |      |
| 0.48 | 105 |                              |      |
| 0.62 | 133 |                              |      |
| 0.76 | 121 |                              |      |
| 0.90 | 149 |                              |      |
| 1    | 157 |                              |      |

- **Structures**: `desert_trees` **dead-tree types only** — **covered today**.

### 9. `abbot_cloister` — low_high

A slot canyon with a spring at the bottom and cells cut into the wall above it. The abbot has not
spoken in a long time.

- **Mobs**: `the_silent_abbot`, `kweebec_heartwood`, `koloss`
- **Resources**: `dragonlily` (HERBALIST)
- **Profile**: inverted — rim at 194, spring floor at 60, which is exactly sea level, so the
  canyon floor holds water.

| x    | y   | land                              | var  |
| ---- | --- | --------------------------------- | ---- |
| 0    | 194 | red_sand / limestone / deep_stone |      |
| 0.14 | 161 |                                   |      |
| 0.24 | 117 |                                   |      |
| 0.34 | 81  | limestone / gravel / deep_stone   | 0.03 |
| 0.46 | 60  |                                   |      |
| 0.56 | 69  |                                   |      |
| 0.68 | 105 | red_sand / limestone / deep_stone | 0.03 |
| 0.84 | 153 |                                   |      |
| 1    | 189 |                                   |      |

- **Structures**: wants **cells cut into a canyon wall** — a cliff temple. Half-buried Japanese
  buildings set against the wall, with one stair down to the water.

---

## Materials

| name                                 | color                 | preset         | used by                       |
| ------------------------------------ | --------------------- | -------------- | ----------------------------- |
| `limestone`                          | `#958d75`             | stone          | mesas, tombs, canyon          |
| `deep_stone`                         | `#465258`             | stone          | filler everywhere             |
| `gravel`                             | `#766f61`             | stone          | barrens, bazaar, wadi         |
| `blackstone`                         | `#373737`             | stone          | the wadi walls                |
| `clay`                               | `#76514b`             | earth          | oasis, pans                   |
| `rich_soil`                          | `#493a2d`             | earth          | the oasis bank                |
| `dirt`                               | `#654d36`             | earth          | barrens                       |
| `ash`                                | `#55504a`             | earth          | the wadi                      |
| `cinder`                             | `#3a3330`             | earth          | the wadi crust                |
| `dry_grass`                          | `#9a9457`             | grass          | barrens scrub                 |
| `salt`                               | `#e6e6e0`             | sand           | the pans                      |
| `sand`                               | `#b9a77e`             | sand           | dunes, tombs                  |
| `golden_sand`                        | `#d8b570`             | sand           | the dune crests               |
| `red_sand`                           | `#9b6248`             | sand           | bazaar, mesa tops, canyon rim |
| `water`                              | `#2e609e`             | water          | oasis, wadi, spring           |
| `desert_wood` / `desert_foliage`     | `#77533b` / `#72814b` | wood / foliage | barrens dead trees            |
| `cactus`                             | `#4c874f`             | foliage        | dune and barrens edge         |
| `tropical_wood` / `tropical_foliage` | `#5c3c2b` / `#317149` | wood / foliage | **the oasis palms**           |

## Mob rows

```json
{ "mob_type": "wild_talokan",     "weight_bp": 8000, "biomes": ["talokan_oasis","magmaclaw_wadis"] },
{ "mob_type": "talokan_aero",     "weight_bp": 8000, "biomes": ["talokan_oasis"] },
{ "mob_type": "woolice",          "weight_bp": 8000, "biomes": ["salt_pans","pale_barrens"] },
{ "mob_type": "boneherald",       "weight_bp": 8000, "biomes": ["sunspire_dunes","marrow_necropolis"] },
{ "mob_type": "goblin_duke",      "weight_bp": 8000, "biomes": ["duke_bazaar"] },
{ "mob_type": "armorscale",       "weight_bp": 8000, "biomes": ["magmaclaw_wadis","stormhawk_mesas","salt_pans"] },
{ "mob_type": "sand_lich",        "weight_bp": 8000, "biomes": ["sunspire_dunes"] },
{ "mob_type": "silk_lancer",      "weight_bp": 8000, "biomes": ["duke_bazaar","pale_barrens"] },
{ "mob_type": "kweebec_heartwood","weight_bp": 8000, "biomes": ["talokan_oasis","abbot_cloister"] },
{ "mob_type": "marrow_acolyte",   "weight_bp": 8000, "biomes": ["marrow_necropolis"] },
{ "mob_type": "scarak_seeker",    "weight_bp": 8000, "biomes": ["sunspire_dunes","duke_bazaar"] },
{ "mob_type": "koloss",           "weight_bp": 8000, "biomes": ["stormhawk_mesas","abbot_cloister"] },
{ "mob_type": "pale_mare",        "weight_bp": 8000, "biomes": ["pale_barrens","salt_pans"] },
{ "mob_type": "magmaclaw",        "weight_bp": 8000, "biomes": ["magmaclaw_wadis"] },
{ "mob_type": "stormhawk",        "weight_bp": 8000, "biomes": ["stormhawk_mesas"] },
{ "mob_type": "the_silent_abbot", "weight_bp": 8000, "biomes": ["abbot_cloister","marrow_necropolis"] }
```

## Resource rows

```json
{ "item_type": "cursed_gem",       "job": "MINER",     "tier": 10, "protector": "protector_cursed_gem",          "rare_item_type": "", "biomes": ["stormhawk_mesas","sunspire_dunes","magmaclaw_wadis","salt_pans","marrow_necropolis"] },
{ "item_type": "dragonlily",       "job": "HERBALIST", "tier": 10, "protector": "protector_dragon_gaia",         "rare_item_type": "", "biomes": ["talokan_oasis","abbot_cloister","pale_barrens","marrow_necropolis"] },
{ "item_type": "wheat_draconize",  "job": "FARMER",    "tier": 10, "protector": "protector_draconize_bricheton", "rare_item_type": "", "biomes": ["duke_bazaar","talokan_oasis","pale_barrens"] }
```

Dungeon: unchanged (`nerak_key`).

## Structures — have / want

| biome               | reuse today                                     | want                                                                 |
| ------------------- | ----------------------------------------------- | -------------------------------------------------------------------- |
| `sunspire_dunes`    | `desert_rocks`, buried and sparse — **covered** | —                                                                    |
| `pale_barrens`      | `desert_trees` dead set — **covered**           | —                                                                    |
| `magmaclaw_wadis`   | `scorched_rocks` — **covered**                  | waterline slabs                                                      |
| `salt_pans`         | **nothing, on purpose**                         | —                                                                    |
| `talokan_oasis`     | —                                               | the palm pack + `tropical_rocks`                                     |
| `duke_bazaar`       | —                                               | **a market street: stalls, awnings, walled compound, gate**          |
| `marrow_necropolis` | —                                               | **tomb doorways and a marching line of gates**                       |
| `abbot_cloister`    | —                                               | **cells cut into a canyon wall, one stair to the water**             |
| `stormhawk_mesas`   | —                                               | mesa caps + **the sunspire: one tower at 383, seen from everywhere** |

Four biomes ship or stay deliberately empty. The four builds this world wants are the strongest
case in the whole study for the Japanese pack — a market, a tomb road, a cliff cloister and a
pagoda tower are all in it, and together they make a desert feel inhabited by something older
than the player.
