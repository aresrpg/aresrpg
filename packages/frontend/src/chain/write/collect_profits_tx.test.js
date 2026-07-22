// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// BUILD #180 — RED-FIRST: the multi-kiosk COLLECT PTB shape. `build_collect_profits_tx` lives in its own
// module (imported by write_listings.js) purely so the SHAPE is assertable: write_listings.js imports
// `../../auth` at module scope, which registers Enoki wallets at import time (touches `window` — real in a
// browser, absent under `bun test`); testing through it would need mock.module, banned house-wide
// (kiosk_cap_cache.test.js's law). Given N caps, does it independently borrow → withdraw → return EACH
// kiosk's own PersonalKioskCap, all inside ONE shared Transaction (one signature for every kiosk with
// money, never N wallet prompts)? Real @mysten/sui Transaction + real @mysten/kiosk KioskClient — building
// a PTB graph never touches the network, so nothing here is faked; verified against the library's ACTUAL
// command output (not a guessed shape).
import { describe, expect, it } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { KioskClient } from '@mysten/kiosk'

import { build_collect_profits_tx } from './collect_profits_tx.js'

const ADDRESS = '0x' + '11'.repeat(32)
const CAP_A = { kioskId: '0x' + 'aa'.repeat(32), objectId: '0x' + 'ab'.repeat(32), isPersonal: true }
const CAP_B = { kioskId: '0x' + 'bb'.repeat(32), objectId: '0x' + 'bc'.repeat(32), isPersonal: true }

// No custom packageIds passed anywhere below — KioskClient falls back to its own hardcoded testnet rule
// package, so this never needs a real deployment id to construct a faithful, real client.
function test_kiosk_client() {
  return new KioskClient({ client: { network: 'testnet' }, network: 'testnet' })
}

function move_calls(tx) {
  return tx
    .getData()
    .commands.filter((c) => c.$kind === 'MoveCall')
    .map((c) => `${c.MoveCall.module}::${c.MoveCall.function}`)
}

describe('build_collect_profits_tx — the multi-kiosk withdraw PTB shape', () => {
  it('one kiosk: borrows its personal cap, withdraws, then returns the cap — in that exact order', () => {
    const tx = new Transaction()
    build_collect_profits_tx({ tx, kiosk_client: test_kiosk_client(), caps: [CAP_A], address: ADDRESS })

    expect(move_calls(tx)).toEqual(['personal_kiosk::borrow_val', 'kiosk::withdraw', 'personal_kiosk::return_val'])
    expect(tx.getData().commands.filter((c) => c.$kind === 'TransferObjects')).toHaveLength(1)
  })

  it('two kiosks with profits settle in ONE shared transaction — one full borrow/withdraw/return cycle EACH', () => {
    const tx = new Transaction()
    build_collect_profits_tx({ tx, kiosk_client: test_kiosk_client(), caps: [CAP_A, CAP_B], address: ADDRESS })

    expect(move_calls(tx)).toEqual([
      'personal_kiosk::borrow_val',
      'kiosk::withdraw',
      'personal_kiosk::return_val',
      'personal_kiosk::borrow_val',
      'kiosk::withdraw',
      'personal_kiosk::return_val',
    ])
    // every kiosk's proceeds land as their OWN transfer to the connected wallet — never merged, never dropped
    expect(tx.getData().commands.filter((c) => c.$kind === 'TransferObjects')).toHaveLength(2)
  })

  it('every withdraw pays out to the SAME connected wallet address, never a third party', () => {
    const tx = new Transaction()
    build_collect_profits_tx({ tx, kiosk_client: test_kiosk_client(), caps: [CAP_A, CAP_B], address: ADDRESS })

    const { inputs } = tx.getData()
    const transfers = tx.getData().commands.filter((c) => c.$kind === 'TransferObjects')
    for (const transfer of transfers) {
      const idx = transfer.TransferObjects.address.Input
      expect(inputs[idx].Pure.bytes).toBe(inputs[transfers[0].TransferObjects.address.Input].Pure.bytes)
    }
  })

  it('zero kiosks builds an empty PTB — never a phantom withdraw call', () => {
    const tx = new Transaction()
    build_collect_profits_tx({ tx, kiosk_client: test_kiosk_client(), caps: [], address: ADDRESS })
    expect(tx.getData().commands).toHaveLength(0)
  })
})
