// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { job_groups, job_max_level, job_xp_for_level } from '@aresrpg/immutable'

import { crafter_note, job_progress, skill_groups } from '../../src/characters/skill_rows.ts'

const member = (id: string, jobs: Record<string, string>) => ({ id, name: id, jobs })

test('job progress reports the level and the share of the next level', () => {
  const floor = job_xp_for_level(10)!
  const ceiling = job_xp_for_level(11)!
  const half = job_progress(floor + (ceiling - floor) / 2)
  expect(half.level).toBe(10)
  expect(half.span).toBe(ceiling - floor)
  expect(half.percent).toBe(50)
  expect(job_progress(0).level).toBe(1)
})

test('job progress is full with no span at the max level', () => {
  const max = job_progress(job_xp_for_level(job_max_level)!)
  expect(max.level).toBe(job_max_level)
  expect(max.span).toBe(0)
  expect(max.percent).toBe(100)
})

test("skill groups cover every job once in category order with the character's own levels", () => {
  const groups = skill_groups(member('alt', { MINER: String(job_xp_for_level(5)) }))
  expect(groups.flatMap(({ jobs }) => jobs.map(({ job }) => job))).toEqual(Object.values(job_groups).flat())
  const levels = Object.fromEntries(
    groups.flatMap(({ jobs }) => jobs.map(({ job, progress }) => [job, progress.level]))
  )
  expect(levels.MINER).toBe(5)
  expect(levels.FARMER).toBe(1)
})

test('the crafter note follows the craft lock and ignores a crafter outside the roster', () => {
  const roster = [member('lead', {}), member('alt', {})]
  expect(crafter_note('lead', 'lead', roster)).toEqual({ key: 'crafter_self', crafter: 'lead' })
  expect(crafter_note('alt', 'lead', roster)).toEqual({ key: 'crafter_other', crafter: 'lead' })
  expect(crafter_note('alt', 'gone', roster)).toBeNull()
  expect(crafter_note('alt', null, roster)).toBeNull()
})
