# 20 — Zenith Scar

> Entry level 170 · mobs level 170–200 · dungeon key `wound_key` · sea level 50 · no gatherables

The last world is a wound in the world being closed by hand. A borer, a leech, a chanter, a
**suture priest**, a **first ward**, a **wall fragment**, a **last guardian** — half the roster is
repairing something and the other half is making it worse. The pilgrims walking the road toward
it are already husks.

Everything here is at the top of its ladder: level 170 to 200, the final dungeon, the last
guardian. The world should feel **finished and broken at once** — a wall built to hold something,
now in pieces at 383 blocks, and the scar itself running below it with people kneeling along the
seam.

No trees. No gatherables. Five biomes across nine slots, and nothing in it is alive in the
ordinary sense.

## The roster

| mob                | lvl           | what the icon shows      | where it belongs  |
| ------------------ | ------------- | ------------------------ | ----------------- |
| `zs_scarborer`     | 170–179       | wooden box, blue eyes    | the wound         |
| `zs_pilgrim_husk`  | 171–180       | gold skeleton walking    | the road          |
| `zs_wound_leech`   | 172–181       | crate parasite           | the wound         |
| `zs_rift_toad`     | 174–183       | blue toad on ice         | the glimmer flats |
| `zs_scar_chanter`  | 176–185       | purple skeleton          | the suture line   |
| `zs_glimmer_shade` | 178–187       | ice-crystal shade        | the glimmer flats |
| `zs_scarhound`     | 180–189       | dark green wolf          | the road          |
| `zs_suture_priest` | 182–191       | pale skeleton            | the suture line   |
| `zs_wall_fragment` | 184–193       | gold-green golem         | the wall          |
| `zs_deep_auditor`  | 186–195       | floating torso and hands | the glimmer flats |
| `zs_scarbound`     | 178–186 archi | floating torso and hands | the suture line   |
| `zs_first_ward`    | 190–197 archi | green-white ram          | the wall          |
| `zs_wound_oracle`  | 192–198 archi | dark spider              | the wound         |
| `zs_guardian`      | 196–200 boss  | rock guardian            | **dungeon only**  |

## The five biomes

|               | humidity **low** | humidity **mid** | humidity **high** |
| ------------- | ---------------- | ---------------- | ----------------- |
| **temp low**  | `wall_fragments` | `wall_fragments` | `glimmer_flats`   |
| **temp mid**  | `pilgrim_road`   | `the_wound`      | `the_wound`       |
| **temp high** | `pilgrim_road`   | `suture_line`    | `suture_line`     |

---

### 1. `the_wound` — mid_mid **and** mid_high

The scar itself, cut through the world: a canyon whose walls are raw and whose floor is 100
blocks below the rim. **The world's default ground, and it is a hole.**

- **Mobs**: `zs_wound_leech`, `zs_scarborer`, `zs_wound_oracle`
- **Profile**: inverted, 37 → 205. **A player entering this world drops into it**, which is the
  right last impression.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 202 | gravel / scar_stone / deep_stone     |      |
| 0.12 | 161 |                                      |      |
| 0.22 | 108 |                                      |      |
| 0.32 | 64  | raw_scar / scar_stone / deep_stone   | 0.04 |
| 0.46 | 37  |                                      |      |
| 0.58 | 50  |                                      |      |
| 0.70 | 97  | gravel / scar_stone / deep_stone     | 0.03 |
| 0.84 | 155 |                                      |      |
| 1    | 205 |                                      |      |

- **Structures**: rock-pack **collapse blocks** on the floor, and nothing on the walls — the walls
  are the wound and should be bare.

### 2. `suture_line` — high_mid **and** high_high

Where it is being closed. Ridges of new stone run in parallel rows across the scar like stitches,
and the priests work along them.

- **Mobs**: `zs_suture_priest`, `zs_scar_chanter`, `zs_scarbound`
- **Profile**: 57 → 165 in **regular alternating ridges** — the only rhythmic curve in the study,
  because a stitch line is regular and nothing else in this world is.

| x    | y   | land                                 | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 57  | raw_scar / scar_stone / deep_stone   |      |
| 0.16 | 81  |                                      |      |
| 0.22 | 101 | scar_stone / scar_stone / deep_stone | 0.03 |
| 0.30 | 138 |                                      |      |
| 0.38 | 108 |                                      |      |
| 0.50 | 148 |                                      |      |
| 0.60 | 114 |                                      |      |
| 0.72 | 158 |                                      |      |
| 0.84 | 121 |                                      |      |
| 1    | 165 |                                      |      |

- **Structures**: wants **a line of small identical shrines**, one per ridge, all facing the same
  way. Repetition is the design — a hundred of one tiny build beats one large one here.

### 3. `pilgrim_road` — mid_low **and** high_low

The road in. Bone grit packed hard by a very long queue of people who are still walking it.

- **Mobs**: `zs_pilgrim_husk`, `zs_scarhound`
- **Profile**: 54 → 155, an ordinary rising road — deliberately the most normal terrain in the
  world, so that arriving at the wound lands.

| x    | y   | land                           | var  |
| ---- | --- | ------------------------------ | ---- |
| 0    | 54  | gravel / dirt / limestone      |      |
| 0.18 | 77  |                                |      |
| 0.24 | 97  | bone_grit / gravel / limestone | 0.03 |
| 0.36 | 111 |                                |      |
| 0.48 | 104 |                                |      |
| 0.62 | 128 |                                |      |
| 0.76 | 118 |                                |      |
| 0.90 | 144 |                                |      |
| 1    | 155 |                                |      |

- **Structures**: wants **waymarkers** — one small repeated stone every so often along the whole
  biome, and a gate where the road reaches the rim.

