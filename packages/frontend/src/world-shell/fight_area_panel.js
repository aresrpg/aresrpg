// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// short_fighter_id lives in character_name_resolve.js (07-19 "ONE HOME" — the same fallback the live
// fight-HUD roster now shares). Import it directly so this panel cannot become a second public formatting door.
import { short_fighter_id } from './character_name_resolve.js'

/**
 * Detail model for the big two-column hover card. Player identity comes from id-keyed Character docs. The
 * opponent column resolves the mob-group NAME from the fight's `group_template` (the homogeneous MobTemplate id
 * the /v1/fights view now serves, projected from zones::MobGroupClaimed) through `mob_names` — the client's ONE
 * catalog home (use_dungeon: group_template id → name, fed by world_spawns' nearby group cards + the fight
 * board's own resolver). Every opponent in a homogeneous group shares that base name; the ordinal distinguishes
 * them (e.g. "Draugr #1", "Draugr #2"). An unresolved id — or a fight with no group_template (old/pre-arm, or a
 * ticketless ambush/PvP fight) — leaves `name` null, and the renderer falls back to the honest "Enemies #N".
 * @param {any} marker @param {Map<string, any>} characters @param {Record<string,string>} mob_names
 */
export function fight_hover_teams(marker, characters = new Map(), mob_names = {}) {
  const players = (marker?.participant_ids ?? []).map((id) => {
    const character = characters.get(id)
    return {
      id,
      name: character?.name || short_fighter_id(id),
      level: Number(character?.level ?? 0) || null,
      class_name: character?.class ?? character?.classe ?? null,
    }
  })
  const group_name = marker?.group_template ? (mob_names?.[marker.group_template] ?? null) : null
  const opponents = Array.from({ length: Math.max(0, Number(marker?.mob_count ?? 0)) }, (_, index) => ({
    id: `opponent-${index + 1}`,
    ordinal: index + 1,
    name: group_name,
  }))
  return { players, opponents }
}

/**
 * True when at least one of the VIEWER's own characters is seated on the player side of this fight — the
 * gate for the hover card's team-title copy (#498): a fight browsed in the world list is someone else's
 * "party" until proven otherwise, so the label must be viewer-relative, never a blanket "Your party".
 * @param {{ id: string }[]} players fight_hover_teams(...).players
 * @param {Set<string> | Iterable<string> | null | undefined} my_character_ids the viewer's own character ids
 */
export function viewer_has_fighter(players, my_character_ids) {
  const mine = my_character_ids instanceof Set ? my_character_ids : new Set(my_character_ids ?? [])
  return (players ?? []).some((player) => mine.has(player.id))
}
