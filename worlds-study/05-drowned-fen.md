# 05 — Drowned Fen

> Entry level 18 · mobs level 18–32 · dungeon key `flooded_nave_key` · sea level 258

A lowland that went under and stayed under. The water is high — sea level 258 against world 1's
180 on a world with no sea — so **most of this world is wading depth**, and the design job is
deciding what breaks the surface: peat hummocks, a goblin town on stilts, sinter terraces boiling
out of the ground, and the roof of a temple whose nave is the dungeon.

The roster is split down the middle between **wet** (geckos, toads, crabs, grubs, the drowned
dead) and **fire** (ember weavers, magma weavers, sparklings, cauldron imps, a sun-king gecko).
That is not a contradiction to smooth over — it is the world's whole character. Fen gas burns.
Where the ground is hot the water boils instead of lying still, and the things that live in the
steam are the ones with fire in them.

## The roster

| mob                   | lvl         | what the icon shows          | the habitat it asks for       |
| --------------------- | ----------- | ---------------------------- | ----------------------------- |
| `tokek`               | 18–26       | orange-and-white gecko       | reeds, warm wet rock          |
| `ember_silkweaver`    | 18–26       | dark spider, lava seams      | burnt dry ground              |
| `gopnik`              | 18–24       | green goblin                 | the stilt town, the hummocks  |
| `boneguard`           | 18–26       | purple skeleton              | the temple, the dry sinks     |
| `boar`                | 18–28       | red-brown boar               | anywhere solid enough to root |
| `sparkling`           | 18–26       | spider lit from inside       | hot ground                    |
| `wallow_grub`         | 18–23       | wooden box, blue eyes        | mud, stores, wrecked stuff    |
| `goblin_runt`         | 19–25       | goblin                       | the stilt town                |
| `webling`             | 20–26       | small green spider           | reeds and dry webs            |
| `raptor_cave`         | 20–28       | green raptor with a lure     | dry sinkholes                 |
| `goblin_crazy`        | 21–24       | goblin, fire-mad             | the stilt town                |
| `scarak_louse`        | 24–32       | white house-shaped insect    | dry ground above the water    |
| `firekoa`             | 25–32       | red toad                     | boiling pools                 |
| `magmaweaver`         | 25–32       | black spider, orange glow    | burnt ground                  |
| `cauldron_imp`        | 26–31       | small brown imp              | the springs                   |
| `hanged_effigy`       | 20–24 archi | hanging burnt figure         | the temple                    |
| `crabito_the_drowned` | 24–31 archi | dark blue crab               | deep still water              |
| `tokek_sunking`       | 26–32 archi | orange gecko, crowned        | the hottest water             |
| `phacochef`           | 20–25 boss  | white warthog with a cleaver | **dungeon only**              |

## The nine biomes

Temperature runs cold black water → boiling ground; humidity runs dry sink → open mere. The
**mid and high rows are the world** — a player is in water most of the time. The cold-dry corner
is the only place to stand and dry off, and it is full of raptors.

|               | humidity **low**   | humidity **mid** | humidity **high** |
| ------------- | ------------------ | ---------------- | ----------------- |
| **temp low**  | `raptor_sinks`     | `peat_hummocks`  | `black_meres`     |
| **temp mid**  | `cauldron_springs` | `reed_shallows`  | `drowned_nave`    |
| **temp high** | `ember_webs`       | `goblin_stilts`  | `witchfire_bog`   |

---

### 1. `reed_shallows` — mid_mid

Ankle-to-knee water through reeds that go over your head. You cannot see far, and everything can
see you. **The world's default ground.**

- **Mobs**: `tokek`, `wallow_grub`, `webling`, `boar`
- **Resources**: `wheat_tanjirize` (FARMER)
- **Profile**: breathes across sea level 258 — every dip is open water, every rise is a reed bed.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 183 | clay / clay / limestone              |      |
| 0.20 | 233 |                                      |      |
| 0.28 | 250 |                                      |      |
| 0.34 | 271 | rot_moss / peat / limestone          | 0.03 |
| 0.44 | 246 |                                      |      |
| 0.54 | 266 | moss / peat / limestone              | 0.03 |
| 0.66 | 241 |                                      |      |
| 0.78 | 271 |                                      |      |
| 0.90 | 250 |                                      |      |
| 1    | 275 |                                      |      |

- **Structures**: `swamp_trees` — **covered today**. Density high; the point is that you cannot see.

### 2. `drowned_nave` — mid_high

The temple. Its floor is a stone shelf that breaks the surface in places and drops away in
others, and its roof line is the only straight edge in the world. **The dungeon's overworld tell.**

