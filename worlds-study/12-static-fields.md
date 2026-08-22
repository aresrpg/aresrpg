# 12 — Static Fields

> Entry level 60 · mobs level 60–80 · dungeon key `charged_vault_key` · sea level 146

Open country under a storm that never moves off. Eleven mobs, the smallest roster since
Cinderforge, and the design answer is the opposite of a mountain world: **make it flat and let
the sky be the content**. Its broad curves still reach the common y 383 roof, but spend that
height over long runs — you should see weather coming across the fields for a very long time
before it reaches you.

Everything in the roster is either **conducting** (a steel golem, a lance, a lion called
Stormfang), **hiding from it** (spiders under the pylons, a yeti in the hoarfrost), or **feeding
on the strikes** (a flare wolf, a raptor, a ram that charges thunder). The vault the dungeon key
opens is the only thing here built to survive being hit.

Six biomes across the nine slots — three of them take two slots each, because a flat world reads
better as a few enormous places than as nine small ones.

## The roster

| mob                        | lvl         | what the icon shows       | the habitat it asks for |
| -------------------------- | ----------- | ------------------------- | ----------------------- |
| `frostshamble`             | 60–72       | pale frozen zombie        | hoarfrost, cold shore   |
| `firesteel_golem`          | 60–75       | red-hot steel golem       | the vaults, the burn    |
| `rex_alpha`                | 60–75       | red raptor, blue feathers | open plain              |
| `flarewolf`                | 60–70       | red dragon-wolf           | strike ground           |
| `shark_hammer`             | 60–75       | hammerhead                | the surge coast         |
| `widow_of_widows`          | 62–68       | dark spider, teal glow    | under the pylons        |
| `dread_lancer`             | 65–78       | tan skeleton with a lance | plain and vaults        |
| `frostclaw`                | 65–78       | blue crystal crab         | cold shore              |
| `yeti`                     | 65–78       | white horned yeti         | the hoarfrost           |
| `aragog_spawnling`         | 65–70       | green spider              | under the pylons        |
| `ramrage`                  | 65–75 archi | green-white ram           | the plain, the steppe   |
| `voltstripe_the_stormfang` | 76–80 boss  | gold lion                 | **dungeon only**        |

## The six biomes

Temperature runs frozen → struck; humidity runs burnt ground → open sea. Three biomes hold two
slots each: the plain, the steppe and the coast are each **one enormous place**, not two similar
ones.

|               | humidity **low**   | humidity **mid**   | humidity **high**  |
| ------------- | ------------------ | ------------------ | ------------------ |
| **temp low**  | `hoarfrost_steppe` | `hoarfrost_steppe` | `widow_pylons`     |
| **temp mid**  | `static_plains`    | `static_plains`    | `stormsurge_coast` |
| **temp high** | `flare_barrens`    | `charged_vaults`   | `stormsurge_coast` |

---

### 1. `static_plains` — mid_low **and** mid_mid

Grass standing on end. The ground hums, the air smells burnt, and there is nothing between you
and the horizon. **The world's default ground and roughly a third of its area.**

- **Mobs**: `ramrage`, `rex_alpha`, `flarewolf`, `dread_lancer`
- **Resources**: `wheat_purple` (FARMER), `arcaneshroom` (HERBALIST)
- **Profile**: the flattest large biome in the game after the salt pans, 116 → 222.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 116 | gravel / dirt / stone                |      |
| 0.18 | 146 |                                      |      |
| 0.24 | 166 | dry_grass / dirt / stone             | 0.03 |
| 0.36 | 181 |                                      |      |
| 0.50 | 171 |                                      |      |
| 0.64 | 197 |                                      |      |
| 0.78 | 186 |                                      |      |
| 0.90 | 212 |                                      |      |
| 1    | 222 |                                      |      |

- **Structures**: `grassland_trees` at **very low density** — a struck tree every few hundred
  blocks, and nothing else — plus `grassland_rocks`. Covered today; the emptiness is the design.

### 2. `charged_vaults` — high_mid

Thick-walled stone stores standing on a stepped platform, built by somebody who understood what
the sky does here. **The dungeon's overworld tell.**

- **Mobs**: `firesteel_golem`, `dread_lancer`, `widow_of_widows`
- **Resources**: `arcanite` (MINER), `draconite` (MINER)
- **Profile**: tread and riser, 111 → 297 — a made platform, the only cut ground in the world.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 111 | slag / gravel / stone       |      |
| 0.18 | 141 |                             |      |
| 0.24 | 166 | stone / gravel / deep_stone | 0.03 |
| 0.34 | 176 |                             |      |
| 0.40 | 207 |                             |      |
| 0.54 | 217 |                             |      |
| 0.60 | 247 |                             |      |
| 0.74 | 257 |                             |      |
| 0.86 | 287 |                             |      |
| 1    | 297 |                             |      |

