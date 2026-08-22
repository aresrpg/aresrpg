# 17 — Obsidian Choir

> Entry level 110 · mobs level 110–145 · dungeon key `velkarion_key` · sea level 61 · no gatherables

A cathedral made by a volcano. Eight of the thirteen mobs are **undead in holy orders** — an
acolyte, a chant leader, a pyre tender, a choir sentinel, a choirmaster, an ashsinger, an
apostate — and the two that are not are a glass dog and a lava hound. Something is being sung
here continuously and has been for a long time.

The world's one idea is **sound made solid**: obsidian flows that ring, a nave of glass columns,
and one quarter where the singing has gone wrong. Colour is nearly absent — black glass, ash,
and the orange of the flows — which makes the crystal-and-rock pack the only dressing it needs.

Five biomes across nine slots.

## The roster

| mob                  | lvl           | what the icon shows     | where it belongs     |
| -------------------- | ------------- | ----------------------- | -------------------- |
| `oc_glasskin`        | 110–118       | purple glass dog        | the flows            |
| `oc_cinder_acolyte`  | 112–120       | brown skeleton          | the tenders' walk    |
| `oc_basalt_shambler` | 114–122       | flat green-gold crawler | flows and dissonance |
| `oc_pyre_moth`       | 116–124       | pale blue flier         | the kennels          |
| `oc_chant_leader`    | 118–126       | pale ogre, leading      | the nave             |
| `oc_obsidian_wisp`   | 120–128       | red-blue glass golem    | the flows            |
| `oc_pyre_tender`     | 124–132       | brown skeleton          | the walk             |
| `oc_choir_sentinel`  | 126–134       | dark wolf, orange eyes  | the nave             |
| `oc_lava_hound`      | 128–136       | red dragon-wolf         | the kennels          |
| `oc_dissonant`       | 130–138       | brown rat               | the dissonance       |
| `oc_choirmaster`     | 134–141 archi | brown skeleton          | the nave             |
| `oc_ashsinger`       | 136–143 archi | burnt singing figure    | the walk             |
| `oc_apostate`        | 120–128 archi | brown skeleton          | the dissonance       |
| `oc_velkarion`       | 141–145 boss  | dark demon              | **dungeon only**     |

## The five biomes

|               | humidity **low**    | humidity **mid**    | humidity **high** |
| ------------- | ------------------- | ------------------- | ----------------- |
| **temp low**  | `glasskin_flows`    | `dissonance`        | `dissonance`      |
| **temp mid**  | `glasskin_flows`    | `choir_nave`        | `dissonance`      |
| **temp high** | `pyre_tenders_walk` | `pyre_tenders_walk` | `lava_kennels`    |

---

### 1. `choir_nave` — mid_mid

A floor of black glass between columns of it, level and enormous. **The world's default ground.**
The columns are terrain, not structures: the spline puts them there.

- **Mobs**: `oc_choirmaster`, `oc_choir_sentinel`, `oc_chant_leader`
- **Profile**: a flat floor with sudden 153-block columns — the 0.3/0.5/0.7 spikes are the pillars.

| x    | y   | land (surface / subsurface / filler)         | var  |
| ---- | --- | -------------------------------------------- | ---- |
| 0    | 56  | obsidian_glass / blackstone / deep_stone     |      |
| 0.16 | 102 |                                              |      |
| 0.22 | 123 | obsidian_glass / obsidian_glass / deep_stone | 0.02 |
| 0.30 | 276 |                                              |      |
| 0.38 | 133 |                                              |      |
| 0.50 | 296 |                                              |      |
| 0.58 | 138 |                                              |      |
| 0.70 | 317 |                                              |      |
| 0.80 | 143 |                                              |      |
| 1    | 153 |                                              |      |

- **Structures**: wants **a raised choir platform and one seat**, small against the columns. The
  terrain is the cathedral; the build is only the furniture.

### 2. `glasskin_flows` — low_low **and** mid_low

Sheets of cooled flow, ropey and smooth, ringing underfoot. The glass animals live on them
because nothing else can keep its footing.

- **Mobs**: `oc_glasskin`, `oc_obsidian_wisp`, `oc_basalt_shambler`
- **Profile**: long smooth lobes, 51 → 245 — the gentlest curve in the world, on purpose.

| x    | y   | land                                     | var  |
| ---- | --- | ---------------------------------------- | ---- |
| 0    | 51  | obsidian_glass / blackstone / deep_stone |      |
| 0.18 | 87  |                                          |      |
| 0.26 | 117 | basalt / blackstone / deep_stone         | 0.03 |
| 0.38 | 148 |                                          |      |
| 0.50 | 133 |                                          |      |
| 0.64 | 179 |                                          |      |
| 0.78 | 163 |                                          |      |
| 0.90 | 225 |                                          |      |
| 1    | 245 |                                          |      |

- **Structures**: rock-pack **flow lobes and pressure ridges**, low and wide.

### 3. `pyre_tenders_walk` — high_low **and** high_mid

A raised causeway between fire pits, walked by the tenders in one direction forever.

- **Mobs**: `oc_pyre_tender`, `oc_cinder_acolyte`, `oc_ashsinger`
- **Profile**: a level walk at 153–179 with the pits cut either side of it — the dips at 0.36 and
  0.62 are the fires.

