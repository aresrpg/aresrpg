# 13 — Mirrormere

> Entry level 68 · mobs level 68–90 · dungeon key `sunken_mere_key` · sea level 144

A lake big enough to be a world, and still enough to double everything standing in it. Sea level
144 keeps **water as the ground here**, and the eight biomes are
mostly different answers to "what is sticking out of it".

Two things make it more than a pretty lake. Crystals grow out of the western shelves in steps you
can climb — this is the world the crystal pack exists for. And the roster is thick with **ghosts**:
a soulking, a pyre wraith, a silent fen, an elder rex that is mostly bone. Whatever is under the
mere is the reason the dungeon key is called `sunken_mere_key`.

## The roster

| mob                   | lvl         | what the icon shows               | the habitat it asks for    |
| --------------------- | ----------- | --------------------------------- | -------------------------- |
| `crystal_golem`       | 68–82       | gold golem set with green crystal | the crystal shelves        |
| `polar_reaver`        | 70–82       | white polar bear                  | the frozen shore           |
| `silk_warden`         | 70–75       | green cocoon                      | shelves and deeps          |
| `widow_consort`       | 72–77       | yellow-black spider               | the cold deeps             |
| `thunderlord`         | 78–88       | brown-white eagle-owl             | the high rim               |
| `feran_elder_warrior` | 78–88       | orange fox warrior                | the isles, the rim         |
| `soulking`            | 78–90       | ghost with a black face           | the isles and the shallows |
| `drowned_buccaneer`   | 78–83       | tan skeleton                      | the shallows, the reeds    |
| `eternwool`           | 80–90       | dark blue bull                    | the isles, the shore       |
| `pyre_wraith`         | 80–90       | burning ghost                     | the reeds                  |
| `tentacle_horror`     | 80–85       | pale tentacled fish               | deep water                 |
| `fen_the_silent`      | 68–75 archi | orange fen brute                  | the warm fen               |
| `rex_the_elder`       | 70–80 archi | bone raptor                       | the rim, the fen           |
| `aragog_mother`       | 68–72 boss  | black spider                      | **dungeon only**           |

## The eight biomes

Temperature runs frozen north shore → warm reed south; humidity runs crystal shelf → open deep.
`polar_shore` holds two slots — the cold half of the lake is one long beach.

|               | humidity **low**  | humidity **mid** | humidity **high** |
| ------------- | ----------------- | ---------------- | ----------------- |
| **temp low**  | `polar_shore`     | `polar_shore`    | `consort_deeps`   |
| **temp mid**  | `crystal_shelves` | `mere_isles`     | `mirror_shallows` |
| **temp high** | `thunder_crown`   | `pyre_reeds`     | `silent_fen`      |

---

### 1. `mere_isles` — mid_mid

Wooded islands scattered across the middle of the lake, close enough together to island-hop.
**The world's default ground**, and the only place with real trees.

- **Mobs**: `soulking`, `feran_elder_warrior`, `eternwool`
- **Resources**: `blood_wheat` (FARMER), `dragonlily` (HERBALIST)
- **Profile**: 87 → 213, rising out of the water fast so the isles have shape rather than shelving
  away.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 87  | clay / rich_soil / stone             |      |
| 0.20 | 122 |                                      |      |
| 0.28 | 148 | moss / rich_soil / stone             | 0.03 |
| 0.38 | 170 |                                      |      |
| 0.50 | 157 |                                      |      |
| 0.62 | 187 |                                      |      |
| 0.76 | 174 |                                      |      |
| 0.90 | 205 |                                      |      |
| 1    | 213 |                                      |      |

- **Structures**: `temperate_trees` — covered today — plus the one build this world must have:
  **a gate standing in the water off an island**, its feet under the surface. A torii in a still
  lake is the most recognisable image in the entire pack, and this is the world it belongs to.

### 2. `mirror_shallows` — mid_high

Wide, still, shin-deep water over pale sand. Nothing breaks the surface, so the surface does what
the world is named for.

