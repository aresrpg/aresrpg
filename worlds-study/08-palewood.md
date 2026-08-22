# 08 — Palewood

> Entry level 34 · mobs level 34–50 · dungeon key `ensable_key` · sea level 168

A white forest standing in shallow water. Birch trunks, chalk under everything, and a river so
still it doubles the wood. Three of the twelve mobs **fly between the trunks** — an owl, an
archaeopteryx, and a fish that flies — which is the detail that decides the world: the aisles
between the trees are open, tall and quiet, and things move through them at head height.

Cutting across it is one black glass scar where something burned through, and that is where the
fire wolf and the obsidian gecko live.

**A note that applies to every world from here on**: materials are authored _per world_, so the
same structure pack looks different in each one. `grassland_trees` is used here with
`grassland_wood` re-tinted to birch white — the pack is brown oak in world 02 and bone white in
this one, at zero asset cost. Colour is a world-level decision, not a pack-level one.

## The roster

| mob                   | lvl         | what the icon shows      | the habitat it asks for |
| --------------------- | ----------- | ------------------------ | ----------------------- |
| `scarak_fighter`      | 34–44       | black insect, red points | dry glades, leaf litter |
| `plaguemo`            | 35–45       | blue rat                 | the wet aisles          |
| `clawlord`            | 35–48       | long dark-blue claw      | the river bed           |
| `thunder_owl`         | 35–48       | green owl, orange eyes   | the open aisles         |
| `archaeo`             | 35–45       | blue archaeopteryx       | between the trunks      |
| `flying_fish`         | 35–45       | green-white "Skyfin"     | over the water          |
| `emberwulf`           | 38–48       | red dragon-wolf          | the burns               |
| `obsidian_tokek`      | 43–48       | black gecko              | the glass scar          |
| `sir_rattlebone`      | 35–42 archi | tan skeleton             | the bone glades         |
| `gobadoc_the_starved` | 38–44 archi | gaunt goblin             | burns and fen           |
| `piranha_black_king`  | 38–44 archi | blue fish, crowned       | the deep river          |
| `feran_the_whisperer` | 44–50 archi | orange fox               | the hollows             |
| `ensable_warden`      | 43–47 boss  | blue crab                | **dungeon only**        |

## The biomes

Temperature runs cold white wood → burnt glass; humidity runs bone-dry glade → standing water.
`pale_birches` takes two slots because the wood **is** the world — the other biomes are things
that happened to it.

|               | humidity **low**   | humidity **mid**  | humidity **high**   |
| ------------- | ------------------ | ----------------- | ------------------- |
| **temp low**  | `bonewhite_glades` | `whisper_hollows` | `stillwater_aisles` |
| **temp mid**  | `pale_birches`     | `pale_birches`    | `ensable_river`     |
| **temp high** | `emberwulf_burns`  | `obsidian_glass`  | `wither_fens`       |

---

### 1. `pale_birches` — mid_low **and** mid_mid

The wood itself: white trunks, high canopy, open floor, and birds moving through it at eye level.
**The world's default ground, across two slots on purpose.**

- **Mobs**: `thunder_owl`, `feran_the_whisperer`, `scarak_fighter`, `archaeo`
- **Resources**: `blood_wheat` (FARMER), `witherbloom` (HERBALIST)
- **Profile**: gentle, 133 → 261 — the ground must not compete with the trunks.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 133 | wet_sand / clay / chalk              |      |
| 0.18 | 162 |                                      |      |
| 0.24 | 180 | pale_grass / dirt / chalk            | 0.03 |
| 0.36 | 203 |                                      |      |
| 0.48 | 192 |                                      |      |
| 0.62 | 226 |                                      |      |
| 0.76 | 212 |                                      |      |
| 0.90 | 250 |                                      |      |
| 1    | 261 |                                      |      |

- **Structures**: `grassland_trees` **birch types only**, at high density, with `grassland_wood`
  re-tinted white. Covered today — no download needed for the world's signature look.

### 2. `stillwater_aisles` — low_high

The flooded half of the wood. The trunks go straight into the water and come back out upside
down. Nothing here is loud.

