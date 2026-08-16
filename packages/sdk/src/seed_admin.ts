// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Seed publishing effect boundary. It scans deterministic addresses in order, builds exactly one
// generated batch, asks the connected wallet to sign it, simulates those bytes, then submits once.

import { receipt_digest } from './cache.ts'
import type { Sdk } from './client.ts'
import { create_seal_transaction, create_seed_plan, type SeedContent } from './seed.ts'

export type SeedAdminConfig = Readonly<{
  publisher: string
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

export const next_seed_batch = (snapshot: SeedAdminSnapshot | null): SeedBatchView | null =>
  snapshot?.batches.find(({ state }) => state === 'ready' || state === 'blocked') ?? null

export type SeedBatchReceipt = Readonly<{
  batch: string
  digest: string
  snapshot: SeedAdminSnapshot
}>

export type SeedAdminSession = Readonly<{
  refresh: () => Promise<SeedAdminSnapshot>
  execute: (batch: string) => Promise<SeedBatchReceipt>
  seal: () => Promise<Readonly<{ digest: string; snapshot: SeedAdminSnapshot }>>
}>

const chunks = <T>(values: readonly T[], size: number): readonly (readonly T[])[] => {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size))
  return result
}

const object_exists = (sdk: Sdk, id: string): boolean => sdk.cache.owned.has(id) || sdk.cache.shared.has(id)

const assert_config = (sdk: Sdk, content: SeedContent, config: SeedAdminConfig): void => {
  if (!config.publisher) throw new Error('A Publisher object ID is required')
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
  const context = Object.freeze({ publisher: config.publisher, worlds: config.worlds })
  const context_ids = [config.publisher, ...content.worlds.map(({ world }) => config.worlds[world])]
  await sdk.hydrate(context_ids)
  const missing_context = context_ids.filter((id) => !object_exists(sdk, id))
  if (missing_context.length) throw new Error(`Seed object IDs do not exist: ${missing_context.join(', ')}`)

  const hydrate_ids = async (ids: readonly string[]): Promise<void> => {
    const unknown = [...new Set(ids)].filter((id) => !object_exists(sdk, id))
    for (const group of chunks(unknown, 50)) await sdk.hydrate_objects(group)
  }

  const refresh = async (): Promise<SeedAdminSnapshot> => {
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
      return Object.freeze({
        batches: Object.freeze(batches),
        sealed: true,
      })
    }
    const views: SeedBatchView[] = []
    let next_batch: string | null = null
    for (const batch of plan.batches) {
      if (next_batch !== null) {
        views.push(
          Object.freeze({
            id: batch.id,
            phase: batch.phase,
            state: 'pending',
            targets: batch.target_ids.length,
            missing_dependencies: [],
          })
        )
        continue
      }
      if (batch.target_ids.length) await hydrate_ids(batch.target_ids)
      const complete = batch.target_ids.every((id) => object_exists(sdk, id))
      if (complete) {
        views.push(
          Object.freeze({
            id: batch.id,
            phase: batch.phase,
            state: 'complete',
            targets: batch.target_ids.length,
            missing_dependencies: [],
          })
        )
        continue
      }
      await hydrate_ids(batch.dependencies)
      const missing_dependencies = batch.dependencies.filter((id) => !object_exists(sdk, id))
      next_batch = batch.id
      views.push(
        Object.freeze({
          id: batch.id,
          phase: batch.phase,
          state: missing_dependencies.length ? 'blocked' : 'ready',
          targets: batch.target_ids.length,
          missing_dependencies: Object.freeze(missing_dependencies),
        })
      )
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
      const receipt = await sdk.execute(transaction)
      return Object.freeze({ batch: batch_id, digest: receipt_digest(receipt), snapshot: await refresh() })
    },
    seal: async () => {
      const snapshot = await refresh()
      if (snapshot.batches.some(({ state }) => state !== 'complete'))
        throw new Error('Every seed batch must complete before sealing')
      const receipt = await sdk.execute(create_seal_transaction(sdk, config.publisher))
      return Object.freeze({ digest: receipt_digest(receipt), snapshot: await refresh() })
    },
  })
}
