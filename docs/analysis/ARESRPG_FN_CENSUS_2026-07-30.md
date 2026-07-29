# AresRPG Move package — public-function census

Read-only classification of every public function in the `aresrpg` Move package, so a
republish decision can be made from counted evidence instead of estimate. No product
code is touched by this document.

## Provenance

| Field                                | Value                                           |
| ------------------------------------ | ----------------------------------------------- |
| Date                                 | 2026-07-30                                      |
| Repo commit                          | `903cf9b88` (branch `lane/fn-census`)           |
| Package source                       | `packages/move/aresrpg/sources/**` (31 modules) |
| Package id (testnet origin = latest) | `0x2096d6a9…c273cb`                             |
| Toolchain                            | `sui 1.76.0-6effb4523834`                       |
| Compiled bytecode                    | 31 `.mv` modules, 93,042 bytes total            |

The package id in `packages/sdk/src/deployment/release.json` matches the module address
in the disassembly, so the census describes the deployed lineage, not a local variant.

## Count control

Two independent counts were reconciled to the function, not the total:

```sh
# source extraction (annotation-aware, drops #[test_only])
grep -c '^\s*public fun ' packages/move/aresrpg/sources/*.move   # 479 raw, 424 after test_only

# compiled ABI — ground truth, what actually ships
sui move build && sui move disassemble build/aresrpg/bytecode_modules/*.mv
```

Both land on **424** public functions. The working figure of 423 is an undercount by
exactly one: `character::anchor_position`, the package's only `public entry fun`, which
the disassembler renders as `entry public …` — a naive `^public ` grep skips it. 55
further `public fun` declarations are `#[test_only]` and never reach the chain; they are
correctly absent from both the ABI and this census.

Outside this census but part of the PTB surface: **12 private `entry fun`** (e.g.
`shop::buy`, `crafting::craft`, `zones::join_world`). They are transaction entrypoints
without being public ABI, so the public surface is not the same thing as the write surface.

## Method

A public function is classified by who can still reach it. Five consumer surfaces were
swept, and each row records the evidence that placed it:

| Surface               | How it was read                                                                                                   | Exactness                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| Shipped Move code     | `Call` instructions in the disassembly, resolved against each module's `use` address table                        | exact                                |
| Sibling Move packages | same, over built `dungeon`, `kolizeum`, `forgemagie`, `gifting` (the four that declare `[dependencies.aresrpg]`)  | exact                                |
| Off-chain static      | `` `${pkg}::module::fn` `` in JS/TS sources (.js, .ts, .mjs, .jsx, .tsx) across the repo, `node_modules` excluded | exact                                |
| Off-chain dynamic     | `` `${pkg}::module::${expr}` `` sites, candidate names resolved from string literals in the same file             | heuristic                            |
| Move tests            | `packages/move/aresrpg/tests/**` qualified calls and method-syntax calls                                          | qualified exact, method-syntax fuzzy |

Classification rule, applied mechanically:

- **CHAIN-NECESSARY** — reached by an off-chain caller (it is a PTB target), or by a
  sibling package (cross-package calls are the reason `public` exists), or it mutates
  state (`&mut` / `TxContext` parameter, or returns nothing) and is called on-chain.
- **RPC-MIRRORED** — a pure view (only `&` parameters, returns a value) with no off-chain
  and no sibling-package caller. Nothing outside the package needs to _call_ it; where a
  client needs the fact, it arrives over `/v1`.
- **DEAD-NO-CALLER** — no caller on any surface above.

### Three instrument failures found and corrected

Each of these produced a plausible-looking table that was wrong, so they are recorded
rather than silently fixed:

1. **Move 2024 method syntax.** A `module::fn(` grep misses `obj.fn()`, which this
   codebase uses heavily (`.assert_enabled(` ×58, `.assert_latest(` ×54, `.verify(` ×51).
   It reported `version::assert_latest` — 54 real call sites — as dead. Replaced by the
   compiler's resolved `Call` instructions.
2. **Regex alternation prefix shadowing.** In an alternation of 424 names, `anchor`
   matches before `anchor_position`, so call sites were filed under the wrong function.
   36 rows were misclassified until alternations were sorted longest-first.
3. **Single-package blindness.** `dungeon` and `kolizeum` call into `aresrpg`; a
   census of one package reported those 63 cross-package entrypoints as dead — the exact
   inverse of the truth, and the most damaging error of the three.

Module names collide across packages (`admin`, `fight`, `version` exist in up to four).
Every match is therefore resolved by package address on the Move side, and by package-id
variable on the JS side (`ENGINE_/SOCIAL_/SPELLS_` prefixes discarded). No `aresrpg` Move
file imports a sibling package's colliding module, so the Move side has no ambiguity left.

## Fractions

| Class           |   Count |    Share |
| --------------- | ------: | -------: |
| CHAIN-NECESSARY |     187 |    44.1% |
| RPC-MIRRORED    |     234 |    55.2% |
| DEAD-NO-CALLER  |       3 |     0.7% |
| **Total**       | **424** | **100%** |

CHAIN-NECESSARY splits into 61 reached by off-chain callers, 55 reached by a sibling
package, and 71 on-chain mutators. Only **61 of 424 (14.4%)** public functions are reached
by off-chain code at all — 30 of those only through dynamically-built target strings.

RPC-MIRRORED splits by what shedding would mean: **134** have in-package callers and could
become `public(package)`; **100** are reached only from Move tests and could become
`#[test_only]` or be deleted.

## Positive control — PROVEN

One RPC-MIRRORED fact traced end-to-end, chain source to live HTTP response.

**Fact:** a class's base HP / AP / MP.

| Hop                         | Evidence                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Chain getters               | `config::base_hp` / `base_ap` / `base_mp` — `packages/move/aresrpg/sources/config.move:487-489`, pure `&ClassRow` reads          |
| Chain emission              | `ClassRowSet` event declared `config.move:169`, emitted `config.move:460`                                                        |
| Indexer decode + projection | `packages/rpc/indexer/src/handlers/ares/project.rs:899-907` matches `("config","ClassRowSet")` and writes `$.classes.{class_id}` |
| API handler                 | `packages/rpc/api/views.js:992-997` — `handle_config()` returns `classes`                                                        |
| Route                       | `/v1/config` — `packages/rpc/api/routes.js:45`                                                                                   |

Live response (`curl https://rpc.aresrpg.world/v1/config`, indexer lag 5s at the time):