- **Mobs**: `plaguemo`, `clawlord`, `flying_fish`
- **Resources**: `witherbloom` (HERBALIST)
- **Profile**: most of the range sits under sea level 168 — the wood is _in_ the water, not beside it.

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 99  | clay / clay / chalk     |      |
| 0.26 | 133 |                         |      |
| 0.36 | 151 |                         |      |
| 0.44 | 171 | rot_moss / clay / chalk | 0.03 |
| 0.54 | 154 |                         |      |
| 0.66 | 142 |                         |      |
| 0.78 | 168 |                         |      |
| 0.90 | 157 |                         |      |
| 1    | 174 |                         |      |

- **Structures**: the same birches, placed **into** the water. `bury: 0` and let the terrain fit
  put their feet under. Covered today.

### 3. `ensable_river` — mid_high

The river the dungeon is named for. Gravel bars, deep pools, and a crab in every one of them.

- **Mobs**: `clawlord`, `piranha_black_king`, `flying_fish`
- **Resources**: `arcanite` (MINER)
- **Profile**: breathes across sea level 168; the bars at 174–180 are walkable, the rest is not.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 104 | gravel / clay / chalk     |      |
| 0.20 | 139 |                           |      |
| 0.28 | 157 |                           |      |
| 0.34 | 177 | wet_sand / gravel / chalk | 0.03 |
| 0.44 | 160 |                           |      |
| 0.54 | 174 |                           |      |
| 0.66 | 154 |                           |      |
| 0.78 | 177 |                           |      |
| 0.90 | 162 |                           |      |
| 1    | 180 |                           |      |

- **Structures**: `swamp_trees` at the margins + rock-pack **gravel bars**. Wants **a plank bridge
  and a fish weir**, small, one per river.

### 4. `bonewhite_glades` — low_low

Dry clearings where the chalk comes through and the wood gives up. Bleached, bright, and full of
bones that are not all animal.

- **Mobs**: `sir_rattlebone`, `scarak_fighter`
- **Resources**: `arcanite` (MINER)
- **Profile**: 139 → 290, open and rolling — the brightest ground in the world.

| x    | y   | land                           | var  |
| ---- | --- | ------------------------------ | ---- |
| 0    | 139 | bone_grit / chalk / deep_stone |      |
| 0.16 | 174 |                                |      |
| 0.22 | 197 | pale_grass / dirt / chalk      | 0.03 |
| 0.34 | 226 |                                |      |
| 0.46 | 209 |                                |      |
| 0.60 | 250 |                                |      |
| 0.74 | 232 |                                |      |
| 0.88 | 273 |                                |      |
| 1    | 290 |                                |      |

- **Structures**: `grassland_rocks` re-tinted chalk-white, plus rock-pack **chalk blocks**.

### 5. `whisper_hollows` — low_mid

Bowls in the wood floor where the leaf mould is deepest and the light stops. The fox lives at the
bottom of one.

- **Mobs**: `feran_the_whisperer`, `plaguemo`, `archaeo`
- **Resources**: `witherbloom` (HERBALIST), `blood_wheat` (FARMER)
- **Profile**: inverted — rim at 267, floor at 151. **The hollow is the biome**; do not flatten it.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 267 | pale_grass / dirt / chalk |      |
| 0.14 | 232 |                           |      |
| 0.24 | 192 |                           |      |
| 0.36 | 168 | rich_soil / dirt / chalk  | 0.03 |
| 0.50 | 151 |                           |      |
| 0.62 | 165 |                           |      |
| 0.74 | 197 | pale_grass / dirt / chalk | 0.03 |
| 0.88 | 238 |                           |      |
| 1    | 273 |                           |      |

- **Structures**: `temperate_trees` re-tinted darker than the birches — the hollows should read as
  a different, older wood. Covered today.

### 6. `emberwulf_burns` — high_low

Where the fire went through. Standing charcoal trunks, ash floor, and the thing that started it
still living there.

- **Mobs**: `emberwulf`, `gobadoc_the_starved`
- **Resources**: `arcanite` (MINER)
- **Profile**: 139 → 284, the same shape as the wood so the contrast is entirely in the materials.

