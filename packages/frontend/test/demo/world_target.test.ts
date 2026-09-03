// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { demo_world_coordinate } from '../../src/demo/world_target.ts'

test('the world lab accepts an exact engine coordinate without confusing a city slug', () => {
  expect(demo_world_coordinate('2322,-2014')).toEqual([2322, -2014])
  expect(demo_world_coordinate('the_ruins')).toBeNull()
  expect(demo_world_coordinate('1,2,3')).toBeNull()
})
