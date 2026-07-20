// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// api/sponsor.mjs is station-only (the Mysten gas station is THE only gas infra).
// sponsor.mjs keeps EVERY identity/money rail but delegates the gas half to the station: reserve_gas →
// (client builds+signs) → execute_tx (station signs+submits, returns EXACT effects). Proven here WITHOUT any
// network: the station HTTP is mocked by reassigning globalThis.fetch (the nostore-pattern), the daily cap +
// reservation stash run in the NO-STORE in-memory mode, and the sui-client gates are never reached in these
// paths (a policy refusal fires before the first network call).
//
//   bun test api/sponsor.station.test.js        (no Redis, no fullnode, no station — that's the point)
//
// Own process on purpose (like the sibling suites): sponsor state reads REDIS_URL at module load.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64, fromBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

process.env.REDIS_URL = '' // no store configured → in-memory daily cap + reservation stash (deterministic)
process.env.GAS_STATION_URL ||= 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH ||= 'test-bearer'
const S = await import('./sponsor.mjs')

const ARES = release.networks.testnet.packages.aresrpg.latest
const DIGEST = 'ES6c9UyVEbXAZWQXUtzvyxvcCQ2FZ9BVgKPnjLXFto1p'
const OBJ = (n = '11') => ({ objectId: '0x' + n.repeat(32), version: 5n, digest: DIGEST })
const coin = (n, ver = '7') => ({ objectId: '0x' + n.repeat(32), version: ver, digest: DIGEST })

// A kind-only PTB targeting an aresrpg call (what the client posts to /reserve).
const build_kind = async (target = `${ARES}::zones::join_world`) => {
  const tx = new Transaction()
  tx.moveCall({ target, arguments: [tx.objectRef(OBJ())] })
  return toBase64(await tx.build({ onlyTransactionKind: true }))
}
// The full tx the client builds from a reservation (kind + reserved gas data), what it posts to /execute.
const build_full_tx = async ({ kind, sender, sponsor_address, gas_coins, budget, price = 1000 }) => {
  const tx = Transaction.fromKind(fromBase64(kind))
  tx.setSender(sender)
  tx.setGasOwner(sponsor_address)
  tx.setGasPayment(gas_coins.map((c) => ({ objectId: c.objectId, version: c.version, digest: c.digest })))
  tx.setGasBudget(Number(budget))
  tx.setGasPrice(price)
  return toBase64(await tx.build())
}