- **Mobs**: `drowned_buccaneer`, `tentacle_horror`, `soulking`
- **Resources**: `cursed_gem` (MINER)
- **Profile**: the tightest curve in the game — 96 → 152, sitting within a few blocks of sea level
  across almost the whole range. **Flatness is the entire effect.**

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 96  | clay / clay / stone     |      |
| 0.24 | 122 |                         |      |
| 0.34 | 135 |                         |      |
| 0.40 | 150 | wet_sand / clay / stone | 0.03 |
| 0.50 | 137 |                         |      |
| 0.60 | 148 |                         |      |
| 0.72 | 135 |                         |      |
| 0.84 | 150 |                         |      |
| 0.94 | 139 |                         |      |
| 1    | 152 |                         |      |

- **Structures**: **none**. Second empty pack list in the game, and for the same reason as the
  salt pans: the emptiness is the content.

### 3. `crystal_shelves` — mid_low

Crystal growing out of the western shore in steps, each one a little higher and a little
brighter. Climbable, and lit from inside.

- **Mobs**: `crystal_golem`, `silk_warden`, `widow_consort`
- **Resources**: `cursed_gem` (MINER)
- **Profile**: tread and riser, 91 → 279 — a staircase of crystal out of the lake.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 91  | gravel / stone / deep_stone  |      |
| 0.20 | 122 |                              |      |
| 0.26 | 148 | crystal / stone / deep_stone | 0.03 |
| 0.36 | 161 |                              |      |
| 0.42 | 192 |                              |      |
| 0.56 | 200 |                              |      |
| 0.62 | 231 |                              |      |
| 0.76 | 239 |                              |      |
| 0.88 | 270 |                              |      |
| 1    | 279 |                              |      |

- **Structures**: **the crystal half of the rock/crystal pack**, dense and large. Along with
  world 08's glass scar, this is what that download is for.

### 4. `polar_shore` — low_low **and** low_mid

The frozen north end: snow down to the waterline, ice at the margin, a white bear working it.

- **Mobs**: `polar_reaver`, `eternwool`, `crystal_golem`
- **Resources**: `blood_wheat` (FARMER), `cursed_gem` (MINER)
- **Profile**: 83 → 205, shelving gently — a beach, not a cliff, so the bear has room.

| x    | y   | land                  | var  |
| ---- | --- | --------------------- | ---- |
| 0    | 83  | gravel / clay / stone |      |
| 0.22 | 113 |                       |      |
| 0.30 | 131 |                       |      |
| 0.36 | 150 | snow / gravel / stone | 0.03 |
| 0.48 | 165 |                       |      |
| 0.60 | 152 |                       |      |
| 0.74 | 187 |                       |      |
| 0.88 | 174 |                       |      |
| 1    | 205 |                       |      |

- **Structures**: `taiga_trees` sparse + `glacier_rocks` — **covered today**.

### 5. `consort_deeps` — low_high

The cold deep water off the north shore. Too deep to stand in, and something is spinning down
there.

- **Mobs**: `widow_consort`, `silk_warden`, `tentacle_horror`
- **Resources**: `dragonlily` (HERBALIST)
- **Profile**: the deepest water in the world — 87 blocks under the surface at the low end.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 57  | clay / clay / deep_stone |      |
| 0.30 | 91  |                          |      |
| 0.42 | 118 |                          |      |
| 0.50 | 146 | rot_moss / clay / stone  | 0.03 |
| 0.58 | 128 |                          |      |
| 0.70 | 113 |                          |      |
| 0.80 | 141 |                          |      |
| 0.92 | 126 |                          |      |
| 1    | 148 |                          |      |

- **Structures**: `swamp_trees` dead set, drowned to the crown — a wood the lake rose over.

### 6. `thunder_crown` — high_low

The high rim on the south side, looking down the length of the mere. Storms break on it and the
lord of them nests there.

- **Mobs**: `thunderlord`, `rex_the_elder`, `feran_elder_warrior`
- **Resources**: `cursed_gem` (MINER), `wheat_draconize` (FARMER)
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 118-block face straight out of
  the water.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 100 | gravel / stone / deep_stone |      |
