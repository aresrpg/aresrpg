// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { create_character_source, create_fight } from '@aresrpg/fight'
import { describe, expect, test } from 'bun:test'

import { select_fight_view } from '../../../src/game/fight/fight_projection.ts'

const source = create_character_source({ classe: 'senshi', level: 1n })

const started_checkpoint = () => {
  const fight = create_fight({
    mode: 'local',
    seed: 7n,
    setup: {
      board_seed: 7n,
      players: [
        { character: 'mine_a', owner: 'mine', team: 0n, ready: true, hp: 55n, source },
        { character: 'mine_b', owner: 'mine', team: 0n, ready: true, hp: 55n, source },
        { character: 'theirs', owner: 'other', team: 1n, ready: true, hp: 55n, source },
      ],
      mobs: [],
    },
  })
  return fight.apply({ type: 'start', observed_ms: 1_000n }).state
}

describe('generic fight view', () => {
  test('selects the next living owned fighter from the canonical queue', () => {
    const checkpoint = started_checkpoint()
    const first = select_fight_view({ checkpoint, mode: 'local', owner: 'mine', names: {} })
    expect(first.selected?.character_id).toBe('mine_a')
    expect(first.can_end_turn).toBeTrue()

    const other_turn = structuredClone(checkpoint)
    other_turn.contract.turn_ptr = 1n
    const next = select_fight_view({ checkpoint: other_turn, mode: 'local', owner: 'mine', names: {} })
    expect(next.active_seat).toBe(2n)
    expect(next.selected?.character_id).toBe('mine_b')
    expect(next.can_end_turn).toBeFalse()
  })

  test('derives the remote placement deadline from the generated Move constant only', () => {
    const checkpoint = started_checkpoint()
    checkpoint.contract.round = 0n
    checkpoint.contract.queue = []
    checkpoint.contract.placement_ms = 12_345n

    expect(select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} }).placement_deadline_ms).toBe(
      72_345n
    )
    expect(select_fight_view({ checkpoint, mode: 'local', owner: 'mine', names: {} }).placement_deadline_ms).toBeNull()
  })
})
