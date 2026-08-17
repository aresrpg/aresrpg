// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The temporary seed signer's custody laws, each born from a real money-loss path:
//   1. a store that cannot hold the secret refuses BEFORE any transaction executes
//   2. a corrupt or half-written record never silently mints a second authorization
//   3. an expired session refuses work with an honest message and stays recoverable
//   4. release never clears a funded signer whose capability ID was not persisted

import { describe, expect, test } from 'bun:test'
import { Ed25519Keypair as Keypair, type Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import type { Transaction, TransactionPlugin } from '@mysten/sui/transactions'

import { SDK, type Receipt, type SuiTransport } from '../src/client.ts'
import { absorb_receipt } from '../src/cache.ts'
import { create_seed_session, type SeedSessionRecord, type SeedSessionStore } from '../src/seed_session.ts'

const id = (n: number) => `0x${String(n).padStart(64, '0')}`
const digest = '11111111111111111111111111111111'
const package_id = id(1)
const network = 'testnet'
const super_cap = id(2)
const temp_cap = id(3)
const return_address = id(9)

const resolve_gas: TransactionPlugin = async (transaction_data, options, next) => {
  if (!options.onlyTransactionKind) {
    transaction_data.gasData.price ??= '1000'
    transaction_data.gasData.budget ??= '5000000'
    transaction_data.gasData.payment ??= [{ objectId: id(50), version: '3', digest }]
  }
  await next()
}

const authorization_receipt = (): Receipt => ({
  $kind: 'Transaction',
  Transaction: {
    digest,
    objectTypes: { [temp_cap]: `${package_id}::admin::AdminCap` },
    effects: {
      changedObjects: [
        {
          objectId: temp_cap,
          idOperation: 'Created',
          outputState: 'ObjectWrite',
          outputVersion: '1',
          outputDigest: digest,
          outputOwner: { $kind: 'AddressOwner', AddressOwner: id(8) },
        },
      ],
    },
  },
})

const release_receipt = (): Receipt => ({
  $kind: 'Transaction',
  Transaction: {
    digest,
    effects: {
      changedObjects: [{ objectId: temp_cap, idOperation: 'Deleted', outputState: 'DoesNotExist' }],
    },
  },
})

const fake_transport = ({ epoch = '7', balance = '0' }: { epoch?: string; balance?: string } = {}) => {
  const log: string[] = []
  const submitted: Uint8Array[] = []
  const state = { epoch, balance, balance_reads: 0, fail_execution: null as string | null, releasing: false }
  return {
    log,
    submitted,
    state,
    core: {
      resolveTransactionPlugin: () => resolve_gas,
      getCurrentSystemState: async () => ({ systemState: { epoch: state.epoch, referenceGasPrice: '1000' } }),
      getBalance: async () => {
        state.balance_reads += 1
        return { balance: { balance: state.balance } }
      },
      getObjects: async ({ objectIds }: { objectIds: string[] }) => ({
        objects: objectIds.map((object_id) => ({
          objectId: object_id,
          version: '1',
          digest,
          owner: { $kind: 'AddressOwner', AddressOwner: id(8) },
        })),
      }),
      simulateTransaction: async (): Promise<Receipt> =>
        state.fail_execution
          ? {
              $kind: 'FailedTransaction',
              FailedTransaction: { digest, effects: { status: { error: state.fail_execution } } },
            }
          : { $kind: 'Transaction', Transaction: { digest } },
      executeTransaction: async ({ transaction }: { transaction: Uint8Array }): Promise<Receipt> => {
        log.push('execute')
        submitted.push(transaction)
        if (!state.releasing) return authorization_receipt()
        state.balance = '0'
        return release_receipt()
      },
    },
  }
}

/** An injectable store with scriptable failure modes and an action log. */
const memory_store = () => {
  const log: string[] = []
  const state = { record: null as SeedSessionRecord | null, refuse_writes: false, corrupt: false }
  const store: SeedSessionStore = {
    read: () => {
      if (state.corrupt)
        throw new Error('The stored seed session record is corrupt — an earlier session may be orphaned.')
      return state.record
    },
    write: (record) => {
      log.push('write')
      if (state.refuse_writes) throw new Error('quota exceeded')
      state.record = record
    },
    clear: () => {
      log.push('clear')
      state.record = null
    },
  }
  return { store, state, log }
}

const session_of = (
  transport: ReturnType<typeof fake_transport>,
  store: SeedSessionStore,
  sdk_builds?: { count: number }
) => {
  const super_sdk = SDK({
    client: transport as unknown as SuiTransport,
    signer: undefined,
    address: id(9),
    pins: { package: package_id },
    sign_transaction: async (tx: Transaction) => ({ bytes: await tx.build(), signature: 'sig' }),
  })
  absorb_receipt(super_sdk.cache, {
    effects: {
      changedObjects: [
        {
          objectId: super_cap,
          idOperation: 'None',
          outputState: 'ObjectWrite',
          outputVersion: '2',
          outputDigest: digest,
          outputOwner: { $kind: 'AddressOwner', AddressOwner: id(9) },
        },
      ],
    },
  })
  return create_seed_session({
    store,
    super_sdk,
    super_admin_cap: super_cap,
    network,
    owner: return_address,
    package_id,
    build_session_sdk: (keypair: Ed25519Keypair) => {
      if (sdk_builds) sdk_builds.count += 1
      return SDK({ client: transport as unknown as SuiTransport, signer: keypair, pins: { package: package_id } })
    },
  })
}

describe('the seed session custody laws', () => {
  test('a store that cannot hold the secret refuses BEFORE any transaction executes', async () => {
    const transport = fake_transport()
    const { store, state } = memory_store()
    state.refuse_writes = true
    const session = session_of(transport, store)
    await expect(session.ensure()).rejects.toThrow('quota exceeded')
    expect(transport.log).toEqual([]) // nothing was signed, nothing was submitted
  })

  test('authorize persists the verified record; a reload restores without a second mint', async () => {
    const transport = fake_transport()
    const { store, state } = memory_store()
    const session = session_of(transport, store)
    const first = await session.ensure()
    expect(first.admin_cap).toBe(temp_cap)
    expect(state.record?.admin_cap).toBe(temp_cap)
    expect(state.record?.epoch).toBe('7')
    expect(transport.log).toEqual(['execute'])

    const restored = session_of(transport, store) // a fresh page: same store, new session
    const second = await restored.ensure()
    expect(second.admin_cap).toBe(temp_cap)
    expect(transport.log).toEqual(['execute']) // still exactly ONE authorization
  })

  test('a failed final write keeps the live signer available for immediate cleanup', async () => {
    const transport = fake_transport({ balance: '5' })
    const memory = memory_store()
    let writes = 0
    const store: SeedSessionStore = {
      ...memory.store,
      write: (record) => {
        writes += 1
        if (writes === 2) throw new Error('quota exceeded after authorization')
        memory.store.write(record)
      },
    }
    const session = session_of(transport, store)
    await expect(session.ensure()).rejects.toThrow('quota exceeded after authorization')

    transport.state.releasing = true
    await session.release()
    expect(transport.log).toEqual(['execute', 'execute'])
    expect(memory.state.record).toBeNull()
  })

  test('cleanup reuses the receipt-fed SDK instead of re-hydrating stale object versions', async () => {
    const transport = fake_transport({ balance: '5' })
    const { store } = memory_store()
    const sdk_builds = { count: 0 }
    const session = session_of(transport, store, sdk_builds)
    await session.ensure()

    transport.state.releasing = true
    await session.release()
    expect(sdk_builds.count).toBe(1)
  })

  test('a corrupt record is a loud stop, never a silent second authorization', async () => {
    const transport = fake_transport()
    const { store, state } = memory_store()
    state.corrupt = true
    const session = session_of(transport, store)
    await expect(session.ensure()).rejects.toThrow('orphaned')
    expect(transport.log).toEqual([])
  })

  test('a record from another admin wallet is never restored or released', async () => {
    const transport = fake_transport()
    const { store, state } = memory_store()
    state.record = {
      secret: new_secret(),
      admin_cap: temp_cap,
      epoch: '7',
      network,
      owner: id(8),
      package: package_id,
    }
    const session = session_of(transport, store)
    await expect(session.ensure()).rejects.toThrow('another wallet')
    await expect(session.release()).rejects.toThrow('another wallet')
    expect(transport.log).toEqual([])
  })

  test('a half-written record (no capability) refuses with a recovery path', async () => {
    const transport = fake_transport()
    const { store, state } = memory_store()
    state.record = {
      secret: new_secret(),
      admin_cap: null,
      epoch: '7',
      network,
      owner: return_address,
      package: package_id,
    }
    const session = session_of(transport, store)
    await expect(session.ensure()).rejects.toThrow('recover the owned AdminCap')
    expect(transport.log).toEqual([])
  })

  test('a session from a past epoch refuses honestly and release recovers it', async () => {
    const transport = fake_transport({ epoch: '8', balance: '5' })
    const { store, state, log } = memory_store()
    state.record = {
      secret: new_secret(),
      admin_cap: temp_cap,
      epoch: '7',
      network,
      owner: return_address,
      package: package_id,
    }
    const session = session_of(transport, store)
    await expect(session.ensure()).rejects.toThrow('expired')

    transport.state.releasing = true
    await session.release()
    expect(transport.log).toEqual(['execute']) // the sweep went out
    expect(log.at(-1)).toBe('clear') // and the record cleared only after it
    expect(state.record).toBeNull()
    expect(transport.state.balance_reads).toBe(1) // the successful receipt proves the transfer; no lagging reread
  })

  test('an empty pending session clears; a funded pending session is retained for recovery', async () => {
    const transport = fake_transport({ balance: '0' })
    const { store, state } = memory_store()
    state.record = {
      secret: new_secret(),
      admin_cap: null,
      epoch: '7',
      network,
      owner: return_address,
      package: package_id,
    }
    transport.state.fail_execution = 'no gas coin'
    const session = session_of(transport, store)
    await session.release()
    expect(state.record).toBeNull()

    const funded = fake_transport({ balance: '5' })
    const { store: store_2, state: state_2 } = memory_store()
    state_2.record = {
      secret: new_secret(),
      admin_cap: null,
      epoch: '7',
      network,
      owner: return_address,
      package: package_id,
    }
    const session_2 = session_of(funded, store_2)
    await expect(session_2.release()).rejects.toThrow('AdminCap ID was not persisted')
    expect(funded.log).toEqual([])
    expect(state_2.record).not.toBeNull()
  })
})

const new_secret = (): string => new Keypair().getSecretKey()
