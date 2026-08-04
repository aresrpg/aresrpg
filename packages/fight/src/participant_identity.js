// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/participant_identity.js — WHO IS THIS FIGHTER. The fold, the projections and the identity book all join
// on these answers, so they have exactly one home and no consumer surface may re-derive them (#2210: seat
// presence had three homes, and the two matchers below already disagreed on an addr-keyed seat — a wrong-false
// held the joiner's `fight_syncing` chip forever). Seat FACTS derived from these predicates are published by the
// board projection (`board_view`: each escrow row's `id`, plus `my_seat_present`); a surface that imports these
// predicates to match seats itself is a fourth home being born, and the arch gate
// (`fight-identity-single-surface`) says so mechanically.
//
// The MOB half of the same vocabulary lives here too (#2219): `entity_id_of_fold_key` answers for both halves of
// the fold's key space, and it cannot ask a module that asks this one. `fight_control.js` — whose remaining
// exports are the CONTROL selectors (which owned character is selectable/active/transactable), consumer-facing by
// design — re-exports the mob pair, which is the path every consumer surface keeps using.

/** Stable render/input identity of a mob fighter at its chain index. @param {number|string} idx */
export const mob_entity_id = (idx) => `mob-${Number(idx)}`

/** The exact inverse of `mob_entity_id`, or null when the value is not a mob entity id. */
export const mob_entity_index = (entity_id) => {
  const match = /^mob-(\d+)$/.exec(String(entity_id))
  return match ? Number(match[1]) : null
}

/** The character id a participant row names, or null when its character has not landed in the read yet.
 *  @param {any} participant @returns {string | null} */
export function participant_character_id(participant) {
  const id = participant?.character ?? participant?.character_id
  return id ? String(id) : null
}

/** A participant's ENTITY identity — the id every fold key, projection and beat joins on. The owner address is
 *  the fallback precisely because a seat can be addr-keyed before its character row is readable: matching on
 *  the character alone reports "not in the read" for a seat that plainly is.
 *  @param {any} participant @returns {string | null} */
export function participant_entity_id(participant) {
  return participant_character_id(participant) ?? (participant?.addr ? String(participant.addr) : null)
}

/**
 * A fold key (`p{seat}` / `m{idx}`) back to the entity id every presentation surface speaks — the INVERSE of the
 * seat/mob keying, and the ONE home for it (#2219: it had two, and they disagreed on the row below).
 *
 * A seat the roster cannot name answers NULL, never a synthetic `player-<idx>`. That id belongs to no entity in
 * the client, so every consumer that received one was holding an address it could not use: the #2151 corrector
 * has an explicit skip arm for null (`if (!target_id) return rest`) and the synthetic walked straight past it to
 * address a correction at a fighter that does not exist — the rewrite silently never landed. Null makes the skip
 * honest, and it is the answer the projection consumers were already written against (the dev bot's result read
 * DROPS a seat it cannot name; `fight_visible_view` falls through to `ctx.my_entity_id`, a fallback a synthetic
 * would shadow with a lie). A beat PRODUCER may still mint a placeholder — a floater must key on something —
 * but a JOIN never invents the thing it is joining on.
 *
 * @param {any[] | null | undefined} escrow the adopted roster that names its seats
 * @param {string | null | undefined} key @returns {string | null}
 */
export const entity_id_of_fold_key = (escrow, key) => {
  const id = String(key ?? '')
  const idx = Number(id.slice(1))
  if (!Number.isInteger(idx) || idx < 0) return null
  if (id.startsWith('m')) return mob_entity_id(idx)
  if (!id.startsWith('p')) return null
  return participant_entity_id((escrow ?? [])[idx] ?? {})
}
