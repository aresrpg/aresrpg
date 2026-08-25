// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The SDK factory — WRITE-ONLY: it composes PTBs whose game-object inputs are PRE-RESOLVED.
// It never reads game state (reads are the indexer's job) and carries zero content. Pins come
// from the ONE committed repo-root pins.json. `hydrate()` seeds game refs; the Sui core client
// separately resolves gas payment and budget because wallet coin state is its concern.

import { KioskClient, TransferPolicyTransaction, type KioskOwnerCap, type TransferPolicyCap } from '@mysten/kiosk'
import { SuiGraphQLClient } from '@mysten/sui/graphql'
import { SuiGrpcClient } from '@mysten/sui/grpc'
import {
  Transaction,
  type TransactionArgument,
  type TransactionObjectArgument,
  type TransactionPlugin,
} from '@mysten/sui/transactions'
import { fromBase64, normalizeSuiObjectId } from '@mysten/sui/utils'
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
import { coin_of, receipt_personal_kiosk_cap, with_kiosk, with_personal_kiosk } from './ptb.ts'
import { create_gas_ledger } from './gas.ts'

export { doors }
export { DOORS } from './doors.gen.ts'
export * from './ptb.ts'
export * from './cache.ts'
export * from './gas.ts'

export type SharedPin = { id: string | null; shared_version: string | null }
export type Pins = Readonly<Record<string, unknown>> & {
  package?: string | null
  math_package?: string | null
  seed_package?: string | null
}

/** The living-content derivation pair: the registry ROOT object id + the seed package's
 * ORIGINAL id — every content address (mob/spell templates, world content, the board
 * catalog) derives from these two. The ORIGINAL, never `pins.seed_package`: a derived object
 * id is computed from a type tag, and on Sui a type is named by its FIRST-publish address
 * forever, while the latest id is a move-call target only (2026-08-22: deriving with the
 * upgraded address produced ids that never existed — every mob engage died unresolved). */
export const living_content = (
  sdk: Readonly<{ pins: Pins }>,
  what: string
): Readonly<{ content_root: string; seed_package_original: string }> => {
  const root = sdk.pins.content_root
  const root_id = typeof root === 'object' && root !== null ? Reflect.get(root, 'id') : null
  const original = sdk.pins.seed_package_original
  if (typeof root_id !== 'string' || typeof original !== 'string')
    throw new Error(`${what} unavailable: pins.json has no living-content ids for this network.`)
  return Object.freeze({ content_root: root_id, seed_package_original: original })
}

const is_shared_pin = (value: unknown): value is Readonly<{ id: string; shared_version: string }> =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 'id') === 'string' &&
  typeof Reflect.get(value, 'shared_version') === 'string'

/**
 * The transport the SDK needs — the modern CORE interface, identical on the gRPC and GraphQL
 * clients (`client.core.*`; JSON-RPC is dead — owner 2026-08-12). Structural on purpose so any
 * flavor or test fake fits: hydrate + resolve gas + simulate + execute.
 */
export interface SuiTransport {
  core: {
    resolveTransactionPlugin: () => TransactionPlugin
    getProtocolConfig?: () => Promise<{
      protocolConfig: { protocolVersion: string; attributes: Record<string, string | null> }
    }>
    getBalance: (input: { owner: string }) => Promise<{
      balance: { balance: string | bigint; addressBalance?: string | bigint; coinBalance?: string | bigint }
    }>
    getCurrentSystemState: () => Promise<{
      systemState: { epoch: string; referenceGasPrice: string }
    }>
    getChainIdentifier: () => Promise<{ chainIdentifier: string }>
    getReferenceGasPrice: () => Promise<{ referenceGasPrice: string | bigint }>
    listCoins: (input: { owner: string; coinType?: string; limit?: number; cursor?: string | null }) => Promise<{
      objects: FetchedObject[]
      cursor?: string | null
      hasNextPage?: boolean
    }>
    getObjects: (input: { objectIds: string[]; include?: { json?: boolean } }) => Promise<{ objects: FetchedObject[] }>
    simulateTransaction: (input: { transaction: Uint8Array; include?: object }) => Promise<Receipt>
    executeTransaction: (input: { transaction: Uint8Array; signatures: string[]; include?: object }) => Promise<Receipt>
  }
}

export type SdkNetwork = 'testnet' | 'mainnet'

