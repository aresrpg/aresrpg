# Deletable weight — measurement report

> **EVIDENCE BRANCH ONLY — NEVER BOARDS.** This branch deliberately mutilates Move
> sources to weigh deletion. The surgery is not a product change and must never be
> merged. Only the measured numbers and refined lists are evidence.

## Seat ruling

| State                                                    |  AresRPG size | Delta from baseline | Chain-ceiling margin |
| -------------------------------------------------------- | ------------: | ------------------: | -------------------: |
| Baseline                                                 | **101,865 B** |                   — |            **535 B** |
| Variant A, build-refined                                 | **101,865 B** |             **0 B** |            **535 B** |
| Variant B, current-edge/full-repo refined (97 additions) |  **98,061 B** |        **−3,804 B** |          **4,339 B** |
| Variant B, artifact-exact/Ares-only (100 additions)      |  **97,953 B** |        **−3,912 B** |          **4,447 B** |

The canonical three-number result is therefore **101,865 → 101,865 → 98,061
bytes**. The canonical after-B value is the one for which the complete
`ceremony_preflight_compat.mjs --size-only` run exits zero on current `origin/edge`.
The requested raw 100-row variant is also measured and disclosed because it answers
the artifact-exact counterfactual; it builds AresRPG but current `forgemagie` makes the
full-repo instrument fail after it reports AresRPG at 97,953 B.

Variant A has **0 refined deletable survivors out of 132 initial rows**. Its
per-survivor average is consequently undefined (0 B / 0 functions), not zero as an
estimate of function weight. The build-valid Variant B deletes 97 functions for
3,804 B, or **39.22 B/function**. The artifact-exact 100-function variant deletes
3,912 B, or **39.12 B/function**.

**Four-feature-wave verdict: no after Variant A.** Its new chain-ceiling margin is
only **535 B**, which is already **238 B short of 773 B**, before adding any
“comfortably more than” safety. The repo's tighter 101,900 B budget has only 35 B
left. Build-valid Variant B would instead leave 4,339 B to the chain ceiling and
3,839 B to the repo budget.

## Provenance and commands

| Field                | Value                                                       |
| -------------------- | ----------------------------------------------------------- |
| Measurement date     | 2026-07-30                                                  |
| Evidence branch      | `lane/deletable-weight`                                     |
| Baseline             | `origin/edge` at `ea9595e0795afb8dadc8d5ec7b5c7c942be610cf` |
| Census               | `docs/analysis/ARESRPG_FN_CENSUS_2026-07-30.md`             |
| Census source commit | `903cf9b887fc6284685775da5401820ae8182120`                  |
| Chain ceiling        | 102,400 B                                                   |
| Repo AresRPG budget  | 101,900 B                                                   |

The census artifact was fetched and read before source surgery. The measurements use
the same size code as CI:

```sh
cd packages/move/aresrpg
sui move build

cd ../../..
node packages/move/scripts/ceremony_preflight_compat.mjs --size-only
```

The sandbox could read but not lock the host Move cache, so the two already
cached pinned dependencies were copied to a lane-local cache and the commands were
run with MOVE_HOME pointed at that lane-local cache. This changes
cache placement only.

## Candidate derivation

The census controls reproduce exactly against the baseline disassembly:

- 234 `RPC-MIRRORED` rows total;
- 134 have at least one shipped in-package `Call`;
- 100 have no shipped in-package `Call` and form the artifact's test-only variant.

The prompt's rough `~73` is not valid set arithmetic for the artifact as written.
The census says the 61 off-chain-reached functions are a split of
`CHAIN-NECESSARY`; they are not a 61-row subset of the 134 in-package-called
`RPC-MIRRORED` rows. The table itself also contains four anomalous
`RPC-MIRRORED` rows with explicit off-chain evidence:

- `item_damages::new`
- `item_stats::new`
- `world::zone_of`
- `zones_view::mob_spawn_id`

Only `world::zone_of` and `zones_view::mob_spawn_id` are among the 134 in-package-called
rows. Applying the literal rule—`RPC-MIRRORED`, has a shipped in-package call, not
off-chain-reached, and not test-only—therefore produces **132 initial Variant-A
candidates**.

## Build refinement

All 132 Variant-A signatures and bodies were deleted together. The first
`sui move build` failed because remaining shipped functions call 127 of them. Those
127 were removed from the deletion set and restored. The next build exposed the
five-step cascade:

- `character_link::spell_points_spent`
- `character_link::stat_points_spent`
- `config::base_hp`
- `config::max_reachable_level`
- `progression::points_for_level_range`

Restoring those five made the build pass. The refined Variant-A survivor list is
therefore:

```text
(empty)
```

That passing state remeasured at 101,865 B, exactly the baseline.

For Variant B, deleting all 100 artifact test-only rows makes the AresRPG build pass
and weighs 97,953 B. The full-repo size instrument then finds post-census production
reach introduced on current edge by `6e1e0adb` (`feat(forgemagie): add staged crush
builder`):

- `item::template_name`
- `item::template_description`
- `item::template_item_type`

Restoring those three leaves **97 current-edge/full-repo build-surviving Variant-B
deletions**. AresRPG builds and the full size instrument exits zero at 98,061 B.
This is why the report preserves both after-B measurements instead of disguising
artifact drift as byte noise.

## Exact Variant-A initial list (132)