- **Structures**: wants **thick-walled storehouses on a raised platform**. A _kura_ — the Japanese
  fireproof storehouse — is precisely this building: heavy walls, small openings, standing alone.
  A row of them on a plinth in the middle of an empty plain is the world's landmark.

### 3. `hoarfrost_steppe` — low_low **and** low_mid

The cold half. Same open ground, frozen white, with the storm's edge sitting on it. Yetis walk
across it in the open because there is nowhere to hide.

- **Mobs**: `yeti`, `frostshamble`, `frostclaw`, `ramrage`
- **Resources**: `wheat_purple` (FARMER), `arcanite` (MINER)
- **Profile**: 116 → 242, matching the plain's shape — **the difference is entirely material**,
  which is what makes the climate border read as weather rather than geography.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 116 | gravel / dirt / stone     |      |
| 0.18 | 146 |                           |      |
| 0.24 | 171 | snow / frostgrass / stone | 0.03 |
| 0.36 | 192 |                           |      |
| 0.50 | 176 |                           |      |
| 0.64 | 212 |                           |      |
| 0.78 | 197 |                           |      |
| 0.90 | 232 |                           |      |
| 1    | 242 |                           |      |

- **Structures**: `taiga_trees` very sparse + `arctic_rocks` — **covered today**.

### 4. `stormsurge_coast` — mid_high **and** high_high

Where the fields meet water and the strikes come down on it. Grey surf, shingle, and a hammerhead
working the shallows.

- **Mobs**: `shark_hammer`, `frostclaw`, `frostshamble`
- **Resources**: `arcaneshroom` (HERBALIST), `draconite` (MINER)
- **Profile**: breathes across sea level 146, 86 → 159.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 86  | gravel / clay / stone     |      |
| 0.22 | 121 |                           |      |
| 0.30 | 136 |                           |      |
| 0.36 | 154 | wet_sand / gravel / stone | 0.03 |
| 0.46 | 139 |                           |      |
| 0.56 | 151 |                           |      |
| 0.68 | 134 |                           |      |
| 0.80 | 154 |                           |      |
| 0.90 | 141 |                           |      |
| 1    | 159 |                           |      |

- **Structures**: rock-pack **shingle banks and groynes**, low. Nothing tall on a coast that gets
  hit this often.

### 5. `widow_pylons` — low_high

Natural stone pylons standing in a row, webbed corner to corner between them. The only vertical
thing in the world that was not built, and every spider in it lives underneath.

- **Mobs**: `widow_of_widows`, `aragog_spawnling`
- **Resources**: `arcanite` (MINER), `arcaneshroom` (HERBALIST)
- **Profile**: **the world's roof, 383** — modest, because it only has to be taller than flat.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 111 | gravel / stone / deep_stone |      |
| 0.14 | 156 |                             |      |
| 0.18 | 192 | stone / gravel / deep_stone | 0.02 |
| 0.20 | 323 |                             |      |
| 0.28 | 343 | frostgrass / dirt / stone   | 0.03 |
| 0.42 | 328 |                             |      |
| 0.56 | 363 |                             |      |
| 0.70 | 338 |                             |      |
| 0.84 | 373 |                             |      |
| 1    | 383 |                             |      |

- **Structures**: rock-pack **pylons** — tall, thin, in groups. The webs are the mobs' business.

### 6. `flare_barrens` — high_low

Where the ground has been hit so often it stopped growing anything. Fulgurite glass in the ash,
and the things that come to feed on the strikes.

- **Mobs**: `flarewolf`, `firesteel_golem`, `rex_alpha`
- **Resources**: `draconite` (MINER)
- **Profile**: 121 → 242, again matching the plain — three of six biomes share one landform and
  differ only in what they are made of.

| x    | y   | land                 | var  |
| ---- | --- | -------------------- | ---- |
| 0    | 121 | ash / cinder / stone |      |
| 0.18 | 151 |                      |      |
| 0.24 | 171 | cinder / ash / stone | 0.03 |
| 0.36 | 192 |                      |      |
| 0.50 | 176 |                      |      |
| 0.64 | 212 |                      |      |
| 0.78 | 197 |                      |      |
| 0.90 | 232 |                      |      |
| 1    | 242 |                      |      |

- **Structures**: `scorched_rocks` — **covered today**.

---

## Materials

