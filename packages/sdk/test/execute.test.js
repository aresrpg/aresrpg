// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The execute gate over the CORE client interface (gRPC/GraphQL — JSON-RPC is dead): sign once
// → simulate the exact bytes → a simulated failure NEVER reaches the chain (zero gas, no
// digest) → the same bytes submit on success → effects.changedObjects feed the cache.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { SDK, absorb_receipt } from '../src/client.js'

const id = (n) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const pin = (n) => ({ id: id(n), shared_version: '1' })
const pins = {
  package: id(1),
  version: pin(3),
  name_registry: pin(4),
  character_policy: pin(5),
  item_policy: pin(6),
  loot_registry: pin(7),
  character_protected_policy: pin(8),
  item_protected_policy: pin(9),
  friend_registry: pin(10),
}

const changed = (object_id, version, owner = { $kind: 'AddressOwner', AddressOwner: id(99) }) => ({
  objectId: object_id,
  idOperation: 'None',
  outputState: 'ObjectWrite',
  outputVersion: version,
  outputDigest: digest,
  outputOwner: owner,
})

/** A fake CORE client: hydrate sources, a scriptable simulation verdict, an execution recorder. */
const fake_client = ({ simulate_ok }) => {
  const calls = { simulations: 0, executions: 0 }
  return {
    calls,
    core: {
      getReferenceGasPrice: async () => ({ referenceGasPrice: '1000' }),
      listCoins: async () => ({
        objects: [{ objectId: id(50), version: '3', digest, owner: { $kind: 'AddressOwner', AddressOwner: id(99) } }],
      }),
      getObjects: async ({ objectIds }) => ({
        objects: objectIds.map((object_id) => ({
          objectId: object_id,
          version: '2',
          digest,
          owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } },
        })),
      }),
      simulateTransaction: async () => {
        calls.simulations += 1
        return simulate_ok
          ? { $kind: 'Transaction', Transaction: { effects: { status: { success: true, error: null } } } }
          : {
              $kind: 'FailedTransaction',
              FailedTransaction: {
                effects: { status: { success: false, error: { message: 'MoveAbort(2701) — scribe locked' } } },
              },
            }
      },
      executeTransaction: async () => {
        calls.executions += 1
        return {
          $kind: 'Transaction',
          Transaction: {
            digest: 'EXEC',
            effects: { status: { success: true, error: null }, changedObjects: [changed(id(50), '4')] },
          },
        }
      },
    },
  }
}

const signer = new Ed25519Keypair()

const game = async (client) => {
  const sdk = SDK({ client, signer, pins })
  await sdk.hydrate([id(11)]) // seeds the shared kiosk, the gas price, and the gas coin
  absorb_receipt(sdk.cache, {
    Transaction: { effects: { changedObjects: [changed(id(13), '5')] } },
  })
  return sdk
}

describe('the execute gate (core interface)', () => {
  test('a simulated failure throws and the transaction is NEVER submitted', async () => {
    const client = fake_client({ simulate_ok: false })
    const sdk = await game(client)
    await expect(
      sdk.call.raise_stat({ kiosk: id(11), cap: id(13), character_id: id(13), stat: 'strength', amount: 5 })
    ).rejects.toThrow(/dry run failed.*NOT submitted.*scribe locked/)
    expect(client.calls.simulations).toBe(1)
    expect(client.calls.executions).toBe(0)
  })

  test('a green simulation submits the same bytes and effects refresh the cache', async () => {
    const client = fake_client({ simulate_ok: true })
    const sdk = await game(client)
    const receipt = await sdk.call.raise_stat({
      kiosk: id(11),
      cap: id(13),
      character_id: id(13),
      stat: 'strength',
      amount: 5,
    })
    expect(receipt.Transaction.digest).toBe('EXEC')
    expect(client.calls.simulations).toBe(1)
    expect(client.calls.executions).toBe(1)
    // the gas coin's fresh version came back through effects.changedObjects — self-sustaining
    expect(sdk.ref(id(50))).toEqual({ objectId: id(50), version: '4', digest })
  })
})
