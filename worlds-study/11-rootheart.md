# 11 — Rootheart

> Entry level 52 · mobs level 52–72 · dungeon key `key_aragog` · sea level 96

A frozen forest growing on top of a root system so old it has become the bedrock. Four of the
fifteen mobs are literally _frost_-prefixed and two more are ice-coloured, so the surface reads
cold — but the roots underneath are still alive, and where they run shallow the ground is warm
enough to steam. That contradiction is the world: **snow on top, heat underneath**, and hot
springs wherever a root comes close to the surface.

The dungeon key is `key_aragog` and the boss is _Varagh the Rootshell_: the spiders live in the
deepest root, and the ghosts — a yurei abbot, a nerak priest — keep shrines above them.

## The roster

| mob                    | lvl         | what the icon shows     | the habitat it asks for       |
| ---------------------- | ----------- | ----------------------- | ----------------------------- |
| `widow_matron`         | 52–65       | dark red spider         | frozen thicket                |
| `nerak_priest`         | 52–57       | grey ape-monk           | the shrines                   |
| `frostling`            | 55–68       | ice-crystal creature    | snow, thicket                 |
| `razmaster`            | 55–65       | dark green rat          | the root hollows, the ruin    |
| `frostkoa`             | 55–65       | blue toad               | the mere, the springs         |
| `frost_silkweaver`     | 55–65       | blue cocoon             | frozen thicket, the mere edge |
| `frostwolf`            | 55–68       | white-blue wolf         | pines and mere ice            |
| `bisonbrute`           | 55–68       | brown bison             | open ground, pines, crags     |
| `pterodon`             | 55–68       | green pterodactyl       | the crags                     |
| `trillo`               | 55–70       | white-blue ram-bear     | the root hollows              |
| `cinder_bonelord`      | 55–65       | brown skeleton          | the warm side                 |
| `fen_stalker`          | 55–70       | green fen brute         | the thawed fen                |
| `swamp_firekoa`        | 55–62       | orange toad on hot rock | the springs                   |
| `yurei_abbot`          | 55–62       | grey ape-monk, ghostly  | the shrines                   |
| `duke_the_insolvent`   | 52–58 archi | goblin dressed in money | the failed market             |
| `varagh_the_rootshell` | 68–72 boss  | yellow rootshell        | **dungeon only**              |

## The nine biomes

Temperature runs deep-frozen → root-warmed; humidity runs webbed thicket → open water. The cold
column is the surface world, the warm column is where the roots are close, and **the middle row
is the roots themselves** — humped backs of wood the size of hills.

|               | humidity **low** | humidity **mid**   | humidity **high** |
| ------------- | ---------------- | ------------------ | ----------------- |
| **temp low**  | `widow_thickets` | `frostpine_taiga`  | `frozen_mere`     |
| **temp mid**  | `broken_market`  | `rootheart_hollow` | `sunken_fen`      |
| **temp high** | `pterodon_crags` | `yurei_shrines`    | `firekoa_springs` |

---

### 1. `rootheart_hollow` — mid_mid

Root backs breaking the ground in long humps with cold hollows between them. **The world's
default ground, and the reason it is called Rootheart.**

- **Mobs**: `trillo`, `fen_stalker`, `razmaster`, `bisonbrute`
- **Resources**: `wheat_white` (FARMER), `cursed_fungus` (HERBALIST)
- **Profile**: humped, 80 → 195. Each rise from 0.3 onward is a root back; the dips are where you
  walk.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 80  | rich_soil / clay / stone             |      |
| 0.16 | 103 |                                      |      |
| 0.22 | 119 | moss / rich_soil / stone             | 0.03 |
| 0.30 | 157 |                                      |      |
| 0.38 | 130 |                                      |      |
| 0.50 | 172 |                                      |      |
| 0.60 | 142 |                                      |      |
| 0.72 | 184 |                                      |      |
| 0.84 | 153 |                                      |      |
| 1    | 195 |                                      |      |

- **Structures**: `swamp_trees` big-tree set at maximum size, very sparse — the same stopgap as
  Pandora's hollow roots, and the same real want: **an arch you can walk under**.

### 2. `frostpine_taiga` — low_mid

Snow-loaded firs, deadfall under the snow, wolves working the edges. The most ordinary place in
the world and the safest-looking.

- **Mobs**: `frostwolf`, `frostling`, `bisonbrute`
- **Resources**: `wheat_white` (FARMER)
- **Profile**: 84 → 218, a long even climb.

