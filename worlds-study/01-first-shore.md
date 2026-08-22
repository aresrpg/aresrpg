# 01 — The First Shore

> Entry level 1 · mobs level 1–12 · dungeon key `sounding_hull_key` · sea level 180

**The world today is wrong.** It ships the engine's nine generic test biomes — `taiga`,
`glacier`, `arctic`, `grassland`, `temperate`, `swamp`, `scorched`, `desert`, `tropical` — with
peaks at **y 358** and every one of its 13 mobs listed in all nine. A world called _The First
Shore_, where a level-1 player meets a baby sheep, has a glacier and a mountain three hundred
blocks tall. That is the whole reason for this pass.

**What it should be.** A castaway coast: you wash up on a strand full of broken hulls, the land
behind it is low, green and grazed, and the only height in the world is a chalk headland you can
see the sea from. Nothing here is above **y 383**.

## The roster (unchanged — this is fixed truth)

| mob                     | lvl        | what the icon shows  | the habitat it asks for                 |
| ----------------------- | ---------- | -------------------- | --------------------------------------- |
| `wooling`               | 1–5        | white baby sheep     | cropped turf, grazing                   |
| `razkin`                | 1–3        | grey rat, pink ears  | a made place gone bad — wrecks, middens |
| `alley_bunny`           | 1–6        | grey/white rabbit    | burrow country: dune slack, hedgerow    |
| `green_walker`          | 2–9        | green drowned corpse | where the sea leaves the dead           |
| `runt_piglet`           | 2–5        | small brown boar     | woodland floor, rooting                 |
| `razmo`                 | 3–7        | black rat, red eyes  | bilges, cellars, marsh middens          |
| `piglet`                | 3–7        | boar                 | woodland floor                          |
| `bonelet`               | 5–10       | small skeleton       | bones — strand, barrow, chalk           |
| `ditch_koaletin`        | 5–10       | blue toad            | standing water at the surface           |
| `sparrowdart`           | 6–12       | small brown owl      | perches: wood edge, cliff               |
| `grainfox`              | 7–10       | orange fox           | field edges, dune scrub                 |
| `pecker_the_widow`      | 5–7 archi  | pink hen             | a farmyard                              |
| `razmo_the_plague_king` | 8–12 archi | huge golden rat      | the deepest wreck                       |
| `captain_wrackbone`     | 8–12 boss  | skeleton pirate      | **dungeon only** — the sounding hull    |
| `goldhen_matilda`       | 8–11       | golden hen           | **dungeon only**                        |

The dungeon key is `sounding_hull_key`: the dungeon **is** a wrecked ship. The overworld should
show you that wreck's siblings long before you hold the key.

## The nine biomes

Temperature runs cool/exposed → warm/settled; humidity runs dry sand → open water. Every name is
still a shore.

|               | humidity **low** | humidity **mid**    | humidity **high** |
| ------------- | ---------------- | ------------------- | ----------------- |
| **temp low**  | `chalk_headland` | `driftwood_thicket` | `brackmarsh`      |
| **temp mid**  | `marram_dunes`   | `shore_plains`      | `tide_flats`      |
| **temp high** | `wreck_strand`   | `fallow_croft`      | `salt_lagoon`     |

`shore_plains` sits dead centre, so it is the biome a new character is most likely to be
standing in — which is exactly where the woolings are.

---

### 1. `shore_plains` — mid_mid

Green rolling plain a stone's throw from the water. Cropped turf, hawthorn scrub, sheep. **The
starter biome.**

- **Mobs**: `wooling`, `alley_bunny`, `runt_piglet`, `sparrowdart`, `grainfox`
- **Resources**: `wheat` (FARMER), `green_mushroom` (HERBALIST)
- **Height**: 138 → 257. Beach at 186, turf line at 197, gentle rolls after.

| x    | y   | land (surface / subsurface / filler) | var  |
| ---- | --- | ------------------------------------ | ---- |
| 0    | 138 | wet_sand / sand / limestone          |      |
| 0.18 | 174 |                                      |      |
| 0.22 | 186 | sand / sand / limestone              | 0.03 |
| 0.30 | 197 | grass / dirt / limestone             | 0.03 |
| 0.45 | 215 |                                      |      |
| 0.58 | 203 |                                      |      |
| 0.72 | 236 |                                      |      |
| 0.86 | 221 |                                      |      |
| 1    | 257 |                                      |      |

