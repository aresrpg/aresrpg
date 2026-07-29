// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs anti-drain caps over a REAL throwaway Redis — proves the per-IP / per-address rate
// windows are SHARED across serverless instances (not per-instance memory that loosens ~N× when the
// sponsor scales out). A SECOND RedisClient stands in for a "second function instance": it seeds the
// SAME keys the sponsor enforces, and the sponsor's checks see them.
// Isolated throwaway redis ONLY (this FLUSHALLs) — NEVER the live :6379 cache:
//
//   docker run -d --rm -p 6399:6379 redis:8
//   REDIS_URL=redis://127.0.0.1:6399 bun test api/sponsor.test.js
//
// The inline guard below refuses to run against the live cache. Fail-closed (Redis-down) is a SEPARATE
// process — see api/sponsor.failclosed.test.js — because sponsor.mjs memoizes REDIS_URL at module load.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { RedisClient } from 'bun'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

const url = process.env.REDIS_URL
const LIVE = new Set([
  'redis://127.0.0.1:6379',
  'redis://localhost:6379',
  'redis://127.0.0.1',
  'redis://localhost',
  'redis://[::1]:6379',
])
if (!url || LIVE.has(url.trim().replace(/\/$/, '')))
  throw new Error(
    'REFUSING: this suite FLUSHALLs Redis. Point REDIS_URL at a throwaway instance, not the live :6379 cache:\n' +
      '  docker run -d --rm -p 6399:6379 redis:8\n' +
      '  REDIS_URL=redis://127.0.0.1:6399 bun test api/sponsor.test.js\n' +
      `Got REDIS_URL=${url ?? '(unset → would default to the LIVE cache)'}`
  )

const S = await import('./sponsor.mjs')

// A SECOND connection = a stand-in "second serverless instance": same store, independent client.
const other = new RedisClient(url)

const RL_MAX = Number(process.env.SPONSOR_RL_MAX || 5) // per-IP window max
const ADDR_RL_MAX = Number(process.env.SPONSOR_ADDR_MAX || 60) // per-address window max

beforeEach(async () => {
  await other.send('FLUSHALL', [])
})
afterAll(async () => {
  await other.send('FLUSHALL', [])
  other.close?.()
})

describe('rate-limit windows — Redis-shared fixed-window (INCR + EXPIRE)', () => {
  test(`per-IP: allows ${RL_MAX}, blocks the next`, async () => {
    const ip = '1.2.3.4'
    for (let i = 0; i < RL_MAX; i++) expect(await S.rate_limited(ip)).toBe(false)
    expect(await S.rate_limited(ip)).toBe(true)
    expect(Number(await other.send('GET', [S.ip_rl_key(ip)]))).toBeGreaterThan(RL_MAX)
  })

  test('per-IP: a window pre-filled by "instance B" blocks "instance A" (shared count)', async () => {
    const ip = '9.9.9.9'
    await other.send('SET', [S.ip_rl_key(ip), String(RL_MAX)]) // instance B already used the whole window
    expect(await S.rate_limited(ip)).toBe(true) // instance A refuses immediately (n = MAX+1)
  })

  test('per-IP window key carries a TTL (auto-expiring fixed window)', async () => {
    const ip = '1.2.3.4'
    await S.rate_limited(ip)
    expect(Number(await other.send('TTL', [S.ip_rl_key(ip)]))).toBeGreaterThan(0)
  })

  test(`per-address: allows ${ADDR_RL_MAX}, blocks the next`, async () => {
    const addr = '0xAbC' // mixed-case → key is normalized lowercase
    for (let i = 0; i < ADDR_RL_MAX; i++) expect(await S.addr_rate_limited(addr)).toBe(false)
    expect(await S.addr_rate_limited(addr)).toBe(true)
    expect(Number(await other.send('GET', [S.addr_rl_key(addr)]))).toBeGreaterThan(ADDR_RL_MAX)
  })
})