```json
{"enabled":true,"classes":{"0":{"base_hp":70,"base_ap":6,"base_mp":3},
 "1":{"base_hp":45,"base_ap":6,"base_mp":3}, … 12 classes}}
```

The three Move getters have **zero** off-chain and zero sibling-package callers: the fact
reaches every client through the event → indexer → `/v1/config` path, never by calling the
getter. The mirror holds for this fact.

**Scope of the control.** It proves the mirror is real and that at least one
RPC-MIRRORED row is correctly classified. It does not prove all 234. Per-row, the
name of 98 of the 234 RPC-MIRRORED functions appears somewhere under `packages/rpc/`,
which is supporting evidence, not proof. For the remainder the classification rests on
the mechanical property actually measured — a pure view with no caller outside the
package — and the claim that `/v1` already serves that specific fact is untested.

## Byte estimate

The compiled package is **93,042 bytes** across 31 modules.

The estimate has to distinguish two different actions, because they do not cost the same:

- **Demotion** (`public` → `public(package)` / `#[test_only]`), which covers 234 of the
  237 shed candidates, changes a visibility flag on a function definition. The function,
  its name, its signature and its code all remain in the bytecode: **byte saving ≈ 0**.
  What it buys is upgrade surface — a public signature is frozen by Move upgrade
  compatibility rules, so 234 fewer public functions is 234 fewer signatures frozen forever.
- **Deletion**, which applies to the 3 dead functions, is the only action that returns
  bytes: at the stated ~22.6 B/fn internal-overhead floor that is **~68 bytes**, plus 13
  bytes of identifier text, plus their (unmeasured) code bodies. Publics carry more than
  the internal floor, so treat ~68 B as a lower bound.

A shed-list byte figure large enough to matter against the 102400-byte package limit is
therefore **not derivable from demotion**; it would require deleting live code, which is a
different decision than this census measures.

## Limitations

- Dynamic call sites are resolved heuristically: a `` `${pkg}::world::${fn}` `` site is
  matched against string literals in the same file. Seed scripts drive `world` and `shop`
  from the private seed corpus, so a name that exists only in that corpus is not visible
  here and its function could be classified RPC-MIRRORED while a seed run calls it. The
  affected modules are `world`, `shop`, `consumable_effect`, `zones`, `results`.
- Move-test method-syntax attribution is by name only (marked `move-test?` in the data),
  so a same-named function in another module can inherit a test caller it does not have.
  This only ever moves a row out of DEAD, never into it.
- The census reads one commit. A caller living on an unmerged branch is invisible.

## The table

424 rows, ordered by module then function. `Evidence` cites one representative call site,
plus the number of resolved call sites in shipped `aresrpg` bytecode (`N move calls`).
`pkg …` names the sibling packages that call the function.

