// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { decode_fight } from '@aresrpg/sdk/fight'

import { is_gone_error, read_object } from './run_reads.js'

const LIVE_FIGHT_STATUSES = new Set([0, 1]) // placement | active

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
  return LIVE_FIGHT_STATUSES.has(Number(fight.status))
    ? { state: 'live', read, fight }
    : { state: 'settled', read, fight }
}
