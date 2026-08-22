// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  aggregate_result_loot,
  fight_result_available,
  fight_result_surface,
  fight_result_complete,
  merge_result_loot,
  next_fight_resolution_step,
  type FightResultState,
} from '../../src/modules/fight_result.ts'
import fight_result_module from '../../src/modules/fight_result.ts'
import { initial_app_state } from '../../src/store.ts'

test('an ended fight keeps its result and settlement behind the terminal presentation', () => {
  expect(fight_result_available({ checkpoint: { contract: { id: '0xf1' } } } as never, '0xf1')).toBeFalse()
  expect(fight_result_available({ checkpoint: null } as never, '0xf1')).toBeTrue()
  expect(fight_result_available({ checkpoint: { contract: { id: '0xf2' } } } as never, '0xf1')).toBeTrue()
})

test('level-up may cover the still-open result card', () => {
  expect(fight_result_surface({ result_open: true, level_up_open: true } as never)).toBe('result')
  expect(fight_result_surface({ result_open: false, level_up_open: true } as never)).toBe('level_up')
  expect(fight_result_surface({ result_open: false, level_up_open: false } as never)).toBeNull()
})

test('the result receipt aggregates declarations once and never shrinks when claims remove chain rows', () => {
  const declared = aggregate_result_loot([
    { item_type: 'silk', qty: 2 },
    { item_type: 'silk', qty: 3 },
    { item_type: 'fang', qty: 1 },
  ])
  expect(declared).toEqual([
    { item_type: 'silk', qty: 5 },
    { item_type: 'fang', qty: 1 },
  ])
  expect(merge_result_loot(declared, [])).toEqual(declared)
  expect(merge_result_loot(declared, [{ item_type: 'silk', qty: 2 }])).toEqual(declared)
})

test('durable recovery settles first, then claims each projected item type', () => {
  const row = {
    settled: false,
    drops: [{ item_type: 'silk', qty: 3 }],
  } as unknown as FightResultState['resolutions'][number]
  expect(next_fight_resolution_step(row)).toEqual({ type: 'settle' })
  expect(next_fight_resolution_step({ ...row, settled: true })).toEqual({ type: 'claim', item_type: 'silk' })
  expect(next_fight_resolution_step({ ...row, settled: true, drops: [] })).toBeNull()
})

test('continue waits for the server reconciliation that proves no resolution remains', () => {
  const current = {
    fight: '0xf1',
    winner: 0,
    own_seat: 0,
    resolution_synced: true,
    error: null,
    result_open: true,
    level_up_open: false,
    level_up_acknowledged: false,
    participants: [
      {
        seat: 0,
        team: 0,
        character_id: '0xc1',
        name: 'Aiden',
        level_before: 1,
        level_after: 2,
        experience_before: 20,
        experience_after: 130,
        hp: 10,
        max_hp: 10,
        dead: false,
        settled: true,
        xp_awarded: 110,
        loot: [{ item_type: 'silk', qty: 2 }],
      },
      {
        seat: 1,
        team: 1,
        character_id: '0xc2',
        name: 'Opponent',
        level_before: 1,
        level_after: 1,
        experience_before: 0,
        experience_after: 0,
        hp: 0,
        max_hp: 10,
        dead: true,
        settled: false,
        xp_awarded: 0,
        loot: [],
      },
    ],
  } as const
  const pending = { fight: '0xf1' } as FightResultState['resolutions'][number]
  expect(fight_result_complete({ current, resolutions: [pending] })).toBe(false)
  expect(fight_result_complete({ current, resolutions: [] })).toBe(true)
})

test('an empty durable-resolution snapshot proves the own settlement completed', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const current = {
    fight: '0xf1',
    winner: 0,
    own_seat: 0,
    resolution_synced: false,
    error: null,
    result_open: true,
    level_up_open: false,
    level_up_acknowledged: false,
    participants: [
      {
        seat: 0,
        team: 0,
        character_id: '0xc1',
        name: 'Aiden',
        level_before: 1,
        level_after: 1,
        experience_before: 0,
        experience_after: 0,
        hp: 10,
        max_hp: 10,
        dead: false,
        settled: false,
        xp_awarded: 0,
        loot: [],
      },
    ],
  } as const
  const state = fight_result_module.reduce!(
    { ...base, fight_result: { current, resolutions: [] } },
    { type: 'server/packet', packet: { type: 'packet/fight_resolutions', resolutions: [] } }
  )
  expect(state.fight_result.current?.participants[0]?.settled).toBeTrue()
  expect(fight_result_complete(state.fight_result)).toBeTrue()
})

test('acknowledging the level-up reveals the still-open fight result underneath', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const current = {
    fight: '0xf1',
    winner: 0,
    own_seat: 0,
    resolution_synced: true,
    error: null,
    result_open: true,
    level_up_open: true,
    level_up_acknowledged: false,
    participants: [],
  } as unknown as NonNullable<FightResultState['current']>
  const state = fight_result_module.reduce!(
    { ...base, fight_result: { current, resolutions: [] } },
    { type: 'fight_result/level_acknowledged' }
  )

  expect(state.fight_result.current).toMatchObject({
    result_open: true,
    level_up_open: false,
    level_up_acknowledged: true,
  })
})