- **Structures wanted**
  - `shore_trees` (trees, spacing 10, density 6500) — **wind-bent hawthorn, low coastal oak,
    blackthorn scrub**. Search: _"windswept tree pack"_, _"hawthorn"_, _"coastal oak schematic"_.
    Needs materials `shore_wood`, `shore_foliage`.
  - `shore_rocks` (rocks, spacing 18, density 900) — **mossy erratics, half-buried boulders**.
    Reuse `grassland_rocks` if nothing better turns up.
  - `shore_ruins` (ruins, spacing 320, density 6000) — **a fisherman's hut, drying racks, a low
    dry-stone wall, an upturned rowboat**. Search: _"fishing village schematic"_, _"medieval
    fisherman hut"_, _"dry stone wall pack"_.

### 2. `marram_dunes` — mid_low

Dry sand ridges held together by marram grass, with deep slacks between them. Rabbit country.

- **Mobs**: `wooling`, `alley_bunny`, `grainfox`, `bonelet`
- **Resources**: `quartz` (MINER)
- **Height**: 132 → 287, alternating ridge/slack — the spline itself makes the dune field.

| x    | y   | land                           | var  |
| ---- | --- | ------------------------------ | ---- |
| 0    | 132 | wet_sand / sand / limestone    |      |
| 0.16 | 171 |                                |      |
| 0.20 | 183 | sand / sand / limestone        | 0.04 |
| 0.30 | 221 |                                |      |
| 0.36 | 197 |                                |      |
| 0.46 | 263 | golden_sand / sand / limestone | 0.04 |
| 0.54 | 209 |                                |      |
| 0.66 | 275 |                                |      |
| 0.78 | 215 |                                |      |
| 0.90 | 287 |                                |      |
| 1    | 251 |                                |      |

- **Structures wanted**
  - `dune_rocks` (rocks, spacing 16, density 1400) — **half-buried boulders, bleached driftwood
    logs, fence posts and sand-trap palisades**. Search: _"driftwood"_, _"beach props schematic"_,
    _"dune fence"_.
  - `dune_ruins` (ruins, spacing 320, density 5000) — **a wrecked rowboat, a fallen signal post,
    a buried anchor**. Search: _"shipwreck props"_, _"beach ruins pack"_.
  - No trees. The absence of trees is what makes a dune read as a dune.

### 3. `tide_flats` — mid_high

Flat wet sand the tide walks over. The spline hovers across sea level, so real pools form and
strand between the bars.

- **Mobs**: `ditch_koaletin`, `razkin`, `green_walker`, `bonelet`
- **Resources**: none (the flats are for walking and frogs)
- **Height**: 120 → 192, never far from 180. **Every knot within ±12 of sea level is a pool or a bar.**

| x    | y   | land                              | var  |
| ---- | --- | --------------------------------- | ---- |
| 0    | 120 | wet_sand / clay / limestone       |      |
| 0.22 | 162 |                                   |      |
| 0.32 | 174 |                                   |      |
| 0.38 | 171 |                                   |      |
| 0.46 | 183 | shell_grit / wet_sand / limestone | 0.03 |
| 0.54 | 177 |                                   |      |
| 0.62 | 186 |                                   |      |
| 0.70 | 174 |                                   |      |
| 0.80 | 189 |                                   |      |
| 0.90 | 177 |                                   |      |
| 1    | 192 |                                   |      |

- **Structures wanted**
  - `tide_rocks` (rocks, spacing 12, density 3000, bury 1) — **barnacled rock clumps, kelp-draped
    stones, mussel beds, tidepool rings**. Search: _"rock pack schematic"_ + retexture, _"tidepool"_,
    _"coral rock pack"_. Reuse `tropical_rocks` (it already carries coral) as a stopgap.
  - `tide_ruins` (ruins, spacing 280, density 6000) — **broken jetty pilings, a rotted boardwalk,
    fish traps, a stranded crab pot**. Search: _"dock schematic"_, _"pier ruins"_, _"jetty"_.

### 4. `wreck_strand` — high_low

The strand where the sea sends its wrecks. Bleached sand over gravel, ribs of hulls in the sand,
rats and the walking drowned. **The world's signature biome, and the dungeon's overworld echo.**

