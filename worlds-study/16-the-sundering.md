# 16 — The Sundering

> Entry level 95 · mobs level 100–125 · dungeon key `hades_key` · sea level 35 · no gatherables

The world tore here and did not close. Nine mobs, all of them **administrative**: a gate watcher,
a gatekeeper, a soul auditor, a rift matriarch, an ash prophet. Nobody in this world is wild —
they are all doing a job at a door that should not exist.

Two decisions define it. **There is no wood** — not one tree pack, not one `_foliage` material,
which is unique in the game and should be felt immediately. And **sea level drops to 35**, so
water is almost absent; the low ground is dry cut rock instead of ocean.

Five biomes across the nine slots. A nine-mob world that pretends to have nine places is a nine-mob
world with nothing in any of them.

## The roster

| mob                 | lvl           | what the icon shows                | where it belongs |
| ------------------- | ------------- | ---------------------------------- | ---------------- |
| `ts_gate_watcher`   | 100–108       | tentacled thing with one green eye | the gate         |
| `ts_ash_prophet`    | 102–110       | pale ogre preaching                | the ash          |
| `ts_hadean_hound`   | 106–114       | golden wolf                        | the hot runs     |
| `ts_void_harrier`   | 108–116       | tattered dark vulture              | shards and runs  |
| `ts_pyre_colossus`  | 110–118       | magma golem                        | ash and runs     |
| `ts_soul_auditor`   | 112–120       | floating torso and hands           | the ledgers      |
| `ts_gatekeeper`     | 114–121 archi | black armoured thing               | the gate         |
| `ts_rift_matriarch` | 116–123 archi | scarak on ice                      | the shards       |
| `ts_riftmaw`        | 104–111 archi | tentacled devourer                 | the shards       |
| `ts_voiddragon`     | 121–125 boss  | purple dragon                      | **dungeon only** |

## The five biomes

|               | humidity **low** | humidity **mid** | humidity **high** |
| ------------- | ---------------- | ---------------- | ----------------- |
| **temp low**  | `rift_shards`    | `rift_shards`    | `soul_ledgers`    |
| **temp mid**  | `rift_shards`    | `hadean_gate`    | `soul_ledgers`    |
| **temp high** | `ash_prophecy`   | `ash_prophecy`   | `hound_runs`      |

`rift_shards` takes three slots — the broken country is most of the world, and the gate is a
single point at the middle of it.

---

### 1. `hadean_gate` — mid_mid

A level approach terrace, and then the gate. Nothing else. **The world's default ground, and the
flattest thing in it, because everything about the approach should be about what is at the end
of it.**

- **Mobs**: `ts_gate_watcher`, `ts_gatekeeper`
- **Profile**: 31 → 101, deliberately dull.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 31  | blackstone / deep_stone / deep_stone |      |
| 0.20 | 59  |                                      |      |
| 0.28 | 77  | slag / blackstone / deep_stone       | 0.03 |
| 0.40 | 84  |                                      |      |
| 0.50 | 80  |                                      |      |
| 0.62 | 91  |                                      |      |
| 0.74 | 87  |                                      |      |
| 0.86 | 97  |                                      |      |
| 1    | 101 |                                      |      |

- **Structures**: wants **one enormous black gate**, and nothing else in the biome. A torii scaled
  past anything else in the game, standing alone on a flat plain, is the whole world in one image.

### 2. `rift_shards` — low_low, low_mid **and** mid_low

Slabs of the world standing on edge where it tore. The ground goes from 40 to 220 and back inside
a few hundred blocks, over and over.

- **Mobs**: `ts_rift_matriarch`, `ts_riftmaw`, `ts_void_harrier`
- **Profile**: **the most violent curve in the study** — every pair of knots is a wall. Roof 383.

| x    | y   | land                                     | var  |
| ---- | --- | ---------------------------------------- | ---- |
| 0    | 42  | blackstone / deep_stone / deep_stone     |      |
| 0.12 | 122 |                                          |      |
| 0.18 | 70  |                                          |      |
| 0.26 | 226 | obsidian_glass / blackstone / deep_stone | 0.03 |
| 0.34 | 97  |                                          |      |
| 0.44 | 292 |                                          |      |
| 0.52 | 125 |                                          |      |
| 0.62 | 341 |                                          |      |
| 0.72 | 139 |                                          |      |
| 0.84 | 383 |                                          |      |
| 1    | 167 |                                          |      |

- **Structures**: rock-pack **slabs and shards** at maximum size, tilted. The terrain does most of
  it; the pack only has to break the silhouette.

### 3. `soul_ledgers` — low_high **and** mid_high

Cut terraces, each one level to the block, where the auditors count. The only ordered ground in a
world that came apart.

- **Mobs**: `ts_soul_auditor`, `ts_gate_watcher`
- **Profile**: tread and riser, 35 → 181. **Every flat run is deliberate** — the contrast with the
  shards is the point.