- `admin`: `contains`
- `character`: `class`, `experience`, `name`, `uid`
- `character_link`: `combat_stats`, `combat_stats_settled`, `has_progression`, `is_locked`, `pet_power`, `spell_level`, `spell_points_spent`, `stat_agility`, `stat_allocated`, `stat_chance`, `stat_count`, `stat_intelligence`, `stat_points_spent`, `stat_strength`, `stat_vitality`, `stat_wisdom`, `unspent_spell_points`, `unspent_stat_points`, `world_field`
- `commission`: `platform_cut_of`
- `config`: `aging_bp_per_hour`, `aging_cap_bp`, `archimob_bp`, `base_ap`, `base_hp`, `base_mp`, `class_id_of`, `class_row`, `domain_crafting`, `domain_fight`, `domain_gathering`, `domain_market`, `listing_level_gate`, `loot_multiplier`, `max_reachable_level`, `placement_ms`, `turn_duration_ms`, `xp_multiplier`
- `consumable_effect`: `is_consumable`
- `crafting`: `craft_xp`, `input_count`, `required_job`, `required_level`
- `equipment`: `any_equipped`, `equipped_weapon_family`, `folded_stats`, `geared_combat_stats_settled`, `pet_equipped`, `tool_equipped_for`
- `fight`: `pending_obligations`
- `item`: `category`, `is_stackable_category`, `template_category`
- `item_damages`: `damages`, `element_id`, `from`, `has_damages`, `has_item_lines`, `item_lines`, `to`
- `item_stats`: `action`, `agility`, `air_resistance`, `chance`, `critical`, `earth_resistance`, `fire_resistance`, `has_ranges`, `intelligence`, `movement`, `pet_full_feed_count`, `range`, `raw_damage`, `scale_from_center`, `shift`, `stats_max`, `stats_min`, `strength`, `vitality`, `water_resistance`, `wisdom`
- `pet`: `has_last_feed_day`, `last_feed_day`
- `progression`: `max_hp`, `points_for_level_range`, `regen_hp`, `xp_add_with_cap_discard`
- `results`: `loot_effective_bp`
- `world`: `boss_mask`, `bounds_x`, `bounds_z`, `max_groups`, `max_nodes`, `me_max_group`, `me_min_group`, `me_rate_bp`, `me_template`, `min_groups`, `min_nodes`, `mob_levels_snapshot`, `mobs_snapshot`, `pet_equipped`, `protector_bp`, `rare_link`, `re_job`, `re_max_qty`, `re_min_qty`, `re_rate_bp`, `re_template`, `re_tier`, `required_level`, `resource_protector`, `resources_snapshot`, `spawn_zone_x`, `spawn_zone_z`, `speed_budget`, `travel_ok`, `zone_origin`, `zone_size`, `zone_ttl_ms`
- `zones`: `group_round`, `mob_group_live`, `resource_remaining`, `zone_seed`
- `zones_view`: `mob_group_pos`, `mob_group_total`, `resource_node_total`

## Exact artifact test-only Variant-B additions (100)

- `admin`: `is_super`
- `character`: `anchor`, `anchor_at_ms`, `anchor_pos_x`, `anchor_pos_z`, `anchor_zone`, `color_1`, `color_2`, `color_3`, `created_at_ms`, `customization`, `male`
- `character_link`: `current_hp`, `progression_hp`
- `commission`: `accepted`, `amount`, `artisan`, `customer`, `recipe`
- `config`: `claim_window_epochs`, `class_count`, `domain_pools`, `domains`, `dungeon_brand`, `forge_brand`, `gifting_brand`, `is_enabled`, `reclaim_cooldown_ms`
- `crafting`: `output_quantity`, `output_template`
- `equipment`: `equipment_attached`, `equipped_weapon`, `geared_combat_stats`
- `item`: `description`, `item_type`, `name`, `template_description`, `template_item_type`, `template_name`
- `item_damages`: `damage_type`, `element`, `midpoint`, `new`
- `item_stats`: `clamp_to`, `critical_chance`, `critical_outcomes`, `new`, `uniform`
- `mob_template`: `mob_ap`, `mob_base_hp`, `mob_loot`, `mob_max_level`, `mob_min_level`, `mob_mp`, `mob_spells`, `mob_stats`, `mob_xp_reward`
- `pet`: `feed_count`, `food_power`, `full_feed_count`, `has_food`, `next_feed_available_ms`
- `progression`: `level_from_xp`
- `results`: `character`, `fight_id`, `is_pvp`, `rolled_qty`, `team`, `winner_team`
- `scribe`: `band`, `has_band`
- `shop`: `end_ms`, `is_paused`, `minted`, `price`, `sale_template`, `start_ms`, `supply`
- `version`: `current_version`, `is_enabled`, `package_version`
- `world`: `biome`, `mob_count`, `mob_entry`, `mob_level`, `resource_count`, `resource_entry`, `time_ms`, `wait_seconds`
- `zones`: `mob_bitmap_bytes`, `res_bitmap_bytes`, `zone_discovered_at`, `zone_exists`
- `zones_view`: `mob_group_count`, `mob_group_size`, `resource_job`, `resource_node_count`, `resource_pos`, `resource_template`, `resource_tier`

The exact current-edge/full-repo refined Variant-B list is the 100-row list above
minus the three `item::template_*` rows named in the refinement section: 97 functions.

## Verification record

- Baseline `sui move build`: pass.
- Baseline size-only instrument: pass; AresRPG 101,865 B.
- Initial Variant A (132 deleted): fail, as intended.
- Refinement step 1 (five still deleted): fail on the five named cascade rows.
- Refined Variant A (zero deleted): build pass; size-only pass; AresRPG 101,865 B.
- Artifact-exact Variant B (100 deleted): AresRPG build pass; AresRPG size reported
  as 97,953 B; later `forgemagie` build fails on the three post-census callers.
- Current-edge/full-repo refined Variant B (97 deleted): AresRPG build pass;
  complete size-only instrument pass; AresRPG 98,061 B.
