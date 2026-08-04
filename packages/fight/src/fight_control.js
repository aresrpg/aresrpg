// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Character-level control selectors for on-chain fights. A participant's character id is the
// entity identity; its owner address is authorization metadata. Keeping those two facts separate
// prevents multiple characters owned by one wallet from collapsing into one renderer/input row.
//
// The two roster-row IDENTITY predicates moved to participant_identity.js (#2210): they are the core's join
// vocabulary — the fold, the projections and the identity book all match seats through them — while everything
// below is a CONTROL selector a consumer surface legitimately calls. Read that file's header for the gate.

import { participant_character_id } from './participant_identity.js'

// The mob-id vocabulary moved beside the roster identity it is the other half of (#2219: the one fold-key
// resolver lives there and cannot import a module that imports it). Re-exported here because this is the
// CONSUMER-facing path — the arch gate keeps consumer surfaces out of participant_identity.js itself.
export { mob_entity_id, mob_entity_index } from './participant_identity.js'

/**
 * Chain-derived character ids this wallet may control, in fight seat/group order.
 * Rows owned by anybody else are deliberately excluded.
 * @param {any[]} participants
 * @param {string | null | undefined} my_address
 * @returns {string[]}
 */
export function controlled_character_ids(participants, my_address) {
  if (!my_address) return []
  const ids = []
  const seen = new Set()
  for (const participant of participants ?? []) {
    if (participant?.addr !== my_address) continue
    const id = participant_character_id(participant)
    if (!id || seen.has(id)) continue
    seen.add(id)
    ids.push(id)
  }
  return ids
}

/**
 * The owned character whose turn is currently active, otherwise null. Non-owned actors remain
 * spectated even when the wallet controls another participant in the same fight.
 * @param {string | null | undefined} active_entity_id
 * @param {string[]} controlled_ids
 * @returns {string | null}
 */
export function active_controlled_character_id(active_entity_id, controlled_ids) {
  return active_entity_id && controlled_ids.includes(active_entity_id) ? active_entity_id : null
}

/**
 * Auto-select an owned active actor; off-turn, retain a valid manual selection or fall back to the
 * first owned seat. This never selects a non-owned entity.
 * @param {{ active_entity_id?: string|null, current_id?: string|null, controlled_ids?: string[] }} input
 * @returns {string | null}
 */
export function selected_controlled_character_id({ active_entity_id, current_id, controlled_ids = [] }) {
  return (
    active_controlled_character_id(active_entity_id, controlled_ids) ??
    (current_id && controlled_ids.includes(current_id) ? current_id : null) ??
    controlled_ids[0] ??
    null
  )
}

/** Auto-selection happens only on first sight/resume or a real chain turn boundary, never every poll. */
export function should_auto_select_active({
  current_fight_id,
  next_fight_id,
  current_active_id,
  next_active_id,
  current_deadline_ms,
  next_deadline_ms,
}) {
  return (
    current_fight_id !== next_fight_id ||
    current_active_id !== next_active_id ||
    current_deadline_ms !== next_deadline_ms
  )
}

/** @param {string | null | undefined} character_id @param {string[]} controlled_ids */
export function can_select_controlled_character(character_id, controlled_ids) {
  return !!character_id && controlled_ids.includes(character_id)
}

/**
 * Character id safe to pass to a gameplay transaction. A manually selected id is used only when
 * the chain-derived controlled set contains it; otherwise the existing single-character fallback wins.
 * @param {any} fight
 * @param {string | null | undefined} fallback_id
 * @returns {string | null}
 */
export function transaction_character_id(fight, fallback_id) {
  const controlled_ids = fight?.controlled_entity_ids ?? []
  return can_select_controlled_character(fight?.my_entity_id, controlled_ids)
    ? fight.my_entity_id
    : (fallback_id ?? null)
}

/** Immutable character-keyed update for the pending local cast/VFX label. */
export function set_character_cast_key(keys, character_id, name_key) {
  const next = new Map(keys ?? [])
  if (!character_id) return next
  if (name_key) next.set(character_id, name_key)
  else next.delete(character_id)
  return next
}

/** Consume one character's pending cast/VFX label without touching another owned character. */
export function take_character_cast_key(keys, character_id) {
  const next = new Map(keys ?? [])
  const name_key = character_id ? (next.get(character_id) ?? null) : null
  if (character_id) next.delete(character_id)
  return { name_key, keys: next }
}
