// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { job_xp_for_level } from '@aresrpg/immutable'
import { expect, test } from 'bun:test'

import job_level_up, { job_level_changes, type JobLevelUp } from '../../src/modules/job_level_up.ts'
import { initial_app_state } from '../../src/store.ts'

const character = (level: number) =>
  ({ id: '0xcharacter', name: 'Crafter', jobs: { TAILOR: String(job_xp_for_level(level) ?? 0) } }) as never

const settings = Object.freeze({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })

test('job level changes ignore login snapshots and derive every crossed level from XP truth', () => {
  expect(job_level_changes([], [character(12)])).toEqual([])
  expect(job_level_changes([character(9)], [character(12)])).toEqual([
    {
      id: '0xcharacter:TAILOR:12',
      character_id: '0xcharacter',
      character_name: 'Crafter',
      job: 'TAILOR',
      level_before: 9,
      level_after: 12,
    },
  ])
})

test('job level-up cards queue and acknowledge one at a time', () => {
  const first = job_level_changes([character(1)], [character(2)])[0]!
  const second = { ...first, id: '0xcharacter:TAILOR:3', level_before: 2, level_after: 3 } satisfies JobLevelUp
  const base = initial_app_state(settings)
  const opened = job_level_up.reduce!(base, { type: 'job_level_up/detected', level_up: first })
  const queued = job_level_up.reduce!(opened, { type: 'job_level_up/detected', level_up: second })

  expect(queued.job_level_up).toEqual({ current: first, queued: [second] })
  expect(job_level_up.reduce!(queued, { type: 'job_level_up/acknowledged' }).job_level_up).toEqual({
    current: second,
    queued: [],
  })
})
