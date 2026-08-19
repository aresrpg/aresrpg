# Seeding — the one-time content publish

This is the operating manual for the one-time publish that walks `seed/content/*.json`
onto the chain and then seals it forever. It exists so the admin-page implementation of the
publishing system can be built without rediscovering (or forgetting) any step. Every claim
cites its source file; when this document and the Move source disagree, the source wins and
this file gets fixed in the same commit.

## What seeding is

Content reaches players only as published chain state. The seeding mints every template
(items, mobs, spells, recipes), authors every world's spawn tables and biome map, opens the
shop, and ends with `seed::seal` — after which `begin_batch` aborts for eternity and zero
admin power over content remains on chain (`packages/move/sources/seed.move`). There is no
"content patch" door: changing sealed content means a new publish train.

Two consequences drive everything below:

1. **A typo freezes forever.** The chain validates almost nothing about slugs; referential
   closure exists only in `scripts/validate_seed.mjs`. The gate is not optional.
2. **Everything before the seal is overwritable.** World doors (`set_world_mobs`,
   `set_world_resources`, `set_world_biome_window`, dungeon doors) may be re-run to correct
   mistakes until the seal. Template mints are the exception — see Idempotency.

## Preconditions (before any seeding transaction)

- **Fresh package published** and its init effects landed: the 20 shared `World` objects
  (`world.move::init`), the shared `TemplateRegistry` (`item.move`), the `LootRegistry`
  (`loot_box.move`). Record the package id and every registry/object id.
- **Custody:** an `AdminCap` gates `begin_batch` and `seal` (admin.move — the epoch-bound
  cap pattern). The connected super-admin wallet authorizes ONE epoch session: it mints a
  throwaway current-epoch cap plus bounded gas to a local session signer, which runs the
  sequential batches; the temp cap dies at the next epoch (or is deleted on release, gas
  returned). The `Publisher` is only needed for the Display creations below; the `UpgradeCap`
  stays in owner custody and is not part of seeding.
- **Post-publish setup transactions** (once, Publisher-gated, before players touch anything —
  these are the classically forgotten steps):
  - Display V2 for characters and items: `admin::create_character_display` /
    `admin::create_item_display` (each returns its cap — custody it).
  - Transfer policies and their rules: the `TransferPolicy<Item>` +
    `AresRPG_TransferPolicy` pair (`protected_policy.move`) that crafting/consumables/trade
    consume, with the personal-kiosk custody rules attached at creation — items are
    unusable and untradeable until these shared objects exist.
- **Pins:** `pins.json` (SDK bootstrap, `packages/sdk/src/client.ts`) updated for the new
  package AND every object id created above — every pin consumer in the same pass, none
  forgotten.
- **Gates green:**
  - `bun scripts/validate_seed.mjs` exits 0 — every RED is an unmade owner decision
    (`PENDING_SEED_DECISIONS.md`), and the seeding does not start while one exists.
  - `sui move build` + `sui move test` clean on `packages/move` and `packages/move-math`.
  - `bun scripts/derive_biome_map.mjs` runs clean for every world with a terrain recipe
    (it compiles each recipe through the engine's own validator — a broken recipe fails here,
    before any transaction).

## Inputs → doors

| seed/content file | doors (all in `seed.move` unless noted)                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `items.json`      | `new_item_template` → `set_stats` / `set_damages` / typed `set_consumable_*`; loot boxes also call `set_loot_table` → `freeze_item_template`                                                          |
| `spells.json`     | `new_spell` (levels composed via `aresrpg_math::spell_effect::new_effect` / `new_spell_level`) → `freeze_spell`                                                                                       |
| `mobs.json`       | `new_mob_template` (spells + loot inline) → `freeze_mob_template`                                                                                                                                     |
| `recipes.json`    | `new_recipe` → `freeze_recipe`                                                                                                                                                                        |
| `shop.json`       | `new_sale` · `new_giftcard`                                                                                                                                                                           |
| `airdrop.json`    | `new_airdrop`                                                                                                                                                                                         |
| `worlds.json`     | `world::new_mob_row` / `new_resource_row` rows → `set_world_mobs` / `set_world_resources`; `set_world_biome_window` + `append_world_biome_cells`; `set_world_dungeon_key` + `set_world_dungeon_rooms` |