- **Mobs**: `boneguard`, `hanged_effigy`, `crabito_the_drowned`
- **Resources**: `bloodstone` (MINER)
- **Profile**: mostly submerged, with one authored stone shelf at 0.44 that stands proud.

| x    | y   | land                            | var  |
| ---- | --- | ------------------------------- | ---- |
| 0    | 158 | clay / gravel / limestone       |      |
| 0.24 | 208 |                                 |      |
| 0.36 | 233 |                                 |      |
| 0.44 | 266 | limestone / gravel / deep_stone | 0.03 |
| 0.50 | 241 |                                 |      |
| 0.60 | 225 |                                 |      |
| 0.70 | 262 |                                 |      |
| 0.80 | 237 |                                 |      |
| 0.90 | 271 |                                 |      |
| 1    | 246 |                                 |      |

- **Structures**: wants **a temple hall standing in water — pillars, a broken roof, a flooded
  stair**. The single most important build in the world; everything else here is landscape.

### 3. `goblin_stilts` — high_mid

A goblin town on poles over warm shallow water, walkways between the houses, cooking smoke.
Loud, crowded, and the only settlement in the fen.

- **Mobs**: `goblin_runt`, `goblin_crazy`, `gopnik`
- **Resources**: `wheat_tanjirize` (FARMER), `nightcap` (HERBALIST)
- **Profile**: shallow water everywhere, 167 → 275, nothing more than a metre proud.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 167 | clay / clay / limestone      |      |
| 0.22 | 225 |                              |      |
| 0.30 | 246 |                              |      |
| 0.36 | 266 | rich_soil / clay / limestone | 0.03 |
| 0.46 | 241 |                              |      |
| 0.56 | 262 |                              |      |
| 0.68 | 237 |                              |      |
| 0.80 | 266 |                              |      |
| 0.90 | 246 |                              |      |
| 1    | 275 |                              |      |

- **Structures**: wants **stilt houses and plank walkways**. Japanese pack, small buildings,
  raised on posts. Second most valuable build here.

### 4. `witchfire_bog` — high_high

Black water with the gas alight on it. Nothing solid, everything lit, and the toads sitting in it
perfectly happy.

- **Mobs**: `firekoa`, `sparkling`, `cauldron_imp`, `tokek_sunking`
- **Resources**: `nightcap` (HERBALIST)
- **Profile**: the deepest breathing curve in the world, 150 → 266.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 150 | peat / peat / limestone     |      |
| 0.24 | 208 |                             |      |
| 0.34 | 237 |                             |      |
| 0.40 | 262 | rot_moss / peat / limestone | 0.03 |
| 0.50 | 233 |                             |      |
| 0.60 | 258 |                             |      |
| 0.72 | 229 |                             |      |
| 0.84 | 262 |                             |      |
| 0.94 | 237 |                             |      |
| 1    | 266 |                             |      |

- **Structures**: `swamp_trees` (dead set only) + `swamp_ruins` — **covered today**.

### 5. `black_meres` — low_high

Cold open water, too deep to wade, with peat islands that are mostly root. The crabs are down
there.

- **Mobs**: `tokek`, `crabito_the_drowned`, `wallow_grub`
- **Resources**: `nightcap` (HERBALIST)
- **Profile**: deep — the floor sits 83+ blocks under the surface for most of the range.

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 142 | peat / clay / limestone |      |
| 0.28 | 200 |                         |      |
| 0.40 | 233 |                         |      |
| 0.48 | 262 | peat / peat / limestone | 0.04 |
| 0.56 | 237 |                         |      |
| 0.68 | 216 |                         |      |
| 0.78 | 254 |                         |      |
| 0.90 | 229 |                         |      |
| 1    | 266 |                         |      |

- **Structures**: `swamp_trees` dead set, sparse — a drowned wood, not a living one.

### 6. `peat_hummocks` — low_mid

Where the fen is only _nearly_ drowned: peat mounds standing a couple of metres proud, dry enough
for a boar to root and a louse to nest.

- **Mobs**: `boar`, `scarak_louse`, `gopnik`
- **Resources**: `wheat_tanjirize` (FARMER), `bloodstone` (MINER)
- **Profile**: 191 → 350, the driest ground outside the sinks.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 191 | peat / clay / limestone     |      |
| 0.18 | 241 |                             |      |
| 0.24 | 266 | rot_moss / peat / limestone | 0.03 |
| 0.34 | 300 |                             |      |
| 0.44 | 275 |                             |      |
| 0.56 | 316 |                             |      |
| 0.68 | 291 |                             |      |
| 0.82 | 333 |                             |      |
| 1    | 350 |                             |      |

