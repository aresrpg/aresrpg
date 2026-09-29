// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { compile_materials, validate_materials } from '../src/world_materials.ts'

test('emission is optional, bounded and preserved for every use of a material', () => {
  const materials = {
    lamp: { color: '#ffd080', preset: 'sand' as const, emission: 3 },
    stone: { color: '#8899aa', preset: 'stone' as const },
  }
  expect(validate_materials(materials)).toEqual([])
  const compiled = compile_materials(materials, [
    { name: 'lamp', role: 'surface' },
    { name: 'lamp', role: 'filler' },
  ])
  expect(compiled.entries.filter((entry) => entry.name === 'lamp').map((entry) => entry.emission)).toEqual([3, 3])
  expect(compiled.entries[compiled.id_for('stone')]!.emission).toBe(0)
  for (const emission of [-1, 9, Infinity, NaN, '3', null]) {
    expect(validate_materials({ lamp: { ...materials.lamp, emission } })).toEqual([
      'materials.lamp.emission must be between 0 and 8',
    ])
  }
})
