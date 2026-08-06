// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Redis access for the read API. Uses Bun's built-in RedisClient (zero-dep) —
// the SAME Redis 8 instance the indexer writes to and the rate limiter counts
// against. Read-only here: the API never mutates game state, only reads the
// indexer's re-derivable cache (plus its own rate-limit counters).
//
// TWO STORES, ONE HELPER SET (#2270). Everything this API serves is indexer state,
// which follows the cache through a blue/green flip. The sponsor money counters
// (`sponsor:cap:*`, `sponsor:spent:*`) are NOT indexer state: the sponsor service
// writes them to ITS OWN Redis, which a flip leaves behind — so an API pointed at
// the freshly flipped cache read an empty store and /v1/sponsor/remaining 503'd for
// every player. The reads are therefore SCOPED: `sponsor_reads` speaks to the
// sponsor's store, every other read to the indexer's. `create_reads` is the one
// implementation of the helper shapes, bound to whichever client it is handed.

import { RedisClient } from 'bun'

export const REDIS_URL = process.env.REDIS_URL ?? 'redis://127.0.0.1:6379'

export const redis = new RedisClient(REDIS_URL)

// The helper set over ONE client. Every read the API makes goes through a bundle
// built here, so a second store costs a binding, never a second copy of the logic.
export const create_reads = (client) => ({
  // JSON.GET returns the JSON text at a path. With a JSONPath (`$`) it returns an
  // array of matches; we unwrap the first. Returns null when the key is absent.
  async get_json(key, path = '$') {
    const raw = await client.send('JSON.GET', [key, path])
    if (raw == null) return null
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed
  },

  // JSON.MGET fetches the same path across many keys in one round trip. Returns an
  // array aligned to `keys` (null for a missing key). Empty input short-circuits so
  // we never issue a JSON.MGET with no keys. Each element is a JSONPath match array
  // (`$`) which we unwrap to the first match, mirroring get_json.
  async mget_json(keys, path = '$') {
    if (!keys || keys.length === 0) return []
    const raw = await client.send('JSON.MGET', [...keys, path])
    return (raw ?? []).map((item) => {
      if (item == null) return null
      const parsed = JSON.parse(item)
      return Array.isArray(parsed) ? (parsed[0] ?? null) : parsed
    })
  },

  // Plain string GET — for non-JSON counter keys (the sponsor's daily-spend tally,
  // `sponsor:spent:{date}:{addr}`, which the sponsor INCRBYs). Returns null when absent.
  async get_str(key) {
    return await client.send('GET', [key])
  },

  // Members of a Redis set (our secondary indexes: rpc:idx:*). Returns [] when the
  // key is absent. Bun's RedisClient returns a string array for SMEMBERS.
  async smembers(key) {
    const members = await client.send('SMEMBERS', [key])
    return members ?? []
  },

  // Newest-first members of a sorted set (the per-kiosk sales log — score = sale ts).
  // `0, -1` = the whole (capped) set; a rank range paginates. Returns [] when absent.
  async zrevrange(key, start = 0, stop = -1) {
    const members = await client.send('ZREVRANGE', [key, String(start), String(stop)])
    return members ?? []
  },

  // Ascending members of a sorted set inside an inclusive SCORE range. The
  // sales-over-time receipt log is scored by checkpoint timestamp, so this reads
  // only the requested dashboard window instead of scanning retained history.
  async zrangebyscore(key, min, max) {
    const members = await client.send('ZRANGEBYSCORE', [key, String(min), String(max)])
    return members ?? []
  },

  // Ascending members of a sorted set by RANK (the fight journal — score = checkpoint,
  // members ordered (checkpoint, tx, event); the rank IS the contiguous per-fight seq).
  // `start`/`stop` are inclusive ranks. Returns [] when the key is absent.
  async zrange(key, start, stop) {
    const members = await client.send('ZRANGE', [key, String(start), String(stop)])
    return members ?? []
  },

  // Cardinality of a sorted set (the fight journal's head = how far the log extends).
  // Returns 0 when the key is absent.
  async zcard(key) {
    const n = await client.send('ZCARD', [key])
    return Number(n ?? 0)
  },

  // Liveness probe against the store. Returns false instead of throwing so callers
  // can degrade gracefully.
  async ping() {
    try {
      const pong = await client.send('PING', [])
      return pong === 'PONG' || pong === 'pong' || pong === true
    } catch {
      return false
    }
  },
})

const default_reads = create_reads(redis)

export const { get_json, mget_json, get_str, smembers, zrevrange, zrangebyscore, zrange, zcard, ping } = default_reads

// The sponsor's own store. Unset (the single-instance deploy) means "the same one" —
// same client, same bundle, zero extra connection, so nothing changes without config.
export const SPONSOR_REDIS_URL = process.env.SPONSOR_REDIS_URL ?? REDIS_URL

export const sponsor_redis = SPONSOR_REDIS_URL === REDIS_URL ? redis : new RedisClient(SPONSOR_REDIS_URL)

export const sponsor_reads = sponsor_redis === redis ? default_reads : create_reads(sponsor_redis)
