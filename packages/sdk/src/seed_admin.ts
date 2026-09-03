// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seed publishing effect boundary. It scans deterministic addresses in order, builds exactly one
// generated batch, asks the connected wallet to sign it, simulates those bytes, then submits once.
// Seeding is just the FIRST rebalance: every batch drives the same living doors any later content
// change uses, under the one seed AdminCap.

import { class_spell_shape_errors } from '@aresrpg/immutable'
import { normalizeSuiObjectId } from '@mysten/sui/utils'

import { object_revision, owned_ref, receipt_digest, shared_ref, type OwnedRef, type Receipt } from './cache.ts'
import type { Sdk } from './client.ts'
import { create_freeze_forever_transaction, create_seed_plan, type SeedContent } from './seed.ts'
import {
  seed_ledger_after,
  seed_ledger_after_batch,
  created_seed_row_keys,
  seed_sync_rows,
  seed_sync_view,
  type SeedLedger,
  type SeedSyncRow,
  type SeedSyncView,
} from './seed_sync.ts'
import { seed_update_batches, type SeedUpdateBatch } from './seed_updates.ts'

export type { SeedLedger, SeedSyncView } from './seed_sync.ts'

export type SeedApplyResult = Readonly<{
  digests: readonly string[]
  /** the ledger as it stands after the apply — the caller persists it */
  ledger: SeedLedger
  view: SeedSyncView
}>

export type SeedApplyProgress = Readonly<{ digest: string; ledger: SeedLedger }>
export type SeedApplyHooks = Readonly<{
  before_execute: (written: readonly string[]) => Promise<void>
  checkpoint: (progress: SeedApplyProgress) => Promise<void>
}>

export type SeedAdminConfig = Readonly<{
  /** the control package's one AdminCap — every content door writes through it */
  admin_cap: string
  /** the seed package's Registry root object */
  content_root: string
  /** math, control, combat, seed, core — verified and consumed only by the permanent freeze. */
  upgrade_caps?: readonly Readonly<{ cap: string; package: string }>[]
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
  execute: (batch: string, ledger: SeedLedger) => Promise<SeedBatchReceipt>
  /** chain truth of the permanent freeze — read at page refresh, no polling */
  read_frozen: () => Promise<boolean>
  /** compare the authored files against the last chain write — new / changed / removed / fixed */
  check_changes: (ledger: SeedLedger) => Promise<SeedSyncView>
  /** Rewrite mutable rows, durably checkpointing each certified transaction before the next. */
  apply_changes: (ledger: SeedLedger, hooks: SeedApplyHooks) => Promise<SeedApplyResult>
  /** the ledger entries covering rows the publish lane just created — persisted by the caller */
  created_ledger: (ledger: SeedLedger, batch: string) => Promise<SeedLedger>
  /** Every currently discoverable derived address; pins.json retains historical entries. */
  address_book: () => Promise<Readonly<Record<string, string>>>
  /** the endgame: permanently freezes EVERY content door — cold-key-only on chain, irreversible */
  freeze_forever: () => Promise<Readonly<{ digest: string; snapshot: SeedAdminSnapshot }>>
  release?: () => Promise<void>
}>

const DEFAULT_MAX_TRANSACTION_BYTES = 131_072
const DEFAULT_MAX_COMMANDS = 1_024
const TRANSACTION_DATA_HEADROOM = 1_024
// Current testnet corpus consumed ~36 SUI during the 2026-08-17 full publish proof. This is
// working capital, not a gas budget: the release PTB returns whatever the seed signer did not use.
export const SEED_SESSION_GAS = 50_000_000_000n

export const apply_seed_update_batches = async (
  batches: readonly SeedUpdateBatch[],
  rows: readonly SeedSyncRow[],
  ledger: SeedLedger,
  execute: (batch: SeedUpdateBatch) => Promise<string>,
  hooks: SeedApplyHooks,
  revision: (id: string) => string | null = () => null
): Promise<Readonly<{ digests: readonly string[]; ledger: SeedLedger }>> => {
  const digests: string[] = []
  let current = ledger
  for (const batch of batches) {
    await hooks.before_execute(batch.written)
    const digest = await execute(batch)
    current = seed_ledger_after_batch(rows, current, batch.written, revision)
    await hooks.checkpoint(Object.freeze({ digest, ledger: current }))
    digests.push(digest)
  }
  return Object.freeze({ digests: Object.freeze(digests), ledger: current })
}

