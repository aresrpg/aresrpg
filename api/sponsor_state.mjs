// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Shared anti-drain counters and once-only reservation state for the station sponsor.
export const RL_WINDOW_MS = Number(process.env.SPONSOR_RL_WINDOW_MS || 600_000)
const RL_MAX = Number(process.env.SPONSOR_RL_MAX || 5)
export const ADDR_RL_MAX = Number(process.env.SPONSOR_ADDR_MAX || 60)
export const SELF_PAY_MIST = BigInt(process.env.SPONSOR_SELF_PAY_MIST || 200_000_000)
export const ADDR_DAILY_CAP_MIST = BigInt(process.env.SPONSOR_ADDR_DAILY_CAP_MIST || 1_000_000_000)
export const PER_TX_BUDGET_CEILING_MIST = BigInt(process.env.SPONSOR_GAS_BUDGET || 300_000_000)
const rl_bucket = () => Math.floor(Date.now() / RL_WINDOW_MS)
export const utc_date = () => new Date().toISOString().slice(0, 10)
export const ip_rl_key = (ip) => `sponsor:rl:ip:${rl_bucket()}:${ip}`
export const addr_rl_key = (address) => `sponsor:rl:addr:${rl_bucket()}:${String(address).toLowerCase()}`

const REDIS_URL = process.env.REDIS_URL ?? (typeof Bun !== 'undefined' ? 'redis://127.0.0.1:6379' : '')
let redis_client
let redis_down_until = 0
async function get_redis() {
  if (redis_client !== undefined) return redis_client
  redis_client = null
  if (!REDIS_URL || typeof Bun === 'undefined') return null
  try {
    const { RedisClient } = await import('bun')
    redis_client = new RedisClient(REDIS_URL, { connectionTimeout: 2000, enableOfflineQueue: true })
    console.log('[sponsor] daily-cap shared store enabled')
  } catch (error) {
    console.warn('[sponsor] redis init failed → in-memory cap only:', error?.message)
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
    console.warn('[sponsor] redis op failed → in-memory cap for 15000 ms:', error?.code || error?.message)
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
  if (!result.ok && result.unconfigured) return { ok: true, value: memory_rate_increment(key) }
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
export async function addr_daily_would_exceed(address, charge) {
  const result = await redis_op((redis) => redis.send('GET', [addr_spent_key(address)]))
  if (result.ok) return BigInt(result.value || 0) + charge > ADDR_DAILY_CAP_MIST
  roll_daily_memory()
  return (daily_memory.get(address) || 0n) + charge > ADDR_DAILY_CAP_MIST
}
export async function addr_daily_record(address, charge) {
  roll_daily_memory()
  daily_memory.set(address, (daily_memory.get(address) || 0n) + charge)
  const key = addr_spent_key(address)
  await redis_op(async (redis) => {
    await redis.send('INCRBY', [key, String(charge)])
    await redis.send('EXPIREAT', [key, String(next_utc_midnight_s())])
  })
}

const RESERVATION_TTL_MS = Number(process.env.SPONSOR_RESERVE_DURATION_SECS || 60) * 1000 + 30_000
const reservation_memory = new Map()
const reservation_key = (id) => `sponsor:resv:${id}`
export async function stash_reservation(reservation_id, value) {
  const payload = JSON.stringify(value)
  const result = await redis_op((redis) =>
    redis.send('SET', [reservation_key(reservation_id), payload, 'PX', String(RESERVATION_TTL_MS)])
  )
  if (result.ok) return
  const now = Date.now()
  for (const [key, entry] of reservation_memory) if (entry.expiry <= now) reservation_memory.delete(key)
  reservation_memory.set(String(reservation_id), { value: payload, expiry: now + RESERVATION_TTL_MS })
}
export async function take_reservation(reservation_id) {
  const result = await redis_op((redis) => redis.send('GETDEL', [reservation_key(reservation_id)]))
  let raw = result.ok ? result.value : null
  if (!raw) {
    const id = String(reservation_id)
    const entry = reservation_memory.get(id)
    if (entry?.expiry > Date.now()) {
      raw = entry.value
      reservation_memory.delete(id)
    }
  }
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}
