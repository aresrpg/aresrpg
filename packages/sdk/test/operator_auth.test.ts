// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { SuiGrpcClient } from '@mysten/sui/grpc'
import type { Transaction } from '@mysten/sui/transactions'

import { create_operator_giftcard_links } from '../src/operator_auth.ts'

const id = (value: number): string => `0x${value.toString(16).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'

const context = (owner = id(1)) => {
  let submitted: Transaction | null = null
  const read_batches: number[] = []
  const game_type_package = id(2)
  const client = {
    network: 'testnet',
    core: {
      getObjects: async ({ objectIds: object_ids }: { objectIds: string[] }) => {
        read_batches.push(object_ids.length)
        return {
          objects: object_ids.map((object_id) => ({
            objectId: object_id,
            version: '1',
            digest,
            type: `${game_type_package}::distribution::Giftcard`,
            owner: { $kind: 'AddressOwner', AddressOwner: owner },
          })),
        }
      },
    },
  } as unknown as SuiGrpcClient
  return {
    get submitted() {
      return submitted
    },
    read_batches,
    value: {
      address: id(1),
      client,
      game_type_package,
      execute: async (transaction: Transaction) => {
        submitted = transaction
        return { $kind: 'Transaction', Transaction: { digest } }
      },
    },
  }
}

const cards = (count = 2) =>
  Object.freeze(
    Array.from({ length: count }, (_, index) => id(index + 3)).map((card_id) =>
      Object.freeze({ id: card_id, key: Ed25519Keypair.generate().getSecretKey() })
    )
  )

describe('operator giftcard signing', () => {
  test('builds one fixed zkSend link per canonical operator-owned voucher', async () => {
    const harness = context()
    const result = await create_operator_giftcard_links(harness.value, cards(100))

    expect(result.digest).toBe(digest)
    expect(result.urls).toHaveLength(100)
    expect(new Set(result.urls).size).toBe(100)
    expect(harness.read_batches).toEqual([50, 50, 50, 50])
    expect(harness.submitted?.getData().commands).toHaveLength(200)
  })

  test('refuses foreign custody before constructing a wallet transaction', async () => {
    const harness = context(id(9))

    expect(create_operator_giftcard_links(harness.value, cards())).rejects.toThrow('owned by the connected operator')
    expect(harness.submitted).toBeNull()
  })

  test('refuses duplicate vouchers and bearer keys', async () => {
    const harness = context()
    const key = Ed25519Keypair.generate().getSecretKey()

    expect(
      create_operator_giftcard_links(harness.value, [
        { id: id(3), key },
        { id: id(3), key: Ed25519Keypair.generate().getSecretKey() },
      ])
    ).rejects.toThrow('reuse an object')
    expect(
      create_operator_giftcard_links(harness.value, [
        { id: id(3), key },
        { id: id(4), key },
      ])
    ).rejects.toThrow('reuse a bearer key')
  })
})
