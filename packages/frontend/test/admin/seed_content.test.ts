// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { SDK, type Pins, type SuiTransport } from '@aresrpg/sdk'
import { create_seed_plan, type SeedBuildContext } from '@aresrpg/sdk/seed'

import { seed_content } from '../../src/content/canonical_seed.ts'

const object_id = (value: number): string => `0x${value.toString(16).padStart(2, '0').repeat(32)}`
const digest = '11111111111111111111111111111111'
const reference = (value: number) => ({ objectId: object_id(value), version: '1', digest })
const shared = (value: number) => ({ objectId: object_id(value), initialSharedVersion: '1' })
const pins: Pins = {
  package: `0x${'11'.repeat(32)}`,
  math_package: `0x${'22'.repeat(32)}`,
  template_registry: { id: `0x${'33'.repeat(32)}`, shared_version: '1' },
  loot_registry: { id: `0x${'44'.repeat(32)}`, shared_version: '1' },
  seed_package: `0x${'55'.repeat(32)}`,
  seed_package_original: `0x${'55'.repeat(32)}`,
  content_root: { id: `0x${'66'.repeat(32)}`, shared_version: '1' },
}
const sdk = SDK({
  pins,
  client: {
    core: {
      resolveTransactionPlugin: () => async (_transaction, _options, next) => next(),
      getBalance: async () => ({ balance: { balance: '0' } }),
      getCurrentSystemState: async () => ({ systemState: { epoch: '1', referenceGasPrice: '1' } }),
      getChainIdentifier: async () => ({ chainIdentifier: digest }),
      getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
      listCoins: async () => ({ objects: [] }),
      getObjects: async () => ({ objects: [] }),
      simulateTransaction: async () => ({}),
      executeTransaction: async () => ({}),
      waitForTransaction: async () => ({}),
    },
  } satisfies SuiTransport,
})

const build_context: SeedBuildContext = Object.freeze({
  admin_cap: reference(5),
  content_root: shared(7),
})

const remember = (ids: readonly string[]): void => {
  for (const object_id of ids) sdk.cache.owned.set(object_id, { objectId: object_id, version: '1', digest })
}

describe('canonical seed content', () => {
  test('compiles the authored corpus into one fully resumable bounded plan', async () => {
    const plan = create_seed_plan(sdk, seed_content)
    const targets = plan.batches.flatMap(({ target_ids }) => target_ids)
    const existing = new Set<string>()

    for (const batch of plan.batches) {
      expect(batch.dependencies.every((id) => existing.has(id))).toBeTrue()
      const transaction = batch.build(build_context, existing)
      expect(transaction).not.toBeNull()
      if (transaction) {
        expect(transaction.getData().commands.length).toBeLessThan(1_024)
        expect((await transaction.build({ onlyTransactionKind: true })).byteLength).toBeLessThanOrEqual(131_072)
      }
      remember(batch.target_ids)
      for (const id of batch.target_ids) existing.add(id)
    }

    expect(seed_content.biome_maps).toHaveLength(seed_content.worlds.filter(({ terrain }) => terrain).length)
    expect(seed_content.mobs.every((mob) => !Object.hasOwn(mob, 'family'))).toBeTrue()
    expect(seed_content.worlds.flatMap(({ resources }) => resources).every(({ job, tier }) => job && tier)).toBeTrue()
    expect(plan.batches.every(({ target_ids }) => target_ids.length > 0)).toBeTrue()
    expect(new Set(targets).size).toBe(targets.length)
    // the biome maps run the engine's real sampler over every world — corpus-sized, not unit-sized
  }, 30_000)
})
