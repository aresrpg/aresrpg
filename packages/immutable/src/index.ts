// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export {
  experience_progress,
  craft_max_ingredients,
  craft_required_level,
  craft_slot_capacity,
  craft_success_percent,
  craft_xp_at_level,
  craft_xp_from_ingredient_count,
  gather_quantity_bounds,
  gather_time_ms,
  gather_xp,
  job_experience_progress,
  job_level_from_xp,
  job_max_level,
  job_xp_for_level,
  level_from_xp,
  max_level,
  tier_unlock_level,
  xp_for_level,
} from './experience.ts'
export {
  display_address,
  display_suins_name,
  canonical_suins_name,
  application_suins_name,
  chat_suins_prefix,
} from './player_label.ts'
export { model_variant_identity, type ModelVariantIdentity } from './model_variant.ts'
export { archimob_rows, type ArchimobRow } from './archimob.ts'
export {
  characteristic_allocation_quote,
  characteristic_cost_step,
  characteristic_ladders,
  characteristic_spending_quote,
  characteristic_value_cost,
  characteristic_values_cost,
  type CharacteristicValues,
} from './characteristics.ts'
export {
  gather_gate,
  type GatherGate,
  gatherable_catalog,
  gatherable_item_types,
  gatherable_of,
  rare_pet_food_tier,
  type Gatherable,
  type GatheringJob,
} from './gathering.ts'
export {
  characteristic_names,
  class_names,
  class_spell_shape_errors,
  class_spell_unlocks,
  is_class_name,
  is_job_slug,
  is_stat_name,
  job_groups,
  job_kind_of,
  job_slugs,
  stat_names,
  type ClassName,
  type CharacteristicName,
  type JobSlug,
  type JobKind,
  type StatName,
} from './identity.ts'
export { pet_max_feeds } from './pet.ts'
export { rune_effect, rune_can_apply, format_rune_weight, type RuneEffect, type RuneTier } from './rune.ts'
export {
  dofus_weapon_damage_envelope,
  hero_power,
  item_budget_envelope,
  item_budget_standing,
  item_budget_stat_weight,
  type ItemBudgetEnvelope,
  type ItemBudgetStanding,
  type WeaponDamageEnvelope,
} from './item_power.ts'
export {
  acquisition_catalog,
  acquisition_estimator,
  archimob_appearance_bp,
  acquisition_average_seconds,
  acquisition_target_range,
  acquisition_target_status,
  item_acquisition,
  best_recipe_for_job_progression,
  compare_recipe_progress,
  recipe_progression_issues,
  unlocked_recipe_chains,
  type AcquisitionContent,
  type AcquisitionEstimate,
  type AcquisitionIngredient,
  type AcquisitionRange,
  type RecipeProgressionInput,
  type RecipeProgressRecommendation,
} from './acquisition.ts'
export { dofus_mob_power_envelope } from './mob_power.ts'
export {
  craft_job_of,
  consumable_types,
  element_names,
  equipment_categories,
  is_cosmetic_category,
  item_categories,
  item_is_stackable,
  craft_batch_limit,
  craft_stackable_batch_limit,
  item_stat_center,
  is_item_category,
  is_tool_category,
  is_weapon_category,
  stackable_item_categories,
  type CharacterConsumableType,
  type ElementName,
  type ItemCategory,
} from './item.ts'
export {
  mob_band_scaled,
  mob_centered_band_scaled,
  mob_effect_value_scaled,
  mob_loot_chance_scaled,
  mob_pool_scaled,
} from './mob_scaling.ts'
export { chain_to_client_coordinate, client_to_chain_coordinate, world_center, world_size } from './world.ts'
export {
  GROUP_SIZE_AVG3_AT,
  GROUP_SIZE_FULL_AT,
  center_distance,
  distance_ramp,
  mob_group_size_bounds,
} from './zone_math.ts'
export { basis_points, marketplace_lot_sizes, marketplace_royalty_bps } from './marketplace.ts'
export {
  character_equipment_slots,
  cosmetic_slots,
  worn_appearance,
  equipment_slot_accepts,
  relic_slots,
  rig_slots,
  type CharacterEquipmentSlot,
} from './equipment.ts'
export { roll_quality } from './roll_quality.ts'
