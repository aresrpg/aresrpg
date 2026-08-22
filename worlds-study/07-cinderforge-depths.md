# 07 — Cinderforge Depths

> Entry level 30 · mobs level 30–47 · dungeon key `core_forge_key` · sea level 68

Thirteen mobs — the roster shrinks hard after Pandora's twenty-five — so this world is **not
built out of variety, it is built out of depth**. You come in over a rim at 383 and you go down,
and the further down you go the hotter it gets, until the floor is slag terraces and channels
with a forge cut into them.

Caves are explicitly deferred in this engine, so "Depths" is honest as **descent, not
underground**: a caldera-quarry you walk into from above. The cold shelf near the rim has the
last living trees in the world, and the wolf and the fox live up there because nothing else can.

Eight biomes over the nine slots — `cinder_wastes` takes two, because a thirteen-mob world cannot
honestly populate nine distinct places.

## The roster

| mob                    | lvl         | what the icon shows              | the habitat it asks for     |
| ---------------------- | ----------- | -------------------------------- | --------------------------- |
| `bjorn`                | 30          | pale ogre, red arm               | the forge floor             |
| `cendroling`           | 30–40       | burning crusted rock ("Ashskin") | ash and slag                |
| `firegoblin`           | 30–40       | goblin, fire-lit                 | the forge                   |
| `goblin_taster`        | 30–35       | goblin                           | the forge, the terraces     |
| `weaver`               | 32–42       | purple-green spider              | still air, high and cold    |
| `piranha_school`       | 32–42       | a school moving as one           | the channels                |
| `moldrot`              | 32–42       | cyan skeleton                    | cold standing water         |
| `sapling_warden`       | 32–44       | brown tree-folk                  | the last living ground      |
| `feran_scout`          | 32–44       | upright orange fox               | the cold shelf              |
| `lantern_wraith`       | 32–45       | a hanging lantern                | the wastes, marking nothing |
| `crater_queen`         | 30–35 archi | green-black spider               | the crater                  |
| `tuskarr_the_oldest`   | 30–36 archi | white shaggy warthog             | ash plains                  |
| `fenrik_the_moonlit`   | 32–38 archi | red wolf                         | the rim at night            |
| `pyrlach_the_forgemaw` | 43–47 boss  | fish of fire                     | **dungeon only** — the core |

## The biomes

Temperature is literally depth here: cold at the rim, molten at the floor. Humidity runs dry ash
→ standing water. **The vertical read is the world** — a player should always know which way is
down without looking at a number.

|               | humidity **low** | humidity **mid** | humidity **high** |
| ------------- | ---------------- | ---------------- | ----------------- |
| **temp low**  | `ashfall_rim`    | `moonlit_shelf`  | `moldrot_sumps`   |
| **temp mid**  | `slag_terraces`  | `forge_floors`   | `magma_channels`  |
| **temp high** | `cinder_wastes`  | `cinder_wastes`  | `crater_webs`     |

---

### 1. `forge_floors` — mid_mid

The working floor: flat, black, swept, with the furnace cut into the rock behind it. **The
dungeon's overworld tell** and the world's default ground.

- **Mobs**: `firegoblin`, `goblin_taster`, `bjorn`
- **Resources**: `wheat_ukraine` (FARMER), `obsidianite` (MINER)
- **Profile**: deliberately the flattest curve in the world, 56 → 105. Flat ground reads as _made_.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 56  | slag / gravel / blackstone           |      |
| 0.20 | 71  |                                      |      |
| 0.28 | 83  | slag / cinder / blackstone           | 0.03 |
| 0.40 | 86  |                                      |      |
| 0.50 | 83  |                                      |      |
| 0.62 | 94  |                                      |      |
| 0.74 | 88  |                                      |      |
| 0.88 | 101 |                                      |      |
| 1    | 105 |                                      |      |

- **Structures**: wants **a furnace house** — a tatara ironworks is exactly this building:
  long, low, banked in earth, with a stack. The Japanese pack's industrial and roofed structures
  carry it, and the world is named after it.

