// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

export {
  experience_curve,
  craft_required_level,
  craft_xp_from_ingredient_count,
  job_experience_curve,
  job_level_from_xp,
  job_max_level,
  job_xp_for_level,
  level_from_xp,
  max_level,
  tier_unlock_level,
  xp_for_level,
} from './experience.ts'
export {
  characteristic_names,
  class_names,
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
export { rune_effect, type RuneEffect, type RuneTier } from './rune.ts'
export {
  item_budget_envelope,
  item_budget_stat_weight,
  item_budget_stat_weights,
  item_damage_line_weight,
  type ItemBudgetEnvelope,
} from './item_power.ts'
export {
  character_consumable_types,
  craft_job_of,
  accessory_categories,
  armor_categories,
  consumable_types,
  cosmetic_item_categories,
  element_names,
  equipment_categories,
  item_categories,
  item_is_stackable,
  item_stat_center,
  is_item_category,
  is_equipment_category,
  is_tool_category,
  is_weapon_category,
  stackable_item_categories,
  tool_categories,
  weapon_categories,
  type CharacterConsumableType,
  type ConsumableType,
  type ElementName,
  type EquipmentCategory,
  type ItemCategory,
  type WeaponCategory,
} from './item.ts'
export { chain_to_client_coordinate, client_to_chain_coordinate, world_center, world_size } from './world.ts'
export {
  character_equipment_slots,
  combat_equipment_slots,
  cosmetic_slots,
  equipment_slot_accepts,
  relic_slots,
  rig_slots,
  type CharacterEquipmentSlot,
} from './equipment.ts'