| x    | y   | land                           | var  |
| ---- | --- | ------------------------------ | ---- |
| 0    | 35  | slag / blackstone / deep_stone |      |
| 0.18 | 59  |                                |      |
| 0.24 | 80  | stone / slag / deep_stone      | 0.03 |
| 0.34 | 87  |                                |      |
| 0.40 | 111 |                                |      |
| 0.54 | 118 |                                |      |
| 0.60 | 143 |                                |      |
| 0.74 | 150 |                                |      |
| 0.86 | 174 |                                |      |
| 1    | 181 |                                |      |

- **Structures**: wants **a long low hall on the widest terrace** — one building, repeated at a
  few scales down the steps.

### 4. `ash_prophecy` — high_low **and** high_mid

Grey level ash where the prophet preaches to the colossus. Nothing grows, nothing moves except
them.

- **Mobs**: `ts_ash_prophet`, `ts_pyre_colossus`
- **Profile**: near-flat, 38 → 80.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 38  | ash / cinder / blackstone |      |
| 0.22 | 59  |                           |      |
| 0.34 | 70  | cinder / ash / blackstone | 0.03 |
| 0.50 | 73  |                           |      |
| 0.66 | 66  |                           |      |
| 0.82 | 80  |                           |      |
| 1    | 77  |                           |      |

- **Structures**: `scorched_rocks` + `scorched_ruins` — **covered today**.

### 5. `hound_runs` — high_high

Hot broken ground where the hounds work. Warmer, rougher, and the only biome with any pace to it.

- **Mobs**: `ts_hadean_hound`, `ts_pyre_colossus`, `ts_void_harrier`
- **Profile**: 42 → 157.

| x    | y   | land                             | var  |
| ---- | --- | -------------------------------- | ---- |
| 0    | 42  | cinder / ash / blackstone        |      |
| 0.18 | 66  |                                  |      |
| 0.24 | 87  | blackstone / cinder / deep_stone | 0.03 |
| 0.36 | 108 |                                  |      |
| 0.48 | 94  |                                  |      |
| 0.62 | 125 |                                  |      |
| 0.76 | 111 |                                  |      |
| 0.90 | 146 |                                  |      |
| 1    | 157 |                                  |      |

- **Structures**: `scorched_rocks` — **covered today**.

---

## Materials

| name             | color     | preset | used by                       |
| ---------------- | --------- | ------ | ----------------------------- |
| `blackstone`     | `#373737` | stone  | the world's rock              |
| `deep_stone`     | `#465258` | stone  | filler                        |
| `stone`          | `#707777` | stone  | the ledger terraces           |
| `slag`           | `#4a4340` | stone  | gate approach, ledgers        |
| `obsidian_glass` | `#2a2130` | stone  | the shard faces               |
| `ash`            | `#55504a` | earth  | the prophecy plain            |
| `cinder`         | `#3a3330` | earth  | crust everywhere hot          |
| `water`          | `#2e220e` | water  | almost nowhere — sea level 35 |

**No wood, no foliage.** The first world in the game with no tree material at all.

## Mob rows

```json
{ "mob_type": "ts_gate_watcher",   "weight_bp": 8000, "biomes": ["hadean_gate","soul_ledgers"] },
{ "mob_type": "ts_ash_prophet",    "weight_bp": 8000, "biomes": ["ash_prophecy"] },
{ "mob_type": "ts_hadean_hound",   "weight_bp": 8000, "biomes": ["hound_runs"] },
{ "mob_type": "ts_void_harrier",   "weight_bp": 8000, "biomes": ["rift_shards","hound_runs"] },
{ "mob_type": "ts_pyre_colossus",  "weight_bp": 8000, "biomes": ["ash_prophecy","hound_runs"] },
{ "mob_type": "ts_soul_auditor",   "weight_bp": 8000, "biomes": ["soul_ledgers"] },
{ "mob_type": "ts_gatekeeper",     "weight_bp": 8000, "biomes": ["hadean_gate"] },
{ "mob_type": "ts_rift_matriarch", "weight_bp": 8000, "biomes": ["rift_shards"] },
{ "mob_type": "ts_riftmaw",        "weight_bp": 8000, "biomes": ["rift_shards"] }
```

Resources: **none**. Dungeon: unchanged (`hades_key`).

## Structures — have / want

| biome          | reuse today                                       | want                                               |
| -------------- | ------------------------------------------------- | -------------------------------------------------- |
| `ash_prophecy` | `scorched_rocks` + `scorched_ruins` — **covered** | —                                                  |
| `hound_runs`   | `scorched_rocks` — **covered**                    | —                                                  |
| `rift_shards`  | —                                                 | tilted slabs and shards, maximum size              |
| `soul_ledgers` | —                                                 | one long low hall, repeated down the steps         |
| `hadean_gate`  | —                                                 | **one enormous black gate, alone on a flat plain** |
