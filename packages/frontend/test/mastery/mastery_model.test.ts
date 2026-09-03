// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import type { CharacterRow, MasteryRow } from '@aresrpg/protocol'

import {
  effective_mastery_points,
  mastery_reminder_visible,
  mastery_reward,
  mastery_world_witness,
} from '../../src/mastery/model.ts'

const mastery = (points: string, last_completed_epoch: string | null): MasteryRow => ({
  id: '0x1',
  owner: '0xa',
  points,
  last_completed_epoch,
  quest_epoch: '9',
  quest_started_ms: '1',
  quest_world: 'nauvis',
  quest_dungeon: '0xd',
  quest_reward: 1,
  quest_completed: false,
})

const character = (id: string, level: number, custody: 'kiosk' | 'fight' = 'kiosk'): CharacterRow =>
  ({ id, level, custody, kiosk: '0xk', equipment: [] }) as unknown as CharacterRow

describe('mastery model', () => {
  test('pins every world-entry reward boundary', () => {
    expect([1, 50, 51, 100, 101, 150, 151, 199, 200].map(mastery_reward)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5])
  })

  test('points remain spendable for the current grace epoch and expire after one miss', () => {
    expect(effective_mastery_points(mastery('7', '10'), '11')).toBe(7n)
    expect(effective_mastery_points(mastery('7', '10'), '12')).toBe(0n)
  })

  test('the strongest free eligible character becomes the invisible access witness', () => {
    const world = { world: 'yakutia', entry_level: 20, cities: [{}] } as never
    expect(
      mastery_world_witness([character('weak', 10), character('busy', 80, 'fight'), character('free', 40)], world)?.id
    ).toBe('free')
  })

  test('a character sees the daily reminder before the refreshed backend snapshot arrives', () => {
    expect(mastery_reminder_visible(1, null, null)).toBeTrue()
    expect(mastery_reminder_visible(0, null, null)).toBeFalse()
    expect(mastery_reminder_visible(1, mastery('1', '9'), '9')).toBeFalse()
  })
})
