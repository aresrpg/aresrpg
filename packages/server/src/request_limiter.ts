// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// One allowance per authenticated address across every graph-reaching packet — matched at the
// player door against READ_PACKETS, never inside a module (owner 2026-08-16: one global gate,
// loose enough). The server creates one instance for the whole process.

type Bucket = Readonly<{ count: number; started_at_ms: number }>

export const create_request_limiter = ({
  capacity = 60,
  window_ms = 60_000,
  max_entries = 8_192,
  now = Date.now,
}: Readonly<{
  capacity?: number
  window_ms?: number
  max_entries?: number
  now?: () => number
}> = {}) => {
  const buckets = new Map<string, Bucket>()
  return Object.freeze({
    take: (raw_key: string): boolean => {
      const key = raw_key.toLowerCase()
      const at_ms = now()
      const current = buckets.get(key)
      if (!current || at_ms - current.started_at_ms >= window_ms) {
        // Fresh windows re-insert at the tail, so iteration order is window-start order.
        buckets.delete(key)
        if (buckets.size >= max_entries) {
          // GC first: deleting an EXPIRED bucket changes no answer (it restarts on next take).
          for (const [stale_key, bucket] of buckets)
            if (at_ms - bucket.started_at_ms >= window_ms) buckets.delete(stale_key)
          // Still saturated by live windows: evict oldest-first. Forgetting a live count grants
          // requests, so this is the hard memory ceiling only — never routine cleanup.
          for (const [oldest_key] of buckets) {
            if (buckets.size < max_entries) break
            buckets.delete(oldest_key)
          }
        }
        buckets.set(key, Object.freeze({ count: 1, started_at_ms: at_ms }))
        return true
      }
      if (current.count >= capacity) return false
      buckets.set(key, Object.freeze({ ...current, count: current.count + 1 }))
      return true
    },
    /** Live entry count — the leak observable; diagnostics only. */
    size: (): number => buckets.size,
  })
}

export type RequestLimiter = ReturnType<typeof create_request_limiter>
