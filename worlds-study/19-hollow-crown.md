# 19 — Hollow Crown

> Entry level 145 · mobs level 145–185 · dungeon key `gods_maw_key` · sea level 53 · no gatherables

Something enormous died here and the world grew over its head. The crown is a ring of gold-veined
plateaus; the maw is the hole in the middle of them; and everything in the roster is either
**keeping the crown** (a crownkeeper, a regent, a gildwraith), **judging from it** (a halo judge,
a zealot, a seraph herald) or **flying above it** (a skywarden, a skyray, a fledgling).

This is the highest world in the game — the eyries top out at **260** — and the maw drops from
198 to 44 in one biome. After eighteen worlds of walking, the last two should be about **falling
distance**.

Six biomes across nine slots.

## The roster

| mob                   | lvl           | what the icon shows       | where it belongs         |
| --------------------- | ------------- | ------------------------- | ------------------------ |
| `hc_quillfledgling`   | 145–154       | yellow chick              | the eyries               |
| `hc_maw_gnat`         | 146–156       | pale house-insect         | the maw                  |
| `hc_halo_zealot`      | 148–158       | pale ogre                 | the courts               |
| `hc_crownkeeper`      | 150–160       | orange figure, keeping    | the rim                  |
| `hc_light_bearer`     | 152–162       | gold-and-blue crystal bat | courts and choir         |
| `hc_skyray`           | 154–164       | blue archaeopteryx        | the eyries               |
| `hc_skywarden`        | 160–170       | white-green owl           | the eyries               |
| `hc_seraph_herald`    | 162–172       | green tattered banner     | the choir                |
| `hc_halo_judge`       | 164–174       | green owl, judging        | the courts               |
| `hc_godbone_colossus` | 166–176       | green ogre of bone        | the maw, the bone fields |
| `hc_dead_gods_eye`    | 172–180 archi | tentacled eye             | the maw                  |
| `hc_crown_regent`     | 174–182 archi | blue claw                 | the gilded bone          |
| `hc_gildwraith`       | 158–167 archi | gilded tentacled thing    | rim and bone             |
| `hc_seraph`           | 180–185 boss  | violet cat                | **dungeon only**         |

## The six biomes

|               | humidity **low** | humidity **mid** | humidity **high** |
| ------------- | ---------------- | ---------------- | ----------------- |
| **temp low**  | `sky_eyries`     | `sky_eyries`     | `gilded_bone`     |
| **temp mid**  | `halo_courts`    | `crown_rim`      | `seraph_choir`    |
| **temp high** | `halo_courts`    | `gods_maw`       | `gods_maw`        |

---

### 1. `crown_rim` — mid_mid

The ring itself: a broad plateau of gold-veined stone with the maw on one side and nothing on the
other. **The world's default ground, and it is already at 147 blocks.**

- **Mobs**: `hc_crownkeeper`, `hc_gildwraith`
- **Profile**: 59 → 218, a high tableland.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 59  | gold_stone / limestone / deep_stone  |      |
| 0.16 | 109 |                                      |      |
| 0.22 | 141 | bone_grit / gold_stone / deep_stone  | 0.03 |
| 0.34 | 165 |                                      |      |
| 0.46 | 153 |                                      |      |
| 0.60 | 186 |                                      |      |
| 0.74 | 174 |                                      |      |
| 0.88 | 206 |                                      |      |
| 1    | 218 |                                      |      |

- **Structures**: wants **a low wall following the rim** — not a building, a boundary. The crown
  should read as something that encloses.

### 2. `gods_maw` — high_mid **and** high_high

The mouth. From 198 at the lip to 44 at the throat, and back up the far side. Two slots, because
the maw is not a feature of this world — it is a third of it.

- **Mobs**: `hc_maw_gnat`, `hc_dead_gods_eye`, `hc_godbone_colossus`
- **Profile**: **inverted, 65 → 292** — the largest single drop in the study.

