# 09 — Coral Throne

> Entry level 40 · mobs level 40–60 · dungeon key `tide_throne_key` · sea level 149

A big tropical island inside its own reef. The roster reads as two populations that never meet:
**reef** (crabs, snapjaws, lizardfolk, drowned bones) and **interior** (a bear, a sabertooth, a
kitsune, tree-folk, a sloth). That is not a mistake to iron out — it is an island. The ring of
water is one world, the forest inside it is another, and the throne sits exactly on the line
between them at the tide.

**This is the palm pack's home.** Import the palms as `tropical_palm_g1…` so they inherit
`tropical_wood` / `tropical_foliage` and cost no new materials — eleven of the twenty-nine in
`misc/schematics.zip` already import clean without touching the block map.

## The roster

| mob                      | lvl         | what the icon shows        | the habitat it asks for            |
| ------------------------ | ----------- | -------------------------- | ---------------------------------- |
| `shadow_vulture`         | 40–55       | dark vulture               | spires, dry ridges                 |
| `banner_wraith`          | 40–55       | green tattered banner-bird | the terraces                       |
| `elder_sloth`            | 40–55       | grey ape-monk              | deep forest                        |
| `ember_kweebec`          | 40–50       | brown tree-folk, fire-lit  | the burns                          |
| `snapjaw`                | 40–55       | spiked fish                | reef and lagoon                    |
| `ensable_hatchling`      | 40–45       | small blue crab            | reef and lagoon                    |
| `broodling`              | 42–52       | orange spider              | shaded hollows                     |
| `palebones`              | 42–52       | blue skeleton              | under the water                    |
| `kweebec_grove_heart`    | 42–48       | brown tree-folk            | the grove's centre                 |
| `grizzly`                | 42–55       | brown bear                 | forest and grass                   |
| `saurian_warden`         | 42–54       | green lizardfolk           | the lagoon                         |
| `scarak_defender`        | 44–54       | purple insect              | hollows and spires                 |
| `sabertooth`             | 48–60       | white sabertooth           | long grass                         |
| `nine_tails_kitsune`     | 50–58       | orange nine-tailed fox     | the strand, the burns              |
| `pyre_warthog`           | 50–60       | red warthog                | the burns                          |
| `bone_choir`             | 50–55       | brown skeleton             | the terraces                       |
| `pale_weaver`            | 50–58 archi | white spider               | hollows and spires                 |
| `scyllar_the_coral_king` | 56–60 boss  | red coral crab             | **dungeon only** — the tide throne |

## The nine biomes

Temperature runs shaded windward side → sun-baked leeward; humidity runs bare spire → open reef.
The **whole right column is water**, and the throne sits at the top of it.

|               | humidity **low**  | humidity **mid** | humidity **high** |
| ------------- | ----------------- | ---------------- | ----------------- |
| **temp low**  | `vulture_spires`  | `brood_hollows`  | `saurian_lagoon`  |
| **temp mid**  | `sabergrass`      | `grove_heart`    | `coral_shelf`     |
| **temp high** | `emberpalm_burns` | `palm_strand`    | `throne_terraces` |

---

### 1. `grove_heart` — mid_mid

The island's interior: closed tropical forest with the tree-folk standing in it, and a bear that
does not care. **The world's default ground.**

- **Mobs**: `kweebec_grove_heart`, `ember_kweebec`, `elder_sloth`, `grizzly`
- **Resources**: `arcaneshroom` (HERBALIST), `wheat_purple` (FARMER)
- **Profile**: 117 → 252, a steady inland rise.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 117 | rich_soil / clay / limestone         |      |
| 0.18 | 145 |                                      |      |
| 0.24 | 163 | moss / rich_soil / limestone         | 0.03 |
| 0.36 | 192 |                                      |      |
| 0.48 | 177 |                                      |      |
| 0.62 | 215 |                                      |      |
| 0.76 | 201 |                                      |      |
| 0.90 | 238 |                                      |      |
| 1    | 252 |                                      |      |

- **Structures**: `tropical_trees` at full density — **covered today**.

### 2. `coral_shelf` — mid_high

The living reef. Heads break the surface at the crest and the rest is blue.

- **Mobs**: `snapjaw`, `ensable_hatchling`, `palebones`
- **Resources**: `draconite` (MINER)
- **Profile**: sits under sea level 149 except the 0.46 crest.

