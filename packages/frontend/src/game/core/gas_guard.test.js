// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Gas-burn emergency 07-06 — proves the pure pre-flight verdict: a would-fail simulation and an over-ceiling
// cost are BOTH refused BEFORE any signing (zero gas), and a normal tx gets an explicit 1.5× budget. The MIST
// vectors mirror a real grpc simulateTransaction `effects` block (gasUsed = computation + storage − rebate).
import { describe, expect, test } from 'bun:test'

import { gas_guard_decision, GAS_CEILING_MIST } from './gas_guard.js'

const ok_sim = (computationCost, storageCost, storageRebate = '0') => ({
  $kind: 'Transaction',
  Transaction: { effects: { status: { success: true }, gasUsed: { computationCost, storageCost, storageRebate } } },
})
const failed_sim = () => ({
  $kind: 'FailedTransaction',
  FailedTransaction: {
    effects: {
      status: { success: false, error: { $kind: 'MoveAbort', MoveAbort: { abortCode: '110', location: { module: 'dungeon_claim' } } } },
      gasUsed: { computationCost: '1000000', storageCost: '0', storageRebate: '0' },
    },
  },
})

describe('gas_guard_decision — refuse before signing', () => {
  test('a failed simulation (would abort on-chain) is refused → sim_failed (zero gas)', () => {
    expect(gas_guard_decision(failed_sim())).toEqual({ ok: false, reason: 'sim_failed' })
  })

  test('a status.success===false result (no FailedTransaction tag) is also sim_failed', () => {
    const sim = { $kind: 'Transaction', Transaction: { effects: { status: { success: false }, gasUsed: {} } } }
    expect(gas_guard_decision(sim)).toEqual({ ok: false, reason: 'sim_failed' })
  })

  test('a cost over the 0.25 SUI ceiling is refused loudly with the number', () => {
    // gross 310M, rebate 10M → net 300M MIST = 0.300 SUI > 250M ceiling
    const v = gas_guard_decision(ok_sim('250000000', '60000000', '10000000'))
    expect(v).toEqual({ ok: false, reason: 'over_ceiling', cost_sui: '0.300' })
  })

  // TESTNET QA DIAL (2026-07-11): ceiling raised 0.1 → 0.25 (mob-AI crank; see gas_guard.js). RESTORE 0.1 at mainnet-prep.
  test('the ceiling is 0.25 SUI (testnet QA dial)', () => {
    expect(GAS_CEILING_MIST).toBe(250_000_000n)
  })

  test('a normal tx passes and gets budget = storage + computation × 1.5', () => {
    // comp 1M ×1.5 = 1.5M + storage 2M (deterministic, never padded — 07-15 wallet-floor fix) → budget = 3.5M
    expect(gas_guard_decision(ok_sim('1000000', '2000000', '500000'))).toEqual({ ok: true, budget: 3_500_000n })
  })

  test('a passing tx whose budget exceeds the balance is refused → insufficient_balance', () => {
    expect(gas_guard_decision(ok_sim('1000000', '2000000', '500000'), 1_000n)).toEqual({
      ok: false,
      reason: 'insufficient_balance',
    })
  })

  test('a sufficient balance passes through with the budget', () => {
    expect(gas_guard_decision(ok_sim('1000000', '2000000', '500000'), 10_000_000n)).toEqual({
      ok: true,
      budget: 3_500_000n,
    })
  })
})
