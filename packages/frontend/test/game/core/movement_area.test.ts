// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_character_controller } from '../../../src/game/core/character.ts'

test('the movement area blocks running and jumping at every height until released', () => {
  const character = create_character_controller({
    solid_at: (_x, y) => y < 0,
    liquid_at: () => false,
    position: [0, 0, 0],
  })
  character.set_movement_area((x, z) => Math.abs(x) < 2 && Math.abs(z) < 2)
  character.set_input({ forward: 1, jump: true })
  for (let step = 0; step < 180; step += 1) {
    character.tick(1 / 60)
    const [x, , z] = character.get_transform().position
    expect(Math.abs(x)).toBeLessThan(2)
    expect(Math.abs(z)).toBeLessThan(2)
  }
  character.set_movement_area(null)
  for (let step = 0; step < 120; step += 1) character.tick(1 / 60)
  expect(Math.abs(character.get_transform().position[2])).toBeGreaterThan(3)
  character.dispose()
})
