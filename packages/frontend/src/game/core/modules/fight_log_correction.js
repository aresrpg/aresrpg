// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// fight_log_correction.js — the ONE reader of an adopted divergence's correction (#2151).
//
// My own cast writes its combat-log line at the click, from the prediction, because the log must stream at its
// beats rather than dump a turn late. When the chain adopts a DIFFERENT amount, that line is the only surface
// left holding a number nothing else in the client still believes: the fold, the HP bar and the board all
// reconciled, while the history kept the predicted 7 against a committed 8 (#2145 §5, the caster's trace).
//
// It could not simply be re-played. My own authoritative rows never become a wave turn (fight/fold.js
// `wave_turns_of` filters them out — the prediction already painted them), and forcing them through would fire a
// second floater and a second line for one hit. So the store hands over a CORRECTION instead — victim, kind and
// the priced amount, built in the fight core off the same pricing home a peer's own line is built from — and
// this module spends it as a REPLACEMENT: the same row, the same place in the stream, the right number.

import { emit_effect_line } from './fight.js'

/** The newest combat line this caster wrote about this victim — the one the click emitted, and the only one a
 *  correction may address. Newest-first because reconciliation is FIFO per claim: the pending prediction being
 *  settled is always the most recent unsettled line for that pair. */
const line_for = (message_history, caster_id, target_id) =>
  [...(message_history ?? [])]
    .reverse()
    .find((row) => row.combat?.caster_id === caster_id && row.combat?.target_id === target_id) ?? null

/**
 * Rewrite the optimistic history line for one adopted divergence. A correction with no line to address writes
 * NOTHING — it is a replacement instruction, never a producer of history (a bare number with no cast above it
 * reads as a hit that never happened).
 * @param {() => any} get_state @param {(type: string, payload: any) => void} dispatch
 * @param {{ entity_id: string, correction: { target_id: string, kind: 'damage'|'heal', amount: number } | null }} arg
 */
export const emit_hit_correction = (get_state, dispatch, { entity_id, correction }) => {
  if (!correction?.target_id) return
  const row = line_for(get_state().message_history, entity_id, correction.target_id)
  if (!row) return
  emit_effect_line(get_state, dispatch, {
    entity_id,
    effect: { target_id: correction.target_id, [correction.kind]: correction.amount, has_health: true },
    is_critical: !!row.combat.is_critical,
    line_id: row.id,
  })
}
