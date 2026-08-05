// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared anti-drain counters and once-only reservation state for the station sponsor.
export const RL_WINDOW_MS = Number(process.env.SPONSOR_RL_WINDOW_MS || 600_000)
const RL_MAX = Number(process.env.SPONSOR_RL_MAX || 30)
export const ADDR_RL_MAX = Number(process.env.SPONSOR_ADDR_MAX || 60)
export const SELF_PAY_MIST = BigInt(process.env.SPONSOR_SELF_PAY_MIST || 200_000_000)
export const ADDR_DAILY_CAP_MIST = BigInt(process.env.SPONSOR_ADDR_DAILY_CAP_MIST || 1_000_000_000)
// SPONSOR_GAS_BUDGET is the RULING home for the per-tx ceiling — the deployed chart sets it (0.4 SUI at the
// time of writing); the literal below is only the unconfigured-process default, never the deployed number.
export const PER_TX_BUDGET_CEILING_MIST = BigInt(process.env.SPONSOR_GAS_BUDGET || 300_000_000)
// How long a reservation — and the daily-cap hold that rides with it — stays alive: the station's own reserve
// duration plus slack for the client's build+sign round trip. ONE home for that lifetime, overridable whole so
// the expiry paths are exercisable without waiting a minute and a half.
const RESERVATION_TTL_MS = Number(
  process.env.SPONSOR_RESERVE_TTL_MS || Number(process.env.SPONSOR_RESERVE_DURATION_SECS || 60) * 1000 + 30_000
)
const rl_bucket = () => Math.floor(Date.now() / RL_WINDOW_MS)
export const utc_date = () => new Date().toISOString().slice(0, 10)
export const ip_rl_key = (ip) => `sponsor:rl:ip:${rl_bucket()}:${ip}`
export const addr_rl_key = (address) => `sponsor:rl:addr:${rl_bucket()}:${String(address).toLowerCase()}`

// ── THE SHARED STORE IS THE AUTHORITY ──────────────────────────────────────────────────────────────────
// Every counter in this file — rate windows, the daily cap, holds, reservations — is only a LIMIT while all
// instances share one. The in-memory maps below give each PROCESS its own full allowance, so any deployment
// that runs more than one instance (or restarts) multiplies every anti-drain cap by the instance count while
// still reporting them as enforced. So the shared store is REQUIRED: without one there is no sponsorship at
// all (a refused sponsorship is degraded UX; an unbounded one is a drained pool).
//
// Localnet is the sole exception, and it is derived from the SAME env truth the boot refusal above uses
// (`assert_no_dev_bypass_with_station_credentials`) rather than a new switch: a throwaway chain on a single
// process, a state no production configuration can reach.
const SHARED_STORE_OPTIONAL = (process.env.VITE_NETWORK || 'testnet') === 'localnet'
export const SHARED_STORE_REASON = 'shared-store-unavailable'
export const SHARED_STORE_ERROR =
  'sponsor-unavailable: the shared anti-drain store is unreachable, so per-player limits cannot be enforced — refusing to sponsor (fail-closed)'

const REDIS_URL = process.env.REDIS_URL ?? (typeof Bun !== 'undefined' ? 'redis://127.0.0.1:6379' : '')
let redis_client
let redis_down_until = 0

/**
 * Can the shared store answer right now? Configuration plus breaker state — no extra round trip, so this is
 * cheap enough to be the FIRST gate of a sponsored request. Localnet answers yes without a store: its
 * per-process counters are the whole deployment.
 */
export async function shared_store_ready() {
  if (SHARED_STORE_OPTIONAL) return true
  if (Date.now() < redis_down_until) return false
  return (await get_redis()) != null
}
async function get_redis() {
  if (redis_client !== undefined) return redis_client
  redis_client = null
  if (!REDIS_URL || typeof Bun === 'undefined') return null
  try {
    const { RedisClient } = await import('bun')
    redis_client = new RedisClient(REDIS_URL, { connectionTimeout: 2000, enableOfflineQueue: true })
    console.log('[sponsor] daily-cap shared store enabled')
  } catch (error) {
    console.warn('[sponsor] shared store init FAILED — sponsorship refuses until it answers:', error?.message)
  }
  return redis_client
}
async function redis_op(operation) {
  if (Date.now() < redis_down_until) return { ok: false }
  const redis = await get_redis()
  if (!redis) return { ok: false, unconfigured: true }
  try {
    return { ok: true, value: await operation(redis) }
  } catch (error) {
    redis_down_until = Date.now() + 15_000
    console.warn('[sponsor] shared store op FAILED — refusing sponsorship for 15000 ms:', error?.code || error?.message)
    return { ok: false }
  }
}

