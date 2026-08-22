# 18 — Abyssal Weald

> Entry level 125 · mobs level 125–152 · dungeon key `anglerdeep_key` · sea level 186 · no gatherables

A forest that drowned and kept growing. Sea level 186 — second only to Drowned Fen — so the wood
stands in water to the shoulder and the canopy above it never lets light down. Four of the
thirteen mobs are **bears**, which is the tell: this is not an ocean, it is a _wood_, and the
things in it are land animals that adapted rather than fish that came up.

The other tell is the lures. Three mobs are literally hanging lanterns — a drownlure, a lure
tyrant, an anglerqueen — and the dungeon is the `anglerdeep`. **Every light in this world is
bait**, and that should be true of the structures too: the only lit things a player sees are
attached to something with teeth.

Six biomes across nine slots.

## The roster

| mob                 | lvl           | what the icon shows   | where it belongs         |
| ------------------- | ------------- | --------------------- | ------------------------ |
| `aw_lightless_frog` | 125–134       | blue toad             | the sink                 |
| `aw_mire_creeper`   | 126–136       | dark crab, green eyes | the spore hollows        |
| `aw_gloomwing`      | 128–138       | pale gull             | the canopy               |
| `aw_sporeback`      | 130–140       | cyan skeleton         | the hollows              |
| `aw_weald_shade`    | 132–142       | orange fox            | the moss wood            |
| `aw_moss_bear`      | 134–144       | brown bear            | the moss wood, the grove |
| `aw_anglerqueen`    | 140–150       | angler with a lure    | the deeps                |
| `aw_bear_patriarch` | 142–152       | white bear            | the moss wood            |
| `aw_gloom_piper`    | 144–154       | dark green rat        | the canopy               |
| `aw_deep_oracle`    | 146–156       | pale fish             | the sink                 |
| `aw_titan_bear`     | 152–160 archi | huge white bear       | the titan grove          |
| `aw_lure_tyrant`    | 154–162 archi | a lantern             | the deeps                |
| `aw_drownlure`      | 138–147 archi | a lantern             | the deeps                |
| `aw_matron`         | 160–165 boss  | dark angler           | **dungeon only**         |

## The six biomes

|               | humidity **low** | humidity **mid** | humidity **high** |
| ------------- | ---------------- | ---------------- | ----------------- |
| **temp low**  | `spore_hollows`  | `spore_hollows`  | `oracle_sink`     |
| **temp mid**  | `moss_wood`      | `moss_wood`      | `lantern_deeps`   |
| **temp high** | `titan_grove`    | `gloom_canopy`   | `lantern_deeps`   |

---

### 1. `moss_wood` — mid_low **and** mid_mid

The weald proper: trunks in waist-deep water, moss on everything above the line, bears moving
through it without a sound. **The world's default ground.**

- **Mobs**: `aw_moss_bear`, `aw_bear_patriarch`, `aw_weald_shade`
- **Profile**: 121 → 267, most of it under sea level 186 — you wade the whole biome.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 121 | rot_moss / clay / stone              |      |
| 0.20 | 156 |                                      |      |
| 0.28 | 186 | moss / peat / stone                  | 0.03 |
| 0.38 | 212 |                                      |      |
| 0.50 | 197 |                                      |      |
| 0.64 | 232 |                                      |      |
| 0.78 | 217 |                                      |      |
| 0.90 | 252 |                                      |      |
| 1    | 267 |                                      |      |

- **Structures**: `swamp_trees` at **maximum density**, all sets — **covered today**. This world is
  what the swamp pack was drawn for and it has waited eighteen worlds.

### 2. `lantern_deeps` — mid_high **and** high_high

Where the wood floor drops away. Deep black water with lights hanging in it at head height, and
each light is attached to something.

- **Mobs**: `aw_drownlure`, `aw_lure_tyrant`, `aw_anglerqueen`
- **Profile**: 76 → 192 — 101 blocks of water over the low half.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 76  | peat / clay / deep_stone |      |
| 0.28 | 116 |                          |      |
| 0.40 | 146 |                          |      |
| 0.48 | 189 | rot_moss / peat / stone  | 0.03 |
| 0.58 | 166 |                          |      |
| 0.70 | 141 |                          |      |
| 0.80 | 181 |                          |      |
| 0.92 | 156 |                          |      |
| 1    | 192 |                          |      |

- **Structures**: `swamp_trees` drowned to the crown, sparse. **No lit props** — the lights are
  mobs, and putting a decorative lantern here would teach the player the wrong lesson.

### 3. `spore_hollows` — low_low **and** low_mid

Bowls in the wood floor that drained. The only ground in the world you can stand on dry, and it
is thick with spore.

- **Mobs**: `aw_sporeback`, `aw_mire_creeper`
- **Profile**: inverted — rim 277, floor 171. Even the floor is only six blocks clear of the water.

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 277 | moss / peat / stone     |      |
| 0.14 | 242 |                         |      |
| 0.24 | 207 |                         |      |
| 0.36 | 186 | rot_moss / clay / stone | 0.03 |
| 0.50 | 171 |                         |      |
| 0.62 | 184 |                         |      |
| 0.74 | 212 | moss / peat / stone     | 0.03 |
| 0.88 | 252 |                         |      |
| 1    | 282 |                         |      |

- **Structures**: `swamp_trees` on the rims only, so the hollows read as clearings from inside.

### 4. `oracle_sink` — low_high

The deepest hole in the weald. Cold, still, and something old is at the bottom of it answering
questions.

- **Mobs**: `aw_deep_oracle`, `aw_lightless_frog`
- **Profile**: 55 → 192 — over 126 blocks of water at the low end, the deepest cold water in the
  game.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 55  | clay / clay / deep_stone |      |