| x    | y   | land                 | var  |
| ---- | --- | -------------------- | ---- |
| 0    | 139 | ash / cinder / chalk |      |
| 0.18 | 174 |                      |      |
| 0.24 | 197 | cinder / ash / chalk | 0.03 |
| 0.36 | 226 |                      |      |
| 0.48 | 209 |                      |      |
| 0.62 | 250 |                      |      |
| 0.76 | 232 |                      |      |
| 0.90 | 273 |                      |      |
| 1    | 284 |                      |      |

- **Structures**: `scorched_rocks` + `grassland_trees` **dead-looking** via a black `grassland_wood`
  tint — but a world owns one tint per material, so this biome instead uses `swamp_trees`' dead
  set with the swamp wood tinted charcoal. Covered today.

### 7. `obsidian_glass` — high_mid

A scar of black glass ploughed through the white wood, standing higher than everything around it.
Visible from every other biome, which is the point.

- **Mobs**: `obsidian_tokek`, `emberwulf`
- **Resources**: `arcanite` (MINER)
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 110-block face of glass.

| x    | y   | land                                     | var  |
| ---- | --- | ---------------------------------------- | ---- |
| 0    | 128 | gravel / blackstone / deep_stone         |      |
| 0.14 | 180 |                                          |      |
| 0.18 | 215 | obsidian_glass / blackstone / deep_stone | 0.02 |
| 0.20 | 325 |                                          |      |
| 0.28 | 342 | ash / cinder / blackstone                | 0.03 |
| 0.42 | 331 |                                          |      |
| 0.56 | 360 |                                          |      |
| 0.70 | 337 |                                          |      |
| 0.84 | 366 |                                          |      |
| 1    | 383 |                                          |      |

- **Structures**: the **crystal half of the rock/crystal pack** — shards standing out of the glass.
  This is the one biome in the first ten worlds that genuinely needs crystals.

### 8. `wither_fens` — high_high

Where the river spreads and rots at the warm edge of the wood. The white goes yellow, then brown.

- **Mobs**: `gobadoc_the_starved`, `obsidian_tokek`, `piranha_black_king`
- **Resources**: `witherbloom` (HERBALIST), `blood_wheat` (FARMER)
- **Profile**: marsh across sea level 168, 110 → 180.

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 110 | peat / clay / chalk     |      |
| 0.22 | 145 |                         |      |
| 0.30 | 162 |                         |      |
| 0.36 | 177 | rot_moss / peat / chalk | 0.03 |
| 0.46 | 160 |                         |      |
| 0.58 | 174 |                         |      |
| 0.70 | 157 |                         |      |
| 0.82 | 177 |                         |      |
| 0.92 | 162 |                         |      |
| 1    | 180 |                         |      |

- **Structures**: `swamp_trees` + `swamp_ruins` — **covered today**.

---

## Materials

| name                                   | color                 | preset         | used by                                          |
| -------------------------------------- | --------------------- | -------------- | ------------------------------------------------ |
| `chalk`                                | `#cfc9b4`             | stone          | the filler under the entire world                |
| `deep_stone`                           | `#465258`             | stone          | glades, glass scar                               |
| `blackstone`                           | `#373737`             | stone          | the glass scar                                   |
| `obsidian_glass`                       | `#2a2130`             | stone          | the scar's face                                  |
| `gravel`                               | `#766f61`             | stone          | river bars                                       |
| `clay`                                 | `#76514b`             | earth          | the flooded aisles                               |
| `dirt`                                 | `#654d36`             | earth          | wood floor                                       |
| `rich_soil`                            | `#493a2d`             | earth          | the hollows                                      |
| `peat`                                 | `#3b3125`             | earth          | the fens                                         |
| `ash`                                  | `#55504a`             | earth          | the burns                                        |
| `cinder`                               | `#3a3330`             | earth          | the burns' crust                                 |
| `pale_grass`                           | `#b6bb9a`             | grass          | the wood floor — bleached, not green             |
| `rot_moss`                             | `#3d5236`             | grass          | aisles, fens                                     |
| `bone_grit`                            | `#d9cfb4`             | sand           | the glades                                       |
| `wet_sand`                             | `#9d896b`             | sand           | river and wood margin                            |
| `water`                                | `#2e609e`             | water          | river, aisles, fens                              |
| `grassland_wood` / `grassland_foliage` | `#cdc6b4` / `#9fb08a` | wood / foliage | **the birches — re-tinted white for this world** |
| `temperate_wood` / `temperate_foliage` | `#4a3a2c` / `#2f4a35` | wood / foliage | the darker hollow wood                           |
| `swamp_wood` / `swamp_foliage`         | `#332c26` / `#39442f` | wood / foliage | fens and burns — charcoal tint                   |

