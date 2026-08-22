# 06 — Pandora Reach

> Entry level 22 · mobs level 22–38 · dungeon key `hollow_root_key` · sea level 131

Twenty-five mobs, more than any world before it, and no two of them agree on what this place is:
reef fish and desert wraiths, jungle cocoons and magma rams, lizardfolk scouts and a goblin
kitchen brigade. That is the read — **Pandora Reach is where everything got out and none of it
went home**. A river reach where a jungle, a burnt scarp and a coral shallows meet inside one
horizon, held together by a root system big enough to walk through.

The dungeon key is `hollow_root_key`, so the roots are literal: the world's landmark is a tree
whose roots you can stand inside, and its boss is a goblin cook.

## The roster

| mob                 | lvl         | what the icon shows                 | the habitat it asks for |
| ------------------- | ----------- | ----------------------------------- | ----------------------- |
| `snapthorn_weak`    | 22–28       | red carnivorous flower              | living root country     |
| `goblin_green`      | 22–26       | green goblin                        | the kitchens            |
| `hermitude`         | 22–32       | crab wearing its shell              | reef and sand           |
| `sandskip`          | 22–30       | sand-coloured skittering lump       | hot flats               |
| `magmooligan`       | 22–30       | ram with lava in its wool           | hot scree               |
| `sandwraith`        | 22–32       | gold skeleton                       | dry flats               |
| `seedkin`           | 22–30       | tan seed-headed creature, huge eyes | root country            |
| `pike`              | 22–32       | blue fish                           | open water              |
| `reef_pike`         | 22–32       | green-white fish                    | the coral               |
| `wraithling`        | 22–32       | flame wraith                        | empty cold ground       |
| `truffle_wraith`    | 22–27       | magenta wraith                      | deep shade, leaf mould  |
| `koagulant`         | 23–35       | cauldron with plants growing out    | root country            |
| `zephyr_silklord`   | 25–29       | pale cocoon, crowned                | the high canopy         |
| `bonegorger`        | 25–35       | gold skeletal beast                 | scarps and barrens      |
| `feran_cub`         | 25–32       | upright fox cub                     | shade and canopy        |
| `slothmaster`       | 25–35       | dark purple sloth                   | deep shade              |
| `flareling`         | 26–38       | fire imp                            | hot scree               |
| `grimfang`          | 26–34       | golden wolf                         | dry scarps              |
| `warthog`           | 26–38       | green-black warthog                 | the kitchens' middens   |
| `shadow_knight`     | 28–38       | gold skeleton in armour             | the barrens             |
| `ashraptor`         | 28–36       | red raptor                          | scarps, hot rock        |
| `banner_of_silence` | 28–34       | dark banner-bird                    | the emptiest ground     |
| `saurian_scout`     | 28–36       | green lizardfolk                    | reef edge, canopy       |
| `goblin_sous_chef`  | 28–33       | goblin, fire-handed                 | the kitchens            |
| `gopnik_blyat`      | 23–27 archi | goblin                              | the kitchens            |
| `gobadoc`           | 23–38 boss  | goblin gourmand                     | **dungeon only**        |

## The nine biomes

Temperature runs shaded scarp-and-wood → sun-hammered flats; humidity runs bare rock → open reef.
This is the first world where the **three columns feel like three different countries**, and that
is intentional: the Reach is a meeting place, and a player should feel the seams.

|               | humidity **low**   | humidity **mid**  | humidity **high** |
| ------------- | ------------------ | ----------------- | ----------------- |
| **temp low**  | `ashraptor_scarps` | `truffle_shade`   | `silence_barrens` |
| **temp mid**  | `magma_scree`      | `goblin_kitchens` | `hollow_roots`    |
| **temp high** | `sandskip_flats`   | `silklord_canopy` | `pandora_reef`    |

---

### 1. `goblin_kitchens` — mid_mid

The riverbank the goblins took: fire pits, spits, drying frames, middens, and the smell reaching
two biomes in every direction. **The world's default ground, and the only populated one.**