| 0.14 | 144 |                             |      |
| 0.18 | 178 | stone / gravel / deep_stone | 0.02 |
| 0.20 | 296 |                             |      |
| 0.28 | 322 | dry_grass / dirt / stone    | 0.03 |
| 0.42 | 305 |                             |      |
| 0.56 | 348 |                             |      |
| 0.70 | 326 |                             |      |
| 0.84 | 366 |                             |      |
| 1    | 383 |                             |      |

- **Structures**: rock-pack **rim crags**, and one **small building on the highest point** —
  something a person climbed up to build once and never came back to.

### 7. `pyre_reeds` — high_mid

Reed beds at the warm south shore that are always burning somewhere. The smoke lies flat over the
water for miles.

- **Mobs**: `pyre_wraith`, `fen_the_silent`, `drowned_buccaneer`
- **Resources**: `dragonlily` (HERBALIST), `wheat_draconize` (FARMER)
- **Profile**: breathes across sea level 144, 83 → 152.

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 83  | peat / clay / stone     |      |
| 0.22 | 113 |                         |      |
| 0.30 | 126 |                         |      |
| 0.36 | 139 | rot_moss / peat / stone | 0.03 |
| 0.46 | 126 |                         |      |
| 0.58 | 144 |                         |      |
| 0.70 | 131 |                         |      |
| 0.82 | 148 |                         |      |
| 0.92 | 135 |                         |      |
| 1    | 152 |                         |      |

- **Structures**: `swamp_trees` + `scorched_rocks` — **covered today**.

### 8. `silent_fen` — high_high

The warm dead end of the lake where the water stops moving entirely and the reeds give way to
moss. Nothing makes a sound in here, including the things that live in it.

- **Mobs**: `fen_the_silent`, `pyre_wraith`, `rex_the_elder`
- **Resources**: `dragonlily` (HERBALIST), `blood_wheat` (FARMER)
- **Profile**: 74 → 148, mostly under water.

| x    | y   | land                | var  |
| ---- | --- | ------------------- | ---- |
| 0    | 74  | peat / peat / stone |      |
| 0.26 | 104 |                     |      |
| 0.36 | 122 |                     |      |
| 0.44 | 146 | moss / peat / stone | 0.03 |
| 0.54 | 131 |                     |      |
| 0.66 | 120 |                     |      |
| 0.78 | 144 |                     |      |
| 0.90 | 128 |                     |      |
| 1    | 148 |                     |      |

- **Structures**: `swamp_trees` + `swamp_ruins` — **covered today**.

---

## Materials

| name                                   | color                 | preset         | used by                |
| -------------------------------------- | --------------------- | -------------- | ---------------------- |
| `stone`                                | `#707777`             | stone          | crown, shelves         |
| `deep_stone`                           | `#465258`             | stone          | filler under the deeps |
| `gravel`                               | `#766f61`             | stone          | shores                 |
| `crystal`                              | `#8fd0e8`             | ice            | the shelves            |
| `clay`                                 | `#76514b`             | earth          | the lake bed           |
| `rich_soil`                            | `#493a2d`             | earth          | the isles              |
| `dirt`                                 | `#654d36`             | earth          | the crown cap          |
| `peat`                                 | `#3b3125`             | earth          | reeds and fen          |
| `moss`                                 | `#456a4b`             | grass          | isles, fen             |
| `rot_moss`                             | `#3d5236`             | grass          | deeps and reed margins |
| `dry_grass`                            | `#9a9457`             | grass          | the crown              |
| `snow`                                 | `#f4f6f3`             | snow           | the polar shore        |
| `wet_sand`                             | `#9d896b`             | sand           | the shallows           |
| `water`                                | `#2e609e`             | water          | most of the world      |
| `temperate_wood` / `temperate_foliage` | `#624936` / `#416f49` | wood / foliage | the isles              |
| `swamp_wood` / `swamp_foliage`         | `#493d32` / `#395d42` | wood / foliage | deeps, reeds, fen      |
| `taiga_wood` / `taiga_foliage`         | `#554536` / `#315346` | wood / foliage | the polar shore        |