| x    | y   | land                      | var  |
| ---- | --- | ------------------------- | ---- |
| 0    | 61  | ash / cinder / blackstone |      |
| 0.18 | 112 |                           |      |
| 0.26 | 158 | cinder / ash / blackstone | 0.03 |
| 0.36 | 102 |                           |      |
| 0.46 | 169 |                           |      |
| 0.62 | 97  |                           |      |
| 0.74 | 174 |                           |      |
| 0.88 | 112 |                           |      |
| 1    | 179 |                           |      |

- **Structures**: `scorched_rocks` + `scorched_ruins` — **covered today**; the altar stub is
  exactly a fire pit's furniture.

### 4. `lava_kennels` — high_high

Where the hounds are kept: a bowl of hot rock with cells burned into the walls.

- **Mobs**: `oc_lava_hound`, `oc_pyre_moth`
- **Profile**: inverted — rim 235, floor 77.

| x    | y   | land                             | var  |
| ---- | --- | -------------------------------- | ---- |
| 0    | 235 | cinder / ash / blackstone        |      |
| 0.14 | 194 |                                  |      |
| 0.24 | 143 |                                  |      |
| 0.36 | 102 | blackstone / cinder / deep_stone | 0.03 |
| 0.50 | 77  |                                  |      |
| 0.62 | 97  |                                  |      |
| 0.74 | 148 | cinder / ash / blackstone        | 0.03 |
| 0.88 | 199 |                                  |      |
| 1    | 240 |                                  |      |

- **Structures**: `scorched_rocks` — **covered today**.

### 5. `dissonance` — low_mid, low_high **and** mid_high

The quarter where the singing went wrong. The glass here did not cool flat: it froze mid-note,
in spikes and broken angles that read as noise after the nave's order.

- **Mobs**: `oc_dissonant`, `oc_apostate`, `oc_basalt_shambler`
- **Profile**: **deliberately ugly** — the only curve in the study designed to be unpleasant to
  cross. Roof 150.

| x    | y   | land                                 | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 66  | basalt / blackstone / deep_stone     |      |
| 0.10 | 163 |                                      |      |
| 0.16 | 97  |                                      |      |
| 0.24 | 245 | obsidian_glass / basalt / deep_stone | 0.04 |
| 0.32 | 112 |                                      |      |
| 0.42 | 301 |                                      |      |
| 0.52 | 128 |                                      |      |
| 0.64 | 347 |                                      |      |
| 0.74 | 117 |                                      |      |
| 0.86 | 383 |                                      |      |
| 1    | 158 |                                      |      |

- **Structures**: **crystal shards**, black and violet, tilted at every angle. The crystal pack's
  fourth and final use in the game, and the only one that should look wrong.

---

## Materials

| name             | color     | preset | used by                       |
| ---------------- | --------- | ------ | ----------------------------- |
| `obsidian_glass` | `#2a2130` | stone  | nave, flows, dissonance       |
| `basalt`         | `#3d3d42` | stone  | flows, dissonance             |
| `blackstone`     | `#373737` | stone  | under everything              |
| `deep_stone`     | `#465258` | stone  | filler                        |
| `ash`            | `#55504a` | earth  | the walk, the kennels         |
| `cinder`         | `#3a3330` | earth  | crust                         |
| `water`          | `#2e150e` | water  | almost nowhere — sea level 61 |

**No wood, no foliage** — the second world in a row with nothing that grows.

## Mob rows

```json
{ "mob_type": "oc_glasskin",         "weight_bp": 8000, "biomes": ["glasskin_flows"] },
{ "mob_type": "oc_cinder_acolyte",   "weight_bp": 8000, "biomes": ["pyre_tenders_walk"] },
{ "mob_type": "oc_basalt_shambler",  "weight_bp": 8000, "biomes": ["glasskin_flows","dissonance"] },
{ "mob_type": "oc_pyre_moth",        "weight_bp": 8000, "biomes": ["lava_kennels"] },
{ "mob_type": "oc_chant_leader",     "weight_bp": 8000, "biomes": ["choir_nave"] },
{ "mob_type": "oc_obsidian_wisp",    "weight_bp": 8000, "biomes": ["glasskin_flows"] },
{ "mob_type": "oc_pyre_tender",      "weight_bp": 8000, "biomes": ["pyre_tenders_walk"] },
{ "mob_type": "oc_choir_sentinel",   "weight_bp": 8000, "biomes": ["choir_nave"] },
{ "mob_type": "oc_lava_hound",       "weight_bp": 8000, "biomes": ["lava_kennels"] },
{ "mob_type": "oc_dissonant",        "weight_bp": 8000, "biomes": ["dissonance"] },
{ "mob_type": "oc_choirmaster",      "weight_bp": 8000, "biomes": ["choir_nave"] },
{ "mob_type": "oc_ashsinger",        "weight_bp": 8000, "biomes": ["pyre_tenders_walk"] },
{ "mob_type": "oc_apostate",         "weight_bp": 8000, "biomes": ["dissonance"] }
```

Resources: **none**. Dungeon: unchanged (`velkarion_key`).

## Structures — have / want

| biome               | reuse today                                       | want                                   |
| ------------------- | ------------------------------------------------- | -------------------------------------- |
| `pyre_tenders_walk` | `scorched_rocks` + `scorched_ruins` — **covered** | —                                      |
| `lava_kennels`      | `scorched_rocks` — **covered**                    | —                                      |
| `glasskin_flows`    | —                                                 | flow lobes, pressure ridges            |
| `dissonance`        | —                                                 | black and violet crystal, tilted wrong |
| `choir_nave`        | —                                                 | a raised choir platform and one seat   |