- **Structures**: `swamp_trees` + `temperate_rocks`. Covered today.

### 7. `raptor_sinks` — low_low

Dry limestone sinkholes where the water drained away and never came back. Bare rock walls, dark
floors, and something with a lure on its head living at the bottom.

- **Mobs**: `raptor_cave`, `scarak_louse`, `boneguard`
- **Resources**: `bloodstone` (MINER)
- **Profile**: inverted — a rim at 366–375 and a floor at 200. **The only dry ground and the only
  relief in the world**, and it is a hole rather than a hill.

| x    | y   | land                            | var  |
| ---- | --- | ------------------------------- | ---- |
| 0    | 366 | dry_grass / dirt / limestone    |      |
| 0.12 | 325 |                                 |      |
| 0.22 | 266 | limestone / gravel / deep_stone | 0.03 |
| 0.34 | 225 |                                 |      |
| 0.48 | 200 |                                 |      |
| 0.60 | 221 |                                 |      |
| 0.72 | 275 | dry_grass / dirt / limestone    | 0.03 |
| 0.86 | 333 |                                 |      |
| 1    | 375 |                                 |      |

- **Structures**: rock-pack **sinkhole walls and collapse blocks**; `desert_rocks` as a stand-in.

### 8. `cauldron_springs` — mid_low

Hot springs terracing out of the fen edge in pale mineral steps, each pool a different heat. The
imps tend them.

- **Mobs**: `cauldron_imp`, `sparkling`, `firekoa`
- **Resources**: `bloodstone` (MINER), `nightcap` (HERBALIST)
- **Profile**: rising terraces of sinter, 200 → 366. Steps, not slope.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 200 | clay / gravel / limestone |      |
| 0.18 | 241 |                           |      |
| 0.24 | 266 | sinter / clay / limestone | 0.03 |
| 0.34 | 275 |                           |      |
| 0.42 | 300 |                           |      |
| 0.54 | 291 |                           |      |
| 0.62 | 325 |                           |      |
| 0.76 | 316 |                           |      |
| 0.88 | 350 |                           |      |
| 1    | 366 |                           |      |

- **Structures**: rock-pack **rimstone lips**, low and pale. The terrain does most of this one.

### 9. `ember_webs` — high_low

Burnt dry ground above the water line, webbed from tree to tree by things that spin with fire in
them.

- **Mobs**: `ember_silkweaver`, `magmaweaver`, `webling`
- **Resources**: `bloodstone` (MINER)
- **Profile**: 208 → 383, the warm dry shoulder of the fen.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 208 | ash / cinder / limestone |      |
| 0.18 | 258 |                          |      |
| 0.24 | 283 | cinder / ash / limestone | 0.03 |
| 0.36 | 316 |                          |      |
| 0.48 | 291 |                          |      |
| 0.60 | 341 |                          |      |
| 0.74 | 316 |                          |      |
| 0.88 | 366 |                          |      |
| 1    | 383 |                          |      |

- **Structures**: `scorched_rocks` + `swamp_trees` dead set — **covered today**.

---

## Materials

| name                                   | color                 | preset         | used by                                   |
| -------------------------------------- | --------------------- | -------------- | ----------------------------------------- |
| `limestone`                            | `#958d75`             | stone          | the whole fen's bedrock, the temple floor |
| `deep_stone`                           | `#465258`             | stone          | sink and nave filler                      |
| `gravel`                               | `#766f61`             | stone          | springs, nave, sinks                      |
| `clay`                                 | `#76514b`             | earth          | the fen bottom                            |
| `peat`                                 | `#3b3125`             | earth          | meres, hummocks, bog                      |
| `rich_soil`                            | `#493a2d`             | earth          | the stilt town's banks                    |
| `ash`                                  | `#55504a`             | earth          | ember webs                                |
| `cinder`                               | `#3a3330`             | earth          | burnt crust                               |
| `dirt`                                 | `#654d36`             | earth          | sink rims                                 |
| `moss`                                 | `#456a4b`             | grass          | reed beds                                 |
| `rot_moss`                             | `#3d5236`             | grass          | everything at the water line              |
| `dry_grass`                            | `#9a9457`             | grass          | the sink rims                             |
| `sinter`                               | `#cfc0a6`             | sand           | the spring terraces                       |
| `water`                                | `#2e609e`             | water          | most of the world                         |
| `swamp_wood` / `swamp_foliage`         | `#493d32` / `#395d42` | wood / foliage | reeds, meres, bog, webs                   |
| `temperate_wood` / `temperate_foliage` | `#624936` / `#416f49` | wood / foliage | hummocks                                  |

