// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The SDK factory (legacy model) — WRITE-ONLY and ZERO-ROUNDTRIP: it composes PTBs whose every
// input is PRE-RESOLVED (owner 2026-08-12: Sui finality is sub-second, so must every tx be —
// no resolution RPC may sit between intent and submission). It never reads game state (reads
// are the indexer's job) and carries zero content. Pins come from the ONE committed repo-root
// pins.json. One sanctioned bootstrap roundtrip exists: `hydrate()` — everything after rides
// receipts.

import { Transaction } from '@mysten/sui/transactions'
import { fromBase64 } from '@mysten/sui/utils'

import PINS from '../../../pins.json' with { type: 'json' }

import * as doors from './doors.gen.js'
import { create_cache, absorb_receipt, absorb_object, owned_ref, shared_ref } from './cache.js'
import { with_kiosk, coin_of } from './ptb.js'

export { doors }
export { DOORS } from './doors.gen.js'
export * from './ptb.js'
export * from './cache.js'

const DEFAULT_GAS_BUDGET = 50_000_000n

/** @typedef {{ id: string | null, shared_version: string | null }} SharedPin */
/** @typedef {Record<string, any> & { package?: string | null }} Pins */
/**
 * The transport the SDK needs — the modern CORE interface, identical on the gRPC and GraphQL
 * clients (`client.core.*`; JSON-RPC is dead — owner 2026-08-12). Structural on purpose so any
 * flavor or test fake fits: hydrate + simulate + execute, NEVER resolution.
 * @typedef {{
 *   core: {
 *     getReferenceGasPrice: () => Promise<{ referenceGasPrice: string | bigint }>,
 *     listCoins: (input: { owner: string, coinType?: string, limit?: number }) => Promise<{ objects: any[] }>,
 *     getObjects: (input: { objectIds: string[] }) => Promise<{ objects: any[] }>,
 *     simulateTransaction: (input: { transaction: Uint8Array, include?: object }) => Promise<any>,
 *     executeTransaction: (input: { transaction: Uint8Array, signatures: string[], include?: object }) => Promise<any>,
 *   },
 * }} SuiTransport
 */

/**
 * SDK({ client, signer, network }) → the game client's one write surface.
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
 *
 * @param {object} [opts]
 * @param {SuiTransport} [opts.client] - the transport (required at runtime; the factory throws without it)
 * @param {import('@mysten/sui/cryptography').Signer} [opts.signer] - zkLogin keypair, wallet adapter...; execute needs it
 * @param {'testnet' | 'mainnet'} [opts.network] - pins.json key
 * @param {Pins} [opts.pins] - override for tests/local publishes; defaults to pins.json[network]
 * @param {bigint} [opts.gas_budget] - default budget in MIST (fixed, never dry-run derived)
 */
