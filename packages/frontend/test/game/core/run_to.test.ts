// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { run_to_input } from '../../../src/game/core/run_to.ts'

test('run-to faces the checkpoint directly and stops inside its arrival radius', () => {
  expect(run_to_input({ x: 0, z: 0 }, { x: 10, z: 0 })).toEqual({ arrived: false, yaw: -Math.PI / 2 })
  expect(run_to_input({ x: 8.5, z: 0 }, { x: 10, z: 0 }).arrived).toBeTrue()
})
