// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Unit proof for the JOB level-up transition detector + slice fold (job_progression.js). Feeds synthetic
// per-job xp maps (the `character.jobs` shape the roster projects) and asserts a card fires ONLY on a real
// job level crossing. Pure — no mocks (the detector core takes plain maps in; the observe wiring is a thin
// STATE_UPDATED loop over this same helper).

import { describe, expect, test } from 'bun:test'
import { job_level } from '@aresrpg/sdk/jobs'

import { detect_job_level_ups, fold_job_level_up } from './job_progression.js'

// Sanity-anchor the SSOT curve thresholds the assertions below rely on (JobExperience table).
describe('SDK job curve anchors (the thresholds the detector crosses)', () => {
  test('level 1 at 0 xp, level 2 at 50, level 3 at 140, level 10 at 1911', () => {
    expect(job_level(0)).toBe(1)
    expect(job_level(50)).toBe(2)
    expect(job_level(139)).toBe(2)
    expect(job_level(140)).toBe(3)
    expect(job_level(1911)).toBe(10)
  })
})

describe('detect_job_level_ups — fires only on a real level crossing', () => {
  test('an xp gain that crosses a level → one up with the new level + levels gained', () => {
    expect(detect_job_level_ups({ miner: 0 }, { miner: 50 })).toEqual([
      { job_id: 'miner', level: 2, levels_gained: 1 },
    ])
  })

  test('an xp gain WITHIN the same level → nothing (a +XP toast is player_experience domain, not a card)', () => {
    expect(detect_job_level_ups({ miner: 50 }, { miner: 139 })).toEqual([])
  })

  test('no xp change → nothing', () => {
    expect(detect_job_level_ups({ miner: 50 }, { miner: 50 })).toEqual([])
  })

  test('a first-ever grant for a job (absent prior = 0 xp) crossing many levels reports the full jump', () => {
    expect(detect_job_level_ups({}, { farmer: 1911 })).toEqual([
      { job_id: 'farmer', level: 10, levels_gained: 9 },
    ])
  })

  test('only the job that actually gained fires — untouched jobs stay silent', () => {
    expect(detect_job_level_ups({ miner: 0, farmer: 0 }, { miner: 50, farmer: 0 })).toEqual([
      { job_id: 'miner', level: 2, levels_gained: 1 },
    ])
  })

  test('a single-level step at a higher boundary (139→140 = level 2→3)', () => {
    expect(detect_job_level_ups({ miner: 139 }, { miner: 140 })).toEqual([
      { job_id: 'miner', level: 3, levels_gained: 1 },
    ])
  })

  test('tolerates undefined maps (transient roster states)', () => {
    expect(detect_job_level_ups(undefined, undefined)).toEqual([])
    expect(detect_job_level_ups(null, { miner: 0 })).toEqual([])
  })
})

describe('fold_job_level_up — the slice reducer', () => {
  test('open sets the slice (a fresh celebration always wins the card)', () => {
    expect(fold_job_level_up(null, 'action/job_level_up/open', { job_id: 'miner', level: 5, levels_gained: 2 })).toEqual({
      job_id: 'miner',
      level: 5,
      levels_gained: 2,
    })
  })

  test('close clears it', () => {
    const slice = { job_id: 'miner', level: 5, levels_gained: 2 }
    expect(fold_job_level_up(slice, 'action/job_level_up/close', {})).toBeNull()
  })

  test('an unrelated action leaves the slice untouched', () => {
    const slice = { job_id: 'miner', level: 5, levels_gained: 2 }
    expect(fold_job_level_up(slice, 'action/something_else', {})).toBe(slice)
  })
})
