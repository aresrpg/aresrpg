// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// RED-FIRST for #1670 (characters tab half): the in-game Jobs drawer offered the RECIPES sub-tab to craft
// jobs only — a gathering job was hard-coerced back to its resource ladder, so the farmer's flours, the
// miner's powders and the herbalist's blends were unreachable in game even though the drawer had already
// projected them (craft_recipes_for_job on the same /v1 read). The gathering jobs craft their own
// intermediates since the 07-29 re-jobbing, so both sub-tabs are theirs.
import { describe, expect, test } from 'bun:test'

import { effective_job_tab, job_subtabs } from './job_subtabs.js'

describe('job_subtabs — which sub-tabs a job detail offers', () => {
  test('a GATHERING job offers its resource ladder AND its recipes, ladder first', () => {
    expect(job_subtabs(true)).toEqual(['resources', 'recipes'])
  })

  test('a craft job has no resource ladder — recipes only', () => {
    expect(job_subtabs(false)).toEqual(['recipes'])
  })
})

describe('effective_job_tab — the selection can never point at a tab the job does not have', () => {
  test('a gathering job KEEPS the recipes tab once picked (the #1670 coercion bug)', () => {
    expect(effective_job_tab(true, 'recipes')).toBe('recipes')
  })

  test('a craft job falls back to recipes when the stale selection is the ladder', () => {
    expect(effective_job_tab(false, 'resources')).toBe('recipes')
  })

  test('each job keeps its natural default', () => {
    expect(effective_job_tab(true, 'resources')).toBe('resources')
    expect(effective_job_tab(false, 'recipes')).toBe('recipes')
  })
})