### 2. `slag_terraces` — mid_low

Waste heaps stepped up off the floor, tipped and re-tipped until they became landscape.

- **Mobs**: `cendroling`, `goblin_taster`, `tuskarr_the_oldest`
- **Resources**: `obsidianite` (MINER)
- **Profile**: tread and riser, 64 → 188 — a spoil heap has flat tops because that is where the
  carts stopped.

| x    | y   | land                       | var  |
| ---- | --- | -------------------------- | ---- |
| 0    | 64  | cinder / ash / blackstone  |      |
| 0.18 | 83  |                            |      |
| 0.24 | 101 | slag / cinder / blackstone | 0.03 |
| 0.34 | 105 |                            |      |
| 0.40 | 128 |                            |      |
| 0.54 | 131 |                            |      |
| 0.60 | 154 |                            |      |
| 0.74 | 158 |                            |      |
| 0.86 | 180 |                            |      |
| 1    | 188 |                            |      |

- **Structures**: `scorched_rocks` + rock-pack **tipped blocks**. Covered enough today.

### 3. `magma_channels` — mid_high

Cut channels running off the floor. The cold ones hold water at sea level 68; the hot ones do
not, and the fish only live in the cold ones.

- **Mobs**: `piranha_school`, `cendroling`, `firegoblin`
- **Resources**: `obsidianite` (MINER)
- **Profile**: the world's low point, 38 → 83, breathing across sea level 68.

| x    | y   | land                                 | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 38  | blackstone / blackstone / deep_stone |      |
| 0.22 | 56  |                                      |      |
| 0.30 | 66  |                                      |      |
| 0.36 | 75  | slag / blackstone / deep_stone       | 0.03 |
| 0.46 | 64  |                                      |      |
| 0.56 | 77  |                                      |      |
| 0.68 | 62  |                                      |      |
| 0.80 | 79  |                                      |      |
| 0.90 | 68  |                                      |      |
| 1    | 83  |                                      |      |

- **Structures**: `scorched_rocks` lava set — **covered today**.

### 4. `cinder_wastes` — high_low **and** high_mid

The ash plain the forge throws out, spreading over two climate slots because it is genuinely most
of the hot half of the world. Grey, level, and lit by lanterns nobody carries.

- **Mobs**: `cendroling`, `tuskarr_the_oldest`, `lantern_wraith`, `bjorn`
- **Resources**: `obsidianite` (MINER), `phantom_spore` (HERBALIST)
- **Profile**: near-flat, 64 → 105. The two slots share one curve on purpose — it should read as
  one enormous place, not two similar ones.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 64  | ash / cinder / blackstone |      |
| 0.22 | 83  |                           |      |
| 0.34 | 94  | cinder / ash / blackstone | 0.03 |
| 0.50 | 98  |                           |      |
| 0.66 | 90  |                           |      |
| 0.82 | 105 |                           |      |
| 1    | 101 |                           |      |

- **Structures**: `scorched_rocks` + `scorched_ruins` — **covered today**. The altar stub reads as
  a shrine to whatever they were smelting for.

### 5. `crater_webs` — high_high

A blown crater, webbed corner to corner by something that likes the updraught. You go down into
it and the light goes strange.

- **Mobs**: `crater_queen`, `weaver`, `lantern_wraith`
- **Resources**: `phantom_spore` (HERBALIST)
- **Profile**: inverted — rim at 180, floor at 75. The bowl is the biome.

| x    | y   | land                       | var  |
| ---- | --- | -------------------------- | ---- |
| 0    | 180 | cinder / ash / blackstone  |      |
| 0.14 | 154 |                            |      |
| 0.24 | 116 |                            |      |
| 0.36 | 90  | slag / cinder / deep_stone | 0.03 |
| 0.50 | 75  |                            |      |
| 0.62 | 88  |                            |      |
| 0.74 | 120 | cinder / ash / blackstone  | 0.03 |
| 0.88 | 158 |                            |      |
| 1    | 184 |                            |      |

