// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_character_source, create_fight_state } from '@aresrpg/fight'
import { expect, test } from 'bun:test'

import { project_fight_cues } from '../../../src/game/fight/fight_cues.ts'

test('zone removal is the exact persistent-blob disappearance edge', () => {
  const source = create_character_source({ classe: 'senshi', level: 1n })
  const checkpoint = create_fight_state({
    fight_id: '0xf1',
    board_seed: 1n,
    players: [
      { character: '0xc1', owner: '0xa1', team: 0n, ready: true, hp: 50n, source },
      { character: '0xc2', owner: '0xa2', team: 1n, ready: true, hp: 50n, source },
    ],
    mobs: [],
  })
  const cues = project_fight_cues({
    checkpoint,
    batch: 5,
    events: [{ type: 'zone_removed', payload: { zone_id: 'zone:glyph', kind: 'glyph', reason: 'expired' } }],
  })

  expect(cues).toEqual([{ id: '0xf1:5:0', type: 'zone_removed', zone_id: 'zone:glyph' }])
})
