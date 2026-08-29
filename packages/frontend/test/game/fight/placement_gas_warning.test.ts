// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { placement_click_decision } from '../../../src/game/fight/PlacementGasWarning.tsx'
import { fight_environment } from '../../../src/modules/fight.ts'
import { initial_app_state, reduce_app_state } from '../../../src/store.ts'

test('the first placement change submits, the second warns, and the saved opt-out submits', () => {
  expect(placement_click_decision(false, false)).toBe('submit')
  expect(placement_click_decision(true, false)).toBe('warn')
  expect(placement_click_decision(true, true)).toBe('submit')
})

test('a remote placement attempt remains remembered when the fight layer remounts', () => {
  const state = initial_app_state({
    quality: 'medium',
    flat_mode: false,
    music_enabled: true,
    render_distance: null,
  })
  const placed = reduce_app_state(state, {
    type: 'fight/input',
    fight: '0xfight',
    origin: 'local',
    input: { type: 'place', fighter: 2n, cell: 4n },
  })
  expect(fight_environment(placed.fight, '0xfight').placement_changed_seats).toEqual({ 2: true })
})