## Order of operations (dependencies, not taste)

1. **Item templates.** Everything else points at them. Stats are positional — the 15
   `ItemStatistics` fields ride in declaration order (`item_stats.move`); the validator
   header carries the canonical list. Weapons add `set_damages`; each consumable dispatches its
   named JSON variant to the matching `set_consumable_*` door. Every template ends with its freeze in the SAME transaction (key-only
   hot value — the transaction cannot end while it lives).
2. **Spells** (class spell book). Independent of items; freeze each.
3. **Mob templates.** Loot entries reference items by `item_type` STRING (`mob_template.move
LootEntry`) — closure is validator-guaranteed, not chain-checked. Kits are inline
   `MobSpell` rows; freeze each template.
4. **Recipes.** These take template **IDs** (`output_template: ID`, `input_templates:
vector<ID>`) — resolve them from the derived addresses (below) before composing.
5. **Economy:** sales (shared at item-type-derived addresses), item-authored loot tables (parallel
   template ID + weight + amount vectors), airdrops (template ID + snapshotted whitelist), giftcards — `new_giftcard`
   RETURNS a key+store object to the PTB: the same transaction must transfer each one to the
   custody address or the transaction fails on an unconsumed value.
6. **Worlds**, per world:
   - mob rows: `new_mob_row(mob_type, weight_bp, biomes)` — ONE row per mob with the vector
     of biome ids it roams (indices into `terrain.biomes`; `[0]` for map-less worlds). A mob
     needing different weights per biome is two rows with disjoint biome lists.
   - resource rows: `new_resource_row(item, job, tier, protector, rare, biomes)` — ONE row
     per resource with the vector of biome ids it spawns in (`[0]` for map-less worlds), so
     divergent per-biome copies cannot exist by construction.
   - **biome map** (worlds with a terrain recipe): take the derive script's output for this
     world and, IN ONE PTB: `set_world_biome_window(w, 0, 0, side)` then one
     `append_world_biome_cells(w, chunk)` per `cell_chunks` entry, in order. The chunks are
     pre-sliced to Sui's 16,384-byte pure-argument cap. Never split window/appends across
     transactions: a half-filled map aborts every read (code 311) until completed.
   - dungeon: key item slug + room sequence (rows via `new_room_mob`/`new_dungeon_room`;
     last room carries the boss; scalars 0..100; empty room aborts 310).
   - finish with `mark_world_seeded`; its registry-derived immutable marker is the world's
     chain receipt and is created atomically with those writes.
7. **Seal** — the final, separate, deliberate transaction: `seed::seal(admin_cap, registry)`.
   It creates the registry-derived seal marker, then closes the registry forever. The admin page
   treats this as a two-step confirmed action, never part of a batch loop.

## Transaction mechanics the admin page must respect

- **Every batch transaction is bracketed:** `begin_batch(admin_cap, registry)` returns the
  `SeedCap` hot potato; the SAME transaction must end it with `destroy_seed_cap`. The cap
  cannot be stored or carried across transactions.
- **The registry is a shared object** taken `&mut` by every batch — seeding transactions
  serialize; run them sequentially, not in parallel.
- **Protocol budgets per transaction:** ≤ 1,024 PTB commands, ≤ ~128KB total transaction
  size, ≤ 16,384 bytes per pure argument. The SDK uses a conservative 400-command bound,
  measures the composed PTB, and refuses an oversized batch before it reaches the wallet.
- **Everything is simulatable.** No seeding door touches `&Random`, so every batch gets a
  simulation of the exact signed bytes before submission. A failed simulation submits nothing
  and the admin page shows the abort.
- **Template identity is derived, not returned.** Templates mint at addresses derived from
  their natural key (`item_type` / `mob_type` / spell name / recipe output) under the
  registry (`item.move` "Derivation root"). The admin page computes these addresses
  off-chain through `@aresrpg/sdk/seed`; the SDK owns every derived-object key encoding.
- **Seeding doors are generated.** `seed_doors.gen.ts` projects `seed.move` plus its Move value
  constructors. `seed_contract.gen.ts` projects the derived-object key module and type names.
  The admin page composes only these generated facts; call targets and key descriptors are never
  handwritten twice. Both modules load only for the admin route.