| x    | y   | land                  | var  |
| ---- | --- | --------------------- | ---- |
| 0    | 84  | gravel / dirt / stone |      |
| 0.16 | 111 |                       |      |
| 0.22 | 134 | snow / dirt / stone   | 0.03 |
| 0.34 | 161 |                       |      |
| 0.46 | 149 |                       |      |
| 0.60 | 184 |                       |      |
| 0.74 | 169 |                       |      |
| 0.88 | 207 |                       |      |
| 1    | 218 |                       |      |

- **Structures**: `taiga_trees` + `taiga_rocks` — **covered today**.

### 3. `widow_thickets` — low_low

Frozen scrub packed too tight to walk through straight, every gap webbed. The matron is in here
somewhere.

- **Mobs**: `widow_matron`, `frost_silkweaver`, `frostling`
- **Resources**: `diamond` (MINER)
- **Profile**: 88 → 226, the same shape as the taiga on purpose — **the difference is density,
  not landform**, which is what makes walking into it feel like a mistake.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 88  | frostgrass / dirt / stone |      |
| 0.16 | 115 |                           |      |
| 0.22 | 138 | snow / frostgrass / stone | 0.03 |
| 0.34 | 165 |                           |      |
| 0.46 | 153 |                           |      |
| 0.60 | 188 |                           |      |
| 0.74 | 172 |                           |      |
| 0.88 | 211 |                           |      |
| 1    | 226 |                           |      |

- **Structures**: `taiga_trees` at **maximum density** + `arctic_rocks`. Covered today.

### 4. `frozen_mere` — low_high

A lake with its lid on. Ice at sea level 96, dark water under it, and things standing on top that
should be swimming.

- **Mobs**: `frostkoa`, `frost_silkweaver`, `frostwolf`
- **Resources**: `cursed_fungus` (HERBALIST)
- **Profile**: the ice sheet at 0.42 is authored as a material band, so the surface is ice where
  the water would be.

| x    | y   | land                  | var  |
| ---- | --- | --------------------- | ---- |
| 0    | 54  | clay / gravel / stone |      |
| 0.24 | 77  |                       |      |
| 0.34 | 88  |                       |      |
| 0.42 | 101 | ice / ice / stone     | 0.03 |
| 0.52 | 90  |                       |      |
| 0.64 | 82  |                       |      |
| 0.76 | 100 |                       |      |
| 0.88 | 88  |                       |      |
| 1    | 103 |                       |      |

- **Structures**: `glacier_rocks` — the icesurface set is fifteen types of exactly this —
  **covered today**.

### 5. `sunken_fen` — mid_high

Where the root heat thaws the ground and the meltwater has nowhere to go. Black water, root
knees, and something green standing very still in it.

- **Mobs**: `fen_stalker`, `frostkoa`, `swamp_firekoa`
- **Resources**: `cursed_fungus` (HERBALIST), `wheat_white` (FARMER)
- **Profile**: breathes across sea level 96, 61 → 107.

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 61  | peat / clay / stone     |      |
| 0.22 | 84  |                         |      |
| 0.30 | 92  |                         |      |
| 0.36 | 103 | rot_moss / peat / stone | 0.03 |
| 0.46 | 90  |                         |      |
| 0.56 | 101 |                         |      |
| 0.68 | 88  |                         |      |
| 0.80 | 103 |                         |      |
| 0.90 | 92  |                         |      |
| 1    | 107 |                         |      |

- **Structures**: `swamp_trees` — **covered today**.

### 6. `firekoa_springs` — high_high

Hot springs terracing out of the snow line in pale mineral steps, steaming. The one warm, kind
place in a cold world, and it is full of toads.

- **Mobs**: `swamp_firekoa`, `frostkoa`, `pterodon`
- **Resources**: `cursed_fungus` (HERBALIST)
- **Profile**: 65 → 115, breathing across sea level so the pools actually hold.

| x    | y   | land                    | var  |
| ---- | --- | ----------------------- | ---- |
| 0    | 65  | sinter / clay / stone   |      |
| 0.22 | 84  |                         |      |
| 0.30 | 92  |                         |      |
| 0.36 | 105 | sinter / sinter / stone | 0.03 |
| 0.46 | 94  |                         |      |
| 0.56 | 107 |                         |      |
| 0.66 | 96  |                         |      |
| 0.78 | 111 |                         |      |
| 0.90 | 100 |                         |      |
| 1    | 115 |                         |      |

