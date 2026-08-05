// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// #2243 MONEY LAW + SINGLE HOME, pinned on the source itself (the store's runtime pulls the whole auth/tx
// stack in; the two facts that matter here are structural, so they are checked structurally — the same shape
// as send_modal_shell.test.ts).
//
//  1. A SUI transfer moves value off `tx.gas`, so it takes the SELF-PAY door. Under the DRAIN shape the gas
//     coin IS the transferred object — a sponsored one would send the gas station's coin away. This is the
//     regression that made the switch mandatory: the send used to ride `sign_and_execute_transaction`, the
//     sponsor-FIRST door.
//  2. Coin plumbing lives once, in the SDK composer. The store used to hand-roll the same split twice (dry-run
//     leg and signing leg) — two homes for one transaction shape.
import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

const store = readFileSync(new URL('../../src/stores/sui_send.ts', import.meta.url), 'utf8')

describe('the SUI send store never routes a transfer through the sponsor', () => {
  test('it signs through the self-pay door', () => {
    expect(store).toContain('sign_and_execute_self_pay_transaction')
  })

  test('it never touches the sponsor-first door or the sponsored door', () => {
    expect(store).not.toMatch(/[^_]\bsign_and_execute_transaction\b/)
    expect(store).not.toContain('sponsor_and_execute_transaction')
  })
})

describe('the send PTB has ONE composer', () => {
  test('the store imports the SDK composer', () => {
    expect(store).toContain("from '@aresrpg/sdk/sui-transfer'")
    expect(store).toContain('sui_transfer_ptb')
  })

  test('the store hand-rolls no coin commands of its own', () => {
    expect(store).not.toContain('splitCoins')
    expect(store).not.toContain('transferObjects')
  })
})
