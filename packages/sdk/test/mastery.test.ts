// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { mastery_id, mastery_row_from_event } from '../src/mastery.ts'

test('mastery identity is deterministic per registry and address', () => {
  const registry = `0x${'11'.repeat(32)}`
  const type_package = `0x${'22'.repeat(32)}`
  const owner = `0x${'33'.repeat(32)}`
  expect(mastery_id(registry, type_package, owner)).toBe(mastery_id(registry, type_package, owner))
  expect(mastery_id(registry, type_package, owner)).not.toBe(mastery_id(registry, type_package, `0x${'44'.repeat(32)}`))
})

test('one receipt event decodes the complete mastery row', () => {
  expect(
    mastery_row_from_event({
      mastery: '0x1',
      owner: '0xa',
      points: '7',
      last_completed_epoch: '8',
      quest_epoch: '9',
      quest_started_ms: '100',
      quest_world: 'nauvis',
      quest_dungeon: '0xd',
      quest_reward: 2,
      quest_completed: false,
    })
  ).toEqual({
    id: `0x${'0'.repeat(63)}1`,
    owner: `0x${'0'.repeat(63)}a`,
    points: '7',
    last_completed_epoch: '8',
    quest_epoch: '9',
    quest_started_ms: '100',
    quest_world: 'nauvis',
    quest_dungeon: `0x${'0'.repeat(63)}d`,
    quest_reward: 2,
    quest_completed: false,
  })
})

test('mastery receipt decoding rejects coercible garbage', () => {
  expect(() =>
    mastery_row_from_event({
      mastery: '0x1',
      owner: '0xa',
      points: undefined,
      last_completed_epoch: null,
      quest_epoch: '9',
      quest_started_ms: '100',
      quest_world: 'nauvis',
      quest_dungeon: '0xd',
      quest_reward: 'not-a-number',
      quest_completed: 0,
    })
  ).toThrow(/field points is invalid/u)
})