// ── F1 FIX: the daily cap now tracks REAL derived gas, not a flat estimate. This is the drain that let ~500
//    storage-bomb txs "fill" the 1-SUI cap while burning ≫ that. Prove the accounting is real. ──
describe('F1 — per-tx budget derived from REAL simulated gas (never a flat estimate)', () => {
  test('derive_budget_mist = (computation + storage) × 1.5, so a storage-bomb is priced HIGH not flat', () => {
    // a cheap tx: 0.002 SUI computation, no storage → 0.003 budget
    expect(S.derive_budget_mist({ computationCost: '2000000', storageCost: '0', storageRebate: '0' })).toBe(3_000_000n)
    // a STORAGE BOMB: same tiny computation but 0.18 SUI of storage → 0.273 budget (the old flat EST was 0.002 —
    // THIS is the ~150× the attacker exploited; now it's captured in full).
    expect(S.derive_budget_mist({ computationCost: '2000000', storageCost: '180000000' })).toBe(273_000_000n)
  })
  test('derive_budget_mist REFUSES LOUDLY over the per-tx ceiling (never signs a fat budget)', () => {
    // 0.252 gross × 1.5 = 0.378 > the 0.3 ceiling → throw (money law: never sign a budget above the ceiling)
    expect(() => S.derive_budget_mist({ computationCost: '2000000', storageCost: '250000000' })).toThrow(/over-ceiling/)
  })
  test('derive_budget_mist REFUSES LOUDLY when the sim returns no gas (never signs an unpriced budget)', () => {
    expect(() => S.derive_budget_mist({})).toThrow(/unpriceable/)
    expect(() => S.derive_budget_mist({ computationCost: '0', storageCost: '0' })).toThrow(/unpriceable/)
  })
})

describe('F1 — per-player daily cap charges REAL gas (drain closed: ~3 bombs fill 1 SUI, not ~500)', () => {
  test('a storage-bomb charge fills the per-player cap in a handful of txs, and Redis holds the REAL sum', async () => {
    const addr = '0xBomber'
    const charge = S.derive_budget_mist({ computationCost: '2000000', storageCost: '180000000' }) // 0.273 SUI REAL
    let n = 0
    // Each granted hold BOOKS its charge (the reserve-time accounting), so the loop is the cap counting itself.
    while (await S.addr_daily_hold(addr, charge)) if (++n > 50) break // safety — must terminate FAST
    // 0.273 × 3 = 0.819 < 1 SUI ; the 4th would exceed → the cap trips after exactly 3 sponsored bombs (was 500).
    expect(n).toBe(Number(S.ADDR_DAILY_CAP_MIST / charge)) // floor(cap/charge) bombs fit before the cap trips
    expect(n).toBe(3)
    expect(n).toBeLessThan(10) // the money proof: a bomber can't hide behind a flat estimate anymore
    // the shared store holds the REAL charged sum (n × 0.273 SUI), not n × a 0.002 flat estimate
    expect(BigInt(await other.send('GET', [S.addr_spent_key(addr)]))).toBe(charge * BigInt(n))
  })
})

// ── F1 delta: the per-address cap is a REMAINING-budget check — the derived cost is refused
//    when it would take the address PAST its daily budget, not merely at some total. ──
describe('F1 — per-address cap refuses when cost > REMAINING daily budget', () => {
  test('cost within remaining passes; cost over remaining refuses', async () => {
    const addr = '0xNearCap'
    expect(await S.addr_daily_hold(addr, S.ADDR_DAILY_CAP_MIST - 100_000_000n)).not.toBeNull() // 0.1 SUI left
    expect(await S.addr_daily_hold(addr, 200_000_000n)).toBeNull() // 0.2 > 0.1 remaining → refuse
    // …and the refused hold booked NOTHING: a 0.05 that fits the same remaining budget still passes after it.
    expect(await S.addr_daily_hold(addr, 50_000_000n)).not.toBeNull()
  })
})

