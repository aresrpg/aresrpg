// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// spell_wire.mjs — the ONE home for the spell_effect::new_effect SIGNED-VALUE dialect (#1250). CENTERED is the
// canon (#904 final ruling, re-adjudicated on captured chain bytes 2026-07-26): alter_stat (kind 9) and
// alter_resist (kind 11) author BOTH signs, so the chain rides those two kinds' `value` CENTERED at 32768
// (stored = authored + 32768); FLAG_NEGATIVE is a non-semantic hint EMITTED from the delta's sign on encode
// and NEVER read back on decode (decode = stored − 32768 — packages/fight/src/fight_status_snapshot.js is the
// ONE decode home this helper rides on top of). Every other kind's `value` is a plain magnitude — the sites
// that pre-normalize a defensive `Math.abs`/BigInt-abs for those kinds keep doing so; this helper is a no-op
// on an already-non-negative delta, so that convention survives untouched.
//
// Five `new_effect` PTB encoders live under packages/move/scripts/ (apply_spells_payload.mjs, seed_full_corpus.mjs,
// seed_spells_phase.mjs, reseed_plan.mjs → reseed_live.mjs, seed_spells.js) and used to each restate this rule —
// one drifted to a retired pre-#904 magnitude+authored-flag dialect. This is now the one place the rule is
// stated; every site imports it instead of re-deriving it.
import { encode_status_value, is_signed_status_kind } from '../../fight/src/fight_status_snapshot.js'
import { FLAG_NEGATIVE } from '../../sim/src/spell_effect.js'

/**
 * An AUTHORED effect's `value`/`flags` pair → the chain-dialect pair. Signed kinds (9/11) CENTER the value
 * (`encode_status_value`) and DERIVE the FLAG_NEGATIVE bit from the delta's sign — an authored flag that
 * disagrees with the sign is corrected, so the sign lives exactly once. Every other kind's value is a plain
 * magnitude (`Math.abs`, a no-op on an already non-negative delta) and its flags ride verbatim.
 * @param {number} kind
 * @param {number} delta the AUTHORED value — a real signed delta for signed kinds, a magnitude otherwise
 * @param {number} [authored_flags]
 * @returns {{ value: number, flags: number }}
 */
export function encode_effect_value(kind, delta, authored_flags = 0) {
  const signed = is_signed_status_kind(kind)
  return {
    value: signed ? encode_status_value(kind, delta) : Math.abs(delta),
    flags: signed ? (authored_flags & ~FLAG_NEGATIVE) | (delta < 0 ? FLAG_NEGATIVE : 0) : authored_flags,
  }
}
