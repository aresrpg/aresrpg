// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Forge vocabulary shared by the runeforge workbench and the bag's item actions (one home).

import { craft_job_of, job_level_from_xp, rune_effect } from '@aresrpg/immutable'
import { CONTRACT_CONSTANTS } from '@aresrpg/fight/move_contract'
import type { CharacterRow, ItemRow } from '@aresrpg/protocol'

export const RUNE_UNLOCK_LEVEL = Number(CONTRACT_CONSTANTS.rune_unlock_level)

/** Crushable/scribeable gear: a rolled stat block + a category with a forgery job (never keys). */
export const is_forge_gear = (item: Readonly<ItemRow>): boolean =>
  !!item.stats && item.category !== 'key' && craft_job_of(item.category) !== null

export const is_rune = (item: Readonly<ItemRow>): boolean =>
  item.category === 'rune' && rune_effect(item.item_type) !== null

export const has_runeforge_job_level = (
  category: string,
  jobs: Readonly<CharacterRow['jobs']>,
  required_level: number
): boolean => {
  const job = craft_job_of(category)
  return job !== null && job_level_from_xp(Number(jobs[job] ?? 0)) >= required_level
}
