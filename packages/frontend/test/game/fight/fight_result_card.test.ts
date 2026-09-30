// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  result_participant_shows_progress,
  result_xp_progress,
  type FightResult,
} from '../../../src/modules/fight_result.ts'
import { fight_settlement_progress } from '../../../src/modules/fight_result_view.ts'

const settlement_result = (character_id: string, confirmed: boolean, error: string | null = null) =>
  ({
    fight: '0xf',
    own_seat: 0,
    participants: [{ character_id, forfeited: false }],
    settlement_confirmed: confirmed,
    error,
  }) as unknown as FightResult

test('the result row composes current XP and this fight gain on one progression bar', () => {
  const progress = result_xp_progress(20, 30)
  expect(progress.base_percent).toBeCloseTo(18.18, 2)
  expect(progress.gained_percent).toBeCloseTo(9.09, 2)
  expect(progress.into).toBe(30)
  expect(progress.span).toBe(110)
})

test('a level-crossing gain reports progress inside the new level instead of zero XP', () => {
  const progress = result_xp_progress(68, 136)

  expect(progress.base_percent).toBe(0)
  expect(progress.gained_percent).toBeCloseTo(4.81, 2)
  expect(progress.into).toBe(26)
  expect(progress.span).toBe(540)
})

test('only character rows own progression chrome', () => {
  expect(result_participant_shows_progress({ character_id: '0xcharacter' })).toBeTrue()
  expect(result_participant_shows_progress({ character_id: null })).toBeFalse()
})

test('multi-character settlement progress counts confirmations and identifies the failed character', () => {
  expect(
    fight_settlement_progress(
      {
        '0xc1': settlement_result('0xc1', true),
        '0xc2': settlement_result('0xc2', false, 'stale object'),
        '0xc3': { ...settlement_result('0xc3', false), fight: '0xother' },
      },
      '0xf'
    )
  ).toEqual({ completed: 1, total: 2, failed_character: '0xc2' })
})
