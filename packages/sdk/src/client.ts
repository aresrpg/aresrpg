// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The SDK factory — WRITE-ONLY and ZERO-ROUNDTRIP after hydration: it composes PTBs whose every
// input is PRE-RESOLVED (owner 2026-08-12: Sui finality is sub-second, so must every tx be —
// no resolution RPC may sit between intent and submission). It never reads game state (reads
// are the indexer's job) and carries zero content. Pins come from the ONE committed repo-root
// pins.json. One sanctioned bootstrap roundtrip exists: `hydrate()` — everything after rides
// receipts.

import { KioskClient, TransferPolicyTransaction, type KioskOwnerCap, type TransferPolicyCap } from '@mysten/kiosk'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'
import type { Signer } from '@mysten/sui/cryptography'

import PINS from '../../../pins.json' with { type: 'json' }

import * as doors from './doors.gen.ts'
import {
  create_cache,
  absorb_receipt,
  absorb_object,
  owned_ref,
  receipt_digest,
  shared_ref,
  type Receipt,
  type FetchedObject,
} from './cache.ts'
import { create_balance_cache } from './balance.ts'
import { with_kiosk, coin_of } from './ptb.ts'
import { create_gas_ledger } from './gas.ts'

export { doors }
export { DOORS } from './doors.gen.ts'
export * from './ptb.ts'
export * from './cache.ts'
export * from './gas.ts'

const DEFAULT_GAS_BUDGET = 50_000_000n

export type SharedPin = { id: string | null; shared_version: string | null }
export type Pins = Record<string, SharedPin | string | null | undefined> & { package?: string | null }

/**
 * The transport the SDK needs — the modern CORE interface, identical on the gRPC and GraphQL
 * clients (`client.core.*`; JSON-RPC is dead — owner 2026-08-12). Structural on purpose so any
 * flavor or test fake fits: hydrate + simulate + execute, NEVER resolution.
 */
export interface SuiTransport {
  core: {
    getBalance?: (input: { owner: string }) => Promise<{ balance: { balance: string | bigint } }>
    getReferenceGasPrice: () => Promise<{ referenceGasPrice: string | bigint }>
    listCoins: (input: { owner: string; coinType?: string; limit?: number }) => Promise<{ objects: FetchedObject[] }>
    getObjects: (input: { objectIds: string[] }) => Promise<{ objects: FetchedObject[] }>
    simulateTransaction: (input: { transaction: Uint8Array; include?: object }) => Promise<Receipt>
    executeTransaction: (input: { transaction: Uint8Array; signatures: string[]; include?: object }) => Promise<Receipt>
  }
}

export type SdkNetwork = 'testnet' | 'mainnet'

export type TransactionSigner = (
  transaction: Transaction
) => Promise<Readonly<{ bytes: string | Uint8Array; signature: string }>>

export type SdkOptions = {
  /** injected transport for tests and existing callers */
  client?: SuiTransport
  /** zkLogin keypair, wallet adapter…; execute needs it */
  signer?: Signer
  /** connected owner when execution uses externally signed bytes */
  address?: string
  /** Wallet Standard adapter. The SDK remains the sole transaction lifecycle owner. */
  sign_transaction?: TransactionSigner
  /** pins.json key */
  network?: SdkNetwork
  /** constructs the production GraphQL transport when client is omitted */
  graphql_url?: string
  /** override for tests/local publishes; defaults to pins.json[network] */
  pins?: Pins
  /** default budget in MIST (fixed, never dry-run derived) */
  gas_budget?: bigint
}

/** What the resolver accepts: a bare id (cache-resolved), an explicit ref, or an in-PTB value. */
export type Resolvable =
  | string
  | { objectId: string; version: string; digest: string }
  | { objectId: string; initialSharedVersion: string }
  | TransactionObjectArgument

/** The composition context every generated door receives. */
export type DoorCtx = {
  pins: Pins
  obj: (tx: Transaction, value: Resolvable, mutable: boolean) => TransactionObjectArgument
  pin: (tx: Transaction, key: string, mutable: boolean) => TransactionObjectArgument
  receiving: (tx: Transaction, value: Resolvable) => TransactionObjectArgument
}

