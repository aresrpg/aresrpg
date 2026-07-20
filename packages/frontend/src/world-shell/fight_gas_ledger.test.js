// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// FIGHT COST LEDGER — proves the accumulator's arithmetic (07-11): multi-tx fold, rebate
// subtraction (including a rebate-heavy total going negative → refund), and reset-on-fresh-fight-start.
import { afterEach, describe, expect, test } from 'bun:test'

import { use_fight_cost, format_fight_cost } from './fight_gas_ledger.js'

afterEach(() => {
  use_fight_cost.setState({ net_mist: 0n }) // isolate each test from the module-singleton store
})

describe('use_fight_cost — the per-fight gas accumulator', () => {
  test('add() folds ONE tx: net = computation + storage − rebate', () => {
    use_fight_cost.getState().add({ computationCost: '1000000', storageCost: '500000', storageRebate: '200000' })
    expect(use_fight_cost.getState().net_mist).toBe(1_300_000n)
  })

  test('add() folds MULTIPLE txs cumulatively (a whole fight: entry + turns + settle)', () => {
    const { add } = use_fight_cost.getState()
    add({ computationCost: '1000000', storageCost: '2000000', storageRebate: '0' }) // entry (Fight deposit)
    add({ computationCost: '500000', storageCost: '0', storageRebate: '0' }) // a turn
    add({ computationCost: '500000', storageCost: '0', storageRebate: '0' }) // another turn
    expect(use_fight_cost.getState().net_mist).toBe(4_000_000n)
  })

  test('a rebate-heavy settle can pull the running total NEGATIVE (an honest refund)', () => {
    const { add } = use_fight_cost.getState()
    add({ computationCost: '1000000', storageCost: '2000000', storageRebate: '0' }) // entry: deposit +3M
    add({ computationCost: '0', storageCost: '0', storageRebate: '4000000' }) // settle: rebate −4M
    expect(use_fight_cost.getState().net_mist).toBe(-1_000_000n)
  })

  test('add() is a no-op on a nullish gas_used (never throws)', () => {
    use_fight_cost.getState().add(null)
    use_fight_cost.getState().add(undefined)
    expect(use_fight_cost.getState().net_mist).toBe(0n)
  })

  test('reset() zeroes the running total — the fresh-fight-start contract', () => {
    use_fight_cost.getState().add({ computationCost: '9000000', storageCost: '0', storageRebate: '0' })
    expect(use_fight_cost.getState().net_mist).toBe(9_000_000n)
    use_fight_cost.getState().reset()
    expect(use_fight_cost.getState().net_mist).toBe(0n)
  })
})

describe('format_fight_cost — MIST → the card display shape', () => {
  test('formats a positive net as an exact 4dp SUI string, never a refund', () => {
    expect(format_fight_cost(42_100_000n)).toEqual({ sui: '0.0421', is_refund: false })
  })

  test('formats whole + fractional SUI together', () => {
    expect(format_fight_cost(1_234_567_800n)).toEqual({ sui: '1.2345', is_refund: false })
  })

  test('a negative net formats as a refund with the ABSOLUTE value', () => {
    expect(format_fight_cost(-3_000_000n)).toEqual({ sui: '0.0030', is_refund: true })
  })

  test('zero formats as a zero cost, never a refund', () => {
    expect(format_fight_cost(0n)).toEqual({ sui: '0.0000', is_refund: false })
  })
})

// ── ITEM 5 (07-11: "minting should be included in the fight cost") ──────────────────────────────────────
// EVERY loot tx — settle, results::OPEN, mint_rolled, burn — signs through dungeon_actions.js's ONE `sign()`
// choke, which folds `res.gasUsed` into THIS store before its success-check throw (tx-retry-burn law). So the
// card's number is create + turns + settle + OPEN + mint + burn. This proves an OPEN receipt's gas actually
// lands in the running total (the fold is pure arithmetic; the choke wiring is asserted in dungeon_actions).
describe('use_fight_cost — the OPEN/mint gas is folded into the fight cost (item 5)', () => {
  test('a whole terminal fight folds create + turns + settle + OPEN + mint (the open is NOT missing)', () => {
    const { reset, add } = use_fight_cost.getState()
    reset() // fresh fight entry
    add({ computationCost: '1000000', storageCost: '2000000', storageRebate: '0' }) // ENTRY (next_fight — Fight deposit) +3.0M
    add({ computationCost: '500000', storageCost: '0', storageRebate: '0' }) //           a turn                              +0.5M
    add({ computationCost: '400000', storageCost: '0', storageRebate: '1000000' }) //      settle (rebate-heavy)              -0.6M
    add({ computationCost: '700000', storageCost: '3000000', storageRebate: '0' }) //      results::OPEN (rolls loot, storage) +3.7M
    add({ computationCost: '300000', storageCost: '1500000', storageRebate: '0' }) //      mint_rolled (the loot lands)        +1.8M
    // 3.0 + 0.5 − 0.6 + 3.7 + 1.8 = 8.4M
    expect(use_fight_cost.getState().net_mist).toBe(8_400_000n)
  })

  test('the OPEN receipt is load-bearing — dropping it undercharges the card by exactly the open gas', () => {
    const { reset, add } = use_fight_cost.getState()
    const open_receipt = { computationCost: '700000', storageCost: '3000000', storageRebate: '0' } // net +3.7M
    // WITH the open
    reset()
    add({ computationCost: '1000000', storageCost: '2000000', storageRebate: '0' })
    add(open_receipt)
    const with_open = use_fight_cost.getState().net_mist
    // WITHOUT the open (the old bug: the auto-open flow signed outside the ledger)
    reset()
    add({ computationCost: '1000000', storageCost: '2000000', storageRebate: '0' })
    const without_open = use_fight_cost.getState().net_mist
    expect(with_open - without_open).toBe(3_700_000n) // the open's gas is genuinely in the total, not lost
  })
})
