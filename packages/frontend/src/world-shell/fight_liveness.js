// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { decode_fight } from '@aresrpg/sdk/fight'
import { fight_status_of } from '@aresrpg/fight/board_state'

import { is_gone_error, read_object } from './run_reads.js'
import { LIVE_CHAIN_STATUSES, seat_is_dead } from './fight_chain_status.js'

/**
 * Validate a persisted Fight reference before any board/session state is published. Deleted/missing and terminal
 * objects are definitive non-live states; transport failures still throw so callers can hold/retry without lying.
 *
 * `character_id` (#2139) asks the SECOND question a RE-ENTRY needs and settlement does not: is the seat still
 * alive in there? A co-op room fight the character already died in stays chain-ACTIVE for the teammates still
 * playing it, so status alone reads `live` and the resume re-mounts a board where the player has no turn to take
 * and no second forfeit (`actions::abandon` aborts EAlreadyDead/106) — the #2136 wedge, on the dungeon door.
 * OMITTING IT IS THE PRE-#2139 VERDICT, VERBATIM, and that is load-bearing: `fight_claim_latch.js` and
 * `dungeon_settlement.js` read this same door precisely while WAITING for a fight the seat has died in to settle.
 * A dead seat is their normal case, so they must keep seeing `live` — only a re-entry names the seat.
 * @param {any} sdk @param {string|null|undefined} fight_id
 * @param {string|null} [character_id] the seat being re-entered; omitted ⇒ status-only (settlement readers)
 * @returns {Promise<{ state:'live'|'absent'|'settled'|'left', read:any|null, fight:any|null }>}
 */
export async function read_fight_liveness(sdk, fight_id, character_id = null) {
  if (!fight_id) return { state: 'absent', read: null, fight: null }
  let read
  try {
    read = await read_object(sdk, fight_id)
  } catch (error) {
    if (is_gone_error(error)) return { state: 'absent', read: null, fight: null }
    throw error
  }
  if (!read) return { state: 'absent', read: null, fight: null }
  const fight = decode_fight(read.json)
  // A status-less decode is a TORN read (#1277), not a verdict: `Number(null)` is 0 — the placement scalar — so
  // coercing it would publish a fabricated live placement, and calling it 'settled' would evict a player from a
  // fight that never ended. Neither is knowable, so it joins the transport-failure arm: throw, and the caller
  // holds/retries until the record is whole.
  const status = fight_status_of(fight)
  if (status == null) throw new Error(`read_fight_liveness: Fight ${fight_id} decoded without a status (torn read)`)
  if (!LIVE_CHAIN_STATUSES.has(status)) return { state: 'settled', read, fight }
  // Live on chain, but not for THIS seat: death is an exit (D48) and it stays one across boots. Checked after the
  // torn-read throw above, so a corpse is never inferred from an incomplete record.
  if (seat_is_dead(fight, character_id)) return { state: 'left', read, fight }
  return { state: 'live', read, fight }
}
