// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import {
  create_flat_projection,
  effective_flattened,
  flat_terrain_amount,
  flat_water_visibility,
  project_height,
  set_flat_projection,
  step_flat_projection,
} from '../src/flatten.ts'

test('the terrain-less grid backend always forces the gameplay projection flat', () => {
  expect(effective_flattened(false, 'grid')).toBeTrue()
  expect(effective_flattened(false, 'webgpu')).toBeFalse()
  expect(effective_flattened(true, 'webgpu')).toBeTrue()
})

test('the flat projection reverses without resetting its progress', () => {
  let projection = set_flat_projection(create_flat_projection(), true)
  projection = step_flat_projection(projection, 0.425)
  expect(projection.amount).toBeCloseTo(0.5)

  projection = set_flat_projection(projection, false)
  projection = step_flat_projection(projection, 0.2125)
  expect(projection.amount).toBeCloseTo(0.25)
  projection = step_flat_projection(projection, 1)
  expect(projection).toEqual({ amount: 0, target: 0 })
})

test('the same amount projects every consumer onto the same height', () => {
  expect(project_height(18, 0)).toBe(18)
  expect(project_height(18, 1)).toBe(0)
})

test('water exits before terrain starts flattening', () => {
  expect(flat_water_visibility(0)).toBe(1)
  expect(flat_terrain_amount(0.2)).toBe(0)
  expect(flat_water_visibility(0.2)).toBe(0)
  expect(flat_terrain_amount(0.21)).toBeGreaterThan(0)
  expect(project_height(18, 0.2)).toBe(18)
})