- **Mobs**: `goblin_green`, `goblin_sous_chef`, `gopnik_blyat`, `warthog`
- **Resources**: `wheat_suize` (FARMER)
- **Profile**: worn riverbank rising to a bluff, 99 → 198.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 99  | wet_sand / clay / limestone          |      |
| 0.18 | 122 |                                      |      |
| 0.24 | 140 | dirt / rich_soil / limestone         | 0.03 |
| 0.36 | 158 |                                      |      |
| 0.48 | 149 |                                      |      |
| 0.62 | 176 |                                      |      |
| 0.76 | 162 |                                      |      |
| 0.90 | 189 |                                      |      |
| 1    | 198 |                                      |      |

- **Structures**: wants **cook frames, spits, a long shed, midden heaps**. Japanese pack
  outbuildings, deliberately shabby and over-dense — a camp that outgrew itself.

### 2. `hollow_roots` — mid_high

Root humps the size of hills, with gaps under them you can walk into. Wet, green, and full of
things that grow rather than hunt. **The dungeon's overworld tell.**

- **Mobs**: `snapthorn_weak`, `seedkin`, `truffle_wraith`, `koagulant`
- **Resources**: `crimson_truffle` (HERBALIST), `nightcap` (HERBALIST)
- **Profile**: humped, 95 → 207. Every rise between 0.32 and 0.86 is a root back breaking ground.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 95  | rich_soil / clay / limestone |      |
| 0.18 | 122 |                              |      |
| 0.24 | 140 | moss / rich_soil / limestone | 0.03 |
| 0.32 | 176 |                              |      |
| 0.40 | 153 |                              |      |
| 0.52 | 189 |                              |      |
| 0.62 | 162 |                              |      |
| 0.74 | 198 |                              |      |
| 0.86 | 171 |                              |      |
| 1    | 207 |                              |      |

- **Structures**: `swamp_trees` big-tree set at **maximum size and low density** is the closest
  thing today to a walk-through root — huge trunks, far apart. Wants **root arches**: a buttress
  you can pass under. Nothing in any pack does this; it may have to be a generated type, the way
  the four existing ruins are.

### 3. `pandora_reef` — high_high

Warm coral shallows off the river mouth. Heads break the surface at low ground, fish everywhere,
and the lizardfolk work the edge of it.

- **Mobs**: `pike`, `reef_pike`, `hermitude`, `saurian_scout`
- **Resources**: `nightcap` (HERBALIST)
- **Profile**: mostly submerged under sea level 131; the 0.48 knot is the reef crest.

| x    | y   | land                           | var  |
| ---- | --- | ------------------------------ | ---- |
| 0    | 77  | coral_sand / clay / limestone  |      |
| 0.28 | 108 |                                |      |
| 0.40 | 122 |                                |      |
| 0.48 | 137 | coral / coral_sand / limestone | 0.04 |
| 0.56 | 124 |                                |      |
| 0.68 | 113 |                                |      |
| 0.78 | 135 |                                |      |
| 0.90 | 122 |                                |      |
| 1    | 140 |                                |      |

- **Structures**: `tropical_rocks` — the corail set — **covered today**, and this is the world it
  was made for.

### 4. `sandskip_flats` — high_low

Hot pale sand above the tide, dead trees, bones half out of the ground, and things that move in
short bursts and then are gone.

- **Mobs**: `sandskip`, `sandwraith`, `hermitude`
- **Resources**: `duskite` (MINER)
- **Profile**: 90 → 194, low dunes and pans.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 90  | wet_sand / sand / limestone |      |
| 0.18 | 117 |                             |      |
| 0.22 | 133 | sand / sand / limestone     | 0.03 |
| 0.32 | 158 |                             |      |
| 0.40 | 142 |                             |      |
| 0.52 | 171 |                             |      |
| 0.62 | 153 |                             |      |
| 0.76 | 185 |                             |      |
| 0.88 | 167 |                             |      |
| 1    | 194 |                             |      |

- **Structures**: `desert_trees` (dead-tree types only) + `desert_rocks` — **covered today**.

