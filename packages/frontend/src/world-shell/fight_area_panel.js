// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// short_fighter_id moved to character_name_resolve.js (07-19 "ONE HOME" — the same fallback the live
// fight-HUD roster now shares). Re-exported so existing importers of this module are untouched.
import { short_fighter_id } from './character_name_resolve.js'

export { short_fighter_id }

/** Section a stable, already-sorted fight list without turning openness into mutually-exclusive tabs. */
export function section_fight_rows(rows) {
  return [
    { key: 'public', rows: rows.filter((row) => row.public) },
    { key: 'group', rows: rows.filter((row) => !row.public) },
  ]
}

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
