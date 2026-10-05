// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { analytics_events } from '../../src/modules/analytics.ts'
import { analytics_properties } from '../../src/analytics.ts'
import { initial_app_state, reduce_app_state } from '../../src/store.ts'

test('crafting attempts and net gas describe the current journey step without transaction or character IDs', () => {
  const base = initial_app_state({ quality: 'medium', music_enabled: true, render_distance: null })
  const before = {
    ...base,
    journey: { ...base.journey, ready: true, completed: ['welcome', 'map_travel', 'first_hunt', 'hoe_materials'] },
  }
  const action = {
    type: 'character/crafted',
    digest: 'secret-digest',
    character_id: 'secret-character',
    output_type: 'old_hoe',
    job: 'HANDYMAN',
    xp: 10,
    attempts: 1,
    successes: 0,
  } as const
  const after = reduce_app_state(before, action)
  expect(analytics_events(after, before)).toEqual([
    {
      name: 'craft_completed',
      properties: {
        output_type: 'old_hoe',
        attempts: 1,
        successes: 0,
        journey_step: 'first_craft',
      },
    },
  ])
  expect(analytics_events(reduce_app_state(after, action), after)).toEqual([])
  const transaction = { ...after, analytics: { digest: 'private', outcome: 'success' as const, gas_mist: '-10000' } }
  const [event] = analytics_events(transaction, after)
  expect(event).toEqual({
    name: 'transaction_executed',
    properties: { outcome: 'success', gas_mist: '-10000', journey_step: 'first_craft' },
  })
  expect(analytics_properties({ ...event!.properties, digest: 'private' })).toEqual(event!.properties!)
})
