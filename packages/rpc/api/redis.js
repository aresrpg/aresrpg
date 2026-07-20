// Redis access for the read API. Uses Bun's built-in RedisClient (zero-dep) —
// the SAME Redis 8 instance the indexer writes to and the rate limiter counts
// against. Read-only here: the API never mutates game state, only reads the
// indexer's re-derivable cache (plus its own rate-limit counters).

import { RedisClient } from 'bun'

export const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

export const redis = new RedisClient(REDIS_URL)

// JSON.GET returns the JSON text at a path. With a JSONPath (`$`) it returns an
// array of matches; we unwrap the first. Returns null when the key is absent.
export async function get_json(key, path = '$') {
  const raw = await redis.send('JSON.GET', [key, path])
  if (raw == null) return null
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed
}

// JSON.MGET fetches the same path across many keys in one round trip. Returns an
// array aligned to `keys` (null for a missing key). Empty input short-circuits so
// we never issue a JSON.MGET with no keys. Each element is a JSONPath match array
// (`$`) which we unwrap to the first match, mirroring get_json.
export async function mget_json(keys, path = '$') {
  if (!keys || keys.length === 0) return []
  const raw = await redis.send('JSON.MGET', [...keys, path])
  return (raw ?? []).map((item) => {
    if (item == null) return null
    const parsed = JSON.parse(item)
    return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed
  })
}

// Plain string GET — for non-JSON counter keys (the sponsor's daily-spend tally,
// `sponsor:spent:{date}:{addr}`, which the sponsor INCRBYs). Returns null when absent.
export async function get_str(key) {
  return await redis.send('GET', [key])
}

// Members of a Redis set (our secondary indexes: rpc:idx:*). Returns [] when the
// key is absent. Bun's RedisClient returns a string array for SMEMBERS.
export async function smembers(key) {
  const members = await redis.send('SMEMBERS', [key])
  return members ?? []
}

// Newest-first members of a sorted set (the per-kiosk sales log — score = sale ts).
// `0, -1` = the whole (capped) set; a rank range paginates. Returns [] when absent.
export async function zrevrange(key, start = 0, stop = -1) {
  const members = await redis.send('ZREVRANGE', [key, String(start), String(stop)])
  return members ?? []
}

// Liveness probe against the store. Returns false instead of throwing so callers
// can degrade gracefully.
export async function ping() {
  try {
    const pong = await redis.send('PING', [])
    return pong === 'PONG' || pong === 'pong' || pong === true
  } catch {
    return false
  }
}