### 4. `wall_fragments` — low_low **and** low_mid

What is left of the wall that was supposed to hold this. Pieces of it standing 336 blocks high
with nothing between them.

- **Mobs**: `zs_wall_fragment`, `zs_first_ward`
- **Profile**: **the world's roof, 383**. The 0.18→0.20 run is a 121-block face of built stone.

| x    | y   | land                            | var  |
| ---- | --- | ------------------------------- | ---- |
| 0    | 64  | gravel / stone / deep_stone     |      |
| 0.14 | 121 |                                 |      |
| 0.18 | 168 | stone / gravel / deep_stone     | 0.02 |
| 0.20 | 289 |                                 |      |
| 0.28 | 309 | gold_stone / stone / deep_stone | 0.03 |
| 0.42 | 296 |                                 |      |
| 0.56 | 343 |                                 |      |
| 0.70 | 319 |                                 |      |
| 0.84 | 366 |                                 |      |
| 1    | 383 |                                 |      |

- **Structures**: rock-pack **squared blocks** — the pieces must read as _cut_, not as cliffs, or
  the whole idea fails. This is the one place where a rock pack's regularity is the feature.

### 5. `glimmer_flats` — low_high

Cold shallow water on the far side of the scar, freezing at the edges, throwing light that does
not come from the sky.

- **Mobs**: `zs_glimmer_shade`, `zs_rift_toad`, `zs_deep_auditor`
- **Profile**: 27 → 64, breathing across sea level 50 — the last water in the game.

| x    | y   | land                     | var  |
| ---- | --- | ------------------------ | ---- |
| 0    | 27  | clay / clay / deep_stone |      |
| 0.24 | 44  |                          |      |
| 0.32 | 52  |                          |      |
| 0.38 | 62  | ice / clay / deep_stone  | 0.03 |
| 0.48 | 49  |                          |      |
| 0.58 | 59  |                          |      |
| 0.70 | 45  |                          |      |
| 0.82 | 60  |                          |      |
| 0.92 | 50  |                          |      |
| 1    | 64  |                          |      |

- **Structures**: **crystal shards**, small and low, standing in the shallows.

---

## Materials

| name         | color     | preset | used by                              |
| ------------ | --------- | ------ | ------------------------------------ |
| `scar_stone` | `#6b5a5f` | stone  | the wound's walls, the suture ridges |
| `stone`      | `#707777` | stone  | the wall                             |
| `gold_stone` | `#b99a4c` | stone  | the wall's facing                    |
| `limestone`  | `#958d75` | stone  | the road                             |
| `deep_stone` | `#465258` | stone  | filler                               |
| `gravel`     | `#766f61` | stone  | road, rim, collapse                  |
| `raw_scar`   | `#7a3f3f` | earth  | the open wound and the new stitching |
| `clay`       | `#76514b` | earth  | the flats                            |
| `dirt`       | `#654d36` | earth  | the road                             |
| `bone_grit`  | `#d9cfb4` | sand   | the road surface                     |
| `ice`        | `#74ccf4` | ice    | the flats' margin                    |
| `water`      | `#2e609e` | water  | the glimmer flats only               |

**No wood, no foliage, no gatherables.** The last world grows nothing.

## Mob rows

```json
{ "mob_type": "zs_scarborer",      "weight_bp": 8000, "biomes": ["the_wound"] },
{ "mob_type": "zs_wound_leech",    "weight_bp": 8000, "biomes": ["the_wound"] },
{ "mob_type": "zs_pilgrim_husk",   "weight_bp": 8000, "biomes": ["pilgrim_road"] },
{ "mob_type": "zs_rift_toad",      "weight_bp": 8000, "biomes": ["glimmer_flats"] },
{ "mob_type": "zs_scar_chanter",   "weight_bp": 8000, "biomes": ["suture_line"] },
{ "mob_type": "zs_glimmer_shade",  "weight_bp": 8000, "biomes": ["glimmer_flats"] },
{ "mob_type": "zs_suture_priest",  "weight_bp": 8000, "biomes": ["suture_line"] },
{ "mob_type": "zs_wall_fragment",  "weight_bp": 8000, "biomes": ["wall_fragments"] },
{ "mob_type": "zs_deep_auditor",   "weight_bp": 8000, "biomes": ["glimmer_flats"] },
{ "mob_type": "zs_scarhound",      "weight_bp": 8000, "biomes": ["pilgrim_road","the_wound"] },
{ "mob_type": "zs_first_ward",     "weight_bp": 8000, "biomes": ["wall_fragments"] },
{ "mob_type": "zs_wound_oracle",   "weight_bp": 8000, "biomes": ["the_wound"] },
{ "mob_type": "zs_scarbound",      "weight_bp": 8000, "biomes": ["suture_line"] }
```

Resources: **none**. Dungeon: unchanged (`wound_key`).

## Structures — have / want

| biome            | reuse today | want                                                                          |
| ---------------- | ----------- | ----------------------------------------------------------------------------- |
| `the_wound`      | —           | collapse blocks on the floor, bare walls                                      |
| `wall_fragments` | —           | **squared cut blocks — they must read as built, not as cliffs**               |
| `glimmer_flats`  | —           | small low crystal shards                                                      |
| `pilgrim_road`   | —           | **waymarkers, and one gate where the road meets the rim**                     |
| `suture_line`    | —           | **a line of identical small shrines, one per ridge, all facing the same way** |

The last world wants the _smallest_ builds in the game and the most of them. A hundred copies of
one waymarker and one shrine, laid in lines across a wound, will say more than any single
monument — and it is the cheapest ask in the study.
