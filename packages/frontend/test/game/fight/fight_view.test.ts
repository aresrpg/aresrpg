// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { readFileSync } from 'node:fs'

import { create_character_source, create_fight } from '@aresrpg/fight'
import { describe, expect, test } from 'bun:test'

import { select_fight_view } from '../../../src/game/fight/fight_projection.ts'

const source = create_character_source({ classe: 'senshi', level: 1n, spell_levels: { slash: 1n } })
const spell_level = {
  ap_cost: 2n,
  range_min: 1n,
  range_max: 4n,
  modifiable_range: false,
  line_of_sight: false,
  line_launch: false,
  free_cell: false,
  casts_per_turn: 0n,
  casts_per_target: 0n,
  cooldown_turns: 0n,
  crit_1_in: 1n,
  effects: [
    {
      kind: 0n,
      element: 'earth',
      value: 10n,
      value_max: 20n,
      area_shape: 0n,
      area_size: 0n,
      target_filter: 0n,
      chance_bp: 10_000n,
      turns: 0n,
      stat: 0n,
    },
  ],
  crit_effects: [],
}

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
      spells: { slash: { classe: 'senshi', unlock_level: 1n, levels: [spell_level] } },
    },
  })
  return fight.apply({ type: 'start', observed_ms: 1_000n }).state
}

describe('generic fight view', () => {
  test('boots the engine through its full-resolution fight presentation', () => {
    const source = readFileSync(new URL('../../../src/game/fight/fight_view.ts', import.meta.url), 'utf8')

    expect(source).toContain("presentation: 'fight'")
  })

  test('selects the next living owned fighter from the canonical queue', () => {
    const checkpoint = started_checkpoint()
    const first = select_fight_view({ checkpoint, mode: 'local', owner: 'mine', names: {} })
    expect(first.selected?.character_id).toBe('mine_a')
    expect(first.can_end_turn).toBeTrue()
    expect(first.selected?.spells[0]?.turn?.critical).toBeTrue()

    const other_turn = structuredClone(checkpoint)
    other_turn.contract.turn_ptr = 1n
    const next = select_fight_view({ checkpoint: other_turn, mode: 'local', owner: 'mine', names: {} })
    expect(next.active_seat).toBe(2n)
    expect(next.selected?.character_id).toBe('mine_b')
    expect(next.can_end_turn).toBeFalse()
    expect(next.selected?.spells[0]?.turn).toBeNull()
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