// ── F3 FIX: the sponsor must NOT blindly sign — every MoveCall is limited to the aresrpg
//    package family + the framework modules our own SDK composes; ≥1 call must be aresrpg. ──
const ARES = release.networks.testnet.packages.aresrpg.latest
const ENGINE_LATEST = release.networks.testnet.packages.engine.latest
const FOREIGN = '0x' + 'de'.repeat(32) // an attacker's own package
const OBJ = (n = '11') => ({
  objectId: '0x' + n.repeat(32),
  version: 5n,
  digest: 'ES6c9UyVEbXAZWQXUtzvyxvcCQ2FZ9BVgKPnjLXFto1p',
})
const kind = async (build) => {
  const tx = new Transaction()
  build(tx)
  return toBase64(await tx.build({ onlyTransactionKind: true }))
}
const scope_refusal = (tx_kind) => {
  try {
    S.assert_ptb_scope(tx_kind)
  } catch (error) {
    return error
  }
  return null
}
describe('F3 — PTB scope allowlist (aresrpg + composed framework only)', () => {
  test('(a) a low-balance GAMEPLAY PTB (zones::join_world) passes — the 07-11 sponsored-gameplay ruling', async () => {
    const k = await kind((tx) =>
      tx.moveCall({ target: `${ARES}::zones::join_world`, arguments: [tx.objectRef(OBJ())] })
    )
    expect(() => S.assert_ptb_scope(k)).not.toThrow()
  })
  test('(a3) a fight PTB targeting the NEW engine latest id (wave-2b v4 upgrade) passes', async () => {
    const k = await kind((tx) =>
      tx.moveCall({ target: `${ENGINE_LATEST}::actions::act_pass`, arguments: [tx.objectRef(OBJ())] })
    )
    expect(() => S.assert_ptb_scope(k)).not.toThrow()
  })
  test('(a4) STRICT UPGRADE: origin + latest pass, while retired engine.previous ids are refused by scope', async () => {
    const { engine } = release.networks.testnet.packages
    // Historical schema remains intact: the stamper keeps retired ids under previous even though the sponsor
    // no longer honors them. IDs come from the release artifact, never a literal.
    expect(engine.previous?.length ?? 0).toBeGreaterThan(0)
    for (const id of [engine.origin, engine.latest]) {
      const k = await kind((tx) =>
        tx.moveCall({ target: `${id}::actions::act_pass`, arguments: [tx.objectRef(OBJ())] })
      )
      expect(() => S.assert_ptb_scope(k)).not.toThrow()
    }
    for (const id of engine.previous ?? []) {
      const k = await kind((tx) =>
        tx.moveCall({ target: `${id}::actions::act_pass`, arguments: [tx.objectRef(OBJ())] })
      )
      const refusal = scope_refusal(k)
      expect(refusal?.message).toMatch(/sponsor-scope.*outdated-package/)
      expect(S.sponsor_error_response(refusal)).toEqual({ error: refusal.message, reason: 'outdated-package' })
    }
  })
  test('(a2) a create-shaped PTB mixing framework (0x2 kiosk/transfer) + an aresrpg call passes', async () => {
    const k = await kind((tx) => {
      tx.moveCall({ target: `0x2::kiosk::new` })
      tx.moveCall({ target: `${ARES}::creation::create_character_free`, arguments: [tx.objectRef(OBJ())] })
      tx.moveCall({
        target: `0x2::transfer::public_share_object`,
        typeArguments: ['0x2::kiosk::Kiosk'],
        arguments: [tx.objectRef(OBJ('22'))],
      })
    })
    expect(() => S.assert_ptb_scope(k)).not.toThrow()
  })
  test('(b) a PTB calling a FOREIGN package is refused, even alongside an aresrpg call', async () => {
    const k = await kind((tx) => {
      tx.moveCall({ target: `${ARES}::zones::join_world`, arguments: [tx.objectRef(OBJ())] })
      tx.moveCall({ target: `${FOREIGN}::bomb::inflate` }) // the storage-bomb / extraction contract
    })
    const refusal = scope_refusal(k)
    expect(refusal?.message).toMatch(/sponsor-scope.*non-allowlisted/)
    expect(S.sponsor_error_response(refusal)).toEqual({ error: refusal.message })
  })
  test('(c) a framework-only PTB (0x2 kiosk/transfer, NO aresrpg call) is refused', async () => {
    const k = await kind((tx) => {
      tx.moveCall({ target: `0x2::kiosk::new` })
      tx.moveCall({
        target: `0x2::transfer::public_share_object`,
        typeArguments: ['0x2::kiosk::Kiosk'],
        arguments: [tx.objectRef(OBJ())],
      })
    })
    expect(() => S.assert_ptb_scope(k)).toThrow(/sponsor-scope.*no aresrpg MoveCall/)
  })
  test('(c2) a bare SplitCoins+TransferObjects PTB (zero MoveCalls) is refused', async () => {
    const k = await kind((tx) => {
      const [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(1n)])
      tx.transferObjects([coin], tx.pure.address('0x' + '22'.repeat(32)))
    })
    expect(() => S.assert_ptb_scope(k)).toThrow(/no aresrpg MoveCall/)
  })
})

// Station execution returns effects synchronously, so this shared helper books the executed-exact cash-out.
const gas = (comp, storage, rebate = 0) => ({
  computationCost: String(comp),
  storageCost: String(storage),
  storageRebate: String(rebate),
})

describe('F4 — real_charge_mist: the sponsor’s true cash-out (comp + storage − rebate, floored at comp)', () => {
  test('pure computation, no storage', () => {
    expect(S.real_charge_mist(gas(2_000_000, 0))).toBe(2_000_000n)
  })
  test('computation + storage (no rebate)', () => {
    expect(S.real_charge_mist(gas(2_000_000, 180_000_000))).toBe(182_000_000n)
  })
  test('a net storage REFUND floors at computation (never books below the always-burned cost)', () => {
    // frees more bytes than it writes: storage 1M − rebate 9M = −8M net storage ⇒ floor at comp (2M), not −6M
    expect(S.real_charge_mist(gas(2_000_000, 1_000_000, 9_000_000))).toBe(2_000_000n)
  })
  test('partial rebate nets under gross', () => {
    expect(S.real_charge_mist(gas(5_000_000, 10_000_000, 3_000_000))).toBe(12_000_000n)
  })
})
