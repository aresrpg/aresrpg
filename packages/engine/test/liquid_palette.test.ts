// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { liquid_palette } from '../src/liquid_palette.ts'
import { material_color } from '../src/world_materials.ts'

test('one authored liquid color drives surface and underwater appearance', () => {
  const blue = liquid_palette(material_color('#2e609e'))
  const red = liquid_palette(material_color('#9e2e2e'))

  expect(blue.body).not.toEqual(red.body)
  expect(blue.shallow).not.toEqual(red.shallow)
  expect(blue.up).not.toEqual(red.up)
  expect(blue.down).not.toEqual(red.down)
  expect(blue.body[2]).toBeGreaterThan(blue.body[0])
  expect(red.body[0]).toBeGreaterThan(red.body[2])
})
