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
  test('the fight surface neither builds a world nor goes looking for one', () => {
    // The board is mounted INSIDE a live world (owner 2026-08-21). Two laws, both learned the
    // hard way: a second engine hides the very world it stands in, and a surface that can ASK
    // for "the live scene" draws into whichever one happens to be published — it landed the
    // fight board in the biome lab twice. The world arrives as an argument or not at all.
    const source = readFileSync(new URL('../../../src/game/fight/FightViewport.tsx', import.meta.url), 'utf8')

    expect(source).not.toContain('create_engine')
    expect(source).not.toContain('create_fight_view')
    expect(source).not.toContain('read_scene')
    expect(source).not.toContain('subscribe_scene')
    expect(source).toContain('scene: SceneHandle')
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

  test('a challenge nobody accepted is unstartable, and its one seat can always leave', () => {
    // THE DUEL INCIDENT (2026-08-21): the challenger sat alone in placement while the HUD
    // offered "Force start" — a transaction the chain can only abort, because `fight::start`
    // refuses a side with no living fighter — and offered no way out at all.
    const checkpoint = structuredClone(started_checkpoint())
    checkpoint.contract.fighters = [checkpoint.contract.fighters[0]!]
    checkpoint.contract.round = 0n
    checkpoint.contract.queue = []

    const view = select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} })

    expect(view.phase).toBe('placement')
    expect(view.sides_manned).toBeFalse()
    expect(view.can_forfeit).toBeTrue()
  })

  test('both sides manned reads as startable', () => {
    const checkpoint = structuredClone(started_checkpoint())
    checkpoint.contract.round = 0n
    checkpoint.contract.queue = []

    expect(select_fight_view({ checkpoint, mode: 'remote', owner: 'mine', names: {} }).sides_manned).toBeTrue()
  })

  test('orders the spell bar by authored unlock level', () => {
    const checkpoint = structuredClone(started_checkpoint())
    Object.values(checkpoint.sources.players).forEach((player) => {
      player.level = 100n
      player.spell_levels = { late: 1n, early: 1n }
    })
    checkpoint.sources.spells = {
      late: { classe: 'senshi', unlock_level: 20n, levels: [spell_level] },
      early: { classe: 'senshi', unlock_level: 2n, levels: [spell_level] },
    }

    const view = select_fight_view({ checkpoint, mode: 'local', owner: 'mine', names: {} })

    expect(view.selected?.spells.map(({ name }) => name)).toEqual(['early', 'late'])
  })
})
