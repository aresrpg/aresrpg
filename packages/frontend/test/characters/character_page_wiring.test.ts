// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { expect, test } from 'bun:test'

import { character_detail_path, character_detail_tab } from '../../src/characters/CharactersPage.tsx'

const source = (name: string): string => readFileSync(new URL(`../../src/characters/${name}`, import.meta.url), 'utf8')

test('every character progression tab crosses the wallet action and proven receipt fold boundary', () => {
  const page = source('CharactersPage.tsx')
  const stats = source('StatsTab.tsx')
  const spells = source('SpellsTab.tsx')
  const jobs = source('JobsTab.tsx')
  const forge = source('RuneforgeTab.tsx')

  for (const tab of ['stats', 'spells', 'jobs', 'runeforge']) expect(page).toContain(`tab === '${tab}'`)

  expect(stats).toContain('.raise_stats(')
  expect(stats).toContain("type: 'character/stats_raised'")
  expect(spells).toContain('.raise_spell(')
  expect(spells).toContain("type: 'character/spell_raised'")
  expect(jobs).toContain('.craft(')
  expect(jobs).toContain("type: 'character/crafted'")
  expect(forge).toContain('.scribe_rune(')
  expect(forge).toContain("type: 'character/rune_scribed'")
  expect(forge).toContain('CONTRACT_CONSTANTS.rune_unlock_level')
  expect(forge).not.toContain('const RUNE_UNLOCK_LEVEL')
})

test('character detail tabs have stable deep links for level-up allocation', () => {
  expect(character_detail_tab('/characters/stats')).toBe('stats')
  expect(character_detail_tab('/characters/nope')).toBe('equipment')
  expect(character_detail_path('stats')).toBe('/characters/stats')
})
