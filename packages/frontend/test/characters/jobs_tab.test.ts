// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { craft_required_level, job_xp_for_level } from '@aresrpg/immutable'
import { expect, test } from 'bun:test'

import { better_job_character, craft_result_tone, recipe_tiers } from '../../src/characters/JobsTab.tsx'
import { ingredient_destination, job_from_path, job_path } from '../../src/characters/job_navigation.ts'

const character = (id: string, name: string, farmer_level: number) => ({
  id,
  name,
  jobs: { FARMER: String(job_xp_for_level(farmer_level) ?? 0) },
})

test('a profession card recommends only the highest strictly better owned character', () => {
  const current = character('current', 'Sceat', 1)
  const level_six = character('six', 'Sceatzer', 6)
  const level_four = character('four', 'Crafter', 4)

  expect(better_job_character([current, level_four, level_six] as never, current.id, 'FARMER')).toEqual({
    id: level_six.id,
    name: level_six.name,
    level: 6,
  })
  expect(better_job_character([current, character('tie', 'Twin', 1)] as never, current.id, 'FARMER')).toBeNull()
})

test('the selected profession survives a character switch through the Jobs route', () => {
  expect(job_path('TAILOR')).toBe('/characters/jobs?job=TAILOR')
  expect(job_from_path('/characters/jobs?job=TAILOR')).toBe('TAILOR')
  expect(job_from_path('/characters/jobs?job=NOPE')).toBe('FARMER')
})

test('zero crafted outputs are a failure even when the transaction succeeded', () => {
  expect(craft_result_tone(0)).toBe('error')
  expect(craft_result_tone(1)).toBe('success')
})

test('recipe subsections derive their ingredient count and required job level once', () => {
  const tiers = recipe_tiers([
    { output_type: 'ring', inputs: { ore: 1, coal: 1 } },
    { output_type: 'amulet', inputs: { ore: 1, coal: 1 } },
    { output_type: 'boots', inputs: { ore: 1, coal: 1, thread: 1 } },
  ] as never)

  expect(
    tiers.map(({ ingredient_count, required_level, recipes }) => [ingredient_count, required_level, recipes.length])
  ).toEqual([
    [2, craft_required_level(2), 2],
    [3, craft_required_level(3), 1],
  ])
})

test('ingredient navigation opens intermediaries at their owning craft job and everything else in the encyclopedia', () => {
  expect(ingredient_destination('quartzbound_scrap')).toMatchObject({
    kind: 'craft',
    job: 'FORGER',
    pathname: '/characters/jobs?job=FORGER',
    selection: { item_type: 'quartzbound_scrap', recipe: { output_type: 'quartzbound_scrap' } },
  })
  expect(ingredient_destination('salvaged_scrap')).toEqual({
    kind: 'encyclopedia',
    pathname: '/encyclopedia/items/salvaged_scrap',
    job: null,
    selection: null,
  })
})

test('the narrow job detail lets long item names wrap instead of cropping them', () => {
  const styles = readFileSync(new URL('../../src/characters/jobs.css', import.meta.url), 'utf8')

  expect(styles).toContain('.jobs__item-detail [data-item-detail-name]')
  expect(styles).toContain('white-space: normal;')
  expect(styles).toContain('overflow-wrap: anywhere;')
})
