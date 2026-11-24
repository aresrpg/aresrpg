// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
/* eslint-disable no-param-reassign, fp-law/no-mutating-methods -- This test-only transport records calls and implements the resolver's mutable transaction-builder interface. */
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519'
import { Inputs, type TransactionPlugin } from '@mysten/sui/transactions'

import type { FetchedObject, Receipt } from '../../src/client.ts'

import { execution_receipt } from './execution_receipt.ts'

type ChangedRow = NonNullable<NonNullable<Receipt['effects']>['changedObjects']>[number]

export const id = (n: number) => `0x${String(n).padStart(64, '0')}`
export const digest = '11111111111111111111111111111111'
const pin = (n: number) => ({ id: id(n), shared_version: '1' })
export const pins = {
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

/** In-memory Storage: the browser tab record and the gas ledger both speak this interface. */
export const memory_storage = () => {
  const values = new Map<string, string>()
  const reads: (string | null)[] = []
  return {
    values,
    reads,
    getItem: (key: string) => {
      const value = values.get(key) ?? null
      reads.push(value)
      return value
    },
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  }
}

export const changed = (
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

export const shared_row = (object_id: string): ChangedRow => ({
  ...changed(object_id, '1', { $kind: 'Shared', Shared: { initialSharedVersion: '1' } }),
  idOperation: 'Created',
})

const resolve_gas =
  (
    calls: { resolutions: number; simulations: number },
    simulate_ok: boolean,
    failure_message: string,
    resolution_failure?: string
  ): TransactionPlugin =>
  async (transaction_data, options, next) => {
    calls.resolutions += 1
    // The gRPC simulation resolves every object input the composer left unresolved: Random and Clock
    // are read-only shared objects, any other bare id resolves as the composer declared it.
    transaction_data.inputs.forEach((input, index) => {
      if (input.$kind !== 'UnresolvedObject') return
      const { objectId, version, digest: object_digest, mutable } = input.UnresolvedObject
      const system = [id(6), id(8)].includes(objectId)
      transaction_data.inputs[index] =
        version && object_digest && !system
          ? Inputs.ObjectRef({ objectId, version, digest: object_digest })
          : Inputs.SharedObjectRef({ objectId, initialSharedVersion: '1', mutable: !system && (mutable ?? true) })
    })
    if (!options.onlyTransactionKind) {
      if (resolution_failure) throw new Error(resolution_failure)
      calls.simulations += 1
      if (!simulate_ok) throw new Error(`[sdk] dry run failed — transaction NOT submitted: ${failure_message}`)
      transaction_data.gasData.price ??= '1000'
      transaction_data.gasData.budget ??= '5000000'
      transaction_data.gasData.payment ??= [{ objectId: id(50), version: '3', digest }]
    }
    await next()
  }

/** A fake CORE client: hydrate sources, a scriptable simulation verdict, an execution recorder. */
/** Objects an executed transaction creates, as receipt rows and as the optional type map. */
const created_objects = (created: Readonly<Record<string, string>> = {}) => ({
  rows: Object.keys(created).map((object_id) => ({ ...changed(object_id, '7'), idOperation: 'Created' as const })),
  types: Object.keys(created).length ? { objectTypes: created } : {},
})

const fetched = (
  object_id: string,
  lag: Map<string, number>,
  owned_versions: Map<string, string[]>,
  objects: Readonly<Record<string, FetchedObject>> | undefined
): FetchedObject[] => {
  // a node still behind answers with NOTHING for an object that already exists;
  // each miss burns one tick, so the object appears once the lag is spent
  const remaining = lag.get(object_id) ?? 0
  if (remaining > 0) {
    lag.set(object_id, remaining - 1)
    return []
  }
  const exact = objects?.[object_id]
  if (exact) return [exact]
  const versions = owned_versions.get(object_id)
  if (versions) {
    const version = versions.length > 1 ? versions.shift()! : versions[0]!
    return [{ objectId: object_id, version, digest, owner: { $kind: 'AddressOwner', AddressOwner: id(99) } }]
  }
  return [
    { objectId: object_id, version: '2', digest, owner: { $kind: 'Shared', Shared: { initialSharedVersion: '1' } } },
  ]
}

export const fake_client = ({
  simulate_ok,
  execution_ok = true,
  events,
  execution_gate,
  visibility_gate,
  visibility_failures = 0,
  failure_branch = 'FailedTransaction',
  failure_message = 'MoveAbort(2701) — scribe locked',
  resolution_failure,
  lag = new Map<string, number>(),
  owned_versions = new Map<string, string[]>(),
  objects,
  gas_used,
  created,
}: {
  /** a refused simulation is opt-in: only `false` refuses */
  simulate_ok?: boolean
  execution_ok?: boolean
  events?: readonly { type: string; json: Record<string, unknown> }[]
  execution_gate?: Promise<void>
  visibility_gate?: Promise<void>
  /** how many predecessor visibility checks fail before the ledger catches up */
  visibility_failures?: number
  /** what the simulated failure says — the SDK reads it to tell OUR budget from THEIR wallet */
  failure_message?: string
  /** raw error thrown while building, before signing or submission */
  resolution_failure?: string
  /** objectId → how many reads this node answers empty before the object shows up */
  lag?: Map<string, number>
  /** objectId → versions returned across reads, for receipt-fresh node-lag tests */
  owned_versions?: Map<string, string[]>
  /** objectId → the exact object a read returns */
  objects?: Readonly<Record<string, FetchedObject>>
  /** gas figures every simulation and execution reports */
  gas_used?: Readonly<{ computationCost: string; storageCost: string; storageRebate: string }>
  /** objectId → type of objects the executed transaction creates */
  created?: Readonly<Record<string, string>>
  /** Which branch a refused simulation arrives in — a `success: false` status can ride the
   *  Transaction branch, and the preflight must refuse that identically. */
  failure_branch?: 'FailedTransaction' | 'Transaction'
} = {}) => {
  const made = created_objects(created)
  const simulation_passes = simulate_ok !== false
  const calls = {
    simulations: 0,
    executions: 0,
    balances: 0,
    resolutions: 0,
    hydrations: [] as string[][],
    active_executions: 0,
    max_active_executions: 0,
    visibility_waits: [] as string[],
    digests: [] as string[],
    submitted: [] as Uint8Array[],
  }
  return {
    calls,
    core: {
      resolveTransactionPlugin: () => resolve_gas(calls, simulation_passes, failure_message, resolution_failure),
      getCurrentSystemState: async () => ({ systemState: { epoch: '1', referenceGasPrice: '1000' } }),
      getChainIdentifier: async () => ({ chainIdentifier: digest }),
      getBalance: async () => {
        calls.balances += 1
        return { balance: { balance: '10000000000', coinBalance: '0', addressBalance: '10000000000' } }
      },
      getReferenceGasPrice: async () => ({ referenceGasPrice: '1000' }),
      listCoins: async (_input: { owner: string; coinType?: string; limit?: number; cursor?: string | null }) => ({
        objects: [
          {
            objectId: id(50),
            version: '3',
            digest,
            balance: '10000000000',
            owner: { $kind: 'AddressOwner', AddressOwner: id(99) },
          },
        ],
      }),
      getObjects: async ({ objectIds }: { objectIds: string[] }) => {
        calls.hydrations.push([...objectIds])
        return { objects: objectIds.flatMap((object_id) => fetched(object_id, lag, owned_versions, objects)) }
      },
      simulateTransaction: async () => {
        calls.simulations += 1
        if (simulation_passes)
          return {
            $kind: 'Transaction',
            Transaction: { effects: { status: { success: true, error: null }, gasUsed: gas_used } },
          }
        const effects = { status: { success: false, error: { message: failure_message } } }
        return failure_branch === 'Transaction'
          ? { $kind: 'Transaction', Transaction: { effects } }
          : { $kind: 'FailedTransaction', FailedTransaction: { effects } }
      },
      executeTransaction: async ({ transaction }: { transaction: Uint8Array }) => {
        calls.executions += 1
        calls.active_executions += 1
        calls.max_active_executions = Math.max(calls.max_active_executions, calls.active_executions)
        calls.submitted.push(transaction)
        await execution_gate
        calls.active_executions -= 1
        const gas_object = changed(id(50), '4', {
          $kind: 'AddressOwner',
          AddressOwner: signer.toSuiAddress(),
        })
        const result = execution_receipt(transaction, {
          $kind: 'Transaction',
          Transaction: {
            digest: 'EXEC',
            events,
            effects: {
              status: execution_ok
                ? { success: true, error: null }
                : { success: false, error: { message: failure_message } },
              gasObject: gas_object,
              gasUsed: gas_used,
              changedObjects: [gas_object, ...made.rows],
            },
            ...made.types,
          },
        })
        calls.digests.push(result.Transaction!.digest!)
        return result
      },
      waitForTransaction: async ({ digest: previous }: { digest: string }) => {
        calls.visibility_waits.push(previous)
        await visibility_gate
        if (visibility_failures > 0) {
          visibility_failures -= 1
          throw new Error('ledger has not indexed the transaction')
        }
        return { $kind: 'Transaction', Transaction: { digest: previous } }
      },
    },
  }
}

export const signer = new Ed25519Keypair()
export type FakeClient = ReturnType<typeof fake_client>
/** Net 2,500,000 MIST: what a priced simulation or execution reports when a test passes it as `gas_used`. */
export const sample_gas = { computationCost: '2000000', storageCost: '1000000', storageRebate: '500000' }
