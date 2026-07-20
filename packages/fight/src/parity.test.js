// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, test, expect } from 'bun:test'

import { canonical_state, fold_log, normalize_events, state_hash } from './inputs.js'
import { create_fight_store } from './store.js'

// PARITY PROOF — S0's definition of done (FIGHT_REWRITE_DESIGN §1/§5). The FIGHTREAL-captured REAL testnet receipt
// (digest 5wdRBuZzjp: TurnEnded→MobMoved→Hit→Cast→TurnStarted) folded through the dark core must (1) byte-match a
// direct fold of the same events, and (2) equal the receipt's chain ground truth. RED before the reducer folds,
// GREEN after. The decoders are the SDK's proven `decode_fight_event` (FIGHTREAL: zero shape drift vs the chain).

const repo_root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const receipt = JSON.parse(
  fs.readFileSync(path.join(repo_root, 'test/gold/fixtures/receipts/real_receipt_events.json'), 'utf8')
)
const FIGHT_ID = receipt.events[0].parsedJson.fight
const PKG = '0xa11ce5_pkg_synthetic'
const ev = (name, json) => ({ type: `${PKG}::fight_events::${name}`, parsedJson: { fight: FIGHT_ID, ...json } })

const via_store = (order = null) => {
  const store = create_fight_store()
  store.getState().input({ type: 'init', fight_id: FIGHT_ID, my_key: 'p0' })
  const events = order ? order(receipt.events) : receipt.events
  store.getState().input({ type: 'receipt', receipt: { events }, version: 1 }, 1_000)
  return store.getState()
}

describe('fight-core parity — real receipt → sim-shaped state (byte parity)', () => {
  test('core fold byte-matches a direct fold of the same events', () => {
    const store_state = via_store()
    const direct = fold_log(normalize_events(receipt, { version: 1, fight_id: FIGHT_ID }), FIGHT_ID)
    expect(JSON.stringify(canonical_state(store_state))).toBe(JSON.stringify(canonical_state(direct)))
    expect(state_hash(store_state)).toBe(state_hash(direct))
  })

  test('folded state equals the receipt chain ground truth', () => {
    const s = via_store()
    // MobMoved{idx:1,to_cell:49}; Hit{victim_idx:0,remaining_hp:43}; TurnStarted{idx:0,deadline_ms:...}
    expect(s.fighters.m1.cell).toBe(49)
    expect(s.fighters.p0.hp).toBe(43)
    expect(s.fighters.p0.alive).toBe(true)
    expect(s.active).toBe('p0')
    expect(s.turn_deadline_ms).toBe(1784174748393)
    expect(Object.keys(s.fighters).sort()).toEqual(['m0', 'm1', 'p0'])
    expect(s.winner).toBe(-1)
  })

  test('convergence — dup poll, stale subset, and out-of-order versions fold to one state', () => {
    const canonical = state_hash(via_store())
    // dup + stale re-delivery through the store: same (version, event_idx) keys ⇒ idempotent
    const store = create_fight_store()
    store.getState().input({ type: 'init', fight_id: FIGHT_ID, my_key: 'p0' })
    store.getState().input({ type: 'receipt', receipt, version: 1 }, 1_000)
    store.getState().input({ type: 'poll', receipt, version: 1 }, 1_000) // exact dup
    store.getState().input({ type: 'poll', receipt: { events: receipt.events.slice(0, 2) }, version: 1 }, 1_000) // stale subset
    expect(state_hash(store.getState())).toBe(canonical)

    // out-of-order VERSION delivery converges — the store re-folds by (version, event_idx), never arrival order.
    const started = { events: [ev('TurnStarted', { is_mob: false, idx: 0, deadline_ms: 5 })] }
    const hit = { events: [ev('Hit', { victim_is_mob: false, victim_idx: 0, amount: 9, remaining_hp: 30 })] }
    const drive = (order) => {
      const s = create_fight_store()
      s.getState().input({ type: 'init', fight_id: FIGHT_ID, my_key: 'p0' })
      for (const [receipt_batch, version] of order)
        s.getState().input({ type: 'receipt', receipt: receipt_batch, version }, 0)
      return state_hash(s.getState())
    }
    expect(
      drive([
        [hit, 2],
        [started, 1],
      ])
    ).toBe(
      drive([
        [started, 1],
        [hit, 2],
      ])
    )
  })
})