- **Structures**: rock-pack **crater lip blocks**, and nothing on the floor — the webs are the
  content and they are the mob's problem, not the terrain's.

### 6. `moonlit_shelf` — low_mid

High and cold, above the heat line: the last firs in the world, snow that survives the day, and
the two animals clever enough to stay up here.

- **Mobs**: `fenrik_the_moonlit`, `feran_scout`, `sapling_warden`
- **Resources**: `phantom_spore` (HERBALIST), `wheat_ukraine` (FARMER)
- **Profile**: 83 → 270, a proper shoulder — and the only green in the world.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 83  | gravel / dirt / stone    |      |
| 0.16 | 131 |                          |      |
| 0.24 | 180 | moss / rich_soil / stone | 0.03 |
| 0.36 | 210 |                          |      |
| 0.48 | 195 |                          |      |
| 0.62 | 237 |                          |      |
| 0.76 | 222 |                          |      |
| 0.90 | 259 |                          |      |
| 1    | 270 |                          |      |

- **Structures**: `taiga_trees` + `taiga_rocks` — **covered today**.

### 7. `ashfall_rim` — low_low

The rim you arrive on. Bare rock with grey fall settling on it, and the whole world visible below.

- **Mobs**: `fenrik_the_moonlit`, `weaver`, `tuskarr_the_oldest`
- **Resources**: `obsidianite` (MINER)
- **Profile**: **the world's roof, 383**, and the reason the descent reads. The 0.18→0.20 run is a
  101-block face.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 90  | gravel / stone / deep_stone |      |
| 0.14 | 143 |                             |      |
| 0.18 | 195 | stone / gravel / deep_stone | 0.02 |
| 0.20 | 297 |                             |      |
| 0.28 | 315 | ash / dirt / stone          | 0.03 |
| 0.42 | 304 |                             |      |
| 0.56 | 342 |                             |      |
| 0.70 | 323 |                             |      |
| 0.84 | 364 |                             |      |
| 1    | 383 |                             |      |

- **Structures**: rock-pack **rim crags**, and a single Japanese **gate at the head of the
  descent** — the last built thing before you go down.

### 8. `moldrot_sumps` — low_high

The cold bottom water: whatever drained down and never boiled off, going bad. The cyan dead stand
in it.

- **Mobs**: `moldrot`, `piranha_school`, `sapling_warden`
- **Resources**: `phantom_spore` (HERBALIST)
- **Profile**: the deepest ground in the world, 30 → 75, breathing across sea level 68.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 30  | clay / clay / deep_stone     |      |
| 0.24 | 49  |                              |      |
| 0.34 | 60  |                              |      |
| 0.40 | 71  | rot_moss / clay / deep_stone | 0.03 |
| 0.50 | 58  |                              |      |
| 0.60 | 69  |                              |      |
| 0.72 | 56  |                              |      |
| 0.84 | 71  |                              |      |
| 0.94 | 62  |                              |      |
| 1    | 75  |                              |      |

- **Structures**: `swamp_trees` dead set — **covered today**.

---

## Materials

| name                           | color                 | preset         | used by                                          |
| ------------------------------ | --------------------- | -------------- | ------------------------------------------------ |
| `blackstone`                   | `#373737`             | stone          | the channels, everything's floor                 |
| `deep_stone`                   | `#465258`             | stone          | filler below the working level                   |
| `stone`                        | `#707777`             | stone          | the rim                                          |
| `gravel`                       | `#766f61`             | stone          | rim, shelf, forge floor                          |
| `slag`                         | `#4a4340`             | stone          | the made ground — floors, terraces, channel lips |
| `ash`                          | `#55504a`             | earth          | the wastes, the rim fall                         |
| `cinder`                       | `#3a3330`             | earth          | crust over everything hot                        |
| `clay`                         | `#76514b`             | earth          | the sumps                                        |
| `dirt`                         | `#654d36`             | earth          | the shelf, the rim cap                           |
| `rich_soil`                    | `#493a2d`             | earth          | the shelf                                        |
| `moss`                         | `#456a4b`             | grass          | the last living ground                           |
| `rot_moss`                     | `#3d5236`             | grass          | the sumps                                        |
| `water`                        | `#2e609e`             | water          | channels and sumps only                          |
| `taiga_wood` / `taiga_foliage` | `#554536` / `#315346` | wood / foliage | the moonlit shelf                                |
| `swamp_wood` / `swamp_foliage` | `#493d32` / `#395d42` | wood / foliage | the sumps                                        |