- **Structures**: wants **a bath house over the pools** — an onsen. Rock-pack rimstone for the
  pool lips. This is the warmest image in the game and worth building properly.

### 7. `yurei_shrines` — high_mid

Shrines set on the warm root backs, still standing, still tended by something that is not alive.

- **Mobs**: `yurei_abbot`, `nerak_priest`, `cinder_bonelord`
- **Resources**: `diamond` (MINER), `cursed_fungus` (HERBALIST)
- **Profile**: tread and riser, 80 → 230 — the shrines sit on the flats.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 80  | rich_soil / clay / stone |      |
| 0.18 | 107 |                          |      |
| 0.24 | 130 | moss / rich_soil / stone | 0.03 |
| 0.34 | 138 |                          |      |
| 0.40 | 161 |                          |      |
| 0.54 | 169 |                          |      |
| 0.60 | 192 |                          |      |
| 0.74 | 199 |                          |      |
| 0.86 | 222 |                          |      |
| 1    | 230 |                          |      |

- **Structures**: wants **shrines, gates and stone lanterns**. A _yurei_ is a Japanese ghost —
  the pack and the mob are from the same world, and this biome should be the one place a player
  stops walking.

### 8. `pterodon_crags` — high_low

Bare crags above the tree line where the roots have pushed rock into the sky. Nests on every
ledge.

- **Mobs**: `pterodon`, `bisonbrute`, `cinder_bonelord`
- **Resources**: `diamond` (MINER)
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 103-block face; snow from 0.28 up.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 88  | gravel / stone / deep_stone |      |
| 0.14 | 138 |                             |      |
| 0.18 | 188 | stone / gravel / deep_stone | 0.02 |
| 0.20 | 291 |                             |      |
| 0.28 | 314 | snow / stone / deep_stone   | 0.03 |
| 0.42 | 303 |                             |      |
| 0.56 | 345 |                             |      |
| 0.70 | 322 |                             |      |
| 0.84 | 368 |                             |      |
| 1    | 383 |                             |      |

- **Structures**: `arctic_rocks` + rock-pack **crags and nest ledges**.

### 9. `broken_market` — mid_low

Somebody tried to trade here and it did not work. Frames without roofs, a weighing yard, and a
duke who still thinks he owns it.

- **Mobs**: `duke_the_insolvent`, `razmaster`, `trillo`
- **Resources**: `diamond` (MINER), `wheat_white` (FARMER)
- **Profile**: 84 → 192, flat enough to have built on.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 84  | gravel / dirt / stone    |      |
| 0.18 | 107 |                          |      |
| 0.24 | 126 | dirt / rich_soil / stone | 0.03 |
| 0.36 | 146 |                          |      |
| 0.48 | 134 |                          |      |
| 0.62 | 165 |                          |      |
| 0.76 | 153 |                          |      |
| 0.90 | 184 |                          |      |
| 1    | 192 |                          |      |

- **Structures**: wants **roofless stall frames and a walled yard**, snow-loaded. The same market
  build as Sunspire's bazaar, wrecked and half-buried — one asset, two very different worlds.

---

## Materials

| name                                   | color                 | preset         | used by                      |
| -------------------------------------- | --------------------- | -------------- | ---------------------------- |
| `stone`                                | `#707777`             | stone          | the crags, filler everywhere |
| `deep_stone`                           | `#465258`             | stone          | crag filler                  |
| `gravel`                               | `#766f61`             | stone          | pines, market, mere floor    |
| `clay`                                 | `#76514b`             | earth          | mere, fen, springs           |
| `rich_soil`                            | `#493a2d`             | earth          | root hollows, shrines        |
| `dirt`                                 | `#654d36`             | earth          | pines, thicket, market       |
| `peat`                                 | `#3b3125`             | earth          | the fen                      |
| `moss`                                 | `#456a4b`             | grass          | root backs, shrines          |
| `rot_moss`                             | `#3d5236`             | grass          | the fen                      |
| `frostgrass`                           | `#8fa08d`             | grass          | the thickets                 |
| `snow`                                 | `#f4f6f3`             | snow           | pines, thicket, crags        |
| `ice`                                  | `#74ccf4`             | ice            | the mere's lid               |
| `sinter`                               | `#cfc0a6`             | sand           | the spring terraces          |
| `water`                                | `#2e609e`             | water          | mere, fen, springs           |
| `taiga_wood` / `taiga_foliage`         | `#554536` / `#315346` | wood / foliage | pines and thickets           |
| `swamp_wood` / `swamp_foliage`         | `#493d32` / `#395d42` | wood / foliage | fen, and the root trunks     |
| `temperate_wood` / `temperate_foliage` | `#624936` / `#416f49` | wood / foliage | shrines, root hollows        |

