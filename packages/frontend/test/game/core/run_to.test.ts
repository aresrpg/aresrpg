// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { run_to_input, run_to_mount } from '../../../src/game/core/run_to.ts'

test('run-to faces the checkpoint directly and stops inside its arrival radius', () => {
  expect(run_to_input({ x: 0, z: 0 }, { x: 10, z: 0 })).toEqual({ arrived: false, yaw: -Math.PI / 2 })
  expect(run_to_input({ x: 8.5, z: 0 }, { x: 10, z: 0 }).arrived).toBeTrue()
})

test('automated travel mounts nearby pets, waits for followers, and stays mounted', () => {
  const following = { requested: true, available: true, riding: false, nearby: false }
  expect(run_to_mount(following)).toBe('wait')
  expect(run_to_mount({ ...following, nearby: true })).toBe('mount')
  expect(run_to_mount({ ...following, riding: true })).toBe('run')
  expect(run_to_mount({ ...following, available: false })).toBe('run')
  expect(run_to_mount({ ...following, requested: false })).toBe('run')
  // Fight presentation can clear riding; the next automation leg mounts again.
  expect(run_to_mount({ ...following, riding: false, nearby: true })).toBe('mount')
})