| x    | y   | land                           | var  |
| ---- | --- | ------------------------------ | ---- |
| 0    | 89  | coral_sand / clay / limestone  |      |
| 0.26 | 117 |                                |      |
| 0.38 | 133 |                                |      |
| 0.46 | 154 | coral / coral_sand / limestone | 0.04 |
| 0.54 | 138 |                                |      |
| 0.66 | 126 |                                |      |
| 0.78 | 152 |                                |      |
| 0.90 | 135 |                                |      |
| 1    | 156 |                                |      |

- **Structures**: `tropical_rocks` corail set — **covered today**.

### 3. `palm_strand` — high_mid

The sunny beach and the palm line behind it. Bright, hot, and where a kitsune walks in daylight.

- **Mobs**: `nine_tails_kitsune`, `sabertooth`, `pyre_warthog`
- **Resources**: `wheat_purple` (FARMER)
- **Profile**: 103 → 210, beach to a low palm shelf.

| x    | y   | land                          | var  |
| ---- | --- | ----------------------------- | ---- |
| 0    | 103 | wet_sand / sand / limestone   |      |
| 0.18 | 131 |                               |      |
| 0.24 | 154 | coral_sand / sand / limestone | 0.03 |
| 0.36 | 173 |                               |      |
| 0.48 | 161 |                               |      |
| 0.62 | 187 |                               |      |
| 0.76 | 175 |                               |      |
| 0.90 | 201 |                               |      |
| 1    | 210 |                               |      |

- **Structures**: **the palm pack**, imported as `tropical_palm_g*`. This is the biome the download
  exists for.

### 4. `throne_terraces` — high_high

Stepped coral platforms rising out of the tide, dry at the top and awash at the bottom. Something
was crowned here. **The dungeon's overworld tell.**

- **Mobs**: `bone_choir`, `banner_wraith`, `saurian_warden`
- **Resources**: `draconite` (MINER), `arcaneshroom` (HERBALIST)
- **Profile**: treads and risers out of the water, 93 → 252 — the only stepped ground in the world.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 93  | coral / coral_sand / limestone     |      |
| 0.22 | 126 |                                    |      |
| 0.28 | 149 | limestone / coral_sand / limestone | 0.03 |
| 0.38 | 159 |                                    |      |
| 0.44 | 182 |                                    |      |
| 0.56 | 187 |                                    |      |
| 0.62 | 215 |                                    |      |
| 0.76 | 220 |                                    |      |
| 0.86 | 243 |                                    |      |
| 1    | 252 |                                    |      |

- **Structures**: wants **a terraced platform temple with its lowest step in the water** — the
  Japanese pack's raised halls and gates, set so the tide reaches the first stair. One build,
  visible from the reef, and the whole world orients on it.

### 5. `saurian_lagoon` — low_high

The cool deep lagoon on the shaded side, where the lizardfolk keep to themselves.

- **Mobs**: `saurian_warden`, `snapjaw`, `ensable_hatchling`, `palebones`
- **Resources**: `arcaneshroom` (HERBALIST)
- **Profile**: deep — 47+ blocks of water over most of the range.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 79  | clay / clay / limestone     |      |
| 0.28 | 112 |                             |      |
| 0.40 | 131 |                             |      |
| 0.48 | 152 | rot_moss / clay / limestone | 0.03 |
| 0.56 | 135 |                             |      |
| 0.68 | 124 |                             |      |
| 0.78 | 149 |                             |      |
| 0.90 | 133 |                             |      |
| 1    | 154 |                             |      |

- **Structures**: `tropical_rocks` under water; wants **a small stilt shrine** on the far bank —
  the lizardfolk's own, not the throne's.

### 6. `sabergrass` — mid_low

Dry grass higher than a person along the island's spine. You hear the sabertooth before you see
it, and then you do not.

- **Mobs**: `sabertooth`, `grizzly`, `shadow_vulture`
- **Resources**: `wheat_purple` (FARMER), `draconite` (MINER)
- **Profile**: 112 → 257, open and rising.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 112 | sand / dirt / limestone      |      |
| 0.16 | 145 |                              |      |
| 0.22 | 168 | dry_grass / dirt / limestone | 0.03 |
| 0.34 | 196 |                              |      |
| 0.46 | 182 |                              |      |
| 0.60 | 220 |                              |      |
| 0.74 | 206 |                              |      |
| 0.88 | 243 |                              |      |
| 1    | 257 |                              |      |