## Mob rows

```json
{ "mob_type": "scarak_fighter",      "weight_bp": 8000, "biomes": ["pale_birches","bonewhite_glades"] },
{ "mob_type": "plaguemo",            "weight_bp": 8000, "biomes": ["stillwater_aisles","whisper_hollows"] },
{ "mob_type": "clawlord",            "weight_bp": 8000, "biomes": ["ensable_river","stillwater_aisles"] },
{ "mob_type": "thunder_owl",         "weight_bp": 8000, "biomes": ["pale_birches"] },
{ "mob_type": "archaeo",             "weight_bp": 8000, "biomes": ["pale_birches","whisper_hollows"] },
{ "mob_type": "flying_fish",         "weight_bp": 8000, "biomes": ["ensable_river","stillwater_aisles"] },
{ "mob_type": "emberwulf",           "weight_bp": 8000, "biomes": ["emberwulf_burns","obsidian_glass"] },
{ "mob_type": "obsidian_tokek",      "weight_bp": 8000, "biomes": ["obsidian_glass","wither_fens"] },
{ "mob_type": "sir_rattlebone",      "weight_bp": 8000, "biomes": ["bonewhite_glades"] },
{ "mob_type": "gobadoc_the_starved", "weight_bp": 8000, "biomes": ["emberwulf_burns","wither_fens"] },
{ "mob_type": "piranha_black_king",  "weight_bp": 8000, "biomes": ["ensable_river","wither_fens"] },
{ "mob_type": "feran_the_whisperer", "weight_bp": 8000, "biomes": ["whisper_hollows","pale_birches"] }
```

## Resource rows

```json
{ "item_type": "arcanite",    "job": "MINER",     "tier": 8, "protector": "protector_arcanite",     "rare_item_type": "", "biomes": ["obsidian_glass","bonewhite_glades","ensable_river","emberwulf_burns"] },
{ "item_type": "witherbloom", "job": "HERBALIST", "tier": 8, "protector": "protector_wither_gaia",  "rare_item_type": "", "biomes": ["wither_fens","stillwater_aisles","whisper_hollows","pale_birches"] },
{ "item_type": "blood_wheat", "job": "FARMER",    "tier": 8, "protector": "protector_blood_bricheton","rare_item_type": "", "biomes": ["pale_birches","whisper_hollows","wither_fens"] }
```

Dungeon: unchanged (`ensable_key`).

## Structures — have / want

| biome               | reuse today                                             | want                                                   |
| ------------------- | ------------------------------------------------------- | ------------------------------------------------------ |
| `pale_birches`      | `grassland_trees` birches, white-tinted — **covered**   | —                                                      |
| `stillwater_aisles` | the same birches, feet under water — **covered**        | —                                                      |
| `whisper_hollows`   | `temperate_trees`, dark-tinted — **covered**            | —                                                      |
| `wither_fens`       | `swamp_trees` + `swamp_ruins` — **covered**             | —                                                      |
| `emberwulf_burns`   | `scorched_rocks` + charcoal `swamp_trees` — **covered** | —                                                      |
| `bonewhite_glades`  | `grassland_rocks`, white-tinted                         | chalk blocks                                           |
| `ensable_river`     | `swamp_trees` margins                                   | gravel bars, **a plank bridge and a fish weir**        |
| `obsidian_glass`    | —                                                       | **crystal shards — the crystal pack's first real use** |

This world is the cheapest in the game to ship: six of eight biomes are already covered, because
the entire look comes from re-tinting packs we own rather than downloading new ones.