- **Mobs**: `razkin`, `razmo`, `green_walker`, `bonelet`, `razmo_the_plague_king`
- **Resources**: `quartz` (MINER)
- **Height**: 126 → 221. Low and open, so the wrecks are the only skyline.

| x    | y   | land                            | var  |
| ---- | --- | ------------------------------- | ---- |
| 0    | 126 | wet_sand / gravel / limestone   |      |
| 0.20 | 168 |                                 |      |
| 0.26 | 183 | sand / gravel / limestone       | 0.03 |
| 0.40 | 192 |                                 |      |
| 0.50 | 186 |                                 |      |
| 0.62 | 203 | shell_grit / gravel / limestone | 0.03 |
| 0.78 | 197 |                                 |      |
| 0.90 | 215 |                                 |      |
| 1    | 221 |                                 |      |

- **Structures wanted** — this is the pack worth spending real hunting time on.
  - `wreck_ruins` (ruins, spacing 220, density 8000, bury 2) — **beached ship hulls, broken masts
    and ribs, snapped keels, spilled crates and barrels, a capstan, a half-sunk longboat**.
    Search: _"shipwreck schematic pack"_, _"pirate ship wreck"_, _"beached galleon"_, _"broken
    ship hull"_. Buried by 2 so the hulls sit IN the sand instead of on it. Needs `wreck_wood`
    (planks/hull) — dark tarred brown.
  - `wreck_rocks` (rocks, spacing 20, density 1200) — **groynes, mooring stones, ballast piles**.

### 5. `fallow_croft` — high_mid

The farm the castaways found already abandoned: terraced fields going to seed, hedgerows, a barn
with the roof gone. Hens, foxes, pigs, rats — everything domestic that went feral.

- **Mobs**: `wooling`, `razkin`, `alley_bunny`, `razmo`, `piglet`, `grainfox`, `pecker_the_widow`
- **Resources**: `wheat` (FARMER), `green_mushroom` (HERBALIST)
- **Height**: 144 → 275, in flat shelves with step risers — the terraces are in the spline.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 144 | dirt / rich_soil / limestone |      |
| 0.20 | 180 |                              |      |
| 0.24 | 197 | meadow / dirt / limestone    | 0.03 |
| 0.38 | 203 |                              |      |
| 0.44 | 221 |                              |      |
| 0.58 | 224 |                              |      |
| 0.64 | 245 |                              |      |
| 0.80 | 248 |                              |      |
| 0.86 | 269 | grass / dirt / limestone     | 0.03 |
| 1    | 275 |                              |      |

- **Structures wanted**
  - `croft_ruins` (ruins, spacing 260, density 7000) — **a roofless stone barn, a farmhouse
    shell, a well, hay bales, a scarecrow, a broken cart, hedgerow gates**. Search: _"medieval
    farm schematic pack"_, _"abandoned farmhouse"_, _"barn schematic"_, _"village props pack"_.
  - `croft_trees` (trees, spacing 12, density 4000) — **hedgerow trees, apple/pear orchard rows,
    a lone elm**. Search: _"orchard schematic"_, _"fruit tree pack"_, _"hedgerow"_.
    Can share `shore_wood`/`shore_foliage` if the species match; otherwise needs `croft_wood`,
    `croft_foliage`.

### 6. `salt_lagoon` — high_high

A warm, still, shallow lagoon behind the bar, ringed with reed banks. Mostly under water.

- **Mobs**: `ditch_koaletin`, `green_walker`, `razmo`
- **Resources**: `green_mushroom` (HERBALIST)
- **Height**: 114 → 189, only the sandbar and the reed bank break the surface.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 114 | wet_sand / clay / limestone  |      |
| 0.30 | 156 |                              |      |
| 0.42 | 171 |                              |      |
| 0.50 | 186 | sand / clay / limestone      | 0.04 |
| 0.56 | 171 |                              |      |
| 0.68 | 165 |                              |      |
| 0.76 | 183 | saltgrass / peat / limestone | 0.03 |
| 0.88 | 174 |                              |      |
| 1    | 189 |                              |      |

- **Structures wanted**
  - `lagoon_ruins` (ruins, spacing 300, density 6000) — **stilt huts standing in water, fish
    traps, a sunken jetty, drying nets**. Search: _"stilt house schematic"_, _"swamp village"_,
    _"fishing huts pack"_.
  - `lagoon_rocks` (rocks, spacing 22, density 1000, bury 1) — **oyster banks, a shell midden**.