### 5. `silklord_canopy` — high_mid

The high jungle shelf where the canopy closes over and the silk starts. Warm, loud, and above
everything else that is warm.

- **Mobs**: `zephyr_silklord`, `feran_cub`, `saurian_scout`
- **Resources**: `crimson_truffle` (HERBALIST), `wheat_suize` (FARMER)
- **Profile**: a long climb to 261 — the second-highest ground in the world and the only high
  ground that is green.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 104 | rich_soil / clay / limestone |      |
| 0.18 | 135 |                              |      |
| 0.24 | 158 | moss / rich_soil / stone     | 0.03 |
| 0.36 | 194 |                              |      |
| 0.48 | 180 |                              |      |
| 0.62 | 221 |                              |      |
| 0.76 | 207 |                              |      |
| 0.90 | 248 |                              |      |
| 1    | 261 |                              |      |

- **Structures**: `tropical_trees` at full density — **covered today**.

### 6. `truffle_shade` — low_mid

The closed cold wood on the shaded side. Leaf mould a metre deep, no undergrowth, nothing moving
fast.

- **Mobs**: `truffle_wraith`, `feran_cub`, `slothmaster`
- **Resources**: `crimson_truffle` (HERBALIST)
- **Profile**: steady, dark, 99 → 221.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 99  | moss / rich_soil / stone |      |
| 0.16 | 126 |                          |      |
| 0.24 | 149 | rich_soil / dirt / stone | 0.03 |
| 0.36 | 167 |                          |      |
| 0.48 | 158 |                          |      |
| 0.62 | 189 |                          |      |
| 0.76 | 176 |                          |      |
| 0.90 | 207 |                          |      |
| 1    | 221 |                          |      |

- **Structures**: `temperate_trees` + `temperate_rocks` — **covered today**.

### 7. `silence_barrens` — low_high

Cold wet ground where nothing grows and the only upright things are banners nobody planted. The
quietest place in the game so far, and it should be uncomfortable.

- **Mobs**: `banner_of_silence`, `wraithling`, `shadow_knight`, `bonegorger`
- **Resources**: `nightcap` (HERBALIST), `duskite` (MINER)
- **Profile**: low, flat, wet, 90 → 167. **Resist the urge to give this one relief.**

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 90  | clay / clay / limestone     |      |
| 0.20 | 117 |                             |      |
| 0.28 | 131 |                             |      |
| 0.34 | 142 | rot_moss / clay / limestone | 0.03 |
| 0.46 | 133 |                             |      |
| 0.58 | 149 |                             |      |
| 0.70 | 140 |                             |      |
| 0.84 | 158 |                             |      |
| 1    | 167 |                             |      |

- **Structures**: `swamp_trees` dead set at very low density, plus wants **standing banner poles
  and one gate**, spaced far enough apart that you walk between them in silence.

### 8. `ashraptor_scarps` — low_low

The dry scarp wall that closes the Reach off. Bare limestone, raptor nests on the ledges, wolves
working the foot of it.

- **Mobs**: `ashraptor`, `grimfang`, `bonegorger`
- **Resources**: `duskite` (MINER)
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 122-block face.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 99  | gravel / limestone / deep_stone    |      |
| 0.14 | 135 |                                    |      |
| 0.18 | 158 | limestone / limestone / deep_stone | 0.02 |
| 0.20 | 279 |                                    |      |
| 0.28 | 302 | dry_grass / dirt / limestone       | 0.03 |
| 0.42 | 288 |                                    |      |
| 0.56 | 333 |                                    |      |
| 0.70 | 311 |                                    |      |
| 0.84 | 360 |                                    |      |
| 1    | 383 |                                    |      |

- **Structures**: rock-pack **ledges and nest shelves**; `desert_rocks` as a stand-in.

### 9. `magma_scree` — mid_low

Loose hot rock spilling off the scarp, ash between the stones, the ram and the imps living where
nothing else will.

