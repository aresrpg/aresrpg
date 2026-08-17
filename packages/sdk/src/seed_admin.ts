// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seed publishing effect boundary. It scans deterministic addresses in order, builds exactly one
// generated batch, asks the connected wallet to sign it, simulates those bytes, then submits once.

import { owned_ref, receipt_digest, shared_ref, type OwnedRef, type Receipt } from './cache.ts'
import type { Sdk } from './client.ts'
import { create_seal_transaction, create_seed_plan, type SeedContent } from './seed.ts'

export type SeedAdminConfig = Readonly<{
  admin_cap: string
  worlds: Readonly<Record<string, string>>
}>

export type SeedBatchState = 'complete' | 'ready' | 'blocked' | 'pending'

export type SeedBatchView = Readonly<{
  id: string
  phase: string
  state: SeedBatchState
  targets: number
  missing_dependencies: readonly string[]
}>

export type SeedAdminSnapshot = Readonly<{
  batches: readonly SeedBatchView[]
  sealed: boolean
}>

export type SeedInspectionProgress = Readonly<{
  inspected: number
  total: number
  batch: string | null
}>

export const next_seed_batch = (snapshot: SeedAdminSnapshot | null): SeedBatchView | null =>
  snapshot?.batches.find(({ state }) => state === 'ready' || state === 'blocked') ?? null

export type SeedBatchReceipt = Readonly<{
  batch: string
  digest: string
  snapshot: SeedAdminSnapshot
}>

export type SeedAdminSession = Readonly<{
  refresh: (on_progress?: (progress: SeedInspectionProgress) => void) => Promise<SeedAdminSnapshot>
  execute: (batch: string) => Promise<SeedBatchReceipt>
  seal: () => Promise<Readonly<{ digest: string; snapshot: SeedAdminSnapshot }>>
  release?: () => Promise<void>
}>

const DEFAULT_MAX_TRANSACTION_BYTES = 131_072
const DEFAULT_MAX_COMMANDS = 1_024
const TRANSACTION_DATA_HEADROOM = 1_024
// Current testnet corpus consumed ~36 SUI during the 2026-08-17 full publish proof. This is
// working capital, not a gas budget: the release PTB returns whatever the seed signer did not use.
export const SEED_SESSION_GAS = 50_000_000_000n