### 7. `brackmarsh` — low_high

The cold side of the same water: peat, black pools, dead trees, and the reeds that grow where
salt meets fresh. Where `razmo` and the drowned share a midden.

- **Mobs**: `green_walker`, `razmo`, `ditch_koaletin`, `bonelet`
- **Resources**: `green_mushroom` (HERBALIST)
- **Height**: 120 → 192. Water table pinned at 180; the land breathes ±12 around it.

| x    | y   | land                         | var  |
| ---- | --- | ---------------------------- | ---- |
| 0    | 120 | peat / clay / limestone      |      |
| 0.20 | 165 |                              |      |
| 0.28 | 177 |                              |      |
| 0.32 | 186 | saltgrass / peat / limestone | 0.03 |
| 0.40 | 177 |                              |      |
| 0.50 | 189 | moss / peat / limestone      | 0.03 |
| 0.60 | 174 |                              |      |
| 0.70 | 186 |                              |      |
| 0.82 | 177 |                              |      |
| 0.92 | 192 |                              |      |
| 1    | 183 |                              |      |

- **Structures wanted**
  - `swamp_trees` — **reuse as-is**, it is already dead-tree-heavy and needs no new material.
  - `marsh_ruins` (ruins, spacing 300, density 6000) — **a sunken boardwalk, eel traps, a
    half-drowned shrine, leaning marker posts**. Search: _"swamp ruins schematic"_,
    _"boardwalk"_, _"bog shrine"_.

### 8. `driftwood_thicket` — low_mid

The wood that survived the wind: leaning trunks all bent one way, a low rise behind the dunes.
Boars root here; the owl hunts here.

- **Mobs**: `runt_piglet`, `piglet`, `sparrowdart`
- **Resources**: `green_mushroom` (HERBALIST)
- **Height**: 138 → 299, one continuous rise — the only wooded ground in the world.

| x    | y   | land                        | var  |
| ---- | --- | --------------------------- | ---- |
| 0    | 138 | wet_sand / sand / limestone |      |
| 0.18 | 177 |                             |      |
| 0.22 | 189 | sand / dirt / limestone     | 0.03 |
| 0.30 | 209 | grass / dirt / stone        | 0.03 |
| 0.44 | 233 |                             |      |
| 0.55 | 221 |                             |      |
| 0.68 | 263 | moss / rich_soil / stone    | 0.03 |
| 0.80 | 251 |                             |      |
| 0.92 | 287 |                             |      |
| 1    | 299 |                             |      |

- **Structures wanted**
  - `driftwood_trees` (trees, spacing 8, density 9500) — **leaning wind-shaped pines and oaks,
    all sheared to one side, plus bare dead trunks**. Search: _"windswept tree pack schematic"_,
    _"leaning trees"_, _"coastal pine"_, _"bonsai/krummholz"_. Needs `driftwood_wood`,
    `driftwood_foliage`. **The single most identity-defining tree pack in this world** — if the
    trees stand up straight, the world stops being a coast.
  - `temperate_rocks` — reuse as-is.

### 9. `chalk_headland` — low_low

The one place with height: a white cliff over the sea, flint in the chalk, cropped turf on top,
old bones underneath. You can see the whole world from it.

- **Mobs**: `wooling`, `bonelet`, `sparrowdart`
- **Resources**: `quartz` (MINER), `wheat` (FARMER — the downland field on the cap)
- **Height**: 132 → **383, the world's roof**. The 0.18→0.20 run is the cliff face: 144 blocks over
  0.02 of the ground field — as steep as the reference glacier wall, and steep enough that the
  slope rule shows filler instead of cover. The face is authored limestone top-to-bottom, and the
  turf cap's edges strip back to dirt then limestone on their own. The white cliff is a
  consequence of the strata, not a decoration.

| x    | y   | land                               | var  |
| ---- | --- | ---------------------------------- | ---- |
| 0    | 132 | gravel / limestone / deep_stone    |      |
| 0.14 | 174 |                                    |      |
| 0.18 | 192 | limestone / limestone / deep_stone | 0.02 |
| 0.20 | 335 |                                    |      |
| 0.26 | 347 | meadow / dirt / limestone          | 0.03 |
| 0.40 | 341 |                                    |      |
| 0.55 | 359 |                                    |      |
| 0.68 | 335 |                                    |      |
| 0.80 | 365 |                                    |      |
| 1    | 383 |                                    |      |

