// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_character_controller } from '../../../src/game/core/character.ts'

const character_at_origin = () =>
  create_character_controller({
    solid_at: (_x, y) => y < 0,
    liquid_at: () => false,
    position: [0, 0, 0],
  })

test('a nearby anchor applies immediately to physics without a rendered jump', () => {
  const character = character_at_origin()
  character.teleport([1, 0, 0], { smooth: true })
  expect(character.get_transform().position).toEqual([1, 0, 0])
  expect(character.get_transform().visual_position).toEqual([0, 0, 0])
  character.tick(0.09)
  expect(character.get_transform().visual_position[0]).toBeCloseTo(0.5)
  expect(character.get_transform().position[0]).toBe(1)
  character.tick(0.09)
  expect(character.get_transform().visual_position[0]).toBe(1)
})

test('a repeated anchor keeps the current visual position and settles', () => {
  const character = character_at_origin()
  character.teleport([1, 0, 0], { smooth: true })
  character.tick(0.09)
  const before = character.get_transform().visual_position
  character.teleport([1, 0, 0], { smooth: true })
  expect(character.get_transform().visual_position).toEqual(before)
  character.tick(0.2)
  expect(character.get_transform().visual_position[0]).toBe(1)
})

test('large corrections and explicit teleports never glide through the world', () => {
  const character = character_at_origin()
  character.teleport([1.01, 0, 0], { smooth: true })
  expect(character.get_transform().visual_position).toEqual([1.01, 0, 0])
  character.teleport([1.5, 0, 0])
  expect(character.get_transform().visual_position).toEqual([1.5, 0, 0])
})
