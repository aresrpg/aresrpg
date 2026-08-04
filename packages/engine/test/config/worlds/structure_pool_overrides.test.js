// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { get_biome_by_id } from '../../../src/config/biome_registry.js'
import { EMBER_STEPPE_WORLD } from '../../../src/config/worlds/ember_steppe.js'
import { RAINFOREST_WORLD } from '../../../src/config/worlds/rainforest.js'

/** @param {{ biomes: Array<{ id: number }>, structure_pool_overrides?: Record<string, unknown> }} world_config */
const unresolved_override_keys = (world_config) => {
  const placement_names = new Set(
    world_config.biomes.flatMap(({ id }) => {
      const biome_name = get_biome_by_id(id)?.name
      return biome_name === undefined ? [] : [biome_name]
    })
  )
  return Object.keys(world_config.structure_pool_overrides ?? {}).filter(
    (biome_name) => !placement_names.has(biome_name)
  )
}

describe('structure pool override wiring', () => {
  test('ember_steppe overrides use the registry names consumed by placement', () => {
    expect(unresolved_override_keys(EMBER_STEPPE_WORLD)).toEqual([])
  })

  test('rainforest overrides use the registry names consumed by placement', () => {
    expect(unresolved_override_keys(RAINFOREST_WORLD)).toEqual([])
  })
})