| x    | y   | land                                | var  |
| ---- | --- | ----------------------------------- | ---- |
| 0    | 289 | bone_grit / gold_stone / deep_stone |      |
| 0.12 | 250 |                                     |      |
| 0.22 | 189 |                                     |      |
| 0.34 | 130 | gold_stone / limestone / deep_stone | 0.03 |
| 0.46 | 77  |                                     |      |
| 0.56 | 65  |                                     |      |
| 0.68 | 115 | bone_grit / gold_stone / deep_stone | 0.03 |
| 0.82 | 200 |                                     |      |
| 1    | 292 |                                     |      |

- **Structures**: rock-pack **teeth** around the lip — big, irregular, leaning inward. Nothing on
  the floor: the drop is the content.

### 3. `halo_courts` — mid_low **and** high_low

Level gold courts stepped down the outer slope, where whatever is left of the order holds session.

- **Mobs**: `hc_halo_zealot`, `hc_halo_judge`, `hc_light_bearer`
- **Profile**: tread and riser, 65 → 221 — every flat run is a court floor.

| x    | y   | land                                 | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 65  | gold_stone / limestone / deep_stone  |      |
| 0.18 | 97  |                                      |      |
| 0.24 | 124 | gold_stone / gold_stone / deep_stone | 0.02 |
| 0.34 | 130 |                                      |      |
| 0.40 | 153 |                                      |      |
| 0.54 | 159 |                                      |      |
| 0.60 | 183 |                                      |      |
| 0.74 | 189 |                                      |      |
| 0.86 | 212 |                                      |      |
| 1    | 221 |                                      |      |

- **Structures**: wants **open-sided halls on the terraces** — roofs on posts, no walls, so the
  judging is visible from the court below. The Japanese pack's raised open halls are exactly this.

### 4. `sky_eyries` — low_low **and** low_mid

Spires off the cold side of the crown, higher than the crown itself. Nests on every ledge and
nothing else.

- **Mobs**: `hc_skywarden`, `hc_skyray`, `hc_quillfledgling`
- **Profile**: **the game's roof, 383**. The 0.18→0.20 run is a 136-block face — the tallest
  authored cliff in the study.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 65  | gravel / limestone / deep_stone    |      |
| 0.14 | 115 |                                    |      |
| 0.18 | 153 | limestone / limestone / deep_stone | 0.02 |
| 0.20 | 289 |                                    |      |
| 0.28 | 312 | pale_grass / dirt / limestone      | 0.03 |
| 0.42 | 301 |                                    |      |
| 0.56 | 345 |                                    |      |
| 0.70 | 321 |                                    |      |
| 0.84 | 368 |                                    |      |
| 1    | 383 |                                    |      |

- **Structures**: rock-pack **spires and nest ledges**. Nothing built — birds do not build.

### 5. `seraph_choir` — mid_high

A high terrace that sits in cloud all day. No standing water at this altitude, so the wet reads
as moss and drip, exactly as it does in world 04.

- **Mobs**: `hc_seraph_herald`, `hc_light_bearer`
- **Profile**: 62 → 189.

| x    | y   | land                          | var  |
| ---- | --- | ----------------------------- | ---- |
| 0    | 62  | pale_grass / dirt / limestone |      |
| 0.18 | 94  |                               |      |
| 0.24 | 121 | moss / rich_soil / limestone  | 0.03 |
| 0.36 | 138 |                               |      |
| 0.48 | 130 |                               |      |
| 0.62 | 159 |                               |      |
| 0.76 | 147 |                               |      |
| 0.90 | 177 |                               |      |
| 1    | 189 |                               |      |

- **Structures**: `temperate_trees` very sparse, plus wants **one open pavilion**. The only green
  thing in the world.

### 6. `gilded_bone` — low_high

The low ground on the cold side: bone fields with gold run into the cracks, and the world's only
water lying in the hollows between them.

- **Mobs**: `hc_crown_regent`, `hc_gildwraith`, `hc_godbone_colossus`
- **Profile**: 29 → 68, breathing across sea level 53 — the one low, wet biome in a world of
  heights.