- **Mobs**: `magmooligan`, `flareling`, `ashraptor`
- **Resources**: `duskite` (MINER)
- **Profile**: 108 → 261, the steepest non-cliff slope in the world.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 108 | gravel / ash / blackstone |      |
| 0.18 | 140 |                           |      |
| 0.26 | 171 | ash / cinder / blackstone | 0.03 |
| 0.38 | 198 |                           |      |
| 0.50 | 180 |                           |      |
| 0.64 | 225 |                           |      |
| 0.78 | 207 |                           |      |
| 0.90 | 248 |                           |      |
| 1    | 261 |                           |      |

- **Structures**: `scorched_rocks` + `scorched_ruins` — **covered today**.

---

## Materials

| name                                   | color                 | preset         | used by                                           |
| -------------------------------------- | --------------------- | -------------- | ------------------------------------------------- |
| `limestone`                            | `#958d75`             | stone          | the scarp and most fillers                        |
| `stone`                                | `#707777`             | stone          | canopy and shade filler, above the limestone line |
| `deep_stone`                           | `#465258`             | stone          | scarp filler                                      |
| `gravel`                               | `#766f61`             | stone          | scree, scarp foot                                 |
| `blackstone`                           | `#373737`             | stone          | under the magma scree                             |
| `coral`                                | `#c46975`             | stone          | the reef crest                                    |
| `clay`                                 | `#76514b`             | earth          | river, reef, barrens                              |
| `rich_soil`                            | `#493a2d`             | earth          | roots, canopy, shade                              |
| `dirt`                                 | `#654d36`             | earth          | kitchens, scarp cap                               |
| `ash`                                  | `#55504a`             | earth          | magma scree                                       |
| `cinder`                               | `#3a3330`             | earth          | burnt crust                                       |
| `moss`                                 | `#456a4b`             | grass          | roots, canopy, shade                              |
| `rot_moss`                             | `#3d5236`             | grass          | the barrens                                       |
| `dry_grass`                            | `#9a9457`             | grass          | the scarp cap                                     |
| `sand`                                 | `#b9a77e`             | sand           | the flats                                         |
| `coral_sand`                           | `#cdbb90`             | sand           | the reef                                          |
| `wet_sand`                             | `#9d896b`             | sand           | river and tide line                               |
| `water`                                | `#2e609e`             | water          | river, reef                                       |
| `tropical_wood` / `tropical_foliage`   | `#5c3c2b` / `#317149` | wood / foliage | canopy, roots                                     |
| `temperate_wood` / `temperate_foliage` | `#624936` / `#416f49` | wood / foliage | truffle shade                                     |
| `swamp_wood` / `swamp_foliage`         | `#493d32` / `#395d42` | wood / foliage | roots, barrens                                    |
| `desert_wood` / `desert_foliage`       | `#77533b` / `#72814b` | wood / foliage | the flats' dead trees                             |

## Mob rows

