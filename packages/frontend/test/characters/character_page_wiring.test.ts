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
  const forge_eligibility = source('forge_eligibility.ts')

  for (const tab of ['stats', 'spells', 'jobs', 'runeforge']) expect(page).toContain(`tab === '${tab}'`)

  expect(stats).toContain('.raise_stats(')
  expect(stats).toContain("type: 'character/stats_raised'")
  expect(spells).toContain('.raise_spell(')
  expect(spells).toContain("type: 'character/spell_raised'")
  expect(jobs).toContain('.craft(')
  expect(jobs).toContain('.merge_many(')
  expect(jobs.match(/retry_after_version_race/g)?.length).toBe(3)
  expect(jobs).toContain("type: 'inventory/stacks_merged'")
  expect(jobs).toContain("type: 'character/crafted'")
  expect(jobs).toContain("t('jobs.craft.starting_chance')")
  expect(jobs).toContain('onClick={() => open_ingredient(item_type)}')
  expect(jobs).toContain('open_ingredient={open_ingredient}')
  expect(forge).toContain('.scribe_rune(')
  expect(forge).toContain("type: 'runeforge/scribed'")
  expect(forge.match(/set_rune_id\(null\)/g)?.length).toBe(1)
  expect(forge).toContain('history_by_gear')
  expect(forge).toContain('RUNE_UNLOCK_LEVEL')
  expect(forge_eligibility).toContain('CONTRACT_CONSTANTS.rune_unlock_level')
  expect(forge).not.toContain('const RUNE_UNLOCK_LEVEL')
})

test('character detail tabs have stable deep links for level-up allocation', () => {
  expect(character_detail_tab('/characters/stats')).toBe('stats')
  expect(character_detail_tab('/characters/nope')).toBe('equipment')
  expect(character_detail_path('stats')).toBe('/characters/stats')
})

test('short and narrow screens scroll the whole stats sheet instead of clipping its pinned regions', () => {
  const styles = source('stats_panels.css')

  expect(styles).toContain('@media (max-height: 800px), (max-width: 700px)')
  expect(styles).toContain('overflow-y: auto;')
  expect(styles).toContain('overscroll-behavior: contain;')
  expect(styles).toContain('grid-template-columns: repeat(2, 1fr);')
})
