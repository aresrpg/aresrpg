// Per-IP rate limiting backed by Redis (INCR + EXPIRE).
//
// A fixed window admits up to RATE_LIMIT_MAX requests per RATE_LIMIT_WINDOW_SEC.
// The counter key embeds the window index and is given a TTL on first hit, so it
// self-evicts and memory stays bounded — this is the pragmatic "token bucket
// lite" the architecture calls for: one home for the limit, env-driven, atomic
// on INCR. If burst/refill smoothing is ever needed, swap the body for an EVAL
// token bucket against the same Redis; nothing else changes.

import { redis } from './redis.js'

export const DEFAULT_RATE_LIMIT_MAX = 300
export const DEFAULT_RATE_LIMIT_WINDOW_SEC = 60
export const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? DEFAULT_RATE_LIMIT_MAX)
export const RATE_LIMIT_WINDOW_SEC = Number(process.env.RATE_LIMIT_WINDOW_SEC ?? DEFAULT_RATE_LIMIT_WINDOW_SEC)

// Returns { allowed, limit, remaining, retry_after } for one request from `ip`.
export async function check_rate_limit(
  ip,
  { store = redis, max = RATE_LIMIT_MAX, window_sec = RATE_LIMIT_WINDOW_SEC, now_ms = Date.now() } = {}
) {
  const window_ms = window_sec * 1000
  const window = Math.floor(now_ms / window_ms)
  const key = `rpc:rl:${ip}:${window}`

  const count = Number(await store.send('INCR', [key]))
  if (count === 1) {
    // First hit in this window — set the TTL so the counter self-evicts.
    await store.send('EXPIRE', [key, String(window_sec)])
  }

  return {
    allowed: count <= max,
    limit: max,
    remaining: Math.max(0, max - count),
    retry_after: Math.max(1, Math.ceil(((window + 1) * window_ms - now_ms) / 1000)),
  }
}
