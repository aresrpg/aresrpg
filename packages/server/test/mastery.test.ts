// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { get_mastery } from '../src/reads/get_mastery.ts'

test('the reconnect snapshot joins address mastery with live offer costs', async () => {
  const snapshot = await get_mastery(
    {
      read: async () => [
        {
          user: {
            properties: {
              mastery_id: '0xm',
              mastery_points: '7',
              mastery_last_completed_epoch: '8',
              mastery_quest_epoch: '9',
              mastery_quest_started_ms: '100',
              mastery_quest_world: 'nauvis',
              mastery_quest_dungeon: '0xd',
              mastery_quest_reward: 2,
              mastery_quest_completed: false,
            },
          },
          offers: [{ properties: { id: '0xo', item_type: 'box', template: '0xt', cost: '5', enabled: true } }],
        },
      ],
      close: async () => undefined,
    },
    { address: '0xa' }
  )

  expect(snapshot.mastery?.quest_started_ms).toBe('100')
  expect(snapshot.offers).toEqual([{ id: '0xo', item_type: 'box', template: '0xt', cost: '5', enabled: true }])
})