type GeneratedDoor = (tx: Transaction, context: DoorCtx, args: never) => unknown
export type BoundDoors<T> = {
  [K in keyof T as T[K] extends GeneratedDoor ? K : never]: T[K] extends (
    tx: infer Tx,
    context: DoorCtx,
    args: infer Args
  ) => infer Result
    ? (tx: Tx, args: Args) => Result
    : never
}

export const bind_doors = <T extends Readonly<{ DOORS: Readonly<Record<string, unknown>> }>>(
  projection: T,
  context: DoorCtx
): BoundDoors<T> => {
  type DoorName = keyof T['DOORS'] & string
  type BoundDoor = (tx: Transaction, args: never) => unknown
  const table = projection as unknown as Record<DoorName, (tx: Transaction, context: DoorCtx, args: never) => unknown>
  return Object.fromEntries(
    (Object.keys(projection.DOORS) as DoorName[]).map((name) => [
      name,
      ((tx, args) => table[name](tx, context, args)) satisfies BoundDoor,
    ])
  ) as BoundDoors<T>
}

/**
 * SDK({ client, signer, network, graphql_url }) → the game client's one write surface.
 *
 * Composition-first: `sdk.tx()` opens a Transaction, `sdk.doors.<door>(tx, args)` composes
 * calls onto it (hot potatoes chain through returned results), `sdk.execute(tx)` signs,
 * dry-runs, executes, absorbs the receipt into the cache, and returns the receipt. One-shot:
 * `sdk.call.<door>(args)`.
 *
 * THE RESOLVER LAW: an object argument that is a bare id string resolves from the cache —
 * shared → sharedObjectRef (stable initial version), owned → exact objectRef — and an id the
 * cache does not know THROWS. Hydrate first, or pass a full ref; the SDK never falls back to
 * an RPC lookup inside a build.
 */
