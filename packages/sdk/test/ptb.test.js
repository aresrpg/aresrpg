// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// with_kiosk delegates the borrow/return dance to the official KioskTransaction: a personal cap
// composes borrow_val → doors → return_val; a plain cap passes straight through.

import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { KioskClient } from '@mysten/kiosk'

import { with_kiosk } from '../src/ptb.js'

const id = (n) => `0x${String(n).padStart(64, '0')}`
// A REAL KioskClient over a stub transport: the personal-kiosk package ids are baked per
// network, so construction and the borrow/return composition make zero RPC calls.
const kiosk_client = new KioskClient({ client: {}, network: 'testnet' })

const cap = (is_personal) => ({ objectId: id(1), kioskId: id(2), isPersonal: is_personal })
const targets = (tx) =>
  tx
    .getData()
    .commands.filter((c) => c.MoveCall)
    .map((c) => `${c.MoveCall.module}::${c.MoveCall.function}`)

describe('with_kiosk (the official KioskTransaction under the hood)', () => {
  test('a PERSONAL cap wraps compose in borrow_val / return_val', () => {
    const tx = new Transaction()
    with_kiosk(tx, kiosk_client, cap(true), (kiosk, kiosk_cap) => {
      expect(kiosk).toBeDefined()
      expect(kiosk_cap).toBeDefined()
    })
    expect(targets(tx)[0]).toBe('personal_kiosk::borrow_val')
    expect(targets(tx).at(-1)).toBe('personal_kiosk::return_val')
  })

  test('a plain cap composes with zero extra commands', () => {
    const tx = new Transaction()
    with_kiosk(tx, kiosk_client, cap(false), () => {})
    expect(targets(tx)).toEqual([])
  })
})
