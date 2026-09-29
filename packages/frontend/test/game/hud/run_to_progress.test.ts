// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { selected_position_run } from '../../../src/game/hud/RunToProgress.tsx'
import { run_to_distance, run_to_progress_percent } from '../../../src/modules/run_to.ts'
import { run_to_remaining_seconds } from '../../../src/game/core/run_to.ts'

test('arrival estimate follows running and mounted speed from remaining route length', () => {
  expect(run_to_remaining_seconds(315, false)).toBe(30)
  expect(run_to_remaining_seconds(315, true)).toBe(20)
  expect(run_to_remaining_seconds(2, false)).toBe(1)
  expect(run_to_remaining_seconds(0, true)).toBe(0)
})

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

test('route distances cannot leak across target or character changes', () => {
  const run = {
    status: 'running',
    source: 'position',
    controlled_character_id: 'hero',
    name: '',
    world: 'nauvis',
    x: 50100,
    z: 50200,
  } as const
  const pose = { character_id: 'hero', route: { x: 100, z: 200, remaining: 42 } } as never
  expect(run_to_distance(run, pose)).toBe(42)
  expect(run_to_distance({ ...run, x: 50101 }, pose)).toBeNull()
  expect(run_to_distance({ ...run, controlled_character_id: 'other' }, pose)).toBeNull()
})
