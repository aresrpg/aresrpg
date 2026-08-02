// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1862 — THE CERTIFIED RECEIPT. /execute used to answer with `effects` ONLY, so a sponsored client could not
// see WHICH objects the transaction created (nor their types) and had to demote to a fullnode
// waitForTransaction plus read-layer polling — the structural half of the ≈7s felt character create.
//
// The station already supports it: `execute_tx` takes JSON-RPC response OPTIONS and, given any, answers with
// the full `tx_block_response` INSTEAD of the flat `effects` field (sui-gas-pool @45ed6d3
// `new_ok_block_response` vs `new_ok_effects`). That relocation is the money-critical part proven here: read
// only the flat field and every EXECUTED sponsored transaction reads as a pre-execution rejection — the daily
// hold gets refunded against gas that was really burned.
//
//   bun test api/sponsor.execute_receipt.test.js   (no Redis, no fullnode, no station — the wire is mocked)
//
// RED BEFORE THE FIX (measured by reverting api/sponsor.mjs to HEAD):
//   ✗ the wire carries no `options` at all
//   ✗ a `tx_block_response` answer throws `sponsor-exec-rejected: no effects — no gas charged` on a tx that
//     executed, and the executed charge is never booked
//
// Own process on purpose (like every sibling suite): sponsor state reads REDIS_URL at module load.

import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64, fromBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

process.env.REDIS_URL = '' // no shared store → in-memory cap + reservation stash (deterministic)
process.env.VITE_NETWORK = 'localnet'
process.env.GAS_STATION_URL ||= 'http://rpc-gas-pool.test:9527'
process.env.GAS_STATION_AUTH ||= 'test-bearer'
const S = await import('./sponsor.mjs')

const ARES = release.networks.testnet.packages.aresrpg.latest
const DIGEST = 'ES6c9UyVEbXAZWQXUtzvyxvcCQ2FZ9BVgKPnjLXFto1p'
const SPONSOR_ADDRESS = '0x' + 'cd'.repeat(32)
const GAS_COINS = [{ objectId: '0x' + 'b1'.repeat(32), version: '7', digest: DIGEST }]
const BUDGET = '3000000'
const CHARACTER = '0x' + '1a'.repeat(32)
const KIOSK = '0x' + '2b'.repeat(32)

const EFFECTS = {
  transactionDigest: DIGEST,
  status: { status: 'success' },
  gasUsed: { computationCost: '2000000', storageCost: '1000000', storageRebate: '0' },
}
// What a JSON-RPC `showObjectChanges` answer looks like — the created objects WITH their on-chain types.
const OBJECT_CHANGES = [
  { type: 'created', objectId: CHARACTER, objectType: `${ARES}::character::Character`, version: '9' },
  { type: 'mutated', objectId: KIOSK, objectType: '0x2::kiosk::Kiosk', version: '12' },
]
const EVENTS = [{ type: `${ARES}::character::CharacterCreated`, parsedJson: { id: CHARACTER } }]

// ── station HTTP mock: capture every request, script the next response ──
let _fetch_calls = []
let _next_response = null
const mock_response = (json, { ok = true, status = 200 } = {}) => ({ ok, status, json: async () => json })
const _real_fetch = globalThis.fetch
beforeEach(() => {
  _fetch_calls = []
  globalThis.fetch = async (url, init) => {
    _fetch_calls.push({ url: String(url), init })
    return _next_response ?? mock_response({})
  }
})
afterEach(() => {
  globalThis.fetch = _real_fetch
  _next_response = null
})

const build_kind = async (target = `${ARES}::zones::join_world`) => {
  const tx = new Transaction()
  tx.moveCall({ target, arguments: [tx.objectRef({ objectId: '0x' + '11'.repeat(32), version: 5n, digest: DIGEST })] })
  return toBase64(await tx.build({ onlyTransactionKind: true }))
}
const build_full_tx = async ({ kind, sender }) => {
  const tx = Transaction.fromKind(fromBase64(kind))
  tx.setSender(sender)
  tx.setGasOwner(SPONSOR_ADDRESS)
  tx.setGasPayment(GAS_COINS)
  tx.setGasBudget(Number(BUDGET))
  tx.setGasPrice(1000)
  return toBase64(await tx.build())
}
/** Stash a reservation the way /reserve would, and build the exact bytes the client would post to /execute. */
const seed = async (reservation_id, sender) => {
  const kind = await build_kind()
  await S.stash_reservation(reservation_id, {
    sender,
    sponsor_address: SPONSOR_ADDRESS,
    gas_coins: GAS_COINS,
    budget: BUDGET,
    kind,
  })
  return { txBytes: await build_full_tx({ kind, sender }) }
}