const protocol_number = (value: string | null | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const create_seed_session_authorization_transaction = ({
  sdk,
  admin_cap,
  recipient,
}: Readonly<{ sdk: Sdk; admin_cap: string; recipient: string }>) => {
  const transaction = sdk.tx()
  transaction.moveCall({
    target: `${sdk.pins.package}::admin::mint_temp_admin_cap`,
    arguments: [
      sdk.door_context.obj(transaction, admin_cap, false),
      sdk.door_context.pure.address(transaction, recipient),
    ],
  })
  const [funding] = transaction.splitCoins(transaction.gas, [SEED_SESSION_GAS])
  transaction.transferObjects([funding], recipient)
  return transaction
}

export const project_temp_admin_cap = (receipt: Receipt): OwnedRef => {
  const types = receipt.Transaction?.objectTypes ?? {}
  const created = receipt.Transaction?.effects?.changedObjects ?? []
  const admin_cap = created.find(
    ({ objectId, idOperation }) =>
      idOperation === 'Created' && !!objectId && types[objectId]?.endsWith('::admin::AdminCap')
  )
  if (!admin_cap?.objectId || !admin_cap.outputVersion || !admin_cap.outputDigest)
    throw new Error('Seed session authorization created no temporary AdminCap ref')
  return Object.freeze({
    objectId: admin_cap.objectId,
    version: String(admin_cap.outputVersion),
    digest: admin_cap.outputDigest,
  })
}

// Existence reads go through the normalizing doors — a raw Map probe with a short or
// mixed-case id would report a hydrated object as missing forever.
const object_exists = (sdk: Sdk, id: string): boolean => !!owned_ref(sdk.cache, id) || !!shared_ref(sdk.cache, id)

const assert_config = (sdk: Sdk, content: SeedContent, config: SeedAdminConfig): void => {
  if (!config.admin_cap) throw new Error('An AdminCap object ID is required')
  const missing_worlds = content.worlds.map(({ world }) => world).filter((world) => !config.worlds[world])
  if (missing_worlds.length) throw new Error(`Missing World object IDs: ${missing_worlds.join(', ')}`)
  const world_ids = content.worlds.map(({ world }) => config.worlds[world])
  if (new Set(world_ids).size !== world_ids.length) throw new Error('Every world must use a distinct World object ID')
  for (const key of ['package', 'math_package'] as const)
    if (typeof sdk.pins[key] !== 'string' || !sdk.pins[key]) throw new Error(`pins.json is missing ${key}`)
  for (const key of ['template_registry', 'loot_registry'] as const) {
    const pin = sdk.pins[key]
    if (!pin || typeof pin !== 'object' || !pin.id || !pin.shared_version)
      throw new Error(`pins.json is missing ${key}`)
  }
}

export const create_seed_admin = async ({
  sdk,
  content,
  config,
}: Readonly<{
  sdk: Sdk
  content: SeedContent
  config: SeedAdminConfig
}>): Promise<SeedAdminSession> => {
  assert_config(sdk, content, config)
  const plan = create_seed_plan(sdk, content)
  const context = Object.freeze({ admin_cap: config.admin_cap, worlds: config.worlds })
  const hydrate_ids = async (ids: readonly string[]): Promise<void> => {
    await sdk.hydrate_unknown(ids)
  }
  const context_ids = [config.admin_cap, ...content.worlds.map(({ world }) => config.worlds[world])]
  await hydrate_ids(context_ids)
  const missing_context = context_ids.filter((id) => !object_exists(sdk, id))
  if (missing_context.length) throw new Error(`Seed object IDs do not exist: ${missing_context.join(', ')}`)

  const refresh = async (on_progress?: (progress: SeedInspectionProgress) => void): Promise<SeedAdminSnapshot> => {
    await hydrate_ids([plan.seal_id])
    if (object_exists(sdk, plan.seal_id)) {
      const batches = plan.batches.map((batch) =>
        Object.freeze({
          id: batch.id,
          phase: batch.phase,
          state: 'complete' as const,
          targets: batch.target_ids.length,
          missing_dependencies: Object.freeze([]),
        })
      )
      on_progress?.(Object.freeze({ inspected: plan.batches.length, total: plan.batches.length, batch: null }))
      return Object.freeze({
        batches: Object.freeze(batches),
        sealed: true,
      })
    }
    const views: SeedBatchView[] = []
    let next_batch: string | null = null
    const report = (view: SeedBatchView): void => {
      on_progress?.(Object.freeze({ inspected: views.length, total: plan.batches.length, batch: view.id }))
    }
    for (const batch of plan.batches) {
      if (next_batch !== null) {
        const view = Object.freeze({
          id: batch.id,
          phase: batch.phase,
          state: 'pending' as const,
          targets: batch.target_ids.length,
          missing_dependencies: [],
        })
        views.push(view)
        report(view)
        continue
      }
      if (batch.target_ids.length) await hydrate_ids(batch.target_ids)
      const complete = batch.target_ids.every((id) => object_exists(sdk, id))
      if (complete) {
        const view = Object.freeze({
          id: batch.id,
          phase: batch.phase,
          state: 'complete' as const,
          targets: batch.target_ids.length,
          missing_dependencies: [],
        })
        views.push(view)
        report(view)
        continue
      }
      await hydrate_ids(batch.dependencies)
      const missing_dependencies = batch.dependencies.filter((id) => !object_exists(sdk, id))
      next_batch = batch.id
      const view = Object.freeze({
        id: batch.id,
        phase: batch.phase,
        state: missing_dependencies.length ? ('blocked' as const) : ('ready' as const),
        targets: batch.target_ids.length,
        missing_dependencies: Object.freeze(missing_dependencies),
      })
      views.push(view)
      report(view)
    }
    return Object.freeze({
      batches: Object.freeze(views),
      sealed: false,
    })
  }

  return Object.freeze({
    refresh,
    execute: async (batch_id) => {
      const before = await refresh()
      const view = before.batches.find(({ id }) => id === batch_id)
      if (next_seed_batch(before)?.id !== batch_id || view?.state !== 'ready')
        throw new Error(`Seed batch ${batch_id} is not the next ready batch`)
      const batch = plan.batches.find(({ id }) => id === batch_id)
      if (!batch) throw new Error(`Unknown seed batch ${batch_id}`)
      const existing = new Set([...sdk.cache.owned.keys(), ...sdk.cache.shared.keys()])
      const transaction = batch.build(context, existing)
      if (!transaction) throw new Error(`Seed batch ${batch_id} contains no pending work`)
      const protocol = await sdk.sui_client.core.getProtocolConfig?.()
      const attributes = protocol?.protocolConfig.attributes ?? {}
      const max_commands = protocol_number(attributes.max_programmable_tx_commands, DEFAULT_MAX_COMMANDS)
      const max_bytes = protocol_number(attributes.max_tx_size_bytes, DEFAULT_MAX_TRANSACTION_BYTES)
      const commands = transaction.getData().commands.length
      if (commands >= max_commands)
        throw new Error(`Seed batch ${batch_id} has ${commands} commands; protocol requires fewer than ${max_commands}`)
      const kind_bytes = await transaction.build({ onlyTransactionKind: true })
      if (kind_bytes.byteLength + TRANSACTION_DATA_HEADROOM > max_bytes)
        throw new Error(
          `Seed batch ${batch_id} needs ${kind_bytes.byteLength + TRANSACTION_DATA_HEADROOM} bytes; protocol allows ${max_bytes}`
        )
      // No separate dry run here: the executor itself simulates the exact signed bytes and
      // refuses before submission (and the wallet path preflights before the wallet opens).
      const receipt = await sdk.execute(transaction)
      return Object.freeze({ batch: batch_id, digest: receipt_digest(receipt), snapshot: await refresh() })
    },
    seal: async () => {
      const snapshot = await refresh()
      if (snapshot.batches.some(({ state }) => state !== 'complete'))
        throw new Error('Every seed batch must complete before sealing')
      const receipt = await sdk.execute(create_seal_transaction(sdk, config.admin_cap))
      return Object.freeze({ digest: receipt_digest(receipt), snapshot: await refresh() })
    },
  })
}
