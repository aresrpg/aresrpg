// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The character builder's receipt law and its local fold — the fold restates character.move's
// exact arithmetic (1 point spent per stat point, character.move raise_stat), so this test is
// the client half of that twin.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { KioskOwnerCap } from '@mysten/kiosk'
import type { TransactionPlugin } from '@mysten/sui/transactions'
import type { CharacterRow } from '@aresrpg/protocol'

import { SDK, absorb_receipt, type Receipt, type SuiTransport } from '../src/client.ts'
import { character_actions, character_create } from '../src/character.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'

const resolve_inputs: TransactionPlugin = async (transaction_data, options, next) => {
  transaction_data.inputs.forEach((input, index) => {
    const unresolved = (input as { UnresolvedObject?: { objectId: string } }).UnresolvedObject
    if (!unresolved) return
    transaction_data.inputs[index] = {
      $kind: 'Object',
      Object: {
        $kind: 'SharedObject',
        SharedObject: { objectId: unresolved.objectId, initialSharedVersion: '1', mutable: true },
      },
    } as never
  })
  if (!options.onlyTransactionKind) {
    transaction_data.gasData.price ??= '1000'
    transaction_data.gasData.budget ??= '5000000'
    transaction_data.gasData.payment ??= [{ objectId: id(50), version: '3', digest }]
  }
  await next()
}

const fake_client = (receipt: () => Receipt) => ({
  core: {
    resolveTransactionPlugin: () => resolve_inputs,
    getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
      objects: objectIds.map((object_id) => ({
        objectId: object_id,
        version: '1',
        digest,
        owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
      })),
    }),
    simulateTransaction: async (): Promise<Receipt> => ({ $kind: 'Transaction', Transaction: { digest } }),
    executeTransaction: async (): Promise<Receipt> => receipt(),
  },
})

const pins = {
  package: id(1),
  version: { id: id(6), shared_version: '1' },
  name_registry: { id: id(4), shared_version: '1' },
  character_policy: { id: id(5), shared_version: '1' },
  character_protected_policy: { id: id(11), shared_version: '1' },
}

const kiosk_cap = { objectId: id(3), kioskId: id(12), isPersonal: true } as KioskOwnerCap

const game = (receipt: () => Receipt = () => ({ $kind: 'Transaction', Transaction: { digest } })) => {
  const sdk = SDK({ client: fake_client(receipt) as unknown as SuiTransport, signer: new Ed25519Keypair(), pins })
  absorb_receipt(sdk.cache, {
    effects: {
      changedObjects: [
        {
          objectId: id(20),
          idOperation: 'Created',
          outputState: 'ObjectWrite',
          outputVersion: '1',
          outputDigest: digest,
          outputOwner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
        },
      ],
    },
  })
  return sdk
}

const character_row = (): CharacterRow =>
  ({
    id: id(20),
    name: 'aiden',
    classe: 'senshi',
    level: 10,
    strength: 25,
    available_points: 45,
  }) as CharacterRow

describe('the character builder', () => {
  test('raise_stat folds the exact chain arithmetic: +N to the stat, −N from the pool', async () => {
    const actions = character_actions(game() as never, { character: character_row(), kiosk_cap })
    const { character } = await actions.raise_stat('strength', 20)
    expect(character.strength).toBe(45)
    expect(character.available_points).toBe(25)
  })

  test('refuses a non-positive raise and an unaffordable one before any transaction', async () => {
    const actions = character_actions(game() as never, { character: character_row(), kiosk_cap })
    await expect(actions.raise_stat('strength', 0)).rejects.toThrow('positive')
    await expect(actions.raise_stat('strength', 46)).rejects.toThrow('Not enough')
  })

  test('create refuses to invent the character id when the receipt carries no CharacterCreated', async () => {
    const sdk = game()
    await expect(
      character_create(sdk as never, {
        name: 'aiden',
        classe: 'senshi',
        male: true,
        color_1: 1,
        color_2: 2,
        color_3: 3,
        kiosk_cap,
      })
    ).rejects.toThrow('CharacterCreated')
  })
})