## Mob rows

```json
{ "mob_type": "crystal_golem",        "weight_bp": 8000, "biomes": ["crystal_shelves","polar_shore"] },
{ "mob_type": "polar_reaver",         "weight_bp": 8000, "biomes": ["polar_shore"] },
{ "mob_type": "silk_warden",          "weight_bp": 8000, "biomes": ["crystal_shelves","consort_deeps"] },
{ "mob_type": "widow_consort",        "weight_bp": 8000, "biomes": ["consort_deeps","crystal_shelves"] },
{ "mob_type": "thunderlord",          "weight_bp": 8000, "biomes": ["thunder_crown"] },
{ "mob_type": "feran_elder_warrior",  "weight_bp": 8000, "biomes": ["mere_isles","thunder_crown"] },
{ "mob_type": "soulking",             "weight_bp": 8000, "biomes": ["mere_isles","mirror_shallows"] },
{ "mob_type": "drowned_buccaneer",    "weight_bp": 8000, "biomes": ["mirror_shallows","pyre_reeds"] },
{ "mob_type": "eternwool",            "weight_bp": 8000, "biomes": ["mere_isles","polar_shore"] },
{ "mob_type": "pyre_wraith",          "weight_bp": 8000, "biomes": ["pyre_reeds","silent_fen"] },
{ "mob_type": "tentacle_horror",      "weight_bp": 8000, "biomes": ["consort_deeps","mirror_shallows"] },
{ "mob_type": "fen_the_silent",       "weight_bp": 8000, "biomes": ["silent_fen","pyre_reeds"] },
{ "mob_type": "rex_the_elder",        "weight_bp": 8000, "biomes": ["thunder_crown","silent_fen"] }
```

## Resource rows

```json
{ "item_type": "blood_wheat",     "job": "FARMER",    "tier": 8,  "protector": "protector_blood_bricheton",     "rare_item_type": "", "biomes": ["mere_isles","polar_shore","silent_fen"] },
{ "item_type": "cursed_gem",      "job": "MINER",     "tier": 10, "protector": "protector_cursed_gem",          "rare_item_type": "", "biomes": ["crystal_shelves","thunder_crown","mirror_shallows","polar_shore"] },
{ "item_type": "dragonlily",      "job": "HERBALIST", "tier": 10, "protector": "protector_dragon_gaia",         "rare_item_type": "", "biomes": ["consort_deeps","pyre_reeds","silent_fen","mere_isles"] },
{ "item_type": "wheat_draconize", "job": "FARMER",    "tier": 10, "protector": "protector_draconize_bricheton", "rare_item_type": "", "biomes": ["pyre_reeds","thunder_crown"] }
```

Dungeon: unchanged (`sunken_mere_key`).

## Structures — have / want

| biome             | reuse today                                    | want                                           |
| ----------------- | ---------------------------------------------- | ---------------------------------------------- |
| `polar_shore`     | `taiga_trees` + `glacier_rocks` — **covered**  | —                                              |
| `pyre_reeds`      | `swamp_trees` + `scorched_rocks` — **covered** | —                                              |
| `silent_fen`      | `swamp_trees` + `swamp_ruins` — **covered**    | —                                              |
| `consort_deeps`   | `swamp_trees` drowned — **covered**            | —                                              |
| `mirror_shallows` | **nothing, on purpose**                        | —                                              |
| `crystal_shelves` | —                                              | **crystals, dense and large**                  |
| `thunder_crown`   | —                                              | rim crags + one small building on the summit   |
| `mere_isles`      | `temperate_trees`                              | **a gate standing in the water off an island** |

Four biomes ship, one is deliberately empty, and the two that matter are a crystal download and
one gate in a still lake. That gate is the single best picture in the study and it costs one
small schematic.
