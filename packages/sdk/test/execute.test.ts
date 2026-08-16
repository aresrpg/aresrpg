// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The execute gate over the CORE client interface (gRPC/GraphQL — JSON-RPC is dead): sign once
// → simulate the exact bytes → a simulated failure NEVER reaches the chain (zero gas, no
// digest) → the same bytes submit on success → effects.changedObjects feed the cache.

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'

import { SDK, absorb_receipt, type Receipt, type SuiTransport } from '../src/client.ts'

type ChangedRow = NonNullable<NonNullable<Receipt['effects']>['changedObjects']>[number]

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const pin = (n: number) => ({ id: id(n), shared_version: '1' })
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

const changed = (
  object_id: string,
  version: string,
  owner: ChangedRow['outputOwner'] = { $kind: 'AddressOwner', AddressOwner: id(99) }
): ChangedRow => ({
  objectId: object_id,
  idOperation: 'None',
  outputState: 'ObjectWrite',
  outputVersion: version,
  outputDigest: digest,
  outputOwner: owner,
})

/** A fake CORE client: hydrate sources, a scriptable simulation verdict, an execution recorder. */
const fake_client = ({ simulate_ok, execution_gate }: { simulate_ok: boolean; execution_gate?: Promise<void> }) => {
  const calls = { simulations: 0, executions: 0, balances: 0, active_executions: 0, max_active_executions: 0 }
  return {
    calls,
    core: {
      getBalance: async () => {
        calls.balances += 1
        return { balance: { balance: '10000000000', coinBalance: '0', addressBalance: '10000000000' } }
      },
      getReferenceGasPrice: async () => ({ referenceGasPrice: '1000' }),
      listCoins: async () => ({
        objects: [{ objectId: id(50), version: '3', digest, owner: { $kind: 'AddressOwner', AddressOwner: id(99) } }],
      }),
      getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
        objects: objectIds.map((object_id: string) => ({
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
        calls.active_executions += 1
        calls.max_active_executions = Math.max(calls.max_active_executions, calls.active_executions)
        await execution_gate
        calls.active_executions -= 1
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

const game = async (client: ReturnType<typeof fake_client>) => {
  const sdk = SDK({ client, signer, pins })
  await sdk.hydrate([id(11)]) // seeds the shared kiosk, the gas price, and the gas coin
  absorb_receipt(sdk.cache, {
    Transaction: { effects: { changedObjects: [changed(id(13), '5')] } },
  })
  return sdk
}

describe('the execute gate (core interface)', () => {
  test('balance reads include address balance instead of only legacy coin objects', async () => {
    const client = fake_client({ simulate_ok: true })
    const sdk = SDK({ address: id(99), client, pins })

    expect(await sdk.read_sui_balance()).toBe(10_000_000_000n)
  })

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
    expect(receipt.Transaction?.digest).toBe('EXEC')
    expect(client.calls.simulations).toBe(1)
    expect(client.calls.executions).toBe(1)
    // the gas coin's fresh version came back through effects.changedObjects — self-sustaining
    expect(sdk.ref(id(50))).toEqual({ objectId: id(50), version: '4', digest })
  })

  test('a Wallet Standard adapter uses the same executor, gas ledger, and balance cache', async () => {
    const client = fake_client({ simulate_ok: true })
    let signatures = 0
    const sdk = SDK({
      address: id(99),
      client,
      pins,
      sign_transaction: async () => {
        signatures += 1
        return { bytes: new Uint8Array([1]), signature: 'wallet-signature' }
      },
    })
    await sdk.read_sui_balance()
    await sdk.read_sui_balance()
    expect(client.calls.balances).toBe(1)

    const transaction = sdk.tx()
    transaction.transferObjects([transaction.gas], id(98))
    await sdk.execute(transaction)

    expect(signatures).toBe(1)
    expect(client.calls.simulations).toBe(1)
    expect(client.calls.executions).toBe(1)
    await sdk.read_sui_balance()
    expect(client.calls.balances).toBe(2)
  })

  test('the executor serializes submissions that share its receipt-fed gas cache', async () => {
    let release_execution = (): void => undefined
    const execution_gate = new Promise<void>((resolve) => {
      release_execution = resolve
    })
    const client = fake_client({ simulate_ok: true, execution_gate })
    const sdk = SDK({ client, signer, pins })
    const first = sdk.tx()
    const second = sdk.tx()
    first.transferObjects([first.gas], id(97))
    second.transferObjects([second.gas], id(98))

    const submissions = Promise.all([sdk.execute(first), sdk.execute(second)])
    while (client.calls.executions === 0) await Promise.resolve()
    expect(client.calls.executions).toBe(1)
    release_execution()
    await submissions

    expect(client.calls.executions).toBe(2)
    expect(client.calls.max_active_executions).toBe(1)
  })

  test('missing gas fails before signing and retries hydration after funding', async () => {
    const client = fake_client({ simulate_ok: true })
    let funded = false
    let coin_reads = 0
    let signatures = 0
    client.core.listCoins = async () => {
      coin_reads += 1
      return {
        objects: funded
          ? [{ objectId: id(50), version: '3', digest, owner: { $kind: 'AddressOwner', AddressOwner: id(99) } }]
          : [],
      }
    }
    const sdk = SDK({
      address: id(99),
      client,
      pins,
      sign_transaction: async () => {
        signatures += 1
        return { bytes: new Uint8Array([1]), signature: 'wallet-signature' }
      },
    })
    const unfunded = sdk.tx()
    unfunded.transferObjects([unfunded.gas], id(98))
    await expect(sdk.execute(unfunded)).rejects.toThrow('owned SUI gas coin')
    expect(signatures).toBe(0)

    funded = true
    const funded_transaction = sdk.tx()
    funded_transaction.transferObjects([funded_transaction.gas], id(98))
    await sdk.execute(funded_transaction)

    expect(coin_reads).toBe(2)
    expect(signatures).toBe(1)
  })
})
