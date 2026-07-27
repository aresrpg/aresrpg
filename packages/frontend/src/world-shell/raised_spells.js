// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// THE SEAT'S RAISED SPELLS (#1206) — the ONE home every fight-entry door reads its `raised_spell_ids` from.
//
// `fight::combatant_of` (aresrpg/sources/fight.move) snapshots a seat's LEARNED level for EXACTLY the
// SpellTemplate ids the entry PTB names; an id the client never names reads as the free baseline 1 forever,
// however many points the character invested (participant.move `spell_level_of`: absent ⇒ 1). Move cannot walk
// a character's dynamic fields, so naming the ids IS the client's half of the F-07 contract — and every door
// used to default that vector to `[]`, seating a level-1 kit in every fight while the grimoire showed the real
// level. The chain was right the whole time; it was answering a question nobody asked.
//
// The read is the SAME chain-true allocation read the grimoire uses (chain/read_spell_state.js — the
// SpellLevelKey DFs), so an upgrade is visible to a fight the moment it is visible to the book: one home per
// fact. Only spells past the free baseline are named — the snapshot drops level-1 entries anyway, so the vector
// stays as small as the character's actual investment. A failed read THROWS: a fight entry burns gas, and
// seating a silently downgraded kit is the very bug this closes.

import { read_spell_state } from '../chain/read_spell_state.js'
import { class_spells } from '../game/screens/hud/fight-spells.js'
import { context } from '../game/store.js'

/**
 * The SpellTemplate object ids this character has invested past level 1 — the `raised_spell_ids` every fight
 * create/join PTB carries. Empty for an unseeded class or a kit still at the free baseline.
 * @param {string} character_id
 * @returns {Promise<string[]>}
 */
export async function raised_spell_ids_for(character_id) {
  const character = (context.get_state().sui?.characters ?? []).find((row) => row.id === character_id)
  // A seat we cannot name a class for cannot be asked for its levels — and seating a silently level-1 kit is
  // the bug itself, so the degrade SHOUTS instead of passing for normal (mirrors the spell-corpus loader).
  if (!character)
    console.error(`[raised-spells] ${character_id} is not in the roster — its fight kit seats at the free baseline.`)
  const ids = class_spells(character?.classe ?? character?.class_id)
    .map((spell) => spell.object_id)
    .filter(Boolean)
  if (!ids.length) return []
  const { levels } = await read_spell_state(character_id, ids)
  return ids.filter((id) => Number(levels[id] ?? 1) > 1)
}
