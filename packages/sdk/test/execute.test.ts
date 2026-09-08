// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The execute gate over the CORE client interface (gRPC/GraphQL — JSON-RPC is dead): sign once
// → simulate the exact bytes → a simulated failure NEVER reaches the chain (zero gas, no
// digest) → the same bytes submit on success → effects.changedObjects feed the cache.

import { describe, expect, test } from 'bun:test'

import { GAS_BUDGET_MIST, SDK, absorb_receipt, type Receipt, type SuiTransport } from '../src/client.ts'
import { executed_transaction_digest, pre_submission_version_race } from '../src/transaction_error.ts'

import { changed, digest, fake_client, id, pins, signer } from './helpers/transport.ts'

const game = async (client: ReturnType<typeof fake_client>) => {
  const sdk = SDK({ client, signer, pins })
  await sdk.hydrate([id(11)]) // seeds the shared kiosk; Sui resolves gas while building
  absorb_receipt(sdk.cache, {
    Transaction: { effects: { changedObjects: [changed(id(13), '5')] } },
  })
  return sdk
}

describe('the execute gate (core interface)', () => {
  test('pre-sign resolution lag is classified without retrying inside the SDK', () => {
    const lag = new Error(
      '[sdk] transaction resolution failed — NOT submitted: provided version does not match for object 0x1, provided: 10 actual: 0x9'
    )
    expect(pre_submission_version_race(lag)).toBeTrue()
    expect(pre_submission_version_race(new Error('provided version does not match'))).toBeFalse()
    expect(pre_submission_version_race(new Error('[sdk] transaction DIGEST failed on-chain: stale'))).toBeFalse()
    expect(
      pre_submission_version_race(
        new Error('[sdk] transaction DIGEST failed on-chain: NOT submitted; provided version does not match')
      )
    ).toBeFalse()
  })

  test('an executed failure exposes its terminal digest without classifying pre-submit errors', () => {
    expect(executed_transaction_digest(new Error('[sdk] transaction 7abc failed on-chain: abort'))).toBe('7abc')
    expect(executed_transaction_digest(new Error('transaction resolution failed — NOT submitted'))).toBeNull()
  })

  test('a raw build failure is marked as not submitted at the actual pre-sign boundary', async () => {
    const client = fake_client({
      simulate_ok: true,
      resolution_failure: "provided version doesn't match for object 0x1, provided: 10 actual: 0x9",
    })
    const sdk = await game(client)

    await expect(sdk.execute(sdk.tx())).rejects.toThrow(
      /transaction resolution failed.*NOT submitted.*provided version/
    )
    expect(client.calls.executions).toBe(0)
  })

  test('game transactions reserve the owner-approved 0.2 SUI ceiling', () => {
    expect(GAS_BUDGET_MIST).toBe(200_000_000n)
  })

  test('object hydration stays below the Core query payload limit', async () => {
    const client = fake_client({ simulate_ok: true })
    const sdk = SDK({ address: id(99), client, pins })

    await sdk.hydrate(Array.from({ length: 21 }, (_, index) => id(index + 100)))

    expect(client.calls.hydrations.map(({ length }) => length)).toEqual([21])
  })

  test('an external id is read once and absence remains data', async () => {
    const client = fake_client({ simulate_ok: true, lag: new Map([[id(77), 99]]) })
    const sdk = SDK({ address: id(99), client, pins })

    await sdk.hydrate_unknown([id(77)])
    expect(sdk.cache.shared.has(id(77))).toBeFalse()
    expect(client.calls.hydrations).toHaveLength(1)
  })

  test('a receipt-fresh owned ref is reused without asking a read node', async () => {
    const object_id = id(79)
    const client = fake_client({ simulate_ok: true, owned_versions: new Map([[object_id, ['4']]]) })
    const sdk = SDK({ address: id(99), client, pins })
    absorb_receipt(sdk.cache, { Transaction: { effects: { changedObjects: [changed(object_id, '5')] } } })

    await sdk.hydrate_unknown([object_id])

    expect(client.calls.hydrations).toHaveLength(0)
    expect(sdk.ref(object_id)?.version).toBe('5')
    expect(sdk).not.toHaveProperty('hydrate_required')
    expect(sdk).not.toHaveProperty('hydrate_owned_current')
  })

  test('balance reads include address balance instead of only legacy coin objects', async () => {
    const client = fake_client({ simulate_ok: true })
    const sdk = SDK({ address: id(99), client, pins })

    expect(await sdk.read_sui_balance()).toBe(10_000_000_000n)
  })

  test('a simulated failure throws and the transaction is NEVER submitted', async () => {
    const client = fake_client({ simulate_ok: false })
    const sdk = await game(client)
    const transaction = sdk.tx()
    sdk.doors.raise_stat(transaction, {
      kiosk: id(11),
      cap: id(13),
      character_id: id(13),
      stat: 'strength',
      points: 5,
    })
    await expect(sdk.execute(transaction)).rejects.toThrow(/dry run failed.*NOT submitted.*scribe locked/)
    expect(client.calls.simulations).toBe(1)
    expect(client.calls.executions).toBe(0)
  })

  test('a green simulation submits the same bytes and effects refresh the cache', async () => {
    const client = fake_client({ simulate_ok: true })
    const sdk = await game(client)
    const transaction = sdk.tx()
    sdk.doors.raise_stat(transaction, {
      kiosk: id(11),
      cap: id(13),
      character_id: id(13),
      stat: 'strength',
      points: 5,
    })
    const receipt = await sdk.execute(transaction)
    expect(receipt.Transaction?.digest).toBe(client.calls.digests[0])
    expect(client.calls.simulations).toBe(1)
    expect(client.calls.executions).toBe(1)
    expect(client.calls.resolutions).toBe(1)
    // the gas coin's fresh version came back through the receipt — self-sustaining
    expect(sdk.ref(id(50))).toEqual({ objectId: id(50), version: '4', digest })
  })

  // THE DUEL INCIDENT (2026-08-21): the SDK used to pin the receipt's gas coin onto the next
  // transaction. Naming any coin opts out of address-balance gas — and a testnet address owns
  // NO coin objects — so a wallet holding 1000 SUI was refused for "gas". Gas payment belongs
  // to the resolver, every single time.
  // The budget is OURS and fixed, so a gas refusal at the dry run is our bug, not an empty
  // wallet. The message must say so — and must NOT carry the raw `InsufficientGas`, which is
  // the vocabulary the app's out-of-SUI prompt watches for.
  test('a dry run refused for gas names the budget, not the wallet', async () => {
    const client = fake_client({ simulate_ok: false, failure_message: 'InsufficientGas' })
    const sdk = await game(client)

    await expect(sdk.execute(sdk.tx())).rejects.toThrow(/gas budget exceeded.*NOT submitted/)
    await expect(sdk.execute(sdk.tx())).rejects.not.toThrow(/InsufficientGas/)
    expect(client.calls.executions).toBe(0)
  })

  test('gas payment is never pinned from a receipt — the resolver decides every transaction', async () => {
    const client = fake_client({ simulate_ok: true })
    const sdk = await game(client)
    await sdk.execute(sdk.tx()) // its receipt reports the gas object at version 4

    const next = sdk.tx()
    await sdk.execute(next)
    expect(next.getData().gasData.payment).toEqual([{ objectId: id(50), version: '3', digest }])
  })

  test('a gasless transaction keeps the resolver empty payment — the address balance pays', async () => {
    const client = fake_client({ simulate_ok: true })
    client.core.resolveTransactionPlugin = () => async (transaction_data, options, next) => {
      client.calls.resolutions += 1
      if (!options.onlyTransactionKind) {
        transaction_data.gasData.price = '1000'
        transaction_data.gasData.budget = '5000000'
        transaction_data.gasData.payment = [] // no Coin object exists to name
        // what the real resolver does for an empty payment: replay protection moves to the epoch
        transaction_data.expiration = {
          $kind: 'ValidDuring',
          ValidDuring: {
            minEpoch: '1',
            maxEpoch: '2',
            minTimestamp: null,
            maxTimestamp: null,
            chain: digest,
            nonce: 7,
          },
        }
      }
      await next()
    }
    const sdk = await game(client)
    await sdk.execute(sdk.tx())

    const next = sdk.tx()
    await sdk.execute(next)
    expect(next.getData().gasData.payment).toEqual([])
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
    // one resolver simulation, then one execution; the SDK never adds another preflight
    expect(client.calls.simulations).toBe(1)
    expect(client.calls.executions).toBe(1)
    await sdk.read_sui_balance()
    expect(client.calls.balances).toBe(2) // cached UI read + post-receipt UI read
  })

  test('refuses a bad transaction before opening the wallet', async () => {
    const client = fake_client({ simulate_ok: false })
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
    const transaction = sdk.tx()
    transaction.transferObjects([transaction.gas], id(98))

    await expect(sdk.execute(transaction)).rejects.toThrow(/NOT submitted.*scribe locked/)
    expect(signatures).toBe(0)
    expect(client.calls.executions).toBe(0)
  })

  // The same verdict wearing a different hat: a refused simulation whose `success: false` sits
  // in the Transaction branch. Reading only FailedTransaction would submit it and burn the gas
  // for a failure the preflight already knew about.
  test('refuses a failed simulation that arrives in the Transaction branch', async () => {
    const client = fake_client({ simulate_ok: false, failure_branch: 'Transaction' })
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
    const transaction = sdk.tx()
    transaction.transferObjects([transaction.gas], id(98))

    await expect(sdk.execute(transaction)).rejects.toThrow(/NOT submitted.*scribe locked/)
    expect(signatures).toBe(0)
    expect(client.calls.executions).toBe(0)
  })

  test('an executed failure in the Transaction branch remains a failed action', async () => {
    const client = fake_client({ simulate_ok: true, execution_ok: false })
    const sdk = SDK({ client, signer, pins })
    const transaction = sdk.tx()
    transaction.transferObjects([transaction.gas], id(98))

    await expect(sdk.execute(transaction)).rejects.toThrow(/transaction \S+ failed on-chain.*scribe locked/)
    expect(client.calls.executions).toBe(1)
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

  test('a lazy visibility barrier blocks only the next transaction before resolution or signing', async () => {
    const client = fake_client({ simulate_ok: true, visibility_failures: 1 })
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

    await sdk.execute(sdk.tx())
    expect(client.calls.visibility_waits).toEqual([])
    expect(signatures).toBe(1)

    await expect(sdk.execute(sdk.tx())).rejects.toThrow(/next transaction NOT submitted.*ledger has not indexed/)
    expect(client.calls).toMatchObject({ executions: 1, resolutions: 1, simulations: 1 })
    expect(signatures).toBe(1)

    await sdk.execute(sdk.tx())
    expect(client.calls.visibility_waits).toEqual([client.calls.digests[0]!, client.calls.digests[0]!])
    expect(client.calls).toMatchObject({ executions: 2, resolutions: 2, simulations: 2 })
    expect(signatures).toBe(2)
  })

  test('an executed failure also arms the next-write visibility barrier', async () => {
    const client = fake_client({ simulate_ok: true, execution_ok: false })
    const sdk = SDK({ client, signer, pins })

    await expect(sdk.execute(sdk.tx())).rejects.toThrow(/failed on-chain/)
    await expect(sdk.execute(sdk.tx())).rejects.toThrow(/failed on-chain/)

    expect(client.calls.visibility_waits).toEqual([client.calls.digests[0]!])
    expect(client.calls.executions).toBe(2)
  })

  test('delegates gas selection and estimation to the configured Sui resolver', async () => {
    const client = fake_client({ simulate_ok: true })
    let coin_reads = 0
    let signatures = 0
    client.core.listCoins = async (input: {
      owner: string
      coinType?: string
      limit?: number
      cursor?: string | null
    }) => {
      coin_reads += 1
      expect(input.limit).toBeUndefined()
      return {
        objects: [
          {
            objectId: id(51),
            version: '3',
            digest,
            balance: '3000000000',
            owner: { $kind: 'AddressOwner', AddressOwner: id(99) },
          },
          {
            objectId: id(50),
            version: '3',
            digest,
            balance: '3000000000',
            owner: { $kind: 'AddressOwner', AddressOwner: id(99) },
          },
        ],
      }
    }
    client.core.getBalance = async () => ({
      balance: { balance: '6000000000', addressBalance: '0', coinBalance: '6000000000' },
    })
    client.core.resolveTransactionPlugin = () => async (transaction_data, options, next) => {
      client.calls.resolutions += 1
      if (!options.onlyTransactionKind) {
        const { objects } = await client.core.listCoins({ owner: id(99) })
        transaction_data.gasData.price = '1000'
        transaction_data.gasData.budget = '5000000'
        transaction_data.gasData.payment = objects.map(({ objectId, version, digest: object_digest }) => ({
          objectId: objectId!,
          version: String(version),
          digest: object_digest!,
        }))
      }
      await next()
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
    const transaction = sdk.tx()
    transaction.transferObjects([transaction.gas], id(98))
    await sdk.execute(transaction)

    expect(coin_reads).toBe(1)
    expect(signatures).toBe(1)
    expect(client.calls.resolutions).toBe(1)
  })
})
