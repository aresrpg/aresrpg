// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// The graph → wire decode seam: job-slug casing (graph.rs lowercases, the shared vocabulary is
// UPPERCASE), stat blocks as named records in the canonical field order, damages parsed from
// their JSON-string storage form.

import { describe, expect, test } from 'bun:test'
import { ITEM_STAT_FIELDS } from '@aresrpg/fight/move_contract'

import { shape_character } from '../src/reads/get_characters.ts'
import { shape_item, stats_record_of } from '../src/reads/stat_block.ts'
import { get_fight_resolutions } from '../src/reads/get_fight_resolutions.ts'

describe('shape_character', () => {
  test('job keys are restored to the shared UPPERCASE vocabulary', () => {
    const shaped = shape_character({ id: '0xchar', job_sword_smith: '1200', job_farmer: '80' })
    expect(shaped.jobs).toEqual({ SWORD_SMITH: '1200', FARMER: '80' })
  })

  test('decodes a fired protector verdict from the graph JSON property', () => {
    expect(
      shape_character({
        id: '0xchar',
        ambush: '{"protector":"protector_quartz","x":4,"z":7,"scalar":22,"board_seed":"9","hp":"30"}',
      }).ambush
    ).toEqual({ protector: 'protector_quartz', x: 4, z: 7, scalar: 22, board_seed: '9', hp: '30' })
  })

  test('folded_stats becomes a named record; spells parse from their JSON string', () => {
    const folded = ITEM_STAT_FIELDS.map((_, index) => 32_768 + index)
    const shaped = shape_character({ id: '0xchar', folded_stats: folded, spells: '{"ember":3}' })
    expect(shaped.folded_stats).toEqual(
      Object.fromEntries(ITEM_STAT_FIELDS.map((field, index) => [field, 32_768 + index]))
    )
    expect(shaped.spells).toEqual({ ember: 3 })
  })
})

describe('shape_item', () => {
  test('stats array → record, damages JSON string → rows; absent DFs stay absent', () => {
    const stats = ITEM_STAT_FIELDS.map(() => 32_768)
    const damages = JSON.stringify([{ from: 3, to: 7, damage_type: 'damage', element: 'fire' }])
    const shaped = shape_item({ id: '0xitem', stats, damages })
    expect((shaped as { stats: Record<string, number> }).stats.vitality).toBe(32_768)
    expect((shaped as { damages: unknown[] }).damages).toEqual([
      { from: 3, to: 7, damage_type: 'damage', element: 'fire' },
    ])
    expect(shape_item({ id: '0xbare' })).toEqual({ id: '0xbare' })
  })
})

describe('stats_record_of', () => {
  test('a misshapen block yields the empty record instead of a corrupt one', () => {
    expect(stats_record_of([1, 2, 3])).toEqual({})
    expect(stats_record_of(undefined)).toEqual({})
  })
})

test('RESULT_FOR rows preserve the exact stranded loot needed after reconnect', async () => {
  const graph = {
    read: async () => [
      {
        fight: '0xf1',
        winner: 0,
        fighter: 2,
        character: '0xc1',
        team: 0,
        dead: false,
        settled: true,
        drops: '[{"item_type":"silk","qty":3}]',
        level: 3,
        experience: '271',
      },
    ],
    close: async () => undefined,
  }
  expect(await get_fight_resolutions(graph, { address: '0xme' })).toEqual([
    {
      fight: '0xf1',
      winner: 0,
      fighter: 2,
      character: '0xc1',
      team: 0,
      dead: false,
      settled: true,
      drops: [{ item_type: 'silk', qty: 3 }],
      level: 3,
      experience: '271',
    },
  ])
})