## Mob rows

```json
{ "mob_type": "widow_matron",       "weight_bp": 8000, "biomes": ["widow_thickets"] },
{ "mob_type": "nerak_priest",       "weight_bp": 8000, "biomes": ["yurei_shrines"] },
{ "mob_type": "frostling",          "weight_bp": 8000, "biomes": ["frostpine_taiga","widow_thickets"] },
{ "mob_type": "razmaster",          "weight_bp": 8000, "biomes": ["rootheart_hollow","broken_market"] },
{ "mob_type": "frostkoa",           "weight_bp": 8000, "biomes": ["frozen_mere","sunken_fen","firekoa_springs"] },
{ "mob_type": "frost_silkweaver",   "weight_bp": 8000, "biomes": ["widow_thickets","frozen_mere"] },
{ "mob_type": "frostwolf",          "weight_bp": 8000, "biomes": ["frostpine_taiga","frozen_mere"] },
{ "mob_type": "bisonbrute",         "weight_bp": 8000, "biomes": ["rootheart_hollow","frostpine_taiga","pterodon_crags"] },
{ "mob_type": "pterodon",           "weight_bp": 8000, "biomes": ["pterodon_crags","firekoa_springs"] },
{ "mob_type": "trillo",             "weight_bp": 8000, "biomes": ["rootheart_hollow","broken_market"] },
{ "mob_type": "cinder_bonelord",    "weight_bp": 8000, "biomes": ["yurei_shrines","pterodon_crags"] },
{ "mob_type": "fen_stalker",        "weight_bp": 8000, "biomes": ["sunken_fen","rootheart_hollow"] },
{ "mob_type": "swamp_firekoa",      "weight_bp": 8000, "biomes": ["firekoa_springs","sunken_fen"] },
{ "mob_type": "yurei_abbot",        "weight_bp": 8000, "biomes": ["yurei_shrines"] },
{ "mob_type": "duke_the_insolvent", "weight_bp": 8000, "biomes": ["broken_market"] }
```

## Resource rows

```json
{ "item_type": "cursed_fungus", "job": "HERBALIST", "tier": 11, "protector": "protector_cursed_gaia", "rare_item_type": "", "biomes": ["rootheart_hollow","sunken_fen","frozen_mere","firekoa_springs","yurei_shrines"] },
{ "item_type": "diamond",       "job": "MINER",     "tier": 11, "protector": "protector_diamond",     "rare_item_type": "", "biomes": ["pterodon_crags","widow_thickets","broken_market","yurei_shrines"] },
{ "item_type": "wheat_white",   "job": "FARMER",    "tier": 11, "protector": "protector_cursed_bricheton", "rare_item_type": "", "biomes": ["rootheart_hollow","frostpine_taiga","sunken_fen","broken_market"] }
```

Dungeon: unchanged (`key_aragog`).

## Structures — have / want

| biome              | reuse today                                              | want                                                                                |
| ------------------ | -------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `frostpine_taiga`  | `taiga_trees` + `taiga_rocks` — **covered**              | —                                                                                   |
| `widow_thickets`   | `taiga_trees` max density + `arctic_rocks` — **covered** | —                                                                                   |
| `frozen_mere`      | `glacier_rocks` icesurface set — **covered**             | —                                                                                   |
| `sunken_fen`       | `swamp_trees` — **covered**                              | —                                                                                   |
| `rootheart_hollow` | `swamp_trees` big set, huge and sparse                   | **root arches** (shared want with world 06)                                         |
| `pterodon_crags`   | `arctic_rocks`                                           | crags, nest ledges                                                                  |
| `broken_market`    | —                                                        | roofless stall frames, walled yard — **the same market build as world 10, wrecked** |
| `yurei_shrines`    | —                                                        | **shrines, gates, stone lanterns**                                                  |
| `firekoa_springs`  | —                                                        | **a bath house over the pools**                                                     |

Four biomes ship untouched — the glacier and taiga packs finally get a world that needs all of
them. The three builds are all Japanese-pack native, and one of them (`broken_market`) is a
re-dress of a build world 10 already needs.
