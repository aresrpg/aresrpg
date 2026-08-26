// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { compact_xp, result_participant_shows_progress, result_xp_progress } from '../../../src/modules/fight_result.ts'

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

test('large XP values stay compact enough for max-content columns', () => {
  expect(compact_xp(20_500)).toBe('20.5k')
  expect(compact_xp(20_000)).toBe('20k')
  expect(compact_xp(1_250_000)).toBe('1.3m')
})

test('the result card has no you badge or hp bar and keeps larger loot on one row', () => {
  const component = readFileSync(new URL('../../../src/game/fight/FightResultCard.tsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../../../src/game/fight/fight_result.css', import.meta.url), 'utf8')
  expect(component).not.toContain('result_you')
  expect(component).not.toContain('fe-hp')
  expect(component).toContain('left: `${base_percent}%`')
  expect(component).toContain('rad-rays')
  expect(component).toContain("'level_up_allocate'")
  expect(component).toContain("'level_up_later'")
  expect(component).toContain("pathname: '/characters/stats'")
  expect(component).toContain("type: 'character/select'")
  expect(component).toContain('level_up_stat_points')
  expect(component).toContain('item_icon(loot.item_type)')
  expect(component).not.toContain('item_detail_icon')
  expect(component).toContain("'result_duration'")
  expect(component).toContain("'result_gas_spent'")
  expect(component).toContain("'result_close'")
  expect(component).toContain('result.gas_spent_mist, 3)')
  expect(css).toContain('.result.result--fe > :not(.rad-crn)')
  expect(css).toContain('62% {\n    opacity: 1;\n    transform: scale(1.06);')
  expect(css).toContain('transform: translate(calc(-50% + var(--x)), calc(-50% + var(--y))) rotate(45deg) scale(1);')
  expect(css).toContain('opacity: 1 !important;')
  expect(css).toContain('width: min(980px, 96vw)')
  expect(css).toContain('grid-template-columns: repeat(auto-fit')
  expect(css).toContain('grid-template-columns: minmax(90px, 0.8fr)')
  expect(css).toContain('flex-wrap: nowrap')
  expect(css).toContain('width: 42px')
  expect(css).toContain('text-overflow: ellipsis')
  expect(css).toContain('rgba(4, 5, 8, 0.48)')
})
