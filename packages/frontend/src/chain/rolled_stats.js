// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// OWNED-ITEM stat resolution home. The SDK intentionally returns the centered-u16 StatsKey block because
// forgemagie crush consumes that exact chain shape. Display callers resolve through this file, then decode the
// block with the same range decoder templates already use (rolled == min == max), so bias removal, key aliases,
// neutral filtering, and fixed-value collapse cannot drift between owned-item surfaces.

import { decode_item_stat_ranges } from './read_templates.js'

/** @type {Map<string, Promise<Record<string, number>|null>>} */
const rolled_stats_reads = new Map()
const rolled_stats_retry_delays_ms = [350, 850, 1600]

const wait_for_rolled_stats = (delay_ms) =>
  new Promise((resolve_wait) => {
    setTimeout(resolve_wait, delay_ms)
  })

async function read_rolled_stats(item_id) {
  const { get_sdk } = await import('./sdk')
  const sdk = await get_sdk()
  let rolled_stats = await sdk.get_rolled_stats(item_id)
  for (const delay_ms of rolled_stats_retry_delays_ms) {
    if (rolled_stats) return rolled_stats
    await wait_for_rolled_stats(delay_ms)
    rolled_stats = await sdk.get_rolled_stats(item_id)
  }
  return rolled_stats
}

/** Centered StatsKey block -> fixed, real-valued display stats. */
export function display_rolled_stats(rolled_stats) {
  return rolled_stats ? decode_item_stat_ranges(rolled_stats, rolled_stats) : {}
}

/**
 * Read one owned item's centered StatsKey block through the SDK's canonical getter. Null is retried briefly:
 * execute certification can precede dynamic-field readability for a freshly minted item. Concurrent callers
 * share the whole bounded read; settled reads are not cached because forgemagie can mutate the roll.
 * @param {string} item_id
 * @returns {Promise<Record<string, number>|null>}
 */
export function resolve_rolled_stats(item_id) {
  if (!item_id) return Promise.resolve(null)
  const pending_read = rolled_stats_reads.get(item_id)
  if (pending_read) return pending_read

  const read = read_rolled_stats(item_id)
  rolled_stats_reads.set(item_id, read)
  const clear_read = () => {
    if (rolled_stats_reads.get(item_id) === read) rolled_stats_reads.delete(item_id)
  }
  void read.then(clear_read, clear_read)
  return read
}