const rate_memory = new Map()
let rate_memory_bucket = -1
function memory_rate_increment(key) {
  const bucket = rl_bucket()
  if (bucket !== rate_memory_bucket) {
    rate_memory_bucket = bucket
    rate_memory.clear()
  }
  const count = (rate_memory.get(key) || 0) + 1
  rate_memory.set(key, count)
  return count
}
async function rate_increment(key) {
  const result = await redis_op(async (redis) => {
    const count = Number(await redis.send('INCR', [key]))
    if (count === 1) await redis.send('EXPIRE', [key, String(Math.ceil(RL_WINDOW_MS / 1000) + 60)])
    return count
  })
  // The in-memory window is a LOCALNET convenience, never a production degradation: with no store configured
  // off localnet the result stays `!ok`, and both callers below read that as "refuse".
  if (!result.ok && result.unconfigured && SHARED_STORE_OPTIONAL) return { ok: true, value: memory_rate_increment(key) }
  return result
}
export async function rate_limited(ip) {
  const result = await rate_increment(ip_rl_key(ip))
  return !result.ok || result.value > RL_MAX
}
export async function addr_rate_limited(address) {
  const result = await rate_increment(addr_rl_key(address))
  return !result.ok || result.value > ADDR_RL_MAX
}

const daily_memory = new Map()
let daily_memory_day = ''
const next_utc_midnight_s = () => {
  const now = new Date()
  return Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000)
}
function roll_daily_memory() {
  const day = utc_date()
  if (day !== daily_memory_day) {
    daily_memory_day = day
    daily_memory.clear()
  }
}
export const addr_spent_key = (address) => `sponsor:spent:${utc_date()}:${address.toLowerCase()}`

// ── THE CAP IS PUBLISHED, NEVER RE-DECLARED (#2197) ──────────────────────────────────────────────────────
// `ADDR_DAILY_CAP_MIST` above is the ONE home for the per-address daily allowance: this process reads it from
// its own env and ENFORCES it. The read-api's `/v1/sponsor/remaining` renders the same number for the player,
// and used to get it from a SECOND env of its own — two homes kept equal by prose comments naming each other,
// which is exactly the desync a deploy of one half without the other produces (a bar that shows an allowance
// nobody is granted, or hides one they have). So the enforcing process PUBLISHES its cap into the same shared
// store it already writes the spend counter to, and the display side DERIVES. One write at boot: the value
// only ever changes when this process is redeployed with a different env, and that redeploy re-runs this.
// No TTL — the last cap published is the cap that WOULD be enforced the moment the sponsor answers again, so
// letting it lapse would only teach the display to lie in the other direction.
export const ADDR_DAILY_CAP_KEY = 'sponsor:cap:addr_daily_mist'

/**
 * Publish this process's enforced per-address daily cap for the display side to read. Returns true when the
 * shared store took it. A failure is LOUD and non-fatal: sponsorship enforcement does not depend on this
 * write (the cap is enforced from env, in-process), and a store that cannot take a SET is already refusing
 * every sponsored request through `shared_store_ready` — surfacing it twice as a boot crash would trade a
 * degraded allowance bar for a dead sponsor.
 */
export async function publish_addr_daily_cap() {
  const result = await redis_op((redis) => redis.send('SET', [ADDR_DAILY_CAP_KEY, String(ADDR_DAILY_CAP_MIST)]))
  if (!result.ok)
    console.warn(
      `[sponsor] could not publish the daily cap to ${ADDR_DAILY_CAP_KEY} — /v1/sponsor/remaining will refuse rather than show a stale allowance`
    )
  return result.ok
}

// ── THE DAILY CAP — booked at RESERVE, settled at EXECUTE ────────────────────────────────────────────────
// Reading the counter at reserve and writing it at execute leaves a window in which a reservation exists but is
// not booked, and a pipelined burst fits N of them inside that window: every request reads the same pre-burst
// total, every one passes, and the cap holds against a human but not against a script. So the derived budget is
// BOOKED here, book-then-compare — the INCRBY's own return value is what the cap is compared against, never a
// separate read — and settled to the real charge at execute. Cap VALUES are untouched; only when they are
// counted moved.
//
// A reservation that is never executed would otherwise keep its budget booked all day, so every hold carries the
// reservation's own lifetime and is released lazily on the next hold — the one door that cares. In-process by
// design: a restart forfeits pending holds until the UTC rollover (fail-closed, bounded by one transaction's
// budget) rather than inventing a second durable ledger for a 90-second fact.
const holds = new Map()
let last_hold_id = 0