## Idempotency and resume (the seeding WILL be interrupted)

- **Template mints abort on repeat** — one derived-address claim per key, duplicates abort.
  Resume = query which derived addresses already exist, skip those, continue. Build this
  into the admin page from day one; a 1,980-item run that dies at item 1,400 must resume,
  not restart.
- **World batches have derived markers.** The marker and the overwrite-safe World writes share one
  atomic PTB. Resume checks the marker; local storage is never treated as publish truth.
- **Giftcards/airdrops are derived objects.** Every row has an authored id and a registry-derived
  address, so resume checks chain existence exactly like a template. Never auto-retry a transaction
  that executed and failed; a digest means gas was burned.
- **The seal has a derived marker.** A fresh browser detects a completed publish from chain state;
  it never relies on a remembered local flag.

## After the seal (the forgettable half)

1. Verify the seal: a `begin_batch` dry-run must now abort 401.
2. Confirm pins: SDK `pins.json`, frontend env, every consumer — one pass, same commit.
3. Re-point the indexer at the new package and re-project from a clean slate (its projection
   of the old package is garbage after a fresh publish); its layout gates (`packages/indexer/
src/gates.rs`) must be green against the published bytecode.
4. Wire the freshness gate: CI re-derives each biome map from `worlds.json` and compares to
   the published cells — a recipe edit without a republish goes red.
5. Smoke-test as a player: create character, join world, search a zone, verify the mobs and
   resources belong to the zone's biome, open the shop, gather once.

## What the seal freezes in `worlds.json` (and what stays editable)

Three buckets — the middle one is the trap:

- **Frozen on chain:** the world `mobs` and `resources` lists (each entry with its `biomes`
  name list), the `dungeon` block, the derived
  biome map cells — and the biome ID SPACE: the `terrain.biomes` array's order and count, since
  every sealed row and cell stores an array index. Never reorder, insert, or delete a biome
  entry after the seal; appending one is equally dead (it can't receive sealed spawns or map
  cells, and making it win the visual pick anywhere breaks parity).
- **Frozen by coupling** (not on chain, but the map was derived from them — editing makes the
  engine render a different biome layout than the sealed cells): `terrain.seed`, the five
  `noise.*` blocks, each biome's `climate` centers and `weight`, and all of `biome_selection`.
  The CI freshness gate re-derives the map from the recipe and diffs the published cells, so a
  coupled edit goes red instead of shipping a lying world. The engine's climate sampler code
  is part of this surface (visual-parity ruling).
- **Free forever — the visual-evolution lever:** all three `splines` (height only; the chain
  has no height), `sea_level`, `vertical_chunks`, the `materials` colors, each biome's `land`
  assignments, `grass_density` / `tree_density` / `foliage`, and biome `name` labels.
  Mountains, colors, and dressing may change post-seal at will; where things spawn may not.

## Abort codes worth surfacing in the admin UI

| code | meaning                                                              | source       |
| ---- | -------------------------------------------------------------------- | ------------ |
| 401  | seeding is sealed                                                    | `seed.move`  |
| 501  | the temp AdminCap expired (its epoch ended)                          | `admin.move` |
| 502  | a non-super cap tried a super-only door                              | `admin.move` |
| 503  | temp cap minting during the genesis epoch                            | `admin.move` |
| 306  | mob row weight outside 1..10000 bp                                   | `world.move` |
| 308  | resource job not FARMER/HERBALIST/MINER                              | `world.move` |
| 310  | empty dungeon room                                                   | `world.move` |
| 311  | biome map: cells overflow the window, or a read on a half-filled map | `world.move` |

## The checklist (print this)

- [ ] `validate_seed.mjs` exit 0 · Move build+test clean · derive script clean
- [ ] package published; ids recorded; super AdminCap connected; epoch session authorized; pins updated
- [ ] displays created (character + item) · transfer policies + kiosk rules created
- [ ] items → spells → mobs → recipes → shop → worlds → (biome maps, one PTB each) → dungeon
- [ ] every batch dry-run before signing; sequential execution; resume by derived-address query
- [ ] giftcards transferred to custody in-transaction; supply batches marked done, never re-run
- [ ] SEAL as a separate confirmed action
- [ ] post-seal: 401 verified · indexer re-projected · freshness gate armed · player smoke test