| Module                 | Function                             | Class           | Evidence                                                       |
| ---------------------- | ------------------------------------ | --------------- | -------------------------------------------------------------- |
| admin                  | `add_category`                       | CHAIN-NECESSARY | other move/scripts/seed_testnet.mjs:369                        |
| admin                  | `admin_bump_version`                 | CHAIN-NECESSARY | move-test move/aresrpg/tests/admin_tests.move:669              |
| admin                  | `admin_set_enabled`                  | CHAIN-NECESSARY | other move/scripts/ceremony.mjs:226                            |
| admin                  | `burn_item_template`                 | CHAIN-NECESSARY | move-test move/aresrpg/tests/admin_tests.move:399              |
| admin                  | `contains`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:256; 1 move call |
| admin                  | `create_template`                    | CHAIN-NECESSARY | other move/scripts/seed_testnet.mjs:449                        |
| admin                  | `is_super`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:67               |
| admin                  | `mint_temp_admin_cap`                | CHAIN-NECESSARY | move-test move/aresrpg/tests/admin_tests.move:142              |
| admin                  | `remove_category`                    | CHAIN-NECESSARY | move-test move/aresrpg/tests/admin_tests.move:266              |
| admin                  | `set_template_damages`               | CHAIN-NECESSARY | move-test move/aresrpg/tests/template_damages_tests.move:81    |
| admin                  | `set_template_effect`                | CHAIN-NECESSARY | move-test move/aresrpg/tests/template_effect_tests.move:77     |
| admin                  | `set_template_name_description`      | CHAIN-NECESSARY | other move/scripts/apply_shop_payload.mjs:394                  |
| admin                  | `set_template_stats`                 | CHAIN-NECESSARY | other move/scripts/reseed_live.mjs:259                         |
| admin                  | `verify`                             | CHAIN-NECESSARY | pkg forgemagie+gifting; 51 move calls                          |
| character              | `anchor`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:150          |
| character              | `anchor_at_ms`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:154          |
| character              | `anchor_pos_x`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:151          |
| character              | `anchor_pos_z`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:152          |
| character              | `anchor_position`                    | CHAIN-NECESSARY | move-test move/aresrpg/tests/character_tests.move:147          |
| character              | `anchor_zone`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:153          |
| character              | `class`                              | RPC-MIRRORED    | 4 move calls                                                   |
| character              | `color_1`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:290          |
| character              | `color_2`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:291          |
| character              | `color_3`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:292          |
| character              | `create_character_policy`            | CHAIN-NECESSARY | move-test move/aresrpg/tests/character_tests.move:49           |
| character              | `created_at_ms`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:288          |
| character              | `customization`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:289          |
| character              | `experience`                         | RPC-MIRRORED    | 4 move calls                                                   |
| character              | `id`                                 | CHAIN-NECESSARY | pkg gifting; move-test move/aresrpg/tests/character_tests.m... |
| character              | `lock_in_kiosk`                      | CHAIN-NECESSARY | sdk sdk/src/sui/write/items_creation.js:205                    |
| character              | `male`                               | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:287          |
| character              | `name`                               | RPC-MIRRORED    | move-test move/aresrpg/tests/character_tests.move:286; 1 mo... |
| character              | `new_brand`                          | CHAIN-NECESSARY | pkg gifting; move-test move/aresrpg/tests/sibling_brand_tes... |
| character              | `new_customization`                  | CHAIN-NECESSARY | sdk sdk/src/sui/write/items_creation.js:175                    |
| character              | `uid`                                | RPC-MIRRORED    | 6 move calls                                                   |
| character_extract      | `create_character_extract_policy`    | CHAIN-NECESSARY | move-test move/aresrpg/tests/character_extract_tests.move:59   |
| character_extract      | `delete_character`                   | CHAIN-NECESSARY | sdk sdk/src/sui/write/character_delete.js:48                   |
| character_link         | `add_job_xp_brand`                   | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/forge_brand_te... |
| character_link         | `checkpoint`                         | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/zone_format_dispa... |
| character_link         | `combat_stats`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/stat_allocation_tests.move:127... |
| character_link         | `combat_stats_settled`               | RPC-MIRRORED    | move-test move/aresrpg/tests/fight_door_tests.move:202; 2 m... |
| character_link         | `consume_units_brand`                | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/forge_brand_te... |
| character_link         | `current_hp`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/fight_seam_tests.move:157         |
| character_link         | `enter_dungeon_brand`                | CHAIN-NECESSARY | pkg dungeon                                                    |
| character_link         | `exit_dungeon_brand`                 | CHAIN-NECESSARY | pkg dungeon                                                    |
| character_link         | `flip_world`                         | CHAIN-NECESSARY | move-test move/aresrpg/tests/fight_seam_tests.move:217         |
| character_link         | `has_checkpoint`                     | CHAIN-NECESSARY | pkg dungeon; 4 move calls                                      |
| character_link         | `has_progression`                    | RPC-MIRRORED    | 3 move calls                                                   |
| character_link         | `heal_hp_brand`                      | CHAIN-NECESSARY | pkg gifting; move-test move/aresrpg/tests/sibling_brand_tes... |
| character_link         | `in_world`                           | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/zones_tests.move:... |
| character_link         | `is_locked`                          | RPC-MIRRORED    | move-test? move/aresrpg/tests/extract_tests.move:208; 5 mov... |
| character_link         | `job_xp`                             | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/commission_tes... |
| character_link         | `level`                              | CHAIN-NECESSARY | pkg gifting+kolizeum; move-test move/aresrpg/tests/characte... |
| character_link         | `mint_and_lock_output_brand`         | CHAIN-NECESSARY | pkg gifting; move-test move/aresrpg/tests/sibling_brand_tes... |
| character_link         | `pass`                               | DEAD-NO-CALLER  | no caller in any surface                                       |
| character_link         | `pet_power`                          | RPC-MIRRORED    | 3 move calls                                                   |
| character_link         | `progression_hp`                     | RPC-MIRRORED    | move-test move/aresrpg/tests/character_link_tests.move:57      |
| character_link         | `raise_stat`                         | CHAIN-NECESSARY | sdk sdk/src/game.js:180                                        |
| character_link         | `spell_level`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/spell_level_tests.move:91; 2 m... |
| character_link         | `spell_points_spent`                 | RPC-MIRRORED    | move-test move/aresrpg/tests/spell_level_tests.move:114; 1 ... |
| character_link         | `stat_agility`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/stat_allocation_tests.move:91;... |
| character_link         | `stat_allocated`                     | RPC-MIRRORED    | move-test move/aresrpg/tests/stat_allocation_tests.move:77;... |
| character_link         | `stat_chance`                        | RPC-MIRRORED    | 1 move call                                                    |
| character_link         | `stat_count`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/stat_allocation_tests.move:199... |
| character_link         | `stat_intelligence`                  | RPC-MIRRORED    | 1 move call                                                    |
| character_link         | `stat_points_spent`                  | RPC-MIRRORED    | move-test move/aresrpg/tests/stat_allocation_tests.move:78;... |
| character_link         | `stat_strength`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/stat_allocation_tests.move:90;... |
| character_link         | `stat_vitality`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/stat_allocation_tests.move:72;... |
| character_link         | `stat_wisdom`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/stat_allocation_tests.move:139... |
| character_link         | `unspent_spell_points`               | RPC-MIRRORED    | move-test move/aresrpg/tests/spell_level_tests.move:92; 1 m... |
| character_link         | `unspent_stat_points`                | RPC-MIRRORED    | move-test move/aresrpg/tests/stat_allocation_tests.move:69;... |
| character_link         | `world`                              | DEAD-NO-CALLER  | no caller in any surface                                       |
| character_link         | `world_field`                        | RPC-MIRRORED    | 1 move call                                                    |
| character_listing_rule | `add`                                | CHAIN-NECESSARY | move-test move/aresrpg/tests/character_listing_tests.move:58   |
| character_listing_rule | `prove_level`                        | CHAIN-NECESSARY | move-test move/aresrpg/tests/character_listing_tests.move:79   |
| commission             | `accept`                             | CHAIN-NECESSARY | sdk sdk/src/sui/write/commission.js:104                        |
| commission             | `accepted`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/commission_tests.move:503         |
| commission             | `amount`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/commission_tests.move:502         |
| commission             | `artisan`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/commission_tests.move:500         |
| commission             | `cancel`                             | CHAIN-NECESSARY | sdk sdk/src/sui/write/commission.js:180                        |
| commission             | `customer`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/commission_tests.move:499         |
| commission             | `platform_cut_of`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/commission_tests.move:213; 1 m... |
| commission             | `recipe`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/commission_tests.move:501         |
| commission             | `redeem_craft_xp`                    | CHAIN-NECESSARY | sdk sdk/src/sui/write/commission.js:202                        |
| commission             | `request`                            | CHAIN-NECESSARY | sdk sdk/src/sui/write/commission.js:69                         |
| config                 | `aging_bp_per_hour`                  | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:55; 1 move ... |
| config                 | `aging_cap_bp`                       | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:56; 1 move ... |
| config                 | `archimob_bp`                        | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:54; 1 move ... |
| config                 | `assert_domain`                      | CHAIN-NECESSARY | pkg dungeon+forgemagie+kolizeum; move-test move/aresrpg/tes... |
| config                 | `assert_dungeon_brand`               | CHAIN-NECESSARY | move-test move/aresrpg/tests/sibling_brand_tests.move:95; 5... |
| config                 | `assert_enabled`                     | CHAIN-NECESSARY | pkg dungeon+forgemagie+gifting+kolizeum; move-test? move/ar... |
| config                 | `assert_forge_brand`                 | CHAIN-NECESSARY | move-test move/aresrpg/tests/forge_brand_tests.move:56; 5 m... |
| config                 | `assert_gifting_brand`               | CHAIN-NECESSARY | move-test move/aresrpg/tests/sibling_brand_tests.move:94; 3... |
| config                 | `base_ap`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/config_tests.move:63; 1 move call |
| config                 | `base_hp`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/config_tests.move:62; 1 move call |
| config                 | `base_mp`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/config_tests.move:64; 1 move call |
| config                 | `claim_window_epochs`                | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:53             |
| config                 | `class_count`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/config_tests.move:61              |
| config                 | `class_id_of`                        | RPC-MIRRORED    | 3 move calls                                                   |
| config                 | `class_row`                          | RPC-MIRRORED    | move-test? move/aresrpg/tests/progression_tests.move:118; 4... |
| config                 | `domain_crafting`                    | RPC-MIRRORED    | 3 move calls                                                   |
| config                 | `domain_dungeon`                     | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/config_tests.move:84 |
| config                 | `domain_fight`                       | RPC-MIRRORED    | 3 move calls                                                   |
| config                 | `domain_forgemagie`                  | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/config_tests.m... |
| config                 | `domain_gathering`                   | RPC-MIRRORED    | 1 move call                                                    |
| config                 | `domain_market`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/fight_door_tests.move:470; 2 m... |
| config                 | `domain_pools`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/sibling_brand_tests.move:96       |
| config                 | `domain_pvp`                         | CHAIN-NECESSARY | pkg kolizeum; move-test move/aresrpg/tests/fight_door_tests... |
| config                 | `domains`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/config_tests.move:83              |
| config                 | `dungeon_brand`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/sibling_brand_tests.move:84       |
| config                 | `forge_brand`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/forge_brand_tests.move:48         |
| config                 | `gifting_brand`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/sibling_brand_tests.move:83       |
| config                 | `is_enabled`                         | RPC-MIRRORED    | move-test? move/aresrpg/tests/admin_tests.move:644             |
| config                 | `listing_level_gate`                 | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:58; 1 move ... |
| config                 | `loot_multiplier`                    | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:48; 1 move ... |
| config                 | `max_reachable_level`                | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:49; 1 move ... |
| config                 | `placement_ms`                       | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:52; 1 move ... |
| config                 | `pvp_level_gate`                     | CHAIN-NECESSARY | pkg kolizeum; move-test? move/aresrpg/tests/config_tests.mo... |
| config                 | `reclaim_cooldown_ms`                | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:87             |
| config                 | `set_aging_bp_per_hour`              | CHAIN-NECESSARY | move-test move/aresrpg/tests/config_tests.move:180             |
| config                 | `set_aging_cap_bp`                   | CHAIN-NECESSARY | move-test move/aresrpg/tests/config_tests.move:182             |
| config                 | `set_archimob_bp`                    | CHAIN-NECESSARY | move-test move/aresrpg/tests/config_tests.move:178             |
| config                 | `set_claim_window_epochs`            | CHAIN-NECESSARY | move-test move/aresrpg/tests/config_tests.move:173             |
| config                 | `set_class_base_ap`                  | CHAIN-NECESSARY | other test/gold/lib_gold.mjs:563                               |
| config                 | `set_class_base_hp`                  | CHAIN-NECESSARY | other test/gold/lib_gold.mjs:571                               |
| config                 | `set_class_base_mp`                  | CHAIN-NECESSARY | other test/gold/lib_gold.mjs:567                               |
| config                 | `set_domain_enabled`                 | CHAIN-NECESSARY | move-test move/aresrpg/tests/config_tests.move:324             |
| config                 | `set_dungeon_brand`                  | CHAIN-NECESSARY | other move/scripts/ceremony.mjs:249                            |
| config                 | `set_enabled`                        | CHAIN-NECESSARY | other move/scripts/ceremony.mjs:231                            |
| config                 | `set_forge_brand`                    | CHAIN-NECESSARY | other move/scripts/qa/board_bootstrap.mjs:18                   |
| config                 | `set_gifting_brand`                  | CHAIN-NECESSARY | other move/scripts/ceremony.mjs:243                            |
| config                 | `set_listing_level_gate`             | CHAIN-NECESSARY | move-test move/aresrpg/tests/character_listing_tests.move:49   |
| config                 | `set_loot_multiplier`                | CHAIN-NECESSARY | other test/gold/lib_gold.mjs:560                               |
| config                 | `set_max_reachable_level`            | CHAIN-NECESSARY | move-test move/aresrpg/tests/progression_tests.move:90         |
| config                 | `set_placement_ms`                   | CHAIN-NECESSARY | move-test move/aresrpg/tests/config_tests.move:170             |
| config                 | `set_pvp_level_gate`                 | CHAIN-NECESSARY | move-test move/aresrpg/tests/config_tests.move:190             |
| config                 | `set_reclaim_cooldown_ms`            | CHAIN-NECESSARY | move-test move/aresrpg/tests/config_tests.move:88              |
| config                 | `set_team_size_bound`                | CHAIN-NECESSARY | move-test move/aresrpg/tests/config_tests.move:185             |
| config                 | `set_turn_duration_ms`               | CHAIN-NECESSARY | script scripts/fight_bots.mjs:806                              |
| config                 | `set_xp_multiplier`                  | CHAIN-NECESSARY | other test/gold/lib_gold.mjs:559                               |
| config                 | `team_size_bound`                    | CHAIN-NECESSARY | pkg kolizeum; move-test? move/aresrpg/tests/config_tests.mo... |
| config                 | `turn_duration_ms`                   | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:51; 1 move ... |
| config                 | `xp_multiplier`                      | RPC-MIRRORED    | move-test? move/aresrpg/tests/config_tests.move:47; 2 move ... |
| consumable_effect      | `amount`                             | CHAIN-NECESSARY | pkg gifting; move-test move/aresrpg/tests/admin_tests.move:326 |
| consumable_effect      | `bag_open`                           | CHAIN-NECESSARY | move-test move/aresrpg/tests/admin_tests.move:366              |
| consumable_effect      | `effect`                             | CHAIN-NECESSARY | pkg gifting; move-test move/aresrpg/tests/admin_tests.move:325 |
| consumable_effect      | `gacha_roll`                         | CHAIN-NECESSARY | pkg gifting; other move/scripts/seed_testnet.mjs:426           |
| consumable_effect      | `has_effect`                         | CHAIN-NECESSARY | pkg gifting; move-test move/aresrpg/tests/admin_tests.move:... |
| consumable_effect      | `heal`                               | CHAIN-NECESSARY | pkg gifting; other move/scripts/seed_testnet.mjs:439           |
| consumable_effect      | `is_consumable`                      | RPC-MIRRORED    | 2 move calls                                                   |
| consumable_effect      | `kind`                               | CHAIN-NECESSARY | pkg gifting; move-test move/aresrpg/tests/admin_tests.move:325 |
| consumable_effect      | `new`                                | CHAIN-NECESSARY | other move/scripts/seed_testnet.mjs:423; 1 move call           |
| consumable_effect      | `spell_reset`                        | CHAIN-NECESSARY | move-test move/aresrpg/tests/admin_tests.move:365              |
| consumable_effect      | `stat_reset`                         | CHAIN-NECESSARY | move-test move/aresrpg/tests/admin_tests.move:364              |
| crafting               | `craft_xp`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/crafting_tests.move:205; 1 mov... |
| crafting               | `create_recipe`                      | CHAIN-NECESSARY | other move/scripts/seed_testnet.mjs:525                        |
| crafting               | `input_count`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/crafting_tests.move:200; 1 mov... |
| crafting               | `output_quantity`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/crafting_tests.move:201           |
| crafting               | `output_template`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/crafting_tests.move:202           |
| crafting               | `required_job`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/crafting_tests.move:203; 2 mov... |
| crafting               | `required_level`                     | RPC-MIRRORED    | move-test move/aresrpg/tests/crafting_tests.move:204; 1 mov... |
| crafting               | `retire_recipe`                      | CHAIN-NECESSARY | move-test move/aresrpg/tests/crafting_tests.move:583           |
| crafting               | `set_recipe_craft_xp`                | CHAIN-NECESSARY | move-test move/aresrpg/tests/crafting_tests.move:673           |
| crafting               | `set_recipe_inputs`                  | CHAIN-NECESSARY | move-test move/aresrpg/tests/crafting_tests.move:412           |
| equipment              | `any_equipped`                       | RPC-MIRRORED    | 1 move call                                                    |
| equipment              | `equip`                              | CHAIN-NECESSARY | sdk sdk/src/sui/write/items_extract.js:112                     |
| equipment              | `equipment_attached`                 | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:284          |
| equipment              | `equipped_weapon`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:285          |
| equipment              | `equipped_weapon_family`             | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:286; 1 mo... |
| equipment              | `folded_stats`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:287; 1 mo... |
| equipment              | `geared_combat_stats`                | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:164          |
| equipment              | `geared_combat_stats_settled`        | RPC-MIRRORED    | move-test move/aresrpg/tests/fight_door_tests.move:203; 1 m... |
| equipment              | `pet_equipped`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:336; 7 mo... |
| equipment              | `tool_equipped_for`                  | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:366; 1 mo... |
| equipment              | `unequip`                            | CHAIN-NECESSARY | sdk sdk/src/sui/write/items_extract.js:155                     |
| extension              | `item_uid_mut_brand`                 | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/forge_brand_te... |
| extension              | `mint_item_stack_brand`              | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/forge_brand_te... |
| extension              | `set_rolled_brand`                   | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/forge_brand_te... |
| extract                | `burn`                               | CHAIN-NECESSARY | pkg dungeon+forgemagie+gifting; sdk sdk/src/sui/write/items... |
| extract                | `confirm_equip`                      | CHAIN-NECESSARY | move-test move/aresrpg/tests/extract_tests.move:117; 1 move... |
| extract                | `create_extract_policy`              | CHAIN-NECESSARY | other move/scripts/ceremony.mjs:108                            |
| extract                | `extract_for_burn`                   | CHAIN-NECESSARY | pkg forgemagie+gifting; sdk sdk/src/sui/write/items_extract... |
| extract                | `extract_for_equip`                  | CHAIN-NECESSARY | sdk sdk/src/sui/write/items_extract.js:97                      |
| extract                | `extract_one_for_burn`               | CHAIN-NECESSARY | sdk sdk/src/dungeon.js:81; 1 move call                         |
| extract                | `merge_locked_stacks`                | CHAIN-NECESSARY | move-test move/aresrpg/tests/merge_door_tests.move:150; 1 m... |
| extract                | `merge_locked_stacks_and_relock`     | CHAIN-NECESSARY | sdk sdk/src/sui/write/item_stacks.js:120                       |
| extract                | `split_locked_stack`                 | CHAIN-NECESSARY | sdk sdk/src/sui/write/item_stacks.js:50                        |
| extract                | `unequip`                            | CHAIN-NECESSARY | move-test move/aresrpg/tests/extract_tests.move:141; 1 move... |
| fight                  | `add_member`                         | CHAIN-NECESSARY | sdk sdk/src/fight.js:396                                       |
| fight                  | `combat_snapshot`                    | CHAIN-NECESSARY | pkg kolizeum                                                   |
| fight                  | `create`                             | CHAIN-NECESSARY | other move/scripts/qa/smoke_lineage4.mjs:97                    |
| fight                  | `create_dungeon_fight_brand`         | CHAIN-NECESSARY | pkg dungeon                                                    |
| fight                  | `dial_snapshot`                      | CHAIN-NECESSARY | pkg kolizeum; 5 move calls                                     |
| fight                  | `is_unmarked`                        | CHAIN-NECESSARY | pkg forgemagie+gifting; move-test move/aresrpg/tests/charac... |
| fight                  | `join`                               | CHAIN-NECESSARY | sdk sdk/src/fight.js:440                                       |
| fight                  | `join_vouched_brand`                 | CHAIN-NECESSARY | pkg dungeon                                                    |
| fight                  | `open_group`                         | CHAIN-NECESSARY | sdk sdk/src/fight.js:377                                       |
| fight                  | `open_room_group_brand`              | CHAIN-NECESSARY | pkg dungeon                                                    |
| fight                  | `pending_obligations`                | RPC-MIRRORED    | 1 move call                                                    |
| fight                  | `release_group`                      | CHAIN-NECESSARY | sdk sdk/src/fight.js:1018                                      |
| item                   | `add_listing_rule`                   | CHAIN-NECESSARY | other move/scripts/ceremony.mjs:200                            |
| item                   | `add_lot_rule`                       | CHAIN-NECESSARY | other move/scripts/ceremony.mjs:209                            |
| item                   | `amount`                             | CHAIN-NECESSARY | pkg gifting; move-test move/aresrpg/tests/extract_tests.mov... |
| item                   | `category`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/item_tests.move:159; 5 move calls |
| item                   | `create_item_policy`                 | CHAIN-NECESSARY | move-test move/aresrpg/tests/equipment_tests.move:56           |
| item                   | `description`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/item_tests.move:462               |
| item                   | `is_stackable_category`              | RPC-MIRRORED    | move-test move/aresrpg/tests/lot_rule_tests.move:24; 9 move... |
| item                   | `item_type`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/item_tests.move:79                |
| item                   | `lock_in_kiosk`                      | CHAIN-NECESSARY | pkg forgemagie; sdk sdk/src/sui/write/items_extract.js:172;... |
| item                   | `name`                               | RPC-MIRRORED    | move-test move/aresrpg/tests/item_tests.move:78                |
| item                   | `prove_listing_amount`               | CHAIN-NECESSARY | pkg gifting; test sdk/test/items_marketplace.test.js:413       |
| item                   | `prove_lot`                          | CHAIN-NECESSARY | pkg gifting; test sdk/test/items_marketplace.test.js:414; 1... |
| item                   | `template`                           | CHAIN-NECESSARY | pkg forgemagie+gifting; move-test move/aresrpg/tests/item_t... |
| item                   | `template_category`                  | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:77; 6 move calls |
| item                   | `template_description`               | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:557              |
| item                   | `template_id`                        | CHAIN-NECESSARY | pkg forgemagie+gifting; move-test move/aresrpg/tests/admin_... |
| item                   | `template_item_type`                 | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:76               |
| item                   | `template_level`                     | CHAIN-NECESSARY | pkg forgemagie+gifting; move-test move/aresrpg/tests/admin_... |
| item                   | `template_name`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:556              |
| item                   | `uid`                                | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/forge_brand_te... |
| item_damages           | `damage_type`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:126              |
| item_damages           | `damages`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:121; 1 move call |
| item_damages           | `element`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:123              |
| item_damages           | `element_id`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:198; 1 mo... |
| item_damages           | `from`                               | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:124; 1 move call |
| item_damages           | `has_damages`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:120; 3 move c... |
| item_damages           | `has_item_lines`                     | RPC-MIRRORED    | 2 move calls                                                   |
| item_damages           | `item_lines`                         | RPC-MIRRORED    | 1 move call                                                    |
| item_damages           | `midpoint`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:199          |
| item_damages           | `new`                                | RPC-MIRRORED    | other move/scripts/seed_testnet.mjs:228                        |
| item_damages           | `to`                                 | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:125; 1 move call |
| item_stats             | `action`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:104;... |
| item_stats             | `agility`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:101;... |
| item_stats             | `air_resistance`                     | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:112;... |
| item_stats             | `chance`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:100;... |
| item_stats             | `clamp_to`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/item_tests.move:369               |
| item_stats             | `critical`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:105;... |
| item_stats             | `critical_chance`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:107     |
| item_stats             | `critical_outcomes`                  | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:108     |
| item_stats             | `earth_resistance`                   | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:109;... |
| item_stats             | `fire_resistance`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:110;... |
| item_stats             | `from_raw`                           | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/item_tests.mov... |
| item_stats             | `has_ranges`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:79; 7 move calls |
| item_stats             | `has_rolled_stats`                   | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/shop_tests.mov... |
| item_stats             | `intelligence`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:99; ... |
| item_stats             | `is_malus`                           | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/item_tests.mov... |
| item_stats             | `movement`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:103;... |
| item_stats             | `new`                                | RPC-MIRRORED    | other move/scripts/seed_testnet.mjs:223                        |
| item_stats             | `pet_full_feed_count`                | RPC-MIRRORED    | 2 move calls                                                   |
| item_stats             | `range`                              | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:102;... |
| item_stats             | `raw_damage`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:106;... |
| item_stats             | `rolled_stats`                       | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/shop_tests.mov... |
| item_stats             | `scale_from_center`                  | RPC-MIRRORED    | move-test move/aresrpg/tests/pet_tests.move:192; 2 move calls  |
| item_stats             | `shift`                              | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:503; 1 mo... |
| item_stats             | `stats_max`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:118; 3 move c... |
| item_stats             | `stats_min`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:117; 1 move call |
| item_stats             | `strength`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:119; 2 move c... |
| item_stats             | `template_max_raw`                   | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/admin_tests.mo... |
| item_stats             | `to_raw`                             | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/item_tests.mov... |
| item_stats             | `uniform`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/equipment_tests.move:503          |
| item_stats             | `vitality`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/shop_tests.move:389; 2 move calls |
| item_stats             | `water_resistance`                   | RPC-MIRRORED    | move-test move/aresrpg/tests/template_stats_tests.move:111;... |
| item_stats             | `wisdom`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/shop_tests.move:391; 2 move calls |
| item_stats             | `zero_raw`                           | CHAIN-NECESSARY | pkg forgemagie; move-test move/aresrpg/tests/admin_tests.mo... |
| mob_template           | `burn`                               | CHAIN-NECESSARY | 1 move call                                                    |
| mob_template           | `burn_mob_template`                  | CHAIN-NECESSARY | sdk sdk/src/sui/write/admin.js:29                              |
| mob_template           | `mint`                               | CHAIN-NECESSARY | other test/gold/fixtures/fight_fixtures.mjs:351                |
| mob_template           | `mob_ap`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/mob_template_tests.move:164       |
| mob_template           | `mob_base_hp`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/mob_template_tests.move:163       |
| mob_template           | `mob_loot`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/mob_template_tests.move:45        |
| mob_template           | `mob_max_level`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/mob_template_tests.move:43        |
| mob_template           | `mob_min_level`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/mob_template_tests.move:42        |
| mob_template           | `mob_mp`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/mob_template_tests.move:165       |
| mob_template           | `mob_spells`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/mob_template_tests.move:465       |
| mob_template           | `mob_stats`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/mob_template_tests.move:167       |
| mob_template           | `mob_xp_reward`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/mob_template_tests.move:44        |
| mob_template           | `set_loot`                           | CHAIN-NECESSARY | other move/scripts/apply_loot_payload.mjs:356                  |
| mob_template           | `set_spells`                         | CHAIN-NECESSARY | other move/scripts/apply_spells_payload.mjs:454                |
| mob_template           | `set_stats`                          | CHAIN-NECESSARY | other move/scripts/apply_xp_payload.mjs:300                    |
| mob_template           | `template_id`                        | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/mob_template_test... |
| pet                    | `feed`                               | DEAD-NO-CALLER  | no caller in any surface                                       |
| pet                    | `feed_count`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/pet_tests.move:163                |
| pet                    | `feed_pet`                           | CHAIN-NECESSARY | sdk sdk/src/game.js:222                                        |
| pet                    | `food_power`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/pet_tests.move:207                |
| pet                    | `full_feed_count`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/pet_tests.move:208                |
| pet                    | `has_food`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/pet_tests.move:206                |
| pet                    | `has_last_feed_day`                  | RPC-MIRRORED    | 1 move call                                                    |
| pet                    | `last_feed_day`                      | RPC-MIRRORED    | 1 move call                                                    |
| pet                    | `next_feed_available_ms`             | RPC-MIRRORED    | move-test move/aresrpg/tests/pet_tests.move:165                |
| pet                    | `set_food_power`                     | CHAIN-NECESSARY | other move/scripts/seed_testnet.mjs:563                        |
| progression            | `level_from_xp`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/progression_tests.move:33         |
| progression            | `max_hp`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/progression_tests.move:118; 4 ... |
| progression            | `points_for_level_range`             | RPC-MIRRORED    | move-test move/aresrpg/tests/progression_tests.move:46; 2 m... |
| progression            | `regen_hp`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/progression_tests.move:135; 2 ... |
| progression            | `xp_add_with_cap_discard`            | RPC-MIRRORED    | move-test move/aresrpg/tests/progression_tests.move:69; 2 m... |
| results                | `character`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/results_tests.move:95             |
| results                | `fight_id`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/results_tests.move:96             |
| results                | `final_hp`                           | CHAIN-NECESSARY | move-test move/aresrpg/tests/results_tests.move:97             |
| results                | `is_pvp`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/results_tests.move:100            |
| results                | `loot_effective_bp`                  | RPC-MIRRORED    | move-test move/aresrpg/tests/fight_seam_tests.move:557; 1 m... |
| results                | `open_taken`                         | CHAIN-NECESSARY | sdk sdk/src/fight.js:943                                       |
| results                | `outcome`                            | CHAIN-NECESSARY | move-test move/aresrpg/tests/results_tests.move:99             |
| results                | `rolled_qty`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/results_tests.move:103            |
| results                | `team`                               | RPC-MIRRORED    | move-test move/aresrpg/tests/results_tests.move:101            |
| results                | `winner_team`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/results_tests.move:102            |
| results                | `xp_share`                           | CHAIN-NECESSARY | move-test move/aresrpg/tests/results_tests.move:98             |
| scribe                 | `band`                               | RPC-MIRRORED    | move-test move/aresrpg/tests/scribe_tests.move:43              |
| scribe                 | `has_band`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/scribe_tests.move:39              |
| scribe                 | `set_band`                           | CHAIN-NECESSARY | other move/scripts/seed_testnet.mjs:386                        |
| shop                   | `burn_sale`                          | CHAIN-NECESSARY | sdk sdk/src/sui/write/admin.js:51                              |
| shop                   | `create_sale`                        | CHAIN-NECESSARY | other test/gold/fixtures/market_bootstrap.mjs:28               |
| shop                   | `end_ms`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/shop_tests.move:275               |
| shop                   | `is_paused`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/shop_tests.move:638               |
| shop                   | `minted`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/shop_tests.move:301               |
| shop                   | `price`                              | RPC-MIRRORED    | move-test move/aresrpg/tests/shop_tests.move:635               |
| shop                   | `sale_template`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/shop_tests.move:276               |
| shop                   | `set_paused`                         | CHAIN-NECESSARY | move-test move/aresrpg/tests/shop_tests.move:562               |
| shop                   | `set_price`                          | CHAIN-NECESSARY | other move/scripts/topup_sales.mjs:106                         |
| shop                   | `set_window`                         | CHAIN-NECESSARY | move-test move/aresrpg/tests/shop_tests.move:196               |
| shop                   | `start_ms`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/shop_tests.move:274               |
| shop                   | `supply`                             | RPC-MIRRORED    | move-test move/aresrpg/tests/shop_tests.move:360               |
| spell_level            | `raise_spell_level`                  | CHAIN-NECESSARY | sdk sdk/src/game.js:142                                        |
| version                | `assert_enabled`                     | CHAIN-NECESSARY | pkg dungeon+forgemagie+gifting+kolizeum; move-test? move/ar... |
| version                | `assert_latest`                      | CHAIN-NECESSARY | pkg dungeon+forgemagie+gifting+kolizeum; 54 move calls         |
| version                | `current_version`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:666              |
| version                | `is_enabled`                         | RPC-MIRRORED    | move-test? move/aresrpg/tests/admin_tests.move:644             |
| version                | `package_version`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/admin_tests.move:666              |
| world                  | `add_dungeon_room`                   | CHAIN-NECESSARY | other move/scripts/seed_testnet.mjs:912                        |
| world                  | `add_mob_entry`                      | CHAIN-NECESSARY | other move/scripts/seed_tier1_bootstrap.mjs:204                |
| world                  | `add_resource_entry`                 | CHAIN-NECESSARY | test move/scripts/seed_full_corpus.test.mjs:48                 |
| world                  | `assert_in_bounds`                   | CHAIN-NECESSARY | 1 move call                                                    |
| world                  | `biome`                              | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:171              |
| world                  | `boss_mask`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:91; 1 move call  |
| world                  | `bounds_x`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:173; 3 move c... |
| world                  | `bounds_z`                           | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:174; 3 move c... |
| world                  | `clear_rare_link`                    | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:357              |
| world                  | `clear_tables`                       | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:121              |
| world                  | `create_world`                       | CHAIN-NECESSARY | other test/gold/fixtures/fight_fixtures.mjs:370                |
| world                  | `destroy_world`                      | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:411              |
| world                  | `drain_world_links`                  | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:443              |
| world                  | `dungeon_key_template`               | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/world_tests.move:273 |
| world                  | `dungeon_room`                       | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/sibling_brand_tes... |
| world                  | `max_groups`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:181; 1 move call |
| world                  | `max_nodes`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:183; 2 move c... |
| world                  | `me_max_group`                       | RPC-MIRRORED    | 1 move call                                                    |
| world                  | `me_min_group`                       | RPC-MIRRORED    | 1 move call                                                    |
| world                  | `me_rate_bp`                         | RPC-MIRRORED    | 2 move calls                                                   |
| world                  | `me_template`                        | RPC-MIRRORED    | 2 move calls                                                   |
| world                  | `min_groups`                         | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:180; 1 move call |
| world                  | `min_nodes`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:182; 2 move c... |
| world                  | `mob_count`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:281              |
| world                  | `mob_entry`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:284              |
| world                  | `mob_level`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:439              |
| world                  | `mob_levels_snapshot`                | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:509; 1 move call |
| world                  | `mobs_snapshot`                      | RPC-MIRRORED    | 1 move call                                                    |
| world                  | `pet_equipped`                       | RPC-MIRRORED    | 3 move calls                                                   |
| world                  | `protector_bp`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:179; 1 move call |
| world                  | `rare_link`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:352; 1 move call |
| world                  | `re_job`                             | RPC-MIRRORED    | 2 move calls                                                   |
| world                  | `re_max_qty`                         | RPC-MIRRORED    | 1 move call                                                    |
| world                  | `re_min_qty`                         | RPC-MIRRORED    | 1 move call                                                    |
| world                  | `re_rate_bp`                         | RPC-MIRRORED    | 1 move call                                                    |
| world                  | `re_template`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:283; 1 move call |
| world                  | `re_tier`                            | RPC-MIRRORED    | 1 move call                                                    |
| world                  | `required_level`                     | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:172; 1 move call |
| world                  | `resource_count`                     | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:184              |
| world                  | `resource_entry`                     | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:283              |
| world                  | `resource_protector`                 | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:63; 1 move call  |
| world                  | `resources_snapshot`                 | RPC-MIRRORED    | 1 move call                                                    |
| world                  | `room_count`                         | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/world_tests.move:282 |
| world                  | `room_mobs`                          | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/sibling_brand_tes... |
| world                  | `seed`                               | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/world_tests.move:... |
| world                  | `set_boss_mask`                      | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:96               |
| world                  | `set_bounds`                         | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:208              |
| world                  | `set_density`                        | CHAIN-NECESSARY | other test/gold/lib_gold.mjs:556                               |
| world                  | `set_dungeon_key`                    | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:274              |
| world                  | `set_mob_level`                      | CHAIN-NECESSARY | test move/scripts/seed_full_corpus.test.mjs:138                |
| world                  | `set_protector_bp`                   | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:210              |
| world                  | `set_rare_link`                      | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:353              |
| world                  | `set_required_level`                 | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:206              |
| world                  | `set_resource_protector`             | CHAIN-NECESSARY | test move/scripts/seed_full_corpus.test.mjs:57                 |
| world                  | `set_spawn_zone`                     | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:269              |
| world                  | `set_speed_budget`                   | CHAIN-NECESSARY | other test/gold/lib_gold.mjs:550                               |
| world                  | `set_zone_size`                      | CHAIN-NECESSARY | other test/gold/lib_gold.mjs:552                               |
| world                  | `set_zone_ttl_ms`                    | CHAIN-NECESSARY | move-test move/aresrpg/tests/world_tests.move:267              |
| world                  | `spawn_zone_x`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:178; 3 move c... |
| world                  | `spawn_zone_z`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:271; 3 move c... |
| world                  | `speed_budget`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:177; 2 move c... |
| world                  | `time_ms`                            | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:110              |
| world                  | `travel_ok`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/checkpoint_tests.move:45; 1 mo... |
| world                  | `verify_travel`                      | CHAIN-NECESSARY | move-test move/aresrpg/tests/checkpoint_tests.move:74; 3 mo... |
| world                  | `wait_seconds`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/checkpoint_tests.move:95          |
| world                  | `x`                                  | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/zone_format_dispa... |
| world                  | `z`                                  | CHAIN-NECESSARY | pkg dungeon; move-test move/aresrpg/tests/zone_format_dispa... |
| world                  | `zone_of`                            | RPC-MIRRORED    | other move/scripts/qa/smoke_lineage4.mjs:79; 4 move calls      |
| world                  | `zone_origin`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:318; 2 move c... |
| world                  | `zone_size`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:175; 2 move c... |
| world                  | `zone_ttl_ms`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/world_tests.move:176; 1 move call |
| zones                  | `claim_mob_group`                    | CHAIN-NECESSARY | other move/scripts/qa/smoke_lineage4.mjs:96                    |
| zones                  | `claim_mob_group_in_zone`            | CHAIN-NECESSARY | move-test move/aresrpg/tests/fight_seam_tests.move:96          |
| zones                  | `claim_mob_group_in_zone_members`    | CHAIN-NECESSARY | dyn sdk/src/fight.js:249                                       |
| zones                  | `claim_mob_group_in_zone_with_proof` | CHAIN-NECESSARY | move-test move/aresrpg/tests/zone_group_proof_tests.move:173   |
| zones                  | `claim_mob_group_members`            | CHAIN-NECESSARY | move-test move/aresrpg/tests/member_claim_tests.move:180       |
| zones                  | `claim_mob_group_with_proof`         | CHAIN-NECESSARY | move-test move/aresrpg/tests/zone_group_proof_tests.move:152   |
| zones                  | `drain_zones`                        | CHAIN-NECESSARY | move-test move/aresrpg/tests/zones_tests.move:195              |
| zones                  | `group_round`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/fight_door_tests.move:288; 3 m... |
| zones                  | `mob_bitmap_bytes`                   | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:630              |
| zones                  | `mob_group_live`                     | RPC-MIRRORED    | move-test move/aresrpg/tests/fight_door_tests.move:286; 2 m... |
| zones                  | `res_bitmap_bytes`                   | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:320              |
| zones                  | `resource_remaining`                 | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:171; 1 move call |
| zones                  | `zone_discovered_at`                 | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:275              |
| zones                  | `zone_exists`                        | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:168              |
| zones                  | `zone_seed`                          | RPC-MIRRORED    | move-test move/aresrpg/tests/zone_format_dispatch_tests.mov... |
| zones_view             | `mob_group_count`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:169              |
| zones_view             | `mob_group_pos`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/zone_format_dispatch_tests.mov... |
| zones_view             | `mob_group_size`                     | RPC-MIRRORED    | move-test move/aresrpg/tests/fight_seam_tests.move:256         |
| zones_view             | `mob_group_total`                    | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:655; 1 move call |
| zones_view             | `mob_spawn_id`                       | RPC-MIRRORED    | other move/scripts/qa/smoke_lineage4.mjs:90; 1 move call       |
| zones_view             | `resource_job`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:274              |
| zones_view             | `resource_node_count`                | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:170              |
| zones_view             | `resource_node_total`                | RPC-MIRRORED    | move-test move/aresrpg/tests/gathering_tests.move:434; 1 mo... |
| zones_view             | `resource_pos`                       | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:480              |
| zones_view             | `resource_template`                  | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:273              |
| zones_view             | `resource_tier`                      | RPC-MIRRORED    | move-test move/aresrpg/tests/zones_tests.move:172              |

### Dead rows in full

- `character_link::pass`
- `character_link::world`
- `pet::feed`

`pet::feed` declares every parameter underscore-prefixed and is superseded by
`pet::feed_pet` (called from `packages/sdk`); `character_link::pass` and
`character_link::world` are `Option<ID>` readers with no reader left.
