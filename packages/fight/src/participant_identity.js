// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight/participant_identity.js — WHICH FIGHTER IS THIS ROSTER ROW. The fold, the projections and the identity
// book all join on this answer, so it has exactly one home and no consumer surface may re-derive it (#2210:
// seat presence had three homes, and the two matchers below already disagreed on an addr-keyed seat — a
// wrong-false held the joiner's `fight_syncing` chip forever). Seat FACTS derived from these predicates are
// published by the board projection (`board_view`: each escrow row's `id`, plus `my_seat_present`); a surface
// that imports these predicates to match seats itself is a fourth home being born, and the arch gate
// (`fight-identity-single-surface`) says so mechanically.
//
// Split out of fight_control.js, whose remaining exports are the CONTROL selectors (which owned character is
// selectable/active/transactable) — consumer-facing by design. These two are the core's identity vocabulary.

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
