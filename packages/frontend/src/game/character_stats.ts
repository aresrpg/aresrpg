// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Character stat derivations — display twins of the chain's own math, computed from the
// projected rows the server pushes. Sources of truth: move-math/item_stats.move (fold),
// progression.move (hp), fight/move_contract (base pools). Everything here is a pure
// transform over CharacterRow — nothing is fetched, nothing is authoritative.

import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import { item_stat_center, stat_names, type StatName } from '@aresrpg/immutable'
import type { CharacterRow, EquippedItem } from '@aresrpg/protocol'

const SHIFT = item_stat_center
const BASE_HP = Number(CONTRACT_CONSTANTS.base_hp)
const HP_PER_LEVEL = Number(CONTRACT_CONSTANTS.hp_per_level)
const BASE_AP = Number(CONTRACT_CONSTANTS.base_ap)
const BASE_MP = Number(CONTRACT_CONSTANTS.base_mp)
/** progression.move:19 — one hp per second, game-wide. */
const HP_REGEN_MS_PER_HP = 1_000
/** pet.move MAX_FEEDS — 60 feeds = full power. */
export const PET_MAX_FEEDS = 60

const RAW_MAX = 65_535

/** One equipped item's SIGNED contribution to one stat. A PET contributes its POWER-scaled
 *  block (api.move equip_item → pet::scaled_stats: each side's magnitude floors by
 *  power/60 away from the center), everything else its raw roll. */
export const equipped_stat_offset = (item: Readonly<EquippedItem>, stat: StatName): number => {
  const offset = (item.stats?.[stat] ?? SHIFT) - SHIFT
  if (item.category !== 'pet') return offset
  const power = Math.min(PET_MAX_FEEDS, Math.max(0, item.pet_power ?? 0))
  return offset >= 0 ? Math.floor((offset * power) / PET_MAX_FEEDS) : -Math.floor((-offset * power) / PET_MAX_FEEDS)
}

/** item_stats.move `fold`, twinned: sum every block's centered offsets per stat (pets
 *  power-scaled), clamp to the raw u16 domain. Returns RAW centered values (SHIFT = neutral). */
export const fold_equipment_stats = (equipment: readonly Readonly<EquippedItem>[]): Record<StatName, number> =>
  Object.fromEntries(
    stat_names.map((stat) => {
      const offset = equipment.reduce((total, item) => total + equipped_stat_offset(item, stat), 0)
      return [stat, Math.max(0, Math.min(RAW_MAX, SHIFT + offset))]
    })
  ) as Record<StatName, number>

/** The centered gear contribution for one stat, signed (0 when bare). */
export const equipment_bonus = (character: Readonly<CharacterRow>, stat: StatName): number =>
  (character.folded_stats?.[stat] ?? SHIFT) - SHIFT

/** progression.move `max_hp`: 50 + 5×level + allocated vitality + gear vitality (floored at 1). */
export const character_max_hp = (character: Readonly<CharacterRow>): number =>
  Math.max(1, BASE_HP + HP_PER_LEVEL * character.level + character.vitality + equipment_bonus(character, 'vitality'))

/** progression.move `touch`, read-only: lazy 1 hp/s regen off the last chain write; a
 *  character whose hp DF never initialized is at full health. */
export const projected_hp = (character: Readonly<CharacterRow>, now_ms: number): number => {
  const max = character_max_hp(character)
  if (character.hp === undefined || character.hp_ms === undefined) return max
  const elapsed = Math.max(0, now_ms - character.hp_ms)
  return Math.min(max, Number(character.hp) + Math.floor(elapsed / HP_REGEN_MS_PER_HP))
}

export const action_points = (character: Readonly<CharacterRow>): number =>
  BASE_AP + equipment_bonus(character, 'action')

export const movement_points = (character: Readonly<CharacterRow>): number =>
  BASE_MP + equipment_bonus(character, 'movement')

/** Total of one allocatable characteristic: allocated base + centered gear bonus. */
export const total_stat = (character: Readonly<CharacterRow>, stat: StatName): number => {
  const base =
    stat === 'vitality' ||
    stat === 'wisdom' ||
    stat === 'strength' ||
    stat === 'intelligence' ||
    stat === 'chance' ||
    stat === 'agility'
      ? character[stat]
      : 0
  return base + equipment_bonus(character, stat)
}
