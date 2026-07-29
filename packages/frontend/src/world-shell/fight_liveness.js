// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { decode_fight } from '@aresrpg/sdk/fight'
import { fight_status_of } from '@aresrpg/fight/board_state'

import { is_gone_error, read_object } from './run_reads.js'
import { LIVE_CHAIN_STATUSES } from './fight_chain_status.js'

/**
 * Validate a persisted Fight reference before any board/session state is published. Deleted/missing and terminal
 * objects are definitive non-live states; transport failures still throw so callers can hold/retry without lying.
 * @param {any} sdk @param {string|null|undefined} fight_id
 * @returns {Promise<{ state:'live'|'absent'|'settled', read:any|null, fight:any|null }>}
 */
export async function read_fight_liveness(sdk, fight_id) {
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
  return LIVE_CHAIN_STATUSES.has(status) ? { state: 'live', read, fight } : { state: 'settled', read, fight }
}