/** Move a day counter by `delta` (negative releases) in BOTH stores; returns the authoritative total. */
async function addr_daily_add(address, delta) {
  roll_daily_memory()
  const memory_key = String(address).toLowerCase()
  const memory_total = (daily_memory.get(memory_key) || 0n) + delta
  daily_memory.set(memory_key, memory_total)
  const key = addr_spent_key(address)
  const result = await redis_op(async (redis) => {
    const total = BigInt(await redis.send('INCRBY', [key, String(delta)]))
    await redis.send('EXPIREAT', [key, String(next_utc_midnight_s())])
    return total
  })
  return result.ok ? result.value : memory_total
}

async function release_expired_holds() {
  const now = Date.now()
  for (const [id, hold] of [...holds]) if (hold.expiry <= now) await settle_daily_hold(id, hold.address, 0n)
}

/** What this address has booked against today's cap (holds included — a hold IS a commitment to spend). */
export async function addr_daily_spent(address) {
  const result = await redis_op((redis) => redis.send('GET', [addr_spent_key(address)]))
  if (result.ok) return BigInt(result.value || 0)
  roll_daily_memory()
  return daily_memory.get(String(address).toLowerCase()) || 0n
}

/** Book `amount` against today's cap. Returns a hold id, or null when it would cross the cap (nothing booked). */
export async function addr_daily_hold(address, amount) {
  await release_expired_holds()
  const day = utc_date()
  const total = await addr_daily_add(address, amount)
  if (total > ADDR_DAILY_CAP_MIST) {
    await addr_daily_add(address, -amount)
    return null
  }
  last_hold_id += 1
  holds.set(last_hold_id, { address, amount, day, expiry: Date.now() + RESERVATION_TTL_MS })
  return last_hold_id
}

/**
 * Reconcile a hold to what the chain actually charged (0 releases it outright). The correction is
 * `charge - booked`, and `booked` is 0 for a hold this process no longer has — swept at expiry, lost to a
 * restart, or belonging to a day whose counter has already rolled away (Redis EXPIREAT / roll_daily_memory).
 * Booking the full charge in that case is the safe direction: the ledger may over-count, never lose a spend.
 */
export async function settle_daily_hold(id, address, charge) {
  const hold = holds.get(id)
  holds.delete(id)
  const booked = hold != null && hold.day === utc_date() ? hold.amount : 0n
  if (charge !== booked) await addr_daily_add(address, charge - booked)
}

export const release_daily_hold = (id, address) => settle_daily_hold(id, address, 0n)

const reservation_memory = new Map()
const reservation_key = (id) => `sponsor:resv:${id}`
/** Park a reservation for its one execute. Returns false when it could not be parked WHERE EVERY INSTANCE
 *  CAN SEE IT — the caller refuses rather than hand out an id only this process could honour. */
export async function stash_reservation(reservation_id, value) {
  const payload = JSON.stringify(value)
  const result = await redis_op((redis) =>
    redis.send('SET', [reservation_key(reservation_id), payload, 'PX', String(RESERVATION_TTL_MS)])
  )
  if (result.ok) return true
  if (!SHARED_STORE_OPTIONAL) return false
  const now = Date.now()
  for (const [key, entry] of reservation_memory) if (entry.expiry <= now) reservation_memory.delete(key)
  reservation_memory.set(String(reservation_id), { value: payload, expiry: now + RESERVATION_TTL_MS })
  return true
}
export async function take_reservation(reservation_id) {
  const result = await redis_op((redis) => redis.send('GETDEL', [reservation_key(reservation_id)]))
  let raw = result.ok ? result.value : null
  if (!raw) {
    const id = String(reservation_id)
    const entry = reservation_memory.get(id)
    // An EXPIRED stash is as unknown as a missing one — stated, not inferred from `undefined > number`. The
    // entry goes either way: taken once, or dropped because its window closed.
    if (entry != null) {
      reservation_memory.delete(id)
      if (entry.expiry > Date.now()) raw = entry.value
    }
  }
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch (error) {
    console.warn(`sponsor reservation ${String(reservation_id)} held unreadable JSON`, error)
    return null
  }
}
