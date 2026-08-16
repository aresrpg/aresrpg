// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { SDK, type Pins, type SuiTransport } from '@aresrpg/sdk'
import { create_seed_plan, type SeedBuildContext } from '@aresrpg/sdk/seed'

import { seed_content } from '../../src/admin/seed_content.ts'

const object_id = (value: number): string => `0x${value.toString(16).padStart(2, '0').repeat(32)}`
const reference = (value: number) => ({ objectId: object_id(value), version: '1', digest: 'digest' })
const shared = (value: number) => ({ objectId: object_id(value), initialSharedVersion: '1' })
const pins: Pins = {
  package: `0x${'11'.repeat(32)}`,
  math_package: `0x${'22'.repeat(32)}`,
  template_registry: { id: `0x${'33'.repeat(32)}`, shared_version: '1' },
  loot_registry: { id: `0x${'44'.repeat(32)}`, shared_version: '1' },
}
const sdk = SDK({
  pins,
  client: {
    core: {
      getReferenceGasPrice: async () => ({ referenceGasPrice: '1' }),
      listCoins: async () => ({ objects: [] }),
      getObjects: async () => ({ objects: [] }),
      simulateTransaction: async () => ({}),
      executeTransaction: async () => ({}),
    },
  } as SuiTransport,
})

const build_context: SeedBuildContext = Object.freeze({
  publisher: reference(5),
  worlds: Object.freeze(Object.fromEntries(seed_content.worlds.map(({ world }, index) => [world, shared(index + 16)]))),
})

const remember = (ids: readonly string[]): void => {
  for (const [index, object_id] of ids.entries())
    sdk.cache.owned.set(object_id, { objectId: object_id, version: '1', digest: `digest-${index}` })
}

describe('admin seed content', () => {
  test('compiles the authored corpus into one fully resumable bounded plan', () => {
    const plan = create_seed_plan(sdk, seed_content)
    const targets = plan.batches.flatMap(({ target_ids }) => target_ids)
    const existing = new Set<string>()

    for (const batch of plan.batches) {
      expect(batch.dependencies.every((id) => existing.has(id))).toBeTrue()
      const transaction = batch.build(build_context, existing)
      expect(transaction).not.toBeNull()
      remember(batch.target_ids)
      for (const id of batch.target_ids) existing.add(id)
    }

    expect(seed_content.biome_maps).toHaveLength(seed_content.worlds.filter(({ terrain }) => terrain).length)
    expect(plan.batches.every(({ target_ids }) => target_ids.length > 0)).toBeTrue()
    expect(new Set(targets).size).toBe(targets.length)
    expect(plan.seal_id).not.toBeEmpty()
  })
})
