// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// with_kiosk delegates the borrow/return dance to the official KioskTransaction: a personal cap
// composes borrow_val → doors → return_val; a plain cap passes straight through.

import { describe, expect, test } from 'bun:test'
import { Transaction } from '@mysten/sui/transactions'
import { KioskClient, type KioskOwnerCap } from '@mysten/kiosk'

import {
  create_personal_kiosk_runner,
  receipt_personal_kiosk_cap,
  with_kiosk,
  with_personal_kiosk,
} from '../src/ptb.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
// A REAL KioskClient over a stub transport: the personal-kiosk package ids are baked per
// network, so construction and the borrow/return composition make zero RPC calls.
const kiosk_client = new KioskClient({
  client: {} as ConstructorParameters<typeof KioskClient>[0]['client'],
  network: 'testnet',
})

const cap = (is_personal: boolean) => ({ objectId: id(1), kioskId: id(2), isPersonal: is_personal }) as KioskOwnerCap
const targets = (tx: Transaction) =>
  tx
    .getData()
    .commands.filter((c) => c.MoveCall)
    .map((c) => `${c.MoveCall!.module}::${c.MoveCall!.function}`)

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

  test('a missing cap creates, borrows, finalizes, and transfers one personal kiosk', () => {
    const tx = new Transaction()
    with_personal_kiosk(tx, kiosk_client, null, () => {
      tx.moveCall({ target: `${id(9)}::test::compose` })
    })
    expect(targets(tx)).toEqual([
      'kiosk::new',
      'personal_kiosk::new',
      'personal_kiosk::borrow_val',
      'test::compose',
      'transfer::public_share_object',
      'personal_kiosk::return_val',
      'personal_kiosk::transfer_to_sender',
    ])
  })

  test('an existing personal cap is reused without creating another kiosk', () => {
    const tx = new Transaction()
    with_personal_kiosk(tx, kiosk_client, cap(true), () => {})
    expect(targets(tx)).toEqual(['personal_kiosk::borrow_val', 'personal_kiosk::return_val'])
  })

  test('an ordinary kiosk is never accepted as personal custody', () => {
    const tx = new Transaction()
    expect(() => with_personal_kiosk(tx, kiosk_client, cap(false), () => {})).toThrow('personal kiosk')
  })

  test('projects the reusable personal cap from the creation receipt', () => {
    const kiosk_id = id(21)
    const cap_id = id(22)
    expect(
      receipt_personal_kiosk_cap({
        Transaction: {
          objectTypes: {
            [kiosk_id]: '0x2::kiosk::Kiosk',
            [cap_id]: `${id(7)}::personal_kiosk::PersonalKioskCap`,
          },
          effects: {
            changedObjects: [
              { objectId: kiosk_id, idOperation: 'Created' },
              {
                objectId: cap_id,
                idOperation: 'Created',
                outputVersion: '4',
                outputDigest: 'receipt-digest',
              },
            ],
          },
        },
      })
    ).toEqual({ objectId: cap_id, kioskId: kiosk_id, isPersonal: true, version: '4', digest: 'receipt-digest' })
  })

  test('concurrent first custody actions create once and then reuse the receipt cap', async () => {
    const created = cap(true)
    const seen: (KioskOwnerCap | null)[] = []
    let loads = 0
    const run = create_personal_kiosk_runner(async () => {
      loads += 1
      return null
    })
    await Promise.all([
      run(async (current) => {
        seen.push(current)
        return { value: 'first', kiosk_cap: created }
      }),
      run(async (current) => {
        seen.push(current)
        return { value: 'second', kiosk_cap: current! }
      }),
    ])
    expect(loads).toBe(2)
    expect(seen).toEqual([null, created])
  })
})