```json
{ "mob_type": "snapthorn_weak",    "weight_bp": 8000, "biomes": ["hollow_roots"] },
{ "mob_type": "goblin_green",      "weight_bp": 8000, "biomes": ["goblin_kitchens"] },
{ "mob_type": "hermitude",         "weight_bp": 8000, "biomes": ["pandora_reef","sandskip_flats"] },
{ "mob_type": "sandskip",          "weight_bp": 8000, "biomes": ["sandskip_flats"] },
{ "mob_type": "magmooligan",       "weight_bp": 8000, "biomes": ["magma_scree"] },
{ "mob_type": "sandwraith",        "weight_bp": 8000, "biomes": ["sandskip_flats","silence_barrens"] },
{ "mob_type": "seedkin",           "weight_bp": 8000, "biomes": ["hollow_roots","silklord_canopy"] },
{ "mob_type": "pike",              "weight_bp": 8000, "biomes": ["pandora_reef"] },
{ "mob_type": "reef_pike",         "weight_bp": 8000, "biomes": ["pandora_reef"] },
{ "mob_type": "wraithling",        "weight_bp": 8000, "biomes": ["silence_barrens","magma_scree"] },
{ "mob_type": "truffle_wraith",    "weight_bp": 8000, "biomes": ["truffle_shade","hollow_roots"] },
{ "mob_type": "koagulant",         "weight_bp": 8000, "biomes": ["hollow_roots"] },
{ "mob_type": "zephyr_silklord",   "weight_bp": 8000, "biomes": ["silklord_canopy"] },
{ "mob_type": "bonegorger",        "weight_bp": 8000, "biomes": ["ashraptor_scarps","silence_barrens"] },
{ "mob_type": "feran_cub",         "weight_bp": 8000, "biomes": ["truffle_shade","silklord_canopy"] },
{ "mob_type": "slothmaster",       "weight_bp": 8000, "biomes": ["truffle_shade"] },
{ "mob_type": "flareling",         "weight_bp": 8000, "biomes": ["magma_scree"] },
{ "mob_type": "grimfang",          "weight_bp": 8000, "biomes": ["ashraptor_scarps"] },
{ "mob_type": "warthog",           "weight_bp": 8000, "biomes": ["goblin_kitchens"] },
{ "mob_type": "shadow_knight",     "weight_bp": 8000, "biomes": ["silence_barrens"] },
{ "mob_type": "ashraptor",         "weight_bp": 8000, "biomes": ["ashraptor_scarps","magma_scree"] },
{ "mob_type": "banner_of_silence", "weight_bp": 8000, "biomes": ["silence_barrens"] },
{ "mob_type": "saurian_scout",     "weight_bp": 8000, "biomes": ["pandora_reef","silklord_canopy"] },
{ "mob_type": "goblin_sous_chef",  "weight_bp": 8000, "biomes": ["goblin_kitchens"] },
{ "mob_type": "gopnik_blyat",      "weight_bp": 8000, "biomes": ["goblin_kitchens"] }
```

## Resource rows

```json
{ "item_type": "crimson_truffle", "job": "HERBALIST", "tier": 6, "protector": "protector_truffle_gaia",   "rare_item_type": "", "biomes": ["truffle_shade","hollow_roots","silklord_canopy"] },
{ "item_type": "duskite",         "job": "MINER",     "tier": 6, "protector": "protector_duskite",        "rare_item_type": "", "biomes": ["ashraptor_scarps","magma_scree","sandskip_flats","silence_barrens"] },
{ "item_type": "nightcap",        "job": "HERBALIST", "tier": 5, "protector": "protector_nightcap_gaia",  "rare_item_type": "", "biomes": ["silence_barrens","hollow_roots","pandora_reef"] },
{ "item_type": "wheat_suize",     "job": "FARMER",    "tier": 6, "protector": "protector_suize_bricheton","rare_item_type": "", "biomes": ["goblin_kitchens","silklord_canopy"] }
```

Dungeon: unchanged (`hollow_root_key`).

## Structures — have / want

| biome              | reuse today                                          | want                                                                            |
| ------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `pandora_reef`     | `tropical_rocks` (corail) — **covered**              | —                                                                               |
| `silklord_canopy`  | `tropical_trees` — **covered**                       | —                                                                               |
| `truffle_shade`    | `temperate_trees` + `temperate_rocks` — **covered**  | —                                                                               |
| `sandskip_flats`   | `desert_trees` (dead) + `desert_rocks` — **covered** | —                                                                               |
| `magma_scree`      | `scorched_rocks` + `scorched_ruins` — **covered**    | —                                                                               |
| `ashraptor_scarps` | `desert_rocks` as stand-in                           | ledges, nest shelves                                                            |
| `silence_barrens`  | `swamp_trees` dead, sparse                           | banner poles, one gate                                                          |
| `goblin_kitchens`  | —                                                    | **cook frames, spits, long shed, middens**                                      |
| `hollow_roots`     | `swamp_trees` big set, huge and sparse               | **root arches you can walk under — no pack has these; likely a generated type** |

Five biomes ship as-is, which is what a 25-mob world needs. The one genuinely hard want is the
root arch, and it is the dungeon's own image — worth a generated type rather than a compromise.