| x    | y   | land                                | var  |
| ---- | --- | ----------------------------------- | ---- |
| 0    | 29  | bone_grit / gold_stone / deep_stone |      |
| 0.24 | 44  |                                     |      |
| 0.32 | 53  |                                     |      |
| 0.38 | 65  | gold_stone / bone_grit / deep_stone | 0.03 |
| 0.48 | 50  |                                     |      |
| 0.58 | 62  |                                     |      |
| 0.70 | 49  |                                     |      |
| 0.82 | 65  |                                     |      |
| 0.92 | 53  |                                     |      |
| 1    | 68  |                                     |      |

- **Structures**: rock-pack **bone-shaped blocks** at large scale — ribs, not boulders.

---

## Materials

| name                                   | color                 | preset         | used by                            |
| -------------------------------------- | --------------------- | -------------- | ---------------------------------- |
| `gold_stone`                           | `#b99a4c`             | stone          | the crown, the courts, the veins   |
| `limestone`                            | `#958d75`             | stone          | spires, maw walls                  |
| `deep_stone`                           | `#465258`             | stone          | filler                             |
| `gravel`                               | `#766f61`             | stone          | the spire feet                     |
| `bone_grit`                            | `#d9cfb4`             | sand           | rim caps, maw lip, the bone fields |
| `dirt`                                 | `#654d36`             | earth          | spire caps, choir                  |
| `rich_soil`                            | `#493a2d`             | earth          | the choir terrace                  |
| `pale_grass`                           | `#b6bb9a`             | grass          | spire caps, the choir              |
| `moss`                                 | `#456a4b`             | grass          | the choir                          |
| `water`                                | `#2e609e`             | water          | the gilded bone only               |
| `temperate_wood` / `temperate_foliage` | `#624936` / `#416f49` | wood / foliage | the choir's few trees              |

## Mob rows

```json
{ "mob_type": "hc_quillfledgling",   "weight_bp": 8000, "biomes": ["sky_eyries"] },
{ "mob_type": "hc_maw_gnat",         "weight_bp": 8000, "biomes": ["gods_maw"] },
{ "mob_type": "hc_halo_zealot",      "weight_bp": 8000, "biomes": ["halo_courts"] },
{ "mob_type": "hc_crownkeeper",      "weight_bp": 8000, "biomes": ["crown_rim"] },
{ "mob_type": "hc_light_bearer",     "weight_bp": 8000, "biomes": ["halo_courts","seraph_choir"] },
{ "mob_type": "hc_skyray",           "weight_bp": 8000, "biomes": ["sky_eyries"] },
{ "mob_type": "hc_skywarden",        "weight_bp": 8000, "biomes": ["sky_eyries"] },
{ "mob_type": "hc_seraph_herald",    "weight_bp": 8000, "biomes": ["seraph_choir"] },
{ "mob_type": "hc_halo_judge",       "weight_bp": 8000, "biomes": ["halo_courts"] },
{ "mob_type": "hc_godbone_colossus", "weight_bp": 8000, "biomes": ["gods_maw","gilded_bone"] },
{ "mob_type": "hc_dead_gods_eye",    "weight_bp": 8000, "biomes": ["gods_maw"] },
{ "mob_type": "hc_crown_regent",     "weight_bp": 8000, "biomes": ["gilded_bone"] },
{ "mob_type": "hc_gildwraith",       "weight_bp": 8000, "biomes": ["crown_rim","gilded_bone"] }
```

Resources: **none**. Dungeon: unchanged (`gods_maw_key`).

## Structures — have / want

| biome          | reuse today              | want                                           |
| -------------- | ------------------------ | ---------------------------------------------- |
| `seraph_choir` | `temperate_trees` sparse | one open pavilion                              |
| `sky_eyries`   | —                        | spires and nest ledges                         |
| `gods_maw`     | —                        | teeth around the lip, leaning inward           |
| `gilded_bone`  | —                        | large bone-shaped blocks — ribs, not boulders  |
| `crown_rim`    | —                        | **a low wall following the rim**               |
| `halo_courts`  | —                        | **open-sided halls: roofs on posts, no walls** |