export function SDK({
  client,
  signer,
  address,
  sign_transaction,
  network = 'testnet',
  graphql_url,
  pins = (PINS as Record<string, Pins>)[network],
  gas_budget = DEFAULT_GAS_BUDGET,
}: SdkOptions = {}) {
  const sui_client =
    client ?? (graphql_url ? (new SuiGraphQLClient({ network, url: graphql_url }) as unknown as SuiTransport) : null)
  if (!sui_client) throw new Error('[sdk] SDK({ client }) or SDK({ graphql_url }) — a chain transport is required')
  if (!pins) throw new Error(`[sdk] unknown network "${network}" — pins.json carries no entry for it`)

  // the kiosk client rides the same transport (structurally identical at the core seam)
  const kiosk_client = new KioskClient({
    client: sui_client as ConstructorParameters<typeof KioskClient>[0]['client'],
    network,
  })
  const cache = create_cache()
  const gas: { price: bigint | null; coin: string | null } = { price: null, coin: null }
  let execution_hydration: Promise<void> | null = null
  let execution_tail: Promise<unknown> = Promise.resolve()
  const gas_ledger = create_gas_ledger({ address: address ?? signer?.toSuiAddress() ?? null, network })
  const sender = address ?? signer?.toSuiAddress() ?? null
  const balance = create_balance_cache({
    get_balance: async (owner) => {
      if (!sui_client.core.getBalance) throw new Error('[sdk] transport does not support balance reads')
      const result = await sui_client.core.getBalance({ owner })
      return BigInt(result.balance.balance)
    },
  })

  // ── the resolver: cache → pre-resolved input; unknown → THROW (zero-roundtrip law) ──────
  const resolve = (tx: Transaction, value: Resolvable, mutable: boolean): TransactionObjectArgument => {
    if (typeof value !== 'string') {
      // already an in-PTB argument (a result, a resolved input) or an explicit ref object
      if ('objectId' in value && 'digest' in value) return tx.objectRef(value)
      if ('objectId' in value && 'initialSharedVersion' in value) return tx.sharedObjectRef({ mutable, ...value })
      return value as TransactionObjectArgument
    }
    const shared = shared_ref(cache, value)
    if (shared)
      return tx.sharedObjectRef({ objectId: value, initialSharedVersion: shared.initialSharedVersion, mutable })
    const owned = owned_ref(cache, value)
    if (owned) return tx.objectRef(owned)
    throw new Error(
      `[sdk] unresolved object ${value} — hydrate it first (sdk.hydrate([id])) or pass a full ref; the SDK never resolves over RPC inside a build`
    )
  }

  const ctx: DoorCtx = {
    pins: new Proxy(pins, {
      get(target, key) {
        if (typeof key !== 'string') return Reflect.get(target, key)
        const value = target[key]
        if (!value) throw new Error(`[sdk] missing pin "${key}" — pins.json carries no id for it on this network`)
        return value
      },
    }),
    obj: resolve,
    pin: (tx, key, mutable) => {
      const entry = pins[key]
      if (typeof entry !== 'object' || !entry?.id || !entry?.shared_version)
        throw new Error(`[sdk] missing pin "${key}" — pins.json carries no id for it on this network`)
      return tx.sharedObjectRef({ objectId: entry.id, initialSharedVersion: String(entry.shared_version), mutable })
    },
    receiving: (tx, value) => {
      const ref = typeof value === 'string' ? owned_ref(cache, value) : value
      if (!ref || !('objectId' in ref) || !('digest' in ref))
        throw new Error(
          `[sdk] unresolved receiving object ${typeof value === 'string' ? value : ''} — hydrate it first or pass {objectId, version, digest}`
        )
      return tx.receivingRef(ref)
    },
  }

  type DoorName = keyof typeof doors.DOORS
  const bound_doors = bind_doors(doors, ctx)

  // ── the ONE sanctioned roundtrip: seed refs, gas price, and the gas coin ────────────────
  const hydrate_objects = async (ids: readonly string[]) => {
    if (!ids.length) return cache
    const { objects } = await sui_client.core.getObjects({ objectIds: [...ids] })
    for (const row of objects) absorb_object(cache, row)
    return cache
  }

  const hydrate = async (ids: readonly string[] = [], wallet_address?: string) => {
    const owner = wallet_address ?? sender ?? undefined
    const [{ referenceGasPrice }, coins] = await Promise.all([
      sui_client.core.getReferenceGasPrice(),
      owner ? sui_client.core.listCoins({ owner, limit: 1 }) : { objects: [] as FetchedObject[] },
      hydrate_objects(ids),
    ])
    gas.price = BigInt(referenceGasPrice)
    const [coin] = coins.objects
    if (coin?.objectId) {
      gas.coin = coin.objectId
      absorb_object(cache, coin)
    }
    return cache
  }

  const ensure_execution_hydrated = async (): Promise<void> => {
    if (gas.price !== null && gas.coin !== null) return
    execution_hydration ??= hydrate().then(() => undefined)
    try {
      await execution_hydration
    } finally {
      execution_hydration = null
    }
    if (gas.coin === null) throw new Error('[sdk] execute needs an owned SUI gas coin')
  }

  // A failed result's honest message, whatever depth the error hides at.
  const failure_of = (result: Receipt): string | null => {
    const failed =
      result?.FailedTransaction ??
      (result?.$kind === 'FailedTransaction' ? (result as { effects?: { status?: unknown } }) : null)
    if (!failed) return null
    const status = (failed.effects as { status?: { error?: { message?: string } | string } } | undefined)?.status
    const error = status?.error
    if (error && typeof error === 'object') return error.message ?? JSON.stringify(error)
    return error ?? JSON.stringify('unknown')
  }

  // ── execute: fully-formed tx in, sub-second receipt out — and a tx that would FAIL never
  // leaves the client (owner 2026-08-12): sign ONCE (offline when hydrated), SIMULATE the exact
  // bytes, refuse on any simulated failure (zero gas, no digest), then submit those same bytes.
  // An EXECUTED failure still throws and is never auto-retried (a digest exists = gas burned).
  const prepare_transaction = async (tx: Transaction, sender: string, { budget = gas_budget } = {}) => {
    tx.setSenderIfNotSet(sender)
    if (gas.price) tx.setGasPrice(gas.price)
    tx.setGasBudgetIfNotSet(budget)
    const gas_ref = gas.coin ? owned_ref(cache, gas.coin) : undefined
    if (gas_ref) tx.setGasPayment([gas_ref])
    return tx.toJSON({ supportedIntents: [], client: sui_client as never })
  }

  const execute_signed = async (
    bytes: string | Uint8Array,
    signature: string,
    { include }: { include?: object } = {}
  ) => {
    const raw = typeof bytes === 'string' ? fromBase64(bytes) : bytes
    const simulation = await sui_client.core.simulateTransaction({ transaction: raw, include: { effects: true } })
    const refusal = failure_of(simulation)
    if (refusal !== null) throw new Error(`[sdk] dry run failed — transaction NOT submitted (zero gas): ${refusal}`)

    const receipt = await sui_client.core.executeTransaction({
      transaction: raw,
      signatures: [signature],
      include: { effects: true, events: true, ...include },
    })
    gas_ledger.record(receipt)
    if (sender) balance.invalidate(sender)
    if (receipt?.$kind === 'FailedTransaction') {
      absorb_receipt(cache, receipt) // gas coin still mutated — keep it fresh
      throw new Error(`[sdk] transaction ${receipt_digest(receipt)} failed on-chain: ${failure_of(receipt)}`)
    }
    absorb_receipt(cache, receipt)
    return receipt
  }

  const simulate = async (
    tx: Transaction,
    { budget = gas_budget, include }: { budget?: bigint; include?: object } = {}
  ): Promise<Receipt> => {
    if (!sender) throw new Error('[sdk] simulate needs an address')
    await ensure_execution_hydrated()
    await prepare_transaction(tx, sender, { budget })
    const bytes = await tx.build({ client: sui_client as never })
    return sui_client.core.simulateTransaction({ transaction: bytes, include: { effects: true, ...include } })
  }

  const execute_now = async (
    tx: Transaction,
    { budget = gas_budget, include }: { budget?: bigint; include?: object } = {}
  ) => {
    if (!sender) throw new Error('[sdk] execute needs an address')
    await ensure_execution_hydrated()
    await prepare_transaction(tx, sender, { budget })
    const signed = signer
      ? await tx.sign({ client: sui_client as never, signer })
      : sign_transaction
        ? await sign_transaction(tx)
        : null
    if (!signed) throw new Error('[sdk] execute needs a signer')
    const { bytes, signature } = signed
    return execute_signed(bytes, signature, { include })
  }

  const execute = (
    tx: Transaction,
    options: Readonly<{ budget?: bigint; include?: object }> = {}
  ): Promise<Receipt> => {
    const submitted = execution_tail.then(
      () => execute_now(tx, options),
      () => execute_now(tx, options)
    )
    execution_tail = submitted.then(
      () => undefined,
      () => undefined
    )
    return submitted
  }

  const call = Object.fromEntries(
    (Object.keys(doors.DOORS) as DoorName[]).map((name) => [
      name,
      async (args: Record<string, unknown>, opts?: { budget?: bigint; include?: object }) => {
        const tx = new Transaction()
        ;(bound_doors[name] as (transaction: Transaction, input: never) => unknown)(tx, args as never)
        return execute(tx, opts)
      },
    ])
  ) as Record<
    DoorName,
    (args: Record<string, unknown>, opts?: { budget?: bigint; include?: object }) => Promise<Receipt>
  >

  return {
    network,
    pins,
    cache,
    sui_client,
    hydrate,
    hydrate_objects,
    get_owned_kiosks: (address: string) => kiosk_client.getOwnedKiosks({ address }),
    get_owned_transfer_policies: (address: string) => kiosk_client.getOwnedTransferPolicies({ address }),
    get_transfer_policies: (type: string) => kiosk_client.getTransferPolicies({ type }),
    withdraw_transfer_policy: (tx: Transaction, cap: TransferPolicyCap, recipient: string) =>
      new TransferPolicyTransaction({ kioskClient: kiosk_client, transaction: tx, cap }).withdraw(recipient),
    simulate,
    /** Freshest known owned ref (receipt-fed), or undefined. */
    ref: (object_id: string) => owned_ref(cache, object_id),
    tx: () => new Transaction(),
    door_context: ctx,
    doors: bound_doors,
    call,
    execute,
    read_sui_balance: () => {
      if (!sender) throw new Error('[sdk] balance reads need an address')
      return balance.read(sender)
    },
    gas_spent_24h: gas_ledger.spent_24h,
    with_kiosk,
    with_owner_kiosk: <T>(tx: Transaction, cap: KioskOwnerCap | null, compose: Parameters<typeof with_kiosk<T>>[3]) => {
      if (!cap) throw new Error('No owned kiosk cap is available for this transaction.')
      return with_kiosk(tx, kiosk_client, cap, compose)
    },
    coin_of,
  }
}

export type Sdk = ReturnType<typeof SDK>