- **Structures**: `grassland_trees` acacia set at low density + `grassland_rocks` — **covered today**.

### 7. `brood_hollows` — low_mid

Bowls of shade on the windward side, roofed by canopy, floored with web.

- **Mobs**: `broodling`, `pale_weaver`, `scarak_defender`
- **Resources**: `arcaneshroom` (HERBALIST)
- **Profile**: inverted — rim 243, floor 135.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 243 | moss / rich_soil / limestone |      |
| 0.14 | 210 |                              |      |
| 0.24 | 173 |                              |      |
| 0.36 | 149 | rich_soil / dirt / limestone | 0.03 |
| 0.50 | 135 |                              |      |
| 0.62 | 147 |                              |      |
| 0.74 | 177 | moss / rich_soil / limestone | 0.03 |
| 0.88 | 215 |                              |      |
| 1    | 248 |                              |      |

- **Structures**: `tropical_trees` on the rim only, so the hollow floors stay open and lit from
  above. Covered today.

### 8. `vulture_spires` — low_low

Bare limestone spires on the windward point, whitened by the birds that nest on them.

- **Mobs**: `shadow_vulture`, `pale_weaver`, `scarak_defender`
- **Resources**: `draconite` (MINER)
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 117-block face.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 107 | gravel / limestone / deep_stone    |      |
| 0.14 | 149 |                                    |      |
| 0.18 | 177 | limestone / limestone / deep_stone | 0.02 |
| 0.20 | 294 |                                    |      |
| 0.28 | 322 | dry_grass / dirt / limestone       | 0.03 |
| 0.42 | 304 |                                    |      |
| 0.56 | 346 |                                    |      |
| 0.70 | 322 |                                    |      |
| 0.84 | 364 |                                    |      |
| 1    | 383 |                                    |      |

- **Structures**: rock-pack **spires and stacks**, tall and thin.

### 9. `emberpalm_burns` — high_low

Where the leeward side burned: black palm stumps standing in ash, and the fire-lit things that
moved in after.

- **Mobs**: `pyre_warthog`, `ember_kweebec`, `nine_tails_kitsune`
- **Resources**: `draconite` (MINER)
- **Profile**: 112 → 234.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 112 | ash / cinder / limestone |      |
| 0.18 | 140 |                          |      |
| 0.24 | 163 | cinder / ash / limestone | 0.03 |
| 0.36 | 187 |                          |      |
| 0.48 | 173 |                          |      |
| 0.62 | 206 |                          |      |
| 0.76 | 192 |                          |      |
| 0.90 | 224 |                          |      |
| 1    | 234 |                          |      |

- **Structures**: `scorched_rocks` + the palm pack's **bare-trunk types only**. Covered once the
  palms are imported.

---

## Materials

| name                                   | color                 | preset         | used by                           |
| -------------------------------------- | --------------------- | -------------- | --------------------------------- |
| `limestone`                            | `#958d75`             | stone          | the island's bone                 |
| `deep_stone`                           | `#465258`             | stone          | spire filler                      |
| `gravel`                               | `#766f61`             | stone          | spire foot                        |
| `coral`                                | `#c46975`             | stone          | reef crest, throne steps          |
| `clay`                                 | `#76514b`             | earth          | lagoon, reef floor                |
| `rich_soil`                            | `#493a2d`             | earth          | grove, hollows                    |
| `dirt`                                 | `#654d36`             | earth          | grass, burns, spire cap           |
| `ash`                                  | `#55504a`             | earth          | the burns                         |
| `cinder`                               | `#3a3330`             | earth          | the burns' crust                  |
| `moss`                                 | `#456a4b`             | grass          | grove and hollows                 |
| `rot_moss`                             | `#3d5236`             | grass          | the lagoon shore                  |
| `dry_grass`                            | `#9a9457`             | grass          | sabergrass, spire cap             |
| `sand`                                 | `#b9a77e`             | sand           | strand, sabergrass                |
| `coral_sand`                           | `#cdbb90`             | sand           | reef and beach                    |
| `wet_sand`                             | `#9d896b`             | sand           | the tide line                     |
| `water`                                | `#2e609e`             | water          | reef, lagoon, throne              |
| `tropical_wood` / `tropical_foliage`   | `#5c3c2b` / `#317149` | wood / foliage | grove, hollows, **and the palms** |
| `grassland_wood` / `grassland_foliage` | `#76543a` / `#7d8f46` | wood / foliage | sabergrass acacias                |

