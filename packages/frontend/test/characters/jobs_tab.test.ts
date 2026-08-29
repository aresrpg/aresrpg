// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_xp_for_level } from '@aresrpg/immutable'
import { expect, test } from 'bun:test'

import { better_job_character, craft_result_tone, job_from_path, job_path } from '../../src/characters/JobsTab.tsx'

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
