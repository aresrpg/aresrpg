// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { job_xp_for_level } from '@aresrpg/immutable'

import { has_runeforge_job_level, RUNE_UNLOCK_LEVEL } from '../../src/characters/forge_eligibility.ts'

const LEVEL_70_XP = String(job_xp_for_level(70))

test('a level-70 Tailor can runeforge hats but not Tanner belts', () => {
  const jobs = Object.freeze({ TAILOR: LEVEL_70_XP })

  expect(has_runeforge_job_level('hat', jobs, 70)).toBeTrue()
  expect(has_runeforge_job_level('belt', jobs, 70)).toBeFalse()
  expect(has_runeforge_job_level('belt', { ...jobs, TANNER: LEVEL_70_XP }, 70)).toBeTrue()
})

test('every equipment family requires its own level-70 craft job', () => {
  const families = Object.freeze([
    ['FORGER', ['sword', 'daggers', 'axe']],
    ['CARVER', ['bow', 'spear']],
    ['TAILOR', ['hat', 'cloak']],
    ['TANNER', ['belt', 'boots']],
    ['JEWELER', ['ring', 'amulet']],
  ] as const)

  families.forEach(([job, categories], index) => {
    const jobs = Object.freeze({ [job]: LEVEL_70_XP })
    categories.forEach((category) => expect(has_runeforge_job_level(category, jobs, 70)).toBeTrue())
    const [, [foreign]] = families[(index + 1) % families.length]!
    expect(has_runeforge_job_level(foreign, jobs, 70)).toBeFalse()
  })
})

test('the frontend workbench requires its matching craft job at level 70', () => {
  expect(RUNE_UNLOCK_LEVEL).toBe(70)
  expect(has_runeforge_job_level('belt', {}, RUNE_UNLOCK_LEVEL)).toBeFalse()
  expect(has_runeforge_job_level('belt', { TANNER: LEVEL_70_XP }, RUNE_UNLOCK_LEVEL)).toBeTrue()
})