## Mob rows

```json
{ "mob_type": "bjorn",              "weight_bp": 8000, "biomes": ["forge_floors","cinder_wastes"] },
{ "mob_type": "cendroling",         "weight_bp": 8000, "biomes": ["cinder_wastes","slag_terraces","magma_channels"] },
{ "mob_type": "firegoblin",         "weight_bp": 8000, "biomes": ["forge_floors","magma_channels"] },
{ "mob_type": "goblin_taster",      "weight_bp": 8000, "biomes": ["forge_floors","slag_terraces"] },
{ "mob_type": "weaver",             "weight_bp": 8000, "biomes": ["crater_webs","ashfall_rim"] },
{ "mob_type": "piranha_school",     "weight_bp": 8000, "biomes": ["magma_channels","moldrot_sumps"] },
{ "mob_type": "moldrot",            "weight_bp": 8000, "biomes": ["moldrot_sumps"] },
{ "mob_type": "sapling_warden",     "weight_bp": 8000, "biomes": ["moonlit_shelf","moldrot_sumps"] },
{ "mob_type": "feran_scout",        "weight_bp": 8000, "biomes": ["moonlit_shelf"] },
{ "mob_type": "lantern_wraith",     "weight_bp": 8000, "biomes": ["cinder_wastes","crater_webs"] },
{ "mob_type": "crater_queen",       "weight_bp": 8000, "biomes": ["crater_webs"] },
{ "mob_type": "tuskarr_the_oldest", "weight_bp": 8000, "biomes": ["cinder_wastes","slag_terraces","ashfall_rim"] },
{ "mob_type": "fenrik_the_moonlit", "weight_bp": 8000, "biomes": ["moonlit_shelf","ashfall_rim"] }
```

## Resource rows

```json
{ "item_type": "obsidianite",   "job": "MINER",     "tier": 7, "protector": "protector_obsidianite",        "rare_item_type": "", "biomes": ["forge_floors","slag_terraces","magma_channels","cinder_wastes","ashfall_rim"] },
{ "item_type": "phantom_spore", "job": "HERBALIST", "tier": 7, "protector": "protector_phantom_gaia",       "rare_item_type": "", "biomes": ["moonlit_shelf","moldrot_sumps","crater_webs","cinder_wastes"] },
{ "item_type": "wheat_ukraine", "job": "FARMER",    "tier": 7, "protector": "protector_ukranize_bricheton", "rare_item_type": "", "biomes": ["forge_floors","moonlit_shelf"] }
```

Dungeon: unchanged (`core_forge_key`).

## Structures — have / want

| biome            | reuse today                                       | want                                                        |
| ---------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `magma_channels` | `scorched_rocks` lava set — **covered**           | —                                                           |
| `cinder_wastes`  | `scorched_rocks` + `scorched_ruins` — **covered** | —                                                           |
| `moonlit_shelf`  | `taiga_trees` + `taiga_rocks` — **covered**       | —                                                           |
| `moldrot_sumps`  | `swamp_trees` dead — **covered**                  | —                                                           |
| `slag_terraces`  | `scorched_rocks`                                  | tipped blocks                                               |
| `crater_webs`    | `scorched_rocks`                                  | crater lip blocks                                           |
| `ashfall_rim`    | —                                                 | rim crags + **one gate at the head of the descent**         |
| `forge_floors`   | —                                                 | **a furnace house — the building the world is named after** |

Four biomes ship untouched. One building matters: the furnace. Everything else is rock.
