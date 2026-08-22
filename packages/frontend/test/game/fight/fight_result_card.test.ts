// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { result_participant_shows_progress, result_xp_progress } from '../../../src/modules/fight_result.ts'

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

test('the result card has no you badge or hp bar and keeps larger loot on one row', () => {
  const component = readFileSync(new URL('../../../src/game/fight/FightResultCard.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../../src/game/fight/fight_result.css', import.meta.url), 'utf8')
  expect(component).not.toContain('result_you')
  expect(component).not.toContain('fe-hp')
  expect(component).toContain('left: `${base_percent}%`')
  expect(component).toContain('rad-rays')
  expect(component).toContain('level_up_stat_points')
  expect(css).toContain('width: min(980px, 96vw)')
  expect(css).toContain('minmax(160px, 1fr) 140px')
  expect(css).toContain('flex-wrap: nowrap')
  expect(css).toContain('width: 42px')
})