## Mob rows

```json
{ "mob_type": "tokek",               "weight_bp": 8000, "biomes": ["reed_shallows","black_meres"] },
{ "mob_type": "ember_silkweaver",    "weight_bp": 8000, "biomes": ["ember_webs"] },
{ "mob_type": "gopnik",              "weight_bp": 8000, "biomes": ["goblin_stilts","peat_hummocks"] },
{ "mob_type": "boneguard",           "weight_bp": 8000, "biomes": ["drowned_nave","raptor_sinks"] },
{ "mob_type": "boar",                "weight_bp": 8000, "biomes": ["reed_shallows","peat_hummocks"] },
{ "mob_type": "sparkling",           "weight_bp": 8000, "biomes": ["cauldron_springs","witchfire_bog"] },
{ "mob_type": "wallow_grub",         "weight_bp": 8000, "biomes": ["reed_shallows","black_meres"] },
{ "mob_type": "goblin_runt",         "weight_bp": 8000, "biomes": ["goblin_stilts"] },
{ "mob_type": "webling",             "weight_bp": 8000, "biomes": ["reed_shallows","ember_webs"] },
{ "mob_type": "raptor_cave",         "weight_bp": 8000, "biomes": ["raptor_sinks"] },
{ "mob_type": "goblin_crazy",        "weight_bp": 8000, "biomes": ["goblin_stilts"] },
{ "mob_type": "scarak_louse",        "weight_bp": 8000, "biomes": ["peat_hummocks","raptor_sinks"] },
{ "mob_type": "firekoa",             "weight_bp": 8000, "biomes": ["witchfire_bog","cauldron_springs"] },
{ "mob_type": "magmaweaver",         "weight_bp": 8000, "biomes": ["ember_webs"] },
{ "mob_type": "cauldron_imp",        "weight_bp": 8000, "biomes": ["cauldron_springs","witchfire_bog"] },
{ "mob_type": "hanged_effigy",       "weight_bp": 8000, "biomes": ["drowned_nave"] },
{ "mob_type": "crabito_the_drowned", "weight_bp": 8000, "biomes": ["black_meres","drowned_nave"] },
{ "mob_type": "tokek_sunking",       "weight_bp": 8000, "biomes": ["witchfire_bog"] }
```

## Resource rows

```json
{ "item_type": "bloodstone",       "job": "MINER",     "tier": 5, "protector": "protector_bloodstone",          "rare_item_type": "", "biomes": ["raptor_sinks","cauldron_springs","ember_webs","drowned_nave","peat_hummocks"] },
{ "item_type": "nightcap",         "job": "HERBALIST", "tier": 5, "protector": "protector_nightcap_gaia",       "rare_item_type": "", "biomes": ["black_meres","witchfire_bog","goblin_stilts","cauldron_springs"] },
{ "item_type": "wheat_tanjirize",  "job": "FARMER",    "tier": 5, "protector": "protector_tanjirize_bricheton", "rare_item_type": "", "biomes": ["reed_shallows","peat_hummocks","goblin_stilts"] }
```

Dungeon: unchanged (`flooded_nave_key`).

## Structures — have / want

| biome              | reuse today                                     | want                                                                      |
| ------------------ | ----------------------------------------------- | ------------------------------------------------------------------------- |
| `reed_shallows`    | `swamp_trees` — **covered**                     | —                                                                         |
| `witchfire_bog`    | `swamp_trees` + `swamp_ruins` — **covered**     | —                                                                         |
| `ember_webs`       | `scorched_rocks` + `swamp_trees` — **covered**  | —                                                                         |
| `black_meres`      | `swamp_trees`, sparse — **covered**             | —                                                                         |
| `peat_hummocks`    | `swamp_trees` + `temperate_rocks` — **covered** | —                                                                         |
| `raptor_sinks`     | `desert_rocks` as stand-in                      | sinkhole walls, collapse blocks                                           |
| `cauldron_springs` | —                                               | rimstone lips                                                             |
| `goblin_stilts`    | —                                               | **stilt houses, plank walkways**                                          |
| `drowned_nave`     | —                                               | **a temple hall standing in water — pillars, broken roof, flooded stair** |

Five of nine biomes ship today; the swamp pack was made for this world. Everything that matters
new is two builds, and both are Japanese-pack native: a village on posts over water, and a
temple with its feet in the flood.