const protocol_number = (value: string | null | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export const create_seed_session_authorization_transaction = ({
  sdk,
  admin_cap,
  recipient,
  funding_mist = SEED_SESSION_GAS,
}: Readonly<{ sdk: Sdk; admin_cap: string; recipient: string; funding_mist?: bigint }>) => {
  if (funding_mist <= 0n || funding_mist > SEED_SESSION_GAS)
    throw new Error(`Temporary admin funding must be between 1 MIST and ${SEED_SESSION_GAS} MIST`)
  const transaction = sdk.tx()
  transaction.moveCall({
    target: `${sdk.pins.control_package}::admin::mint_temp_admin_cap`,
    arguments: [
      sdk.door_context.obj(transaction, admin_cap, false),
      sdk.door_context.pure.address(transaction, recipient),
    ],
  })
  const [funding] = transaction.splitCoins(transaction.gas, [funding_mist])
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

export const verify_upgrade_cap_targets = async (
  sdk: Sdk,
  targets: readonly Readonly<{ cap: string; package: string }>[]
): Promise<readonly string[]> => {
  if (targets.length !== 5)
    throw new Error('Permanent freeze requires math, control, combat, seed, and core UpgradeCaps')
  const normalized = targets.map(({ cap, package: package_id }) =>
    Object.freeze({ cap: normalizeSuiObjectId(cap), package: normalizeSuiObjectId(package_id) })
  )
  if (
    new Set(normalized.map(({ cap }) => cap)).size !== 5 ||
    new Set(normalized.map(({ package: id }) => id)).size !== 5
  )
    throw new Error('Permanent freeze requires five distinct UpgradeCaps and package lineages')
  const { objects } = await sdk.sui_client.core.getObjects({
    objectIds: normalized.map(({ cap }) => cap),
    include: { json: true },
  })
  for (const target of normalized) {
    const object = objects.find((candidate) => !(candidate instanceof Error) && candidate.objectId === target.cap)
    const controlled = object && !(object instanceof Error) ? object.json?.package : null
    if (typeof controlled !== 'string' || normalizeSuiObjectId(controlled) !== target.package)
      throw new Error(`UpgradeCap ${target.cap} does not control active package ${target.package}`)
  }
  return Object.freeze(normalized.map(({ cap }) => cap))
}

const assert_config = (sdk: Sdk, content: SeedContent, config: SeedAdminConfig): void => {
  if (!config.admin_cap) throw new Error('An AdminCap object ID is required')
  if (!config.content_root) throw new Error('The seed Registry root object ID is required')
  for (const key of ['package', 'math_package', 'control_package', 'seed_package', 'seed_package_original'] as const)
    if (typeof sdk.pins[key] !== 'string' || !sdk.pins[key]) throw new Error(`pins.json is missing ${key}`)
  for (const key of ['content_root', 'loot_registry'] as const) {
    const pin = sdk.pins[key]
    if (!pin || typeof pin !== 'object' || !Reflect.get(pin, 'id') || !Reflect.get(pin, 'shared_version'))
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
  const context = Object.freeze({
    admin_cap: config.admin_cap,
    content_root: config.content_root,
  })
  const absent = new Set<string>()
  const hydrate_ids = async (ids: readonly string[]): Promise<void> => {
    const unchecked = [...new Set(ids)].filter((id) => !absent.has(id))
    if (!unchecked.length) return
    await sdk.hydrate_unknown(unchecked)
    for (const id of unchecked) {
      if (object_exists(sdk, id)) absent.delete(id)
      else absent.add(id)
    }
  }
  const context_ids = [config.admin_cap, config.content_root]
  await hydrate_ids(context_ids)
  const missing_context = context_ids.filter((id) => !object_exists(sdk, id))
  if (missing_context.length) throw new Error(`Seed object IDs do not exist: ${missing_context.join(', ')}`)

  const refresh = async (on_progress?: (progress: SeedInspectionProgress) => void): Promise<SeedAdminSnapshot> => {
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
    return Object.freeze({ batches: Object.freeze(views) })
  }

  const refresh_after_write = async (batch_id: string, digest: string): Promise<SeedAdminSnapshot> => {
    const targets = plan.batches.find(({ id }) => id === batch_id)?.target_ids ?? []
    for (const id of targets) absent.delete(id)
    const snapshot = await refresh()
    if (snapshot.batches.find(({ id }) => id === batch_id)?.state === 'complete') return snapshot
    throw new Error(
      `Seed batch ${batch_id} published · ${digest}, but its derived target is not readable yet. ` +
        'Do not republish it; check seed status after the read node catches up.'
    )
  }

  const sync_rows = seed_sync_rows(sdk, content)
  const exists = (id: string): boolean => object_exists(sdk, id)
  const revision = (id: string): string | null => object_revision(sdk.cache, id)
  const board_catalog = sync_rows.find(({ domain }) => domain === 'board')?.chain_id ?? null
  /** Chain truth for the endgame flag — read once per check, never polled: the flag only
   * matters to this admin page, and every write door re-asserts it on chain anyway. */
  const read_frozen = async (): Promise<boolean> => {
    const { objects } = await sdk.sui_client.core.getObjects({
      objectIds: [config.content_root],
      include: { json: true },
    })
    const row = objects.find(({ objectId }) => objectId === config.content_root)
    return row?.json?.frozen === true
  }
  const read_board_len = async (): Promise<number> => {
    if (!board_catalog) return 0
    const { objects } = await sdk.sui_client.core.getObjects({
      objectIds: [board_catalog],
      include: { json: true },
    })
    const row = objects.find(({ objectId }) => objectId === board_catalog)
    const len = Number(row?.json?.len ?? 0)
    if (!Number.isSafeInteger(len) || len < 0) throw new Error('The BoardCatalog carries an invalid length')
    return len
  }
  // THE CLASS SPELL LAW: exactly twenty spells per class on the Dofus unlock ladder. The
  // validator enforces it in CI; this second gate stops a locally edited file from ever
  // being written (chain objects are forever). Reads still work so the page can SHOW it.
  const law_errors = class_spell_shape_errors(content.spells)
  const sync_addresses = Object.freeze([...new Set(sync_rows.flatMap(({ addresses }) => addresses))])
  const check_changes = async (ledger: SeedLedger): Promise<SeedSyncView> => {
    await hydrate_ids(sync_addresses)
    const view = seed_sync_view(sync_rows, ledger, exists, await read_board_len(), revision)
    return law_errors.length ? Object.freeze({ ...view, errors: Object.freeze([...law_errors, ...view.errors]) }) : view
  }
  const address_book = async (): Promise<Readonly<Record<string, string>>> => {
    await hydrate_ids(sync_addresses)
    const entries = sync_rows.flatMap((row) =>
      row.addresses
        .filter(exists)
        .map((address) => [address, row.domain === 'board' ? 'fight board catalog' : row.label] as const)
    )
    return Object.freeze(Object.fromEntries(entries))
  }

  return Object.freeze({
    refresh,
    check_changes,
    address_book,
    read_frozen,
    apply_changes: async (ledger, hooks) => {
      const view = await check_changes(ledger)
      if (view.errors.length) throw new Error(`Nothing was written — fix the files first: ${view.errors.join(' · ')}`)
      const board_len = await read_board_len()
      await hydrate_ids(view.changed.flatMap(({ hydrate }) => hydrate))
      const batches = seed_update_batches(sdk, view.changed, context, {
        chain_len: board_len,
        authored_len: content.boards.length,
      })
      const applied = await apply_seed_update_batches(
        batches,
        sync_rows,
        ledger,
        async ({ transaction }) => receipt_digest(await sdk.execute(transaction)),
        hooks,
        revision
      )
      return Object.freeze({
        digests: applied.digests,
        ledger: applied.ledger,
        view: seed_sync_view(sync_rows, applied.ledger, exists, content.boards.length, revision),
      })
    },
    created_ledger: async (ledger, batch_id) => {
      await hydrate_ids(sync_addresses)
      const batch = plan.batches.find(({ id }) => id === batch_id)
      if (!batch) throw new Error(`Unknown seed batch ${batch_id}`)
      // Only this certified batch can advance creation fingerprints. Deterministic objects from
      // an older partial run may already exist without having received today's authored value.
      const created = created_seed_row_keys(sync_rows, ledger, new Set(batch.target_ids), exists)
      return seed_ledger_after(sync_rows, ledger, created, exists, revision)
    },
    execute: async (batch_id, ledger) => {
      const changes = await check_changes(ledger)
      if (changes.errors.length)
        throw new Error(`Nothing was written — fix the files first: ${changes.errors.join(' · ')}`)
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
      const digest = receipt_digest(receipt)
      return Object.freeze({ batch: batch_id, digest, snapshot: await refresh_after_write(batch_id, digest) })
    },
    freeze_forever: async () => {
      const snapshot = await refresh()
      if (snapshot.batches.some(({ state }) => state !== 'complete'))
        throw new Error('Every seed batch must complete before freezing the game forever')
      const upgrade_caps = await verify_upgrade_cap_targets(sdk, config.upgrade_caps ?? [])
      await hydrate_ids(upgrade_caps)
      const receipt = await sdk.execute(
        create_freeze_forever_transaction(sdk, config.admin_cap, config.content_root, upgrade_caps)
      )
      return Object.freeze({ digest: receipt_digest(receipt), snapshot: await refresh() })
    },
  })
}
