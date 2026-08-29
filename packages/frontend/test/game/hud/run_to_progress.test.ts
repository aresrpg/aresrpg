// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { selected_position_run } from '../../../src/game/hud/RunToProgress.tsx'
import { run_to_progress_percent } from '../../../src/modules/run_to.ts'

test('run-to progress advances toward the target and stays bounded', () => {
  expect(run_to_progress_percent(100, 100)).toBe(0)
  expect(run_to_progress_percent(100, 40)).toBe(60)
  expect(run_to_progress_percent(100, 0)).toBe(100)
  expect(run_to_progress_percent(100, 120)).toBe(0)
})

test('every selected-character position run owns the global compass progress bar', () => {
  const run = {
    status: 'running' as const,
    source: 'position' as const,
    controlled_character_id: '0xc',
    name: 'nauvis',
    world: 'nauvis',
    x: 50_100,
    z: 50_200,
  }
  expect(selected_position_run(run, '0xc')).toBe(run)
  expect(selected_position_run(run, '0xother')).toBeNull()
})
