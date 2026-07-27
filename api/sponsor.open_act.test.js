// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #1223 ruling ③ RIDER — "the sponsor's anti-drain cap must demonstrably cover open acts."
//
// The client now composes a sponsored fire-and-forget `results::open` the moment a settle is observed
// (packages/frontend/src/world-shell/dungeon_settlement.js). That only helps if the sponsor actually signs it:
// a scope refusal or a budget refusal would turn the auto-open into a louder version of the same strand. This
// file is the demonstration, against the sponsor's OWN gates — no mirrors: the real `assert_ptb_scope`,
// `derive_budget_mist` and `real_charge_mist`.
//
// PROVENANCE — the gas numbers are a CAPTURED receipt, not a simulation. Testnet digest
// `GKgXWeVhB8maWjbVKRgfYZW8BTSBab7rpFa8uS6PZy5n` (the settle+open cited in #1223's mechanism comment): a
// settle_and_take → open_taken PTB, status `success`, read back with `sui client tx-block --json`. It is the
// HEAVIEST shape an auto-open can take (settlement + open in one act), so a bare `results::open` is strictly
// cheaper — which makes every headroom number below a lower bound.
//
//   bun test api/sponsor.open_act.test.js        (no Redis, no station — pure scope + budget arithmetic)
//
// Own process on purpose (like the sibling suites): sponsor.mjs resolves its allowlist ONCE at module load.

import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { toBase64 } from '@mysten/sui/utils'

import release from '../packages/sdk/src/deployment/release.json' with { type: 'json' }

process.env.REDIS_URL = '' // scope + budget arithmetic never touch the store
delete process.env.SPONSOR_ARESRPG_PACKAGES // the deployed default: the release.json derivation

const S = await import('./sponsor.mjs')
const { ADDR_DAILY_CAP_MIST, PER_TX_BUDGET_CEILING_MIST } = await import('./sponsor_state.mjs')

const testnet = release.networks.testnet.packages
const ARESRPG = testnet.aresrpg.latest
const ENGINE = testnet.engine.latest
const DUNGEON = testnet.dungeon.latest

/** Base64 tx-kind bytes for a command list — exactly what the sponsor endpoint receives from the client. */
const kind_of = async (targets) => {
  const tx = new Transaction()
  for (const target of targets) tx.moveCall({ target })
  return toBase64(await tx.build({ onlyTransactionKind: true }))
}

// The three PTB shapes `open_pending_row` / `settle_chain` can put in front of the sponsor. Targets are what
// assert_ptb_scope reads (arguments are irrelevant to it), and these are the SDK's own — packages/sdk/src/fight.js
// open_result_ptb:888, settle_and_take_ptb:927, open_taken_ptb:969, settle_run_ptb:1011.
const OPEN_KIND = await kind_of([`${ARESRPG}::results::open`])
const RUN_OPEN_KIND = await kind_of([`${DUNGEON}::dungeon::settle_run`, `${ARESRPG}::results::open`])
const SETTLE_OPEN_KIND = await kind_of([`${ENGINE}::settlement::settle_and_take`, `${ARESRPG}::results::open_taken`])

// The captured receipt (digest above). computationCost + storageCost is the `gross` derive_budget_mist prices;
// the rebate exceeds both, which is why the real charge collapses to the computation floor.
const CAPTURED_GAS_USED = {
  computationCost: '2850000',
  storageCost: '10632400',
  storageRebate: '34347060',
  nonRefundableStorageFee: '346940',
}

describe('sponsor SCOPE covers every open act the auto-open can compose', () => {
  test('the bare world open (`results::open` — the pill / settle-observed auto-open) is in scope', () => {
    expect(() => S.assert_ptb_scope(OPEN_KIND)).not.toThrow()
  })

  test('the run-bound open (`dungeon::settle_run` → `results::open`) is in scope', () => {
    expect(() => S.assert_ptb_scope(RUN_OPEN_KIND)).not.toThrow()
  })

  test('the captured settle+open shape (digest GKgXWe…Zy5n) is in scope', () => {
    expect(() => S.assert_ptb_scope(SETTLE_OPEN_KIND)).not.toThrow()
  })
})

describe('sponsor PER-TX BUDGET CEILING covers the heaviest open act on record', () => {
  test('the captured receipt derives a budget far under the ceiling (never a sponsor-over-ceiling refusal)', () => {
    const budget = S.derive_budget_mist(CAPTURED_GAS_USED)
    // gross 13_482_400 × 3/2 = 20_223_600 MIST ≈ 0.0202 SUI against a 0.3 SUI ceiling.
    expect(budget).toBe(20_223_600n)
    expect(budget).toBeLessThan(PER_TX_BUDGET_CEILING_MIST)
    expect(PER_TX_BUDGET_CEILING_MIST / budget).toBeGreaterThanOrEqual(14n) // ≥14× headroom
  })

  test('the ceiling would still admit an open act an order of magnitude heavier than the measured one', () => {
    expect(() => S.derive_budget_mist({ computationCost: '28500000', storageCost: '106324000' })).not.toThrow()
  })
})

describe('sponsor PER-ADDRESS DAILY CAP covers a real day of open acts', () => {
  test('the captured act charges the computation floor (its storage rebate exceeds its storage cost)', () => {
    expect(S.real_charge_mist(CAPTURED_GAS_USED)).toBe(2_850_000n)
  })

  test('the 1 SUI daily cap admits ≥300 open acts per address — more fights than a day holds', () => {
    expect(ADDR_DAILY_CAP_MIST / S.real_charge_mist(CAPTURED_GAS_USED)).toBeGreaterThanOrEqual(300n)
  })

  test('even priced at the full derived BUDGET (nothing refunded), the cap admits a long session of opens', () => {
    expect(ADDR_DAILY_CAP_MIST / S.derive_budget_mist(CAPTURED_GAS_USED)).toBeGreaterThanOrEqual(49n)
  })
})
