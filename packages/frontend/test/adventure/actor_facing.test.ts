// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import source from '../../../../seed/content/adventure.json'
import { adventure_actor_facing } from '../../src/adventure/actor_facing.ts'
import { adventure_companion } from '../../src/adventure/character.ts'

const speaking = { dialogue: 1, companion: null }
test('speaking Sceat faces the listener on either side of the bridge', () => {
  expect(adventure_actor_facing(speaking, source.companion.id, [0, 80, 0], [0, 80, -5], 0)).toBe(Math.PI)
  expect(adventure_actor_facing(speaking, source.companion.id, [0, 80, 0], [5, 80, 0], 0)).toBe(Math.PI / 2)
  expect(adventure_actor_facing(speaking, source.companion.id, [0, 80, 0], [-5, 80, 0], 0)).toBe(-Math.PI / 2)
})
test('unstarted dialogue, other actors, missing listeners and recruitment preserve ordinary facing', () => {
  for (const state of [
    { ...speaking, dialogue: null },
    { ...speaking, companion: adventure_companion() },
  ])
    expect(adventure_actor_facing(state, source.companion.id, [0, 0, 0], [3, 0, 2], 0.4)).toBe(0.4)
  expect(adventure_actor_facing(speaking, 'hero', [0, 0, 0], [3, 0, 2], 0.4)).toBe(0.4)
  expect(adventure_actor_facing(speaking, source.companion.id, [0, 0, 0], undefined, 0.4)).toBe(0.4)
  expect(adventure_actor_facing(speaking, source.companion.id, [0, 0, 0], [0, 0, 0], 0.4)).toBe(0.4)
})
