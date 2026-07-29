// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #677 — the fight-entry half of placement liveness. Mob engage, fight-list join, and owned-alt join all route
// a refused seat through dungeon_settlement's shared recovery door; this leaf turns the character-keyed
// `fight_latch::103` into the exact placement fight and asks the shared chain-truth sweeper to advance it.

import { parse_move_abort } from '../game/core/abort_copy.js'
import i18n from '../i18n'

import { sweep_expired_character_placement } from './fight-liquidation.js'
import { error_executed_digest, error_preflight_marked } from './tx_digest_error.js'

/**
 * A proven zero-gas busy refusal may reveal an expired PLACEMENT fight. Force-start it once, then throw copy
 * describing what ACTUALLY happened. Returning means this was not that state; the caller preserves the original
 * refusal/recovery policy. The requested new entry is never retried after a start: the old fight honestly still
 * owns the latch until it is finished and settled.
 * @param {string} character_id
 * @param {unknown} refusal
 * @param {{force_start_door?:(fight_id:string,silent:boolean)=>Promise<any>}} [doors]
 */
export async function surface_expired_placement_entry_refusal(character_id, refusal, doors = {}) {
  const abort = parse_move_abort(refusal)
  if (
    abort?.module !== 'fight_latch' ||
    abort.code !== 103 ||
    error_executed_digest(refusal) ||
    !error_preflight_marked(refusal)
  )
    return

  const swept = await sweep_expired_character_placement(character_id, doors)
  const copy_key =
    swept.state === 'started'
      ? 'errors.fight_character_busy_expired_started'
      : swept.state === 'finished'
        ? 'errors.fight_character_busy_expired_finished'
        : swept.state === 'refused'
          ? 'errors.fight_character_busy_expired_refused'
          : null
  if (!copy_key) return

  // Keep the exact refusal + sweep verdict as DATA without putting the MoveAbort in `.cause`: the toast
  // humanizer intentionally prioritises a cause-chain abort's generic table copy, which would erase this more
  // precise, newly-observed state.
  throw Object.assign(new Error(i18n.t(copy_key)), { refusal, fight_liveness: swept })
}