| 0.30 | 101 |                          |      |
| 0.42 | 141 |                          |      |
| 0.50 | 189 | rot_moss / clay / stone  | 0.03 |
| 0.60 | 161 |                          |      |
| 0.72 | 131 |                          |      |
| 0.82 | 176 |                          |      |
| 0.94 | 151 |                          |      |
| 1    | 192 |                          |      |

- **Structures**: **nothing**. Third empty pack list in the game.

### 5. `gloom_canopy` — high_mid

A shelf high enough that the canopy is at eye level rather than overhead. The only place you can
see more than thirty blocks.

- **Mobs**: `aw_gloomwing`, `aw_gloom_piper`
- **Profile**: 126 → 333, dry above the water line for most of its range.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 126 | rich_soil / clay / stone |      |
| 0.18 | 166 |                          |      |
| 0.24 | 202 | moss / rich_soil / stone | 0.03 |
| 0.36 | 242 |                          |      |
| 0.48 | 222 |                          |      |
| 0.62 | 277 |                          |      |
| 0.76 | 252 |                          |      |
| 0.90 | 312 |                          |      |
| 1    | 333 |                          |      |

- **Structures**: `temperate_trees` at full size, dark-tinted — **covered today**.

### 6. `titan_grove` — high_low

The oldest trees, on the one ridge that never flooded. **The world's roof, 383**, and the only
dry ground worth the name.

- **Mobs**: `aw_titan_bear`, `aw_moss_bear`
- **Profile**: 126 → 383, a long climb out of the water.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 126 | rich_soil / clay / stone |      |
| 0.16 | 176 |                          |      |
| 0.22 | 222 | moss / rich_soil / stone | 0.03 |
| 0.34 | 267 |                          |      |
| 0.46 | 247 |                          |      |
| 0.60 | 312 |                          |      |
| 0.74 | 287 |                          |      |
| 0.88 | 358 |                          |      |
| 1    | 383 |                          |      |

- **Structures**: `swamp_trees` big-tree set at **maximum size, minimum density** — a dozen trees
  in the whole biome, each one enormous. Covered today.

---

## Materials

| name                                   | color                 | preset         | used by                                                          |
| -------------------------------------- | --------------------- | -------------- | ---------------------------------------------------------------- |
| `stone`                                | `#707777`             | stone          | filler                                                           |
| `deep_stone`                           | `#465258`             | stone          | under the deeps and the sink                                     |
| `clay`                                 | `#76514b`             | earth          | the drowned floor                                                |
| `peat`                                 | `#3b3125`             | earth          | deeps, hollows                                                   |
| `rich_soil`                            | `#493a2d`             | earth          | canopy shelf, titan grove                                        |
| `moss`                                 | `#3d5a3f`             | grass          | everything above the water line                                  |
| `rot_moss`                             | `#33482e`             | grass          | everything at it                                                 |
| `water`                                | `#1d3a4a`             | water          | **dark for this world** — the weald's water does not reflect sky |
| `swamp_wood` / `swamp_foliage`         | `#3a3129` / `#2b4433` | wood / foliage | the weald                                                        |
| `temperate_wood` / `temperate_foliage` | `#463628` / `#2d4a34` | wood / foliage | the canopy shelf                                                 |

## Mob rows

```json
{ "mob_type": "aw_lightless_frog",  "weight_bp": 8000, "biomes": ["oracle_sink","lantern_deeps"] },
{ "mob_type": "aw_mire_creeper",    "weight_bp": 8000, "biomes": ["spore_hollows"] },
{ "mob_type": "aw_gloomwing",       "weight_bp": 8000, "biomes": ["gloom_canopy"] },
{ "mob_type": "aw_sporeback",       "weight_bp": 8000, "biomes": ["spore_hollows"] },
{ "mob_type": "aw_weald_shade",     "weight_bp": 8000, "biomes": ["moss_wood","gloom_canopy"] },
{ "mob_type": "aw_moss_bear",       "weight_bp": 8000, "biomes": ["moss_wood","titan_grove"] },
{ "mob_type": "aw_anglerqueen",     "weight_bp": 8000, "biomes": ["lantern_deeps"] },
{ "mob_type": "aw_bear_patriarch",  "weight_bp": 8000, "biomes": ["moss_wood"] },
{ "mob_type": "aw_gloom_piper",     "weight_bp": 8000, "biomes": ["gloom_canopy"] },
{ "mob_type": "aw_deep_oracle",     "weight_bp": 8000, "biomes": ["oracle_sink"] },
{ "mob_type": "aw_titan_bear",      "weight_bp": 8000, "biomes": ["titan_grove"] },
{ "mob_type": "aw_lure_tyrant",     "weight_bp": 8000, "biomes": ["lantern_deeps"] },
{ "mob_type": "aw_drownlure",       "weight_bp": 8000, "biomes": ["lantern_deeps"] }
```

Resources: **none**. Dungeon: unchanged (`anglerdeep_key`).

## Structures — have / want

| biome           | reuse today                                        | want |
| --------------- | -------------------------------------------------- | ---- |
| `moss_wood`     | `swamp_trees` at max density — **covered**         | —    |
| `lantern_deeps` | `swamp_trees` drowned, sparse — **covered**        | —    |
| `spore_hollows` | `swamp_trees` on the rims — **covered**            | —    |
| `gloom_canopy`  | `temperate_trees`, dark-tinted — **covered**       | —    |
| `titan_grove`   | `swamp_trees` big set, huge and rare — **covered** | —    |
| `oracle_sink`   | **nothing, on purpose**                            | —    |

**The only world in the study that needs no download at all.** Every biome ships from the packs
already in the repo, because a drowned wood is exactly what the swamp pack is.