// ════════════════════════════════════════════════════════════════════════════════════════════════════
describe('#1862 — /execute answers with the CERTIFIED receipt, not effects-only', () => {
  test('the execute_tx wire ASKS for effects + objectChanges + events (without options the station stays effects-only)', async () => {
    const sender = '0x' + 'a1'.repeat(32)
    const { txBytes } = await seed(1101, sender)
    _next_response = mock_response({ tx_block_response: { effects: EFFECTS, objectChanges: [], events: [] } })
    await S.executeSponsored({ reservationId: 1101, txBytes, userSig: 'usersig' })
    const body = JSON.parse(_fetch_calls.at(-1).init.body)
    expect(body.reservation_id).toBe(1101)
    expect(body.tx_bytes).toBe(txBytes)
    expect(body.user_sig).toBe('usersig')
    // showEffects is NOT optional: the station NULLS whatever the caller did not ask for, and effects are this
    // path's proof-of-execution AND its gas charge.
    expect(body.options).toEqual({ showEffects: true, showObjectChanges: true, showEvents: true })
  })

  test('a tx_block_response answer is EXECUTED: the charge is booked and the receipt carries objectChanges + events', async () => {
    const sender = '0x' + 'a2'.repeat(32)
    const { txBytes } = await seed(1102, sender)
    // The shape a station honouring `options` returns: everything nested, the FLAT `effects` field null.
    _next_response = mock_response({
      effects: null,
      tx_block_response: { digest: DIGEST, effects: EFFECTS, objectChanges: OBJECT_CHANGES, events: EVENTS },
    })
    const out = await S.executeSponsored({ reservationId: 1102, txBytes, userSig: 's' })
    expect(out.digest).toBe(DIGEST)
    expect(out.effects).toEqual(EFFECTS)
    expect(out.objectChanges).toEqual(OBJECT_CHANGES)
    expect(out.events).toEqual(EVENTS)
    // MONEY: reading only the flat field would have refunded the hold and reported "no gas charged" for a
    // transaction that burned 3M MIST. The executed charge must be booked exactly once.
    expect(await S.addr_daily_spent(sender)).toBe(S.real_charge_mist(EFFECTS.gasUsed))
  })

  test('an options-BLIND station (flat effects, no tx_block_response) still executes — and never fakes a receipt', async () => {
    const sender = '0x' + 'a3'.repeat(32)
    const { txBytes } = await seed(1103, sender)
    _next_response = mock_response({ effects: EFFECTS })
    const out = await S.executeSponsored({ reservationId: 1103, txBytes, userSig: 's' })
    expect(out.digest).toBe(DIGEST)
    expect(out.effects).toEqual(EFFECTS)
    // ABSENT, not empty: an empty array would tell the client "this transaction created nothing", which is a
    // silent lie. Omitted ⇒ the client keeps its honest wait.
    expect('objectChanges' in out).toBe(false)
    expect('events' in out).toBe(false)
    expect(await S.addr_daily_spent(sender)).toBe(S.real_charge_mist(EFFECTS.gasUsed))
  })

  test('a genuine PRE-EXECUTION rejection (effects in NEITHER home) still refuses and charges nothing', async () => {
    const sender = '0x' + 'a4'.repeat(32)
    const { txBytes } = await seed(1104, sender)
    _next_response = mock_response({ effects: null, error: 'InsufficientGas' })
    await expect(S.executeSponsored({ reservationId: 1104, txBytes, userSig: 's' })).rejects.toThrow(
      /sponsor-exec-rejected/
    )
    expect(await S.addr_daily_spent(sender)).toBe(0n)
  })
})