| name                                   | color                 | preset         | used by                       |
| -------------------------------------- | --------------------- | -------------- | ----------------------------- |
| `stone`                                | `#707777`             | stone          | pylons, vaults                |
| `deep_stone`                           | `#465258`             | stone          | filler                        |
| `gravel`                               | `#766f61`             | stone          | everywhere underfoot          |
| `slag`                                 | `#4a4340`             | stone          | the vault platform            |
| `clay`                                 | `#76514b`             | earth          | the coast                     |
| `dirt`                                 | `#654d36`             | earth          | plain and steppe              |
| `ash`                                  | `#55504a`             | earth          | the barrens                   |
| `cinder`                               | `#3a3330`             | earth          | the barrens' crust            |
| `dry_grass`                            | `#9a9457`             | grass          | the plain                     |
| `frostgrass`                           | `#8fa08d`             | grass          | steppe, pylon tops            |
| `snow`                                 | `#f4f6f3`             | snow           | the steppe                    |
| `wet_sand`                             | `#9d896b`             | sand           | the coast                     |
| `water`                                | `#2e609e`             | water          | the coast                     |
| `grassland_wood` / `grassland_foliage` | `#5a4736` / `#6b7d44` | wood / foliage | the struck trees on the plain |
| `taiga_wood` / `taiga_foliage`         | `#554536` / `#315346` | wood / foliage | the steppe's few firs         |

## Mob rows

```json
{ "mob_type": "frostshamble",     "weight_bp": 8000, "biomes": ["hoarfrost_steppe","stormsurge_coast"] },
{ "mob_type": "firesteel_golem",  "weight_bp": 8000, "biomes": ["charged_vaults","flare_barrens"] },
{ "mob_type": "rex_alpha",        "weight_bp": 8000, "biomes": ["static_plains","flare_barrens"] },
{ "mob_type": "flarewolf",        "weight_bp": 8000, "biomes": ["flare_barrens","static_plains"] },
{ "mob_type": "shark_hammer",     "weight_bp": 8000, "biomes": ["stormsurge_coast"] },
{ "mob_type": "widow_of_widows",  "weight_bp": 8000, "biomes": ["widow_pylons","charged_vaults"] },
{ "mob_type": "dread_lancer",     "weight_bp": 8000, "biomes": ["static_plains","charged_vaults"] },
{ "mob_type": "frostclaw",        "weight_bp": 8000, "biomes": ["stormsurge_coast","hoarfrost_steppe"] },
{ "mob_type": "yeti",             "weight_bp": 8000, "biomes": ["hoarfrost_steppe"] },
{ "mob_type": "aragog_spawnling", "weight_bp": 8000, "biomes": ["widow_pylons"] },
{ "mob_type": "ramrage",          "weight_bp": 8000, "biomes": ["static_plains","hoarfrost_steppe"] }
```

## Resource rows

```json
{ "item_type": "arcaneshroom", "job": "HERBALIST", "tier": 9,  "protector": "protector_arcane_gaia",       "rare_item_type": "", "biomes": ["static_plains","stormsurge_coast","widow_pylons"] },
{ "item_type": "arcanite",     "job": "MINER",     "tier": 8,  "protector": "protector_arcanite",          "rare_item_type": "", "biomes": ["charged_vaults","widow_pylons","hoarfrost_steppe"] },
{ "item_type": "draconite",    "job": "MINER",     "tier": 9,  "protector": "protector_draconite",         "rare_item_type": "", "biomes": ["flare_barrens","charged_vaults","stormsurge_coast"] },
{ "item_type": "wheat_purple", "job": "FARMER",    "tier": 9,  "protector": "protector_arcanize_bricheton","rare_item_type": "", "biomes": ["static_plains","hoarfrost_steppe"] }
```

Dungeon: unchanged (`charged_vault_key`).

## Structures — have / want

| biome              | reuse today                                                     | want                                              |
| ------------------ | --------------------------------------------------------------- | ------------------------------------------------- |
| `static_plains`    | `grassland_trees` very sparse + `grassland_rocks` — **covered** | —                                                 |
| `hoarfrost_steppe` | `taiga_trees` sparse + `arctic_rocks` — **covered**             | —                                                 |
| `flare_barrens`    | `scorched_rocks` — **covered**                                  | —                                                 |
| `stormsurge_coast` | —                                                               | shingle banks, groynes                            |
| `widow_pylons`     | —                                                               | tall thin pylons in groups                        |
| `charged_vaults`   | —                                                               | **a row of thick-walled storehouses on a plinth** |

The cheapest world in the second half of the game: three biomes ship, two want rocks, and the
only building is one repeated storehouse. Everything else is weather.