// ── station HTTP mock: capture every request, script the next response ──
let _fetch_calls = []
let _next_response = null
const mock_response = (json, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => json })
const install_fetch = () => {
  _fetch_calls = []
  globalThis.fetch = async (url, init) => {
    _fetch_calls.push({ url: String(url), init })
    if (_next_response instanceof Error) throw _next_response
    return _next_response ?? mock_response({})
  }
}
const _real_fetch = globalThis.fetch
beforeEach(install_fetch)
afterEach(() => {
  globalThis.fetch = _real_fetch
  _next_response = null
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
describe('station_reserve — the reserve_gas wire (happy + fail-closed)', () => {
  test('happy: POSTs {gas_budget, reserve_duration_secs} with the bearer, returns the parsed reservation', async () => {
    _next_response = mock_response({
      result: { sponsor_address: '0x' + 'cd'.repeat(32), reservation_id: 42, gas_coins: [coin('a1')] },
    })
    const r = await S.station_reserve({ gas_budget: 3_000_000, reserve_duration_secs: 60 })
    expect(r.reservation_id).toBe(42)
    expect(r.sponsor_address).toBe('0x' + 'cd'.repeat(32))
    expect(r.gas_coins).toEqual([coin('a1')])
    // wire: correct endpoint + bearer + body
    const [call] = _fetch_calls
    expect(call.url).toBe('http://rpc-gas-pool.test:9527/v1/reserve_gas')
    expect(call.init.headers.authorization).toBe('Bearer test-bearer')
    expect(JSON.parse(call.init.body)).toEqual({ gas_budget: 3_000_000, reserve_duration_secs: 60 })
  })

  test('station DOWN (fetch throws) ⇒ fail-closed refusal (never proceeds on an unconfirmed reservation)', async () => {
    _next_response = new Error('ECONNREFUSED')
    expect(S.station_reserve({ gas_budget: 1, reserve_duration_secs: 60 })).rejects.toThrow(/sponsor-station-down/)
  })

  test('non-2xx ⇒ fail-closed', async () => {
    _next_response = mock_response({}, { ok: false, status: 503 })
    expect(S.station_reserve({ gas_budget: 1, reserve_duration_secs: 60 })).rejects.toThrow(/sponsor-station-error/)
  })

  test('station returns { error } ⇒ fail-closed', async () => {
    _next_response = mock_response({ error: 'no gas coins available' })
    expect(S.station_reserve({ gas_budget: 1, reserve_duration_secs: 60 })).rejects.toThrow(/sponsor-reserve-failed/)
  })

  test('malformed result (missing coins) ⇒ fail-closed', async () => {
    _next_response = mock_response({ result: { sponsor_address: '0x1', reservation_id: 1, gas_coins: [] } })
    expect(S.station_reserve({ gas_budget: 1, reserve_duration_secs: 60 })).rejects.toThrow(/malformed reservation/)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
describe('require_station_config — fail CLOSED at boot when the station is not wired', () => {
  test('both set ⇒ passes; either unset ⇒ throws (refuses to boot)', () => {
    expect(() => S.require_station_config()).not.toThrow()
    const url = process.env.GAS_STATION_URL
    delete process.env.GAS_STATION_URL
    expect(() => S.require_station_config()).toThrow(/sponsor-misconfig/)
    process.env.GAS_STATION_URL = url
    const auth = process.env.GAS_STATION_AUTH
    delete process.env.GAS_STATION_AUTH
    expect(() => S.require_station_config()).toThrow(/sponsor-misconfig/)
    process.env.GAS_STATION_AUTH = auth
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
describe('reserveSponsored — a policy refusal fires BEFORE the station is ever called', () => {
  test('a missing zkLogin challenge is refused before any network/station round-trip (fetch never called)', async () => {
    await expect(
      S.reserveSponsored({ txKindBytes: await build_kind(), sender: '0x' + 'ab'.repeat(32) })
    ).rejects.toThrow(/zklogin-required/)
    expect(_fetch_calls.length).toBe(0) // neither the sui balance gRPC nor the station was touched
  })

  test('an EXPIRED zkLogin challenge is refused before the station (fail-fast, no reservation)', async () => {
    const sender = '0x' + 'ab'.repeat(32)
    const stale = `aresrpg-sponsor:${sender}:1` // ts=1ms → far outside the TTL
    await expect(
      S.reserveSponsored({ txKindBytes: await build_kind(), sender, challenge: stale, signature: 'x' })
    ).rejects.toThrow(/zklogin-stale/)
    expect(_fetch_calls.length).toBe(0)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
describe('assert_tx_matches_reservation — THE last policy gate (the station signs blindly)', () => {
  const sender = '0x' + 'ab'.repeat(32)
  const sponsor_address = '0x' + 'cd'.repeat(32)
  const gas_coins = [coin('a1'), coin('a2')]
  const budget = '3000000'
  let kind, reservation, txBytes
  beforeEach(async () => {
    kind = await build_kind()
    reservation = { sender, sponsor_address, gas_coins, budget, kind }
    txBytes = await build_full_tx({ kind, sender, sponsor_address, gas_coins, budget })
  })

  test('a faithful build (kind + reserved gas data) PASSES', () => {
    expect(() => S.assert_tx_matches_reservation(txBytes, reservation)).not.toThrow()
  })
  test('a swapped SENDER is refused', async () => {
    const other = await build_full_tx({ kind, sender: '0x' + '99'.repeat(32), sponsor_address, gas_coins, budget })
    expect(() => S.assert_tx_matches_reservation(other, reservation)).toThrow(/sender does not match/)
  })
  test('a swapped GAS OWNER (not the reserved sponsor) is refused', async () => {
    const other = await build_full_tx({ kind, sender, sponsor_address: '0x' + '77'.repeat(32), gas_coins, budget })
    expect(() => S.assert_tx_matches_reservation(other, reservation)).toThrow(/gas owner is not the reserved sponsor/)
  })
  test('a raised GAS BUDGET is refused (client cannot over-sign the priced budget)', async () => {
    const other = await build_full_tx({ kind, sender, sponsor_address, gas_coins, budget: '9000000' })
    expect(() => S.assert_tx_matches_reservation(other, reservation)).toThrow(/gas budget does not match/)
  })
  test('SUBSTITUTED gas coins (not the reserved coins) are refused', async () => {
    const other = await build_full_tx({ kind, sender, sponsor_address, gas_coins: [coin('ff')], budget })
    expect(() => S.assert_tx_matches_reservation(other, reservation)).toThrow(/gas payment coins are not the reserved/)
  })
  test('a SWAPPED PTB kind (scope-allowlist bypass within budget) is refused', async () => {
    // reserve was priced+scope-checked for join_world; the client tries to execute a DIFFERENT kind with the
    // same gas data — refused because the kind bytes differ from what we priced.
    const kind2 = await build_kind(`${ARES}::zones::leave_world`)
    const other = await build_full_tx({ kind: kind2, sender, sponsor_address, gas_coins, budget })
    expect(() => S.assert_tx_matches_reservation(other, reservation)).toThrow(/transaction kind differs/)
  })
  test('unparseable bytes are refused loudly', () => {
    expect(() => S.assert_tx_matches_reservation('bm90LWEtdHg=', reservation)).toThrow(/sponsor-tx-invalid/)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
describe('executeSponsored — once-only, exact-charge booking from the returned effects', () => {
  const sponsor_address = '0x' + 'cd'.repeat(32)
  const gas_coins = [coin('b1')]
  const budget = '3000000'
  // gasUsed → real_charge_mist = comp + storage − rebate, floored at comp = 2M + 1M − 0 = 3M
  const effects = (comp = 2_000_000, storage = 1_000_000, rebate = 0) => ({
    transactionDigest: DIGEST,
    status: { status: 'success' },
    gasUsed: { computationCost: String(comp), storageCost: String(storage), storageRebate: String(rebate) },
  })
  const seed = async (sender) => {
    const kind = await build_kind()
    await S.stash_reservation(101, { sender, sponsor_address, gas_coins, budget, kind })
    const txBytes = await build_full_tx({ kind, sender, sponsor_address, gas_coins, budget })
    return { kind, txBytes }
  }

  test('HAPPY: station returns effects ⇒ books the EXECUTED-exact charge into the daily cap and returns {effects,digest}', async () => {
    const sender = '0x' + 'e1'.repeat(32)
    const { txBytes } = await seed(sender)
    const eff = effects()
    _next_response = mock_response({ effects: eff })
    const out = await S.executeSponsored({ reservationId: 101, txBytes, userSig: 'usersig' })
    expect(out.digest).toBe(DIGEST)
    expect(out.effects).toEqual(eff)
    // wire: execute_tx endpoint + bearer + body carries the SAME bytes we validated
    const call = _fetch_calls.at(-1)
    expect(call.url).toBe('http://rpc-gas-pool.test:9527/v1/execute_tx')
    expect(call.init.headers.authorization).toBe('Bearer test-bearer')
    expect(JSON.parse(call.init.body)).toEqual({ reservation_id: 101, tx_bytes: txBytes, user_sig: 'usersig' })
    // booked EXACTLY real_charge_mist(gasUsed) = 3M — this is the ledger source of truth (no reconcile)
    const charge = S.real_charge_mist(eff.gasUsed)
    expect(charge).toBe(3_000_000n)
    expect(await S.addr_daily_would_exceed(sender, S.ADDR_DAILY_CAP_MIST - charge)).toBe(false) // exactly fits
    expect(await S.addr_daily_would_exceed(sender, S.ADDR_DAILY_CAP_MIST - charge + 1n)).toBe(true) // 1 mist over
  })

  test('a MISMATCHED tx_bytes is refused and the station is NEVER called (no gas burned)', async () => {
    const sender = '0x' + 'e2'.repeat(32)
    const kind = await build_kind()
    await S.stash_reservation(202, { sender, sponsor_address, gas_coins, budget, kind })
    const tampered = await build_full_tx({ kind, sender, sponsor_address, gas_coins, budget: '9000000' }) // budget raised
    await expect(S.executeSponsored({ reservationId: 202, txBytes: tampered, userSig: 'sig' })).rejects.toThrow(
      /sponsor-tx-mismatch/
    )
    expect(_fetch_calls.length).toBe(0) // last policy gate stopped it BEFORE execute_tx
  })

  test('the reservation is ONCE-ONLY: a second execute of the same id is unknown (no double-submit)', async () => {
    const sender = '0x' + 'e3'.repeat(32)
    const kind = await build_kind()
    await S.stash_reservation(303, { sender, sponsor_address, gas_coins, budget, kind })
    const txBytes = await build_full_tx({ kind, sender, sponsor_address, gas_coins, budget })
    _next_response = mock_response({ effects: effects() })
    await S.executeSponsored({ reservationId: 303, txBytes, userSig: 's' })
    await expect(S.executeSponsored({ reservationId: 303, txBytes, userSig: 's' })).rejects.toThrow(
      /sponsor-reservation-unknown/
    )
  })

  test('a PRE-EXECUTION rejection (effects absent + error) charges nothing', async () => {
    const sender = '0x' + 'e4'.repeat(32)
    const kind = await build_kind()
    await S.stash_reservation(404, { sender, sponsor_address, gas_coins, budget, kind })
    const good = await build_full_tx({ kind, sender, sponsor_address, gas_coins, budget })
    _next_response = mock_response({ effects: null, error: 'InsufficientGas' })
    await expect(S.executeSponsored({ reservationId: 404, txBytes: good, userSig: 's' })).rejects.toThrow(
      /sponsor-exec-rejected/
    )
    // nothing booked: the whole cap is still available
    expect(await S.addr_daily_would_exceed(sender, S.ADDR_DAILY_CAP_MIST)).toBe(false)
  })
})

// ════════════════════════════════════════════════════════════════════════════════════════════════════
describe('the retired single-POST route returns an honest 410 upgrade signal (stale client)', () => {
  const fake_res = () => {
    const r = { _status: 0, _json: null, headers: {} }
    r.setHeader = (k, v) => (r.headers[k] = v)
    r.status = (s) => ((r._status = s), r)
    r.json = (j) => ((r._json = j), r)
    r.end = () => r
    return r
  }
  test('POST /api/sponsor in station mode ⇒ 410 { error: "sponsor-two-call-upgrade" }', async () => {
    const res = fake_res()
    await S.default({ method: 'POST', url: '/api/sponsor', headers: {}, body: {} }, res)
    expect(res._status).toBe(410)
    expect(res._json).toEqual({ error: 'sponsor-two-call-upgrade' })
    expect(_fetch_calls.length).toBe(0) // no station call for the upgrade signal
  })
})