/** The one gas budget, for every transaction (owner 2026-08-21: "it should never go above that
 *  anyway"). A budget is RESERVED, not spent — the unused part never leaves the address — and
 *  pinning it is what removes the estimation dry run. A PTB that outgrows it is refused at the
 *  dry run with `GasBudgetExceeded`, never submitted. */
export const GAS_BUDGET_MIST = 200_000_000n

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
  /** Sui gRPC endpoint used to resolve transaction gas and validity */
  rpc_url?: string
  /** override for tests/local publishes; defaults to pins.json[network] */
  pins?: Pins
  /** optional explicit budget in MIST; `'estimate'` lets the Sui resolver price the
   *  transaction itself (deployment-sized surfaces); otherwise the game-door law applies */
  gas_budget?: bigint | 'estimate'
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
  /** Addresses that NAME published types on-chain (first-publish ids) — never move-call targets. */
  game_type_package: string | null
  math_type_package: string | null
  obj: (tx: Transaction, value: Resolvable, mutable: boolean) => TransactionObjectArgument
  pin: (tx: Transaction, key: string, mutable: boolean) => TransactionObjectArgument
  receiving: (tx: Transaction, value: Resolvable) => TransactionObjectArgument
  pure: {
    id: (tx: Transaction, value: string) => TransactionArgument
    address: (tx: Transaction, value: string) => TransactionArgument
    bool: (tx: Transaction, value: boolean) => TransactionArgument
    u8: (tx: Transaction, value: number) => TransactionArgument
    u16: (tx: Transaction, value: number) => TransactionArgument
    u32: (tx: Transaction, value: number) => TransactionArgument
    u64: (tx: Transaction, value: bigint | number | string) => TransactionArgument
    string: (tx: Transaction, value: string) => TransactionArgument
    option: (tx: Transaction, type: string, value: unknown) => TransactionArgument
    vector: (tx: Transaction, type: string, value: readonly unknown[]) => TransactionArgument
  }
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
  rpc_url,
  pins = (PINS as Record<string, Pins>)[network],
  gas_budget,
}: SdkOptions = {}) {
  const sui_client =
    client ??
    (rpc_url
      ? (new SuiGrpcClient({ network, baseUrl: rpc_url }) as unknown as SuiTransport)
      : graphql_url
        ? (new SuiGraphQLClient({ network, url: graphql_url }) as unknown as SuiTransport)
        : null)
  if (!sui_client)
    throw new Error('[sdk] SDK({ client }), SDK({ rpc_url }), or SDK({ graphql_url }) needs a chain transport')
  if (!pins) throw new Error(`[sdk] unknown network "${network}" — pins.json carries no entry for it`)

  // On-chain type arguments name types by their FIRST-publish package address forever;
  // pins.package / pins.math_package follow the latest upgrade's package object and are
  // move-call targets only. Raw reads — the pins proxy fails fast on missing pins.
  const defining_package = (key: 'package' | 'math_package'): string | null => {
    const original = pins[`${key}_original`]
    if (typeof original === 'string' && original) return original
    const latest = pins[key]
    return typeof latest === 'string' && latest ? latest : null
  }
  const game_type_package = defining_package('package')
  const math_type_package = defining_package('math_package')

  // the kiosk client rides the same transport (structurally identical at the core seam)
  const kiosk_client = new KioskClient({
    client: sui_client as ConstructorParameters<typeof KioskClient>[0]['client'],
    network,
  })
  // THE KIOSK LINEAGE SPLIT (2026-08-21, measured the hard way): the game's `kiosk_package`
  // pin is an UPGRADE of Mysten's rules lineage (bd8fc194 v1 → official 0x06f6 v2, which
  // defines personal_kiosk → the game's v3). Sui refuses two versions of one lineage in a
  // transaction, and the game package links v3 — so CALLS (borrow_val/return_val) must
  // target the pin. But owned-object TYPE FILTERS use the DEFINING version (v2, the SDK's
  // network default) — so LOOKUPS must use the default client. One id serving both jobs is
  // the trap that blinded getOwnedKiosks ("no personal kiosk" for a 27-cap wallet).
  const { kiosk_package } = pins
  const kiosk_transaction_client =
    typeof kiosk_package === 'string' && kiosk_package
      ? new KioskClient({
          client: sui_client as ConstructorParameters<typeof KioskClient>[0]['client'],
          network,
          packageIds: { personalKioskRulePackageId: kiosk_package },
        })
      : kiosk_client
  const cache = create_cache()
  const pure_inputs = new WeakMap<Transaction, Map<string, TransactionArgument>>()
  let execution_tail: Promise<unknown> = Promise.resolve()
  const sender = address ?? signer?.toSuiAddress() ?? null
  const gas_ledger = create_gas_ledger({ address: sender, network })
  const balance = create_balance_cache({
    get_balance: async (owner) => {
      if (!sui_client.core.getBalance) throw new Error('[sdk] transport does not support balance reads')
      const result = await sui_client.core.getBalance({ owner })
      return BigInt(result.balance.balance)
    },
  })

  // ── game-object resolver: cache → pre-resolved input; unknown → THROW ──────────────────
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

  const intern_pure = (
    tx: Transaction,
    type: string,
    value: unknown,
    create: () => TransactionArgument
  ): TransactionArgument => {
    const values = pure_inputs.get(tx) ?? new Map<string, TransactionArgument>()
    if (!pure_inputs.has(tx)) pure_inputs.set(tx, values)
    const encoded = JSON.stringify(value, (_key, entry) => (typeof entry === 'bigint' ? `${entry}n` : entry))
    const key = `${type}:${encoded}`
    const existing = values.get(key)
    if (existing) return existing
    const input = create()
    values.set(key, input)
    return input
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
    game_type_package,
    math_type_package,
    obj: resolve,
    pin: (tx, key, mutable) => {
      const entry = pins[key]
      if (!is_shared_pin(entry))
        throw new Error(`[sdk] missing pin "${key}" — pins.json carries no id for it on this network`)
      return tx.sharedObjectRef({
        objectId: String(entry.id),
        initialSharedVersion: String(entry.shared_version),
        mutable,
      })
    },
    receiving: (tx, value) => {
      const ref = typeof value === 'string' ? owned_ref(cache, value) : value
      if (!ref || !('objectId' in ref) || !('digest' in ref))
        throw new Error(
          `[sdk] unresolved receiving object ${typeof value === 'string' ? value : ''} — hydrate it first or pass {objectId, version, digest}`
        )
      return tx.receivingRef(ref)
    },
    pure: {
      id: (tx, value) => intern_pure(tx, 'id', value, () => tx.pure.id(value)),
      address: (tx, value) => intern_pure(tx, 'address', value, () => tx.pure.address(value)),
      bool: (tx, value) => intern_pure(tx, 'bool', value, () => tx.pure.bool(value)),
      u8: (tx, value) => intern_pure(tx, 'u8', value, () => tx.pure.u8(value)),
      u16: (tx, value) => intern_pure(tx, 'u16', value, () => tx.pure.u16(value)),
      u32: (tx, value) => intern_pure(tx, 'u32', value, () => tx.pure.u32(value)),
      u64: (tx, value) => intern_pure(tx, 'u64', value, () => tx.pure.u64(value)),
      string: (tx, value) => intern_pure(tx, 'string', value, () => tx.pure.string(value)),
      option: (tx, type, value) =>
        intern_pure(tx, `option:${type}`, value, () => tx.pure.option(type as never, value as never)),
      vector: (tx, type, value) =>
        intern_pure(tx, `vector:${type}`, value, () => tx.pure.vector(type as never, [...value] as never)),
    },
  }

  type DoorName = keyof typeof doors.DOORS
  const bound_doors = bind_doors(doors, ctx)

  // ── the ONE sanctioned roundtrip: seed object refs. Sui cold-resolves gas. ─────────────
  const hydrate_objects = async (ids: readonly string[]) => {
    const groups = Array.from({ length: Math.ceil(ids.length / 10) }, (_, index) =>
      ids.slice(index * 10, index * 10 + 10)
    )
    for (const group of groups) {
      const { objects } = await sui_client.core.getObjects({ objectIds: group })
      for (const row of objects) absorb_object(cache, row)
    }
    return cache
  }

  const unresolved_ids = (ids: readonly string[]): readonly string[] =>
    ids.filter((id) => !owned_ref(cache, id) && !shared_ref(cache, id))

  const hydrate = async (ids: readonly string[] = []) => {
    await hydrate_objects(ids)
    return cache
  }

  /** Fetch only the ids the cache does not already know — shared objects keep their initial
   *  version for life, so a known ref is never worth a second network read. Absence is DATA
   *  here: callers that merely ask whether an object exists yet get their answer, not a throw. */
  const hydrate_unknown = async (ids: readonly string[]) => {
    const unknown = unresolved_ids([...new Set(ids)])
    if (unknown.length) await hydrate_objects(unknown)
    return cache
  }

  // A failed result's honest message, whatever depth the error hides at. The FailedTransaction
  // branch is how a failed simulation normally arrives, but a `success: false` status inside the
  // Transaction branch is the same verdict wearing a different hat — read BOTH, or a tx that the
  // simulation already refused would submit anyway and burn its gas for the same failure.
  const failure_of = (result: Receipt): string | null => {
    const failed =
      result?.FailedTransaction ??
      (result?.$kind === 'FailedTransaction' ? (result as { effects?: { status?: unknown } }) : null)
    const effects = (failed ?? result?.Transaction ?? result)?.effects as
      { status?: { success?: boolean; error?: { message?: string } | string | null } } | undefined
    const status = effects?.status
    if (!failed && status?.success !== false) return null
    const error = status?.error
    if (error && typeof error === 'object') return error.message ?? JSON.stringify(error)
    return error ?? JSON.stringify('unknown')
  }

  /** A dry run refused for gas is TWO different sentences, and only one of them is the player's
   *  fault. The budget is ours and constant, so `InsufficientGas` means the action outgrew it —
   *  a bug to fix here, never "top up your wallet". The raw verdict is deliberately NOT quoted:
   *  the app's out-of-SUI prompt watches for that vocabulary. */
  const GAS_BUDGET_REFUSAL = /insufficient.?gas|gas.?budget/i
  const refusal_error = (refusal: string): Error =>
    GAS_BUDGET_REFUSAL.test(refusal)
      ? new Error(`[sdk] gas budget exceeded — this action needs more than ${GAS_BUDGET_MIST} MIST; NOT submitted`)
      : new Error(`[sdk] dry run failed — transaction NOT submitted (zero gas): ${refusal}`)

  // ── execute: fully-formed tx in, sub-second receipt out — and a tx that would FAIL never
  // leaves the client (owner 2026-08-12): resolve gas, sign ONCE, SIMULATE the exact
  // bytes, refuse on any simulated failure (zero gas, no digest), then submit those same bytes.
  // An EXECUTED failure still throws and is never auto-retried (a digest exists = gas burned).
  // GAS PAYMENT IS THE RESOLVER'S (2026-08-21, the duel incident): the SDK used to pin the
  // receipt's gas coin onto the next transaction, with no fallback when that single ref stopped
  // covering the budget. Which coin — or whether a coin is involved at all — depends on how the
  // address holds its SUI (Coin objects vs an address balance), and only the resolver knows.
  // The BUDGET is ours and constant for GAME doors; `'estimate'` hands pricing to the resolver
  // for surfaces whose cost is not constant (deployments, seed ceremonies).
  const prepare_transaction = async (
    tx: Transaction,
    sender_address: string,
    { budget = gas_budget }: { budget?: bigint | 'estimate' } = {}
  ) => {
    tx.setSenderIfNotSet(sender_address)
    if (budget !== 'estimate') tx.setGasBudgetIfNotSet(budget ?? GAS_BUDGET_MIST)
    await tx.build({ client: sui_client as never })
  }

  const execute_signed = async (
    bytes: string | Uint8Array,
    signature: string,
    { include, gas_scope }: { include?: object; gas_scope?: string } = {}
  ) => {
    const raw = typeof bytes === 'string' ? fromBase64(bytes) : bytes
    const receipt = await sui_client.core.executeTransaction({
      transaction: raw,
      signatures: [signature],
      include: { effects: true, events: true, ...include },
    })
    gas_ledger.record(receipt)
    if (gas_scope) gas_ledger.tag(receipt, gas_scope)
    if (sender) balance.invalidate(sender)
    if (receipt?.$kind === 'FailedTransaction') {
      absorb_receipt(cache, receipt) // owned game objects the failed tx still touched stay fresh
      throw new Error(`[sdk] transaction ${receipt_digest(receipt)} failed on-chain: ${failure_of(receipt)}`)
    }
    absorb_receipt(cache, receipt)
    return receipt
  }

  const simulate = async (
    tx: Transaction,
    { budget = gas_budget, include }: { budget?: bigint | 'estimate'; include?: object } = {}
  ): Promise<Receipt> => {
    if (!sender) throw new Error('[sdk] simulate needs an address')
    await prepare_transaction(tx, sender, { budget })
    const bytes = await tx.build()
    return sui_client.core.simulateTransaction({ transaction: bytes, include: { effects: true, ...include } })
  }

  const execute_now = async (
    tx: Transaction,
    {
      budget = gas_budget,
      include,
      gas_scope,
    }: { budget?: bigint | 'estimate'; include?: object; gas_scope?: string } = {}
  ) => {
    if (!sender) throw new Error('[sdk] execute needs an address')
    await prepare_transaction(tx, sender, { budget })
    // THE ONE DRY RUN (owner 2026-08-21: a transaction is strictly two roundtrips). It runs on
    // the UNSIGNED bytes — a signature is not part of what a simulation sees, so these are the
    // exact bytes that will be submitted — and it runs BEFORE signing, so a doomed transaction
    // never opens the player's wallet. A refusal here means nothing was submitted: zero gas.
    const preflight = await sui_client.core.simulateTransaction({
      transaction: await tx.build(),
      include: { effects: true },
    })
    const refusal = failure_of(preflight)
    if (refusal !== null) throw refusal_error(refusal)
    const signed = signer ? await tx.sign({ signer }) : sign_transaction ? await sign_transaction(tx) : null
    if (!signed) throw new Error('[sdk] execute needs a signer')
    const { bytes, signature } = signed
    return execute_signed(bytes, signature, { include, gas_scope })
  }

  const execute = (
    tx: Transaction,
    options: Readonly<{ budget?: bigint | 'estimate'; include?: object; gas_scope?: string }> = {}
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

  const execute_personal_kiosk = async (tx: Transaction, cap: KioskOwnerCap | null) => {
    // objectTypes always rides: callers fold their own minted/touched items from it
    const receipt = await execute(tx, { include: { objectTypes: true } })
    const kiosk_cap = cap ?? receipt_personal_kiosk_cap(receipt)
    if (!kiosk_cap)
      throw new Error(
        `[sdk] transaction ${receipt_digest(receipt)} created no reusable PersonalKioskCap in its receipt.`
      )
    return Object.freeze({ receipt, kiosk_cap })
  }

  const call = Object.fromEntries(
    (Object.keys(doors.DOORS) as DoorName[]).map((name) => [
      name,
      async (args: Record<string, unknown>, opts?: { budget?: bigint | 'estimate'; include?: object }) => {
        const tx = new Transaction()
        ;(bound_doors[name] as (transaction: Transaction, input: never) => unknown)(tx, args as never)
        return execute(tx, opts)
      },
    ])
  ) as Record<
    DoorName,
    (args: Record<string, unknown>, opts?: { budget?: bigint | 'estimate'; include?: object }) => Promise<Receipt>
  >

  return {
    network,
    pins,
    game_type_package,
    math_type_package,
    cache,
    sui_client,
    hydrate,
    hydrate_objects,
    hydrate_unknown,
    // lookup by the DEFINING package (the default client) — see the lineage-split note above
    get_owned_kiosks: (address: string) => kiosk_client.getOwnedKiosks({ address }),
    get_owned_transfer_policies: (address: string) => kiosk_client.getOwnedTransferPolicies({ address }),
    get_transfer_policies: (type: string) => kiosk_client.getTransferPolicies({ type }),
    transfer_policy_transaction: (transaction: Transaction, rule_package?: string) =>
      new TransferPolicyTransaction({
        kioskClient: rule_package
          ? new KioskClient({
              client: sui_client as ConstructorParameters<typeof KioskClient>[0]['client'],
              network,
              packageIds: {
                royaltyRulePackageId: rule_package,
                kioskLockRulePackageId: rule_package,
                personalKioskRulePackageId: rule_package,
              },
            })
          : kiosk_client,
        transaction,
      }),
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
    execute_personal_kiosk,
    read_sui_balance: () => {
      if (!sender) throw new Error('[sdk] balance reads need an address')
      return balance.read(sender)
    },
    gas_spent_24h: gas_ledger.spent_24h,
    tag_gas: gas_ledger.tag,
    with_kiosk,
    with_owner_kiosk: <T>(tx: Transaction, cap: KioskOwnerCap | null, compose: Parameters<typeof with_kiosk<T>>[3]) => {
      if (!cap) throw new Error('No owned kiosk cap is available for this transaction.')
      return with_kiosk(tx, kiosk_transaction_client, cap, compose)
    },
    with_personal_kiosk: <T>(
      tx: Transaction,
      cap: KioskOwnerCap | null,
      compose: Parameters<typeof with_personal_kiosk<T>>[3]
    ) => with_personal_kiosk(tx, kiosk_transaction_client, cap, compose),
    coin_of,
  }
}

export type Sdk = ReturnType<typeof SDK>
