// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { describe, expect, test } from 'bun:test'

import {
  generate_seed_contract,
  generate_seed_doors,
  seed_doors,
  seed_string_keys,
  SEED_CONTRACT_OUT_PATH,
  SEED_DOORS_OUT_PATH,
} from '../scripts/generate_seed_doors.mjs'

describe('seed door generation', () => {
  test('projects every public seed door plus the required value constructors', () => {
    const names = seed_doors().map(({ export_name, name }) => export_name ?? name)
    expect(names).toContain('add_item')
    expect(names).toContain('add_loot_reward')
    expect(names).toContain('freeze_forever')
    expect(names).toContain('new_item_stats')
    expect(names).toContain('new_spell_level')
    expect(new Set(names).size).toBe(names.length)
  })

  test('committed seed doors are byte-identical to Move source generation', async () => {
    expect(readFileSync(SEED_DOORS_OUT_PATH, 'utf8')).toBe(await generate_seed_doors())
  })

  test('every game-package seed door is excluded from gameplay analytics', () => {
    const source = readFileSync(new URL('../../indexer/src/pipeline.rs', import.meta.url), 'utf8')
    const start = source.indexOf('pub(crate) fn is_deployment_only_target')
    const end = source.indexOf('\n}\n\nfn game_activity_txs', start)
    const exclusions = source.slice(start, end)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const game_seed_targets = seed_doors()
      .filter(({ package_key }) => package_key === 'package')
      .map(({ module, name }) => `${module}::${name}`)
    expect(game_seed_targets).toHaveLength(7)
    for (const target of game_seed_targets) expect(exclusions).toContain(`"${target}"`)
  })

  test('derived object key descriptors are byte-identical to Move source generation', async () => {
    expect(seed_string_keys().map(({ name }) => name)).toEqual([
      'AirdropKey',
      'GiftcardKey',
      'MasteryOfferKey',
      'WorldKey',
      'CheckpointKey',
      'ItemKey',
      'MobKey',
      'SpellKey',
      'RecipeKey',
      'WorldContentKey',
      'DungeonContentKey',
    ])
    expect(readFileSync(SEED_CONTRACT_OUT_PATH, 'utf8')).toBe(await generate_seed_contract())
  })
})
