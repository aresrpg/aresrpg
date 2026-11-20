// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The one rate limit of every service: an allowance per caller in fixed windows, held in process
// memory. A service takes it at its public door, keyed by whoever is calling (the visitor address
// before authentication, the verified identity after), and never inside a module
// (owner 2026-08-16: one global gate, loose enough). No allowance is ever shared between callers.

/** The HTTP door of every service: 600 requests a minute per caller. */
export const HTTP_DOOR = Object.freeze({ capacity: 600, window_ms: 60_000 })

/**
 * Who is calling before authentication: the visitor address the Cloudflare edge reports. Every public
 * request arrives through the tunnel from the same pod addresses, so the socket address names nobody.
 * The edge overwrites this header, and a service is reachable from outside only through the tunnel.
 */
export const visitor_of = (request: Request): string | null => request.headers.get('cf-connecting-ip')

type Bucket = Readonly<{ count: number; started_at_ms: number }>

export const create_request_limiter = ({
  capacity = 60,
  window_ms = 60_000,
  max_entries = 8_192,
  now = Date.now,
}: Readonly<{
  capacity?: number | (() => number)
  window_ms?: number
  max_entries?: number
  now?: () => number
}> = {}) => {
  const budget = typeof capacity === 'number' ? () => capacity : capacity
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
      if (current.count >= budget()) return false
      buckets.set(key, Object.freeze({ ...current, count: current.count + 1 }))
      return true
    },
    /** Live entry count — the leak observable; diagnostics only. */
    size: (): number => buckets.size,
  })
}

export type RequestLimiter = ReturnType<typeof create_request_limiter>

/**
 * Takes from the visitor's own allowance. A request the edge did not carry came from inside the
 * cluster: it is one of our own services and is never limited (owner 2026-11-18).
 */
export const admit_visitor = (limiter: RequestLimiter, request: Request): boolean => {
  const visitor = visitor_of(request)
  return visitor === null || limiter.take(visitor)
}
