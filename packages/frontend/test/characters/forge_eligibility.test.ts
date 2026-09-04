// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { has_runeforge_job_level, RUNE_UNLOCK_LEVEL } from '../../src/characters/forge_eligibility.ts'

test('every equipment profession can scribe immediately at level one', () => {
  expect(RUNE_UNLOCK_LEVEL).toBe(1)
  const categories = ['sword', 'bow', 'hat', 'belt', 'ring', 'amulet']
  categories.forEach((category) => expect(has_runeforge_job_level(category, {}, RUNE_UNLOCK_LEVEL)).toBeTrue())
})

test('a category without a craft profession is never forgeable', () => {
  expect(has_runeforge_job_level('pet', {}, RUNE_UNLOCK_LEVEL)).toBeFalse()
})