- **Structures wanted**
  - `chalk_rocks` (rocks, spacing 20, density 2000) — **chalk sea stacks, flint nodules, a cairn**.
    Search: _"chalk cliff"_, _"limestone rock pack"_, _"standing stones"_.
  - `chalk_ruins` (ruins, spacing 340, density 6000) — **a ruined lighthouse or beacon tower, a
    cliff-top chapel shell, a barrow mound with a broken lintel**. Search: _"ruined lighthouse
    schematic"_, _"beacon tower"_, _"burial mound"_, _"small chapel ruin"_.

---

## Structures — what exists, what must be found

The catalog today is **168 types in 18 packs**, all of it the legacy dapp's terrain assets
(82 tree + 82 rock schematics, imported at `07f8c7b`) plus 4 procedurally generated ruins
(`temperate_ruined_arch`, `desert_broken_columns`, `scorched_altar`, `swamp_broken_wall`). There
is **no built structure in the game** — no house, no wall, no boat, no tower. Everything is a
tree, a rock, or a 36-block generated stub.

`misc/schematics.zip` adds nothing usable to this world: 8 boulders (Sponge **v3**, which the
importer cannot read — it parses v2 only — plus one unmapped block, `clay`) and 29 of Luna's
palm trees (11 import clean today; 18 fail on `skull` / `player_wall_head` coconuts,
`jungle_trapdoor`, `composter`, `chiseled_quartz_block`). Palms belong to a tropical world —
world 09 or 15 — not to a sheep-and-hedgerow coast.

| biome               | can reuse today                                                                                                     | must be found                                                               |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `brackmarsh`        | **`swamp_trees` + `swamp_ruins` — fully covered**                                                                   | —                                                                           |
| `shore_plains`      | `grassland_trees` (birch g1–4, tree g1–4, big_tree g1–2 — leave the acacias out of the new pack), `grassland_rocks` | fisherman's hut / drying racks / dry-stone wall                             |
| `marram_dunes`      | `desert_rocks` (4 sandy boulders)                                                                                   | wrecked rowboat, sand fences, buried anchor                                 |
| `tide_flats`        | `tropical_rocks` corail g1–6 as barnacle/kelp clumps                                                                | jetty pilings, rotted boardwalk, fish traps                                 |
| `salt_lagoon`       | `tropical_rocks` corail                                                                                             | stilt huts standing in water                                                |
| `driftwood_thicket` | `temperate_thin_tree_g1–6` / `taiga_tree_g1–3` **stand straight** — a placeholder, not the look                     | leaning wind-sheared trees                                                  |
| `chalk_headland`    | `temperate_rocks` as a placeholder                                                                                  | chalk sea stacks + a ruined lighthouse / beacon                             |
| `fallow_croft`      | `grassland` birches as hedgerow                                                                                     | **farmstead: roofless barn, farmhouse shell, well, cart, hay, fence lines** |
| `wreck_strand`      | **nothing**                                                                                                         | **beached ship hulls — the world's whole identity**                         |

### The hunt list, ranked

1. **Shipwrecks** — beached hulls, broken ribs and masts, a snapped keel, spilled crates and
   barrels, a capstan, a half-sunk longboat. Search: _shipwreck schematic pack_, _beached
   galleon_, _pirate ship wreck_, _broken ship hull_. Wants 4–6 variants; placed with `bury: 2`
   so the hulls sit in the sand.
2. **Abandoned farmstead** — roofless stone barn, farmhouse shell, well, broken cart, hay bales,
   gates. Search: _medieval farm schematic pack_, _abandoned farmhouse_, _barn_, _village props_.
3. **Windswept / leaning trees** — every trunk sheared the same way, plus bare dead ones. Search:
   _windswept tree pack_, _leaning trees_, _coastal pine_, _krummholz_. This is the silhouette
   that makes the world read as a coast rather than a field.
4. **Lighthouse or beacon tower + chalk sea stacks** — one ruined tower is enough; it becomes the
   landmark you steer by.
5. **Jetty / pilings / fish traps** — one pack serves `tide_flats` _and_ `salt_lagoon`.
6. **Stilt huts** — `salt_lagoon` only.
7. _(optional)_ coastal scrub trees and barnacled rocks, only if the grassland birches and the
   corail clumps read wrong once they are in the world.