## Mob rows

```json
{ "mob_type": "shadow_vulture",      "weight_bp": 8000, "biomes": ["vulture_spires","sabergrass"] },
{ "mob_type": "banner_wraith",       "weight_bp": 8000, "biomes": ["throne_terraces"] },
{ "mob_type": "elder_sloth",         "weight_bp": 8000, "biomes": ["grove_heart"] },
{ "mob_type": "ember_kweebec",       "weight_bp": 8000, "biomes": ["emberpalm_burns","grove_heart"] },
{ "mob_type": "snapjaw",             "weight_bp": 8000, "biomes": ["coral_shelf","saurian_lagoon"] },
{ "mob_type": "ensable_hatchling",   "weight_bp": 8000, "biomes": ["coral_shelf","saurian_lagoon"] },
{ "mob_type": "broodling",           "weight_bp": 8000, "biomes": ["brood_hollows"] },
{ "mob_type": "palebones",           "weight_bp": 8000, "biomes": ["coral_shelf","saurian_lagoon"] },
{ "mob_type": "kweebec_grove_heart", "weight_bp": 8000, "biomes": ["grove_heart"] },
{ "mob_type": "grizzly",             "weight_bp": 8000, "biomes": ["grove_heart","sabergrass"] },
{ "mob_type": "saurian_warden",      "weight_bp": 8000, "biomes": ["saurian_lagoon","throne_terraces"] },
{ "mob_type": "scarak_defender",     "weight_bp": 8000, "biomes": ["brood_hollows","vulture_spires"] },
{ "mob_type": "sabertooth",          "weight_bp": 8000, "biomes": ["sabergrass","palm_strand"] },
{ "mob_type": "nine_tails_kitsune",  "weight_bp": 8000, "biomes": ["palm_strand","emberpalm_burns"] },
{ "mob_type": "pyre_warthog",        "weight_bp": 8000, "biomes": ["emberpalm_burns","palm_strand"] },
{ "mob_type": "bone_choir",          "weight_bp": 8000, "biomes": ["throne_terraces"] },
{ "mob_type": "pale_weaver",         "weight_bp": 8000, "biomes": ["brood_hollows","vulture_spires"] }
```

## Resource rows

```json
{ "item_type": "arcaneshroom", "job": "HERBALIST", "tier": 9, "protector": "protector_arcane_gaia",      "rare_item_type": "", "biomes": ["grove_heart","brood_hollows","saurian_lagoon","throne_terraces"] },
{ "item_type": "draconite",    "job": "MINER",     "tier": 9, "protector": "protector_draconite",        "rare_item_type": "", "biomes": ["vulture_spires","coral_shelf","emberpalm_burns","sabergrass","throne_terraces"] },
{ "item_type": "wheat_purple", "job": "FARMER",    "tier": 9, "protector": "protector_arcanize_bricheton","rare_item_type": "", "biomes": ["grove_heart","palm_strand","sabergrass"] }
```

Dungeon: unchanged (`tide_throne_key`).

## Structures — have / want

| biome             | reuse today                                                | want                                                   |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| `grove_heart`     | `tropical_trees` — **covered**                             | —                                                      |
| `coral_shelf`     | `tropical_rocks` corail — **covered**                      | —                                                      |
| `sabergrass`      | `grassland_trees` acacia + `grassland_rocks` — **covered** | —                                                      |
| `brood_hollows`   | `tropical_trees` on the rim — **covered**                  | —                                                      |
| `palm_strand`     | —                                                          | **the palm pack, imported as `tropical_palm_g*`**      |
| `emberpalm_burns` | `scorched_rocks`                                           | bare palm trunks (same pack)                           |
| `vulture_spires`  | —                                                          | spires and stacks                                      |
| `saurian_lagoon`  | `tropical_rocks`                                           | a small stilt shrine                                   |
| `throne_terraces` | —                                                          | **a terraced temple with its lowest step in the tide** |

The palm download lands here and nowhere earlier. One temple, one shrine, some spires, and the
world is dressed.
