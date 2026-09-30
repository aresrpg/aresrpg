// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { world_center } from '@aresrpg/immutable'

import { party_frame_visible, party_run_available, party_run_distance } from '../../src/components/PartyFrame.tsx'

test('owned character candidates do not impersonate a created party', () => {
  expect(party_frame_visible(null, null)).toBeFalse()
  expect(party_frame_visible({ id: '0xp' } as never, null)).toBeTrue()
  expect(party_frame_visible({ id: '0xp' } as never, 'leave')).toBeFalse()
})

test('the active external run target reuses distance progress in green', () => {
  const run = {
    status: 'running',
    source: 'character',
    controlled_character_id: '0xa',
    target_character_id: '0xc',
    name: 'Cyr',
    world: 'nauvis',
    x: world_center + 12,
    z: world_center + 5,
  } as const
  const pose = { character_id: '0xa', x: 0, y: 0, z: 0, route: { x: 12, z: 5, remaining: 13 } } as never
  expect(party_run_distance(run, pose, '0xc')).toBe(13)
  expect(party_run_distance(run, pose, '0xb')).toBeNull()
})

test('only external party members open the shared player menu for run-to', () => {
  const owned = [{ id: '0xa' }, { id: '0xb' }]
  expect(party_run_available(owned, '0xa')).toBeFalse()
  expect(party_run_available(owned, '0xc')).toBeTrue()
})
