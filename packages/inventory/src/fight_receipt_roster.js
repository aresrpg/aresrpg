// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Post-fight receipt → roster patch. ResultOpened carries the XP delta; the same settlement receipt's correlated
// ResultMinted carries exact final HP. Apply both before any later roster enrichment read. Pure + immutable.

import { experience_to_level } from '@aresrpg/sdk/experience'

/**
 * @param {any[]} characters
 * @param {{ character_id:string, xp_share?:number|null, final_hp?:number|null, now?:number }} receipt
 * @returns {any[]} the original array when no matching/usable receipt field exists
 */
export function apply_fight_receipt_to_roster(
  characters,
  { character_id, xp_share = null, final_hp = null, now = Date.now() }
) {
  if (!Array.isArray(characters) || !character_id) return characters
  const index = characters.findIndex((character) => character?.id === character_id)
  if (index === -1) return characters
  const current = characters[index]
  const patch = {}

  const xp_delta = Number(xp_share)
  if (xp_share != null && Number.isFinite(xp_delta) && xp_delta > 0) {
    const before = Math.max(0, Number(current.experience ?? 0))
    const experience = before + xp_delta
    const levels_gained = Math.max(0, experience_to_level(experience) - experience_to_level(before))
    patch.experience = experience
    patch.level = experience_to_level(experience)
    if (levels_gained > 0)
      patch.available_points = Math.max(0, Number(current.available_points ?? 0)) + levels_gained * 5
  }

  const hp = Number(final_hp)
  if (final_hp != null && Number.isFinite(hp)) {
    patch.current_hp = hp
    patch.hp_updated_ms = now
  }

  if (Object.keys(patch).length === 0) return characters
  const next = characters.slice()
  next[index] = { ...current, ...patch }
  return next
}
