// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The hacker cool-off (owner 2026-08-19): an address the server DROPPED for cheating (speed,
// flood) cannot reconnect for a while. Deliberately stateless beyond this pod's memory — an
// expiring LRU, no store, no cross-pod sync: a banned client that lands on another pod just
// gets caught again by the same laws there.

import { VIOLATION_DROP_REASONS } from '@aresrpg/protocol'

const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_CAPACITY = 10_000

/** The drop reasons that earn a cool-off — the ONE violation set the wire contract declares
 *  (the client's red connection state keys on the same home). */
export const BANNABLE_REASONS: ReadonlySet<string> = VIOLATION_DROP_REASONS

export type BanList = Readonly<{
  ban: (address: string) => void
  is_banned: (address: string) => boolean
}>

export const create_ban_list = ({
  ttl_ms = DEFAULT_TTL_MS,
  capacity = DEFAULT_CAPACITY,
  now = () => Date.now(),
}: Readonly<{ ttl_ms?: number; capacity?: number; now?: () => number }> = {}): BanList => {
  /** address → banned_until — insertion-ordered, so the first key is always the oldest */
  const banned = new Map<string, number>()
  return Object.freeze({
    ban: (address) => {
      banned.delete(address) // re-insert to the tail — a repeat offense refreshes recency
      banned.set(address, now() + ttl_ms)
      if (banned.size > capacity) banned.delete(banned.keys().next().value!)
    },
    is_banned: (address) => {
      const until = banned.get(address)
      if (until === undefined) return false
      if (until <= now()) {
        banned.delete(address)
        return false
      }
      return true
    },
  })
}