### Constraints for the hunt (these reject packs before you download them)

- **Sponge Schematic `.schem`, version 2 only.** The importer parses v2; v3 files (the boulders
  in `misc/schematics.zip`) throw. `.litematic` and `.nbt` are not read at all. A v3 pack can be
  re-saved as v2 in WorldEdit — it is a re-export, not a rebuild.
- **Colour and detail are lost.** Every block collapses to one of ~12 world materials by a fixed
  rule (logs/planks/fences → `<prefix>_wood`, leaves → `<prefix>_foliage`, stone family → stone,
  wool → stone, terracotta/concrete → red_sand, grass/moss → moss …). Stained glass, banners,
  lanterns, item frames, carpets and signs either vanish or become stone. **Pick packs whose
  SHAPE carries the design**, never packs that rely on their palette.
- **Unmapped blocks throw the import.** Anything outside the rule list (`clay`, `skull`,
  `trapdoor`, `composter`, `chiseled_quartz_block`, doors, stairs-only builds) needs a one-line
  rule added first — cheap, but it must be a deliberate decision, not a surprise.
- **Size**: proven range is up to 43 wide and 63 tall (`swamp_big_tree_g2`, `taiga_huge_sapin_g1`).
  Keep a ruin under ~40×30×40; the structure is clipped per chunk from its halo, so a bigger
  build only costs residency.
- **No entities, no block entities** — a chest is a shape, its contents do not exist.
- **A tree pack forces two materials**: `<prefix>_wood` and `<prefix>_foliage` must be in the
  world palette, where `<prefix>` is the first token of the type's filename.

## Materials

| name                                   | color                 | preset         | used by                                        |
| -------------------------------------- | --------------------- | -------------- | ---------------------------------------------- |
| `stone`                                | `#707777`             | stone          | thicket filler                                 |
| `deep_stone`                           | `#465258`             | stone          | the headland's filler                          |
| `limestone`                            | `#958d75`             | stone          | the chalk — filler under almost everything     |
| `gravel`                               | `#766f61`             | stone          | wreck strand, headland foot                    |
| `dirt`                                 | `#654d36`             | earth          | croft, thicket, headland cap                   |
| `rich_soil`                            | `#493a2d`             | earth          | the croft                                      |
| `clay`                                 | `#76514b`             | earth          | tide flats, lagoon, marsh                      |
| `peat`                                 | `#3b3125`             | earth          | brackmarsh, lagoon reed bank                   |
| `grass`                                | `#668047`             | grass          | shore plains, thicket                          |
| `meadow`                               | `#89984e`             | grass          | croft, headland turf                           |
| `moss`                                 | `#456a4b`             | grass          | marsh, thicket crown                           |
| `saltgrass`                            | `#7e8f5f`             | grass          | marsh and lagoon banks — grey-green, not green |
| `sand`                                 | `#b9a77e`             | sand           | beaches                                        |
| `golden_sand`                          | `#d8b570`             | sand           | the dune crests                                |
| `wet_sand`                             | `#9d896b`             | sand           | every tide line                                |
| `shell_grit`                           | `#c9bda2`             | sand           | the crushed-shell band the tide leaves         |
| `coral`                                | `#c46975`             | stone          | only if `tide_rocks` borrows the corail types  |
| `water`                                | `#2e609e`             | water          | sea, flats, lagoon, marsh                      |
| `shore_wood` / `shore_foliage`         | `#6b563d` / `#5c7a44` | wood / foliage | shore and croft trees                          |
| `driftwood_wood` / `driftwood_foliage` | `#7a6a58` / `#4a6b4e` | wood / foliage | the wind-sheared thicket — bleached and dark   |
| `wreck_wood`                           | `#4a3a2c`             | wood           | tarred hull planking                           |
| `swamp_wood` / `swamp_foliage`         | `#493d32` / `#395d42` | wood / foliage | brackmarsh, reused as-is                       |
| `temperate_wood` / `temperate_foliage` | `#624936` / `#416f49` | wood / foliage | thicket rocks pack's neighbours                |

