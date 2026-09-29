// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { create_character_controller } from '../../../src/game/core/character.ts'

test('shallow wading detects wet feet without putting the head into swimming state', () => {
  const character = create_character_controller({
    position: [0.5, 0, 0.5],
    solid_at: (_x, y) => y < 0,
    liquid_at: (_x, y) => y >= 0 && y < 1,
  })
  character.tick(1 / 30)
  expect(character.get_transform()).toMatchObject({
    on_ground: true,
    in_water: false,
    feet_in_water: true,
    water_entered: false,
  })
  character.dispose()
})

test('a falling water entry survives physics substeps and fires once, never on a teleport', () => {
  const character = create_character_controller({
    position: [0.5, 5, 0.5],
    solid_at: (_x, y) => y < 0,
    liquid_at: (_x, y) => y >= 0 && y < 2,
  })
  let entries = 0
  for (let i = 0; i < 60; i++) {
    character.tick(1 / 30)
    if (character.get_transform().water_entered) entries += 1
  }
  expect(entries).toBe(1)
  character.teleport([0.5, 0, 0.5])
  character.tick(1 / 30)
  expect(character.get_transform().water_entered).toBe(false)
  character.tick(0)
  expect(character.get_transform().water_entered).toBe(false)
  character.dispose()
})

test('walking into shallow water changes foot contact without playing the airborne entry splash', () => {
  const character = create_character_controller({
    position: [0.5, 0, 0.5],
    solid_at: (_x, y) => y < 0,
    liquid_at: (_x, y, z) => z < -1 && y >= 0 && y < 1,
  })
  character.set_input({ forward: 1 })
  for (let i = 0; i < 60; i++) {
    character.tick(1 / 60)
    expect(character.get_transform().water_entered).toBe(false)
  }
  expect(character.get_transform().feet_in_water).toBe(true)
  character.dispose()
})