export function SDK({
  client,
  signer,
  network = 'testnet',
  pins = PINS[network],
  gas_budget = DEFAULT_GAS_BUDGET,
} = {}) {
  if (!client) throw new Error('[sdk] SDK({ client }) — a SuiClient is required')
  if (!pins) throw new Error(`[sdk] unknown network "${network}" — pins.json carries no entry for it`)

  const cache = create_cache()
  const gas = { price: null, coin: null } // reference gas price (per epoch) + the signer's gas coin id

  // ── the resolver: cache → pre-resolved input; unknown → THROW (zero-roundtrip law) ──────
  const resolve = (tx, value, mutable) => {
    if (typeof value !== 'string') {
      // already an in-PTB argument (a result, a resolved input) or an explicit ref object
      if (value?.objectId && value?.digest) return tx.objectRef(value)
      if (value?.objectId && value?.initialSharedVersion) return tx.sharedObjectRef({ mutable, ...value })
      return value
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

  const ctx = {
    pins: new Proxy(pins, {
      get(target, key) {
        if (typeof key !== 'string') return Reflect.get(target, key)
        const v = target[key]
        if (!v) throw new Error(`[sdk] missing pin "${String(key)}" — pins.json carries no id for it on this network`)
        return v
      },
    }),
    obj: resolve,
    pin: (tx, key, mutable) => {
      const entry = pins[key]
      if (!entry?.id || !entry?.shared_version)
        throw new Error(`[sdk] missing pin "${key}" — pins.json carries no id for it on this network`)
      return tx.sharedObjectRef({ objectId: entry.id, initialSharedVersion: String(entry.shared_version), mutable })
    },
    receiving: (tx, value) => {
      const ref = typeof value === 'string' ? owned_ref(cache, value) : value
      if (!ref?.objectId || !ref?.digest)
        throw new Error(
          `[sdk] unresolved receiving object ${typeof value === 'string' ? value : ''} — hydrate it first or pass {objectId, version, digest}`
        )
      return tx.receivingRef(ref)
    },
  }

  const bound_doors = Object.fromEntries(
    Object.keys(doors.DOORS).map((name) => [name, (tx, args) => doors[name](tx, ctx, args)])
  )

  // ── the ONE sanctioned roundtrip: seed refs, gas price, and the gas coin ────────────────
  const hydrate = async (ids = []) => {
    const address = signer?.toSuiAddress?.()
    const [{ referenceGasPrice }, coins, objects] = await Promise.all([
      client.core.getReferenceGasPrice(),
      address ? client.core.listCoins({ owner: address, limit: 1 }) : { objects: [] },
      ids.length ? client.core.getObjects({ objectIds: ids }) : { objects: [] },
    ])
    gas.price = BigInt(referenceGasPrice)
    const [coin] = coins.objects
    if (coin) {
      gas.coin = coin.objectId
      absorb_object(cache, coin)
    }
    for (const row of objects.objects) absorb_object(cache, row)
    return cache
  }

  // A failed result's honest message, whatever depth the error hides at.
  const failure_of = (result) => {
    const failed = result?.FailedTransaction
    if (!failed) return null
    const error = failed.effects?.status?.error
    return error?.message ?? (typeof error === 'string' ? error : JSON.stringify(error ?? 'unknown'))
  }

  // ── execute: fully-formed tx in, sub-second receipt out — and a tx that would FAIL never
  // leaves the client (owner 2026-08-12): sign ONCE (offline when hydrated), SIMULATE the exact
  // bytes, refuse on any simulated failure (zero gas, no digest), then submit those same bytes.
  // An EXECUTED failure still throws and is never auto-retried (a digest exists = gas burned).
  const execute = async (tx, { budget = gas_budget, include = undefined } = {}) => {
    if (!signer) throw new Error('[sdk] execute needs a signer — pass it to SDK({ signer })')
    tx.setSenderIfNotSet(signer.toSuiAddress())
    if (gas.price) tx.setGasPrice(gas.price)
    tx.setGasBudgetIfNotSet(budget)
    const gas_ref = gas.coin && owned_ref(cache, gas.coin)
    if (gas_ref) tx.setGasPayment([gas_ref])

    const { bytes, signature } = await tx.sign({ client, signer })
    const raw = typeof bytes === 'string' ? fromBase64(bytes) : bytes

    const simulation = await client.core.simulateTransaction({ transaction: raw, include: { effects: true } })
    const refusal = failure_of(simulation)
    if (refusal !== null) throw new Error(`[sdk] dry run failed — transaction NOT submitted (zero gas): ${refusal}`)

    const receipt = await client.core.executeTransaction({
      transaction: raw,
      signatures: [signature],
      include: { effects: true, events: true, ...include },
    })
    if (receipt?.$kind === 'FailedTransaction') {
      absorb_receipt(cache, receipt) // gas coin still mutated — keep it fresh
      throw new Error(`[sdk] transaction failed: ${failure_of(receipt)}`)
    }
    absorb_receipt(cache, receipt)
    return receipt
  }

  const call = Object.fromEntries(
    Object.keys(doors.DOORS).map((name) => [
      name,
      async (args, opts) => {
        const tx = new Transaction()
        bound_doors[name](tx, args)
        return execute(tx, opts)
      },
    ])
  )

  return {
    pins,
    cache,
    hydrate,
    /** Freshest known owned ref (receipt-fed), or undefined. */
    ref: (object_id) => owned_ref(cache, object_id),
    tx: () => new Transaction(),
    doors: bound_doors,
    call,
    execute,
    with_kiosk,
    coin_of,
  }
}