Dropped from what world 01 ships today, because no biome uses them any more: `snow`, `ice`,
`blackstone`, `scorched_stone`, `red_sand`, `cactus`, `coral_sand`, `taiga_wood/foliage`,
`grassland_wood/foliage`, `desert_wood/foliage`, `tropical_wood/foliage`.

## Mob rows (paste-ready)

```json
{ "mob_type": "wooling",               "weight_bp": 8000, "biomes": ["shore_plains","marram_dunes","fallow_croft","chalk_headland"] },
{ "mob_type": "razkin",                "weight_bp": 8000, "biomes": ["wreck_strand","tide_flats","fallow_croft"] },
{ "mob_type": "alley_bunny",           "weight_bp": 8000, "biomes": ["shore_plains","marram_dunes","fallow_croft"] },
{ "mob_type": "green_walker",          "weight_bp": 8000, "biomes": ["wreck_strand","tide_flats","brackmarsh","salt_lagoon"] },
{ "mob_type": "runt_piglet",           "weight_bp": 8000, "biomes": ["driftwood_thicket","shore_plains"] },
{ "mob_type": "razmo",                 "weight_bp": 8000, "biomes": ["wreck_strand","brackmarsh","salt_lagoon","fallow_croft"] },
{ "mob_type": "piglet",                "weight_bp": 8000, "biomes": ["driftwood_thicket","fallow_croft"] },
{ "mob_type": "bonelet",               "weight_bp": 8000, "biomes": ["wreck_strand","brackmarsh","marram_dunes","tide_flats","chalk_headland"] },
{ "mob_type": "ditch_koaletin",        "weight_bp": 8000, "biomes": ["tide_flats","brackmarsh","salt_lagoon"] },
{ "mob_type": "sparrowdart",           "weight_bp": 8000, "biomes": ["driftwood_thicket","shore_plains","chalk_headland"] },
{ "mob_type": "grainfox",              "weight_bp": 8000, "biomes": ["fallow_croft","marram_dunes","shore_plains"] },
{ "mob_type": "pecker_the_widow",      "weight_bp": 444,  "biomes": ["fallow_croft"] },
{ "mob_type": "razmo_the_plague_king", "weight_bp": 444,  "biomes": ["wreck_strand"] }
```

Resources:

```json
{ "item_type": "green_mushroom", "job": "HERBALIST", "tier": 1, "protector": "protector_shrooms_gaia", "rare_item_type": "", "biomes": ["driftwood_thicket","brackmarsh","salt_lagoon","shore_plains","fallow_croft"] },
{ "item_type": "quartz",         "job": "MINER",     "tier": 1, "protector": "protector_quartz",       "rare_item_type": "", "biomes": ["chalk_headland","wreck_strand","marram_dunes"] },
{ "item_type": "wheat",          "job": "FARMER",    "tier": 1, "protector": "protector_wheat_bricheton", "rare_item_type": "", "biomes": ["fallow_croft","shore_plains","chalk_headland"] }
```

Dungeon: unchanged (`sounding_hull_key`, `wooling`+`razkin`, `pecker_the_widow`+`bonelet`,
`captain_wrackbone`+`goldhen_matilda`).

## Verified

The nine biomes above were assembled into a real recipe and run through the engine's own
`validate_world_recipe` + `sample_biome_grid` (structure packs stubbed with existing ones, since
the wanted packs do not exist yet):

```
validate: OK
biome map: 196² = 38416 zones
   26.6%  shore_plains        <- the starter biome, the centre slot, the biggest region
   12.5%  fallow_croft
   12.2%  driftwood_thicket
   12.0%  tide_flats
   11.7%  marram_dunes
    6.9%  wreck_strand
    6.9%  brackmarsh
    5.6%  chalk_headland
    5.6%  salt_lagoon
```

Corner slots are naturally the rarest — the chalk headland and the lagoon are the two places you
go looking for, and `shore_plains` is what you wash up in. World roof: **y 383** (chalk), down
from 358 today.

## Checks before this lands

- `bun scripts/validate_seed.mjs` — mob/resource rows naming an unknown biome, unknown structure
  packs, and unknown pack materials all red here.
- Biome array order = biome id order. World 01 has a published biome map; **append, never
  reorder**, and re-run `bun scripts/derive_biome_map.mjs 01_first_shore` for the reseed.
- Eyeball it in the /demo composition lab before the ceremony: the roof must read as a cliff you
  can climb, not a mountain, and `shore_plains` must be the thing you see first.
