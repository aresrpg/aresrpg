// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Adapted from @MidwestGentleman's tests in https://github.com/aresrpg/aresrpg/pull/2355
import { expect, test } from 'bun:test'
import { job_max_level, job_xp_for_level } from '@aresrpg/immutable'

import { job_progress } from '../../src/characters/job_progress.ts'

test('profession progress starts at level one and tracks XP within each level', () => {
  expect(job_progress(0)).toMatchObject({ level: 1, into: 0, percent: 0 })
  const floor = job_xp_for_level(10)!
  const span = job_xp_for_level(11)! - floor
  expect(job_progress(floor + span / 2)).toEqual({ level: 10, into: span / 2, span, percent: 50 })
  expect(job_progress(job_xp_for_level(11)!)).toMatchObject({ level: 11, into: 0, percent: 0 })
})

test('maximum profession level is complete with no next-level XP requirement', () => {
  const experience = job_xp_for_level(job_max_level)!
  expect(job_progress(experience)).toEqual({ level: job_max_level, into: 0, span: 0, percent: 100 })
})
