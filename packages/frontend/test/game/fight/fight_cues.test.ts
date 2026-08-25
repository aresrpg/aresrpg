// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'
import { create_character_source, create_fight_state, type FightEvent, type SpellLevel } from '@aresrpg/fight'

import { project_fight_cues } from '../../../src/game/fight/fight_cues.ts'

const level: SpellLevel = {
  ap_cost: 3n,
  range_min: 1n,
  range_max: 4n,
  modifiable_range: false,
  line_of_sight: false,
  line_launch: false,
  free_cell: false,
  casts_per_turn: 0n,
  casts_per_target: 0n,
  cooldown_turns: 0n,
  crit_1_in: 2n,
  effects: [],
  crit_effects: [],
}

const checkpoint = () =>
  create_fight_state({
    fight_id: '0xf1',
    board_seed: 1n,
    players: [
      {
        character: '0xc1',
        owner: '0xa1',
        ready: true,
        hp: 100n,
        source: create_character_source({ classe: 'senshi', level: 10n }),
      },
    ],
    mobs: [
      {
        team: 1n,
        scalar: 100n,
        template: {
          mob_type: 'alley_bunny',
          level_min: 1n,
          level_max: 1n,
          hp: 100n,
          ap: 6n,
          mp: 3n,
          agility: 0n,
          wisdom: 0n,
          earth_res: 32_768n,
          fire_res: 32_768n,
          water_res: 32_768n,
          air_res: 32_768n,
          spells: [],
          xp: 1n,
          loot: [],
        },
      },
    ],
    spells: { slash: { classe: 'senshi', unlock_level: 1n, levels: [level] } },
  })

describe('fight presentation cues', () => {
  test('invisibility expiry is presented before the next mob can act', () => {
    const state = checkpoint()
    const events: readonly FightEvent[] = [
      { type: 'invisibility_changed', payload: { fighter: 0n, invisible: false, reason: 'expired' } },
      { type: 'turn_switched', payload: { from: 0n, to: 1n, round: 1n, skipped: [], reason: 'end_turn' } },
    ]

    expect(project_fight_cues({ checkpoint: state, events, batch: 1 }).map(({ type }) => type)).toEqual([
      'visibility',
      'turn',
    ])
  })

  test('projects one ordered immutable batch without re-resolving its cast results', () => {
    const state = checkpoint()
    const target_cell = state.contract.fighters[1]!.cell
    const events: readonly FightEvent[] = [
      {
        type: 'spell_cast',
        payload: {
          caster: 0n,
          spell: 'slash',
          cast_level: 1n,
          target_cell,
          slot: 0n,
          ap_cost: 3n,
          critical: true,
          weapon: false,
        },
      },
      {
        type: 'damage_number',
        payload: {
          source: 0n,
          target: 1n,
          amount: 100n,
          hp_before: 100n,
          hp_after: 0n,
          element: 'earth',
          cause: 'spell',
        },
      },
      { type: 'fighter_died', payload: { fighter: 1n, source: 0n, cause: 'spell', cell: target_cell } },
    ]

    const cues = project_fight_cues({ checkpoint: state, events, batch: 7 })

    expect(cues.map(({ type }) => type)).toEqual(['cast', 'damage', 'death'])
    expect(cues[0]).toMatchObject({
      id: '0xf1:7:0',
      type: 'cast',
      caster_id: 'fight_character_0',
      element: 'earth',
      critical: true,
      style: 'damage',
      amount: 100,
      target_max_hp: 100,
      affected_cells: [Number(target_cell)],
      killed: true,
    })
    expect(cues[1]).toMatchObject({ type: 'damage', target_id: 'fight_mob_1', critical: true })
  })

  test('an MP steal floats one signed pool delta per fighter, live spend deduped against its lasting row', () => {
    const state = checkpoint()
    const target_cell = state.contract.fighters[1]!.cell
    const cast: FightEvent = {
      type: 'spell_cast',
      payload: {
        caster: 0n,
        spell: 'slash',
        cast_level: 1n,
        target_cell,
        slot: 0n,
        ap_cost: 3n,
        critical: false,
        weapon: false,
      },
    }
    const events: readonly FightEvent[] = [
      cast,
      // the ACTIVE target: live spend first, then the lasting row of the same removal
      {
        type: 'ap_mp_change',
        payload: {
          fighter: 1n,
          ap_before: 6n,
          ap_after: 6n,
          mp_before: 3n,
          mp_after: 1n,
          reason: 'effect_remove',
          source: 0n,
        },
      },
      {
        type: 'effect_applied',
        payload: { target: 1n, effect_id: 'e1', kind: 6n, channel: 7n, element: '', value: 2n, turns: 1n, source: 0n },
      },
      // the caster's drink
      {
        type: 'ap_mp_change',
        payload: {
          fighter: 0n,
          ap_before: 3n,
          ap_after: 3n,
          mp_before: 3n,
          mp_after: 5n,
          reason: 'effect_steal',
          source: 1n,
        },
      },
    ]

    const pools = project_fight_cues({ checkpoint: state, events, batch: 1 }).filter(({ type }) => type === 'pool')

    expect(pools).toEqual([
      expect.objectContaining({ type: 'pool', entity_id: 'fight_mob_1', ap: 0, mp: -2 }),
      expect.objectContaining({ type: 'pool', entity_id: 'fight_character_0', ap: 0, mp: 2 }),
    ])
  })

  test('an inactive target floats each pool channel row when no live pool moved', () => {
    const state = checkpoint()
    const events: readonly FightEvent[] = [
      {
        type: 'effect_applied',
        payload: { target: 1n, effect_id: 'e1', kind: 6n, channel: 7n, element: '', value: 2n, turns: 1n, source: 0n },
      },
      // a dual-channel debuff: the AP row floats independently of the MP row (per-channel ledger)
      {
        type: 'effect_applied',
        payload: { target: 1n, effect_id: 'e2', kind: 5n, channel: 6n, element: '', value: 1n, turns: 1n, source: 0n },
      },
    ]

    const pools = project_fight_cues({ checkpoint: state, events, batch: 1 }).filter(({ type }) => type === 'pool')

    expect(pools).toEqual([
      expect.objectContaining({ type: 'pool', entity_id: 'fight_mob_1', ap: 0, mp: -2 }),
      expect.objectContaining({ type: 'pool', entity_id: 'fight_mob_1', ap: -1, mp: 0 }),
    ])
  })

  test('a sprung trap is a presentation boundary: each hit keeps its own boom between movement segments', () => {
    // a sprung trap is a presentation boundary: slides and booms interleave, one per trap
    {
      const state = checkpoint()
      const trap_hit = (zone: string, cell: bigint): FightEvent[] => [
        { type: 'trap_triggered', payload: { zone_id: zone, owner: 0n, fighter: 1n, from: cell - 1n, cell } },
        { type: 'zone_removed', payload: { zone_id: zone, kind: 'trap', reason: 'triggered' } },
        {
          type: 'damage_number',
          payload: {
            source: 0n,
            target: 1n,
            amount: 5n,
            hp_before: 100n,
            hp_after: 95n,
            element: 'earth',
            cause: 'trap',
          },
        },
      ]
      const events: readonly FightEvent[] = [
        {
          type: 'spell_cast',
          payload: {
            caster: 0n,
            spell: 'slash',
            cast_level: 1n,
            target_cell: 9n,
            slot: 0n,
            ap_cost: 3n,
            critical: false,
            weapon: false,
          },
        },
        { type: 'fighter_moved', payload: { fighter: 1n, from: 9n, to: 10n, mode: 'push', source: 0n, mp_spent: 0n } },
        ...trap_hit('z1', 10n),
        { type: 'fighter_moved', payload: { fighter: 1n, from: 10n, to: 11n, mode: 'push', source: 0n, mp_spent: 0n } },
        ...trap_hit('z2', 11n),
      ]

      const cues = project_fight_cues({ checkpoint: state, events, batch: 3 })

      // movement never hoists across a trap boundary, and each trap keeps its own boom
      expect(cues.map((cue) => cue.type)).toEqual(['cast', 'movement', 'zone', 'damage', 'movement', 'zone', 'damage'])
      // the sprung trap's damage never folds into the cast's own impact amount
      expect(cues[0]).toMatchObject({ type: 'cast', amount: 0 })
      expect(cues.filter((cue) => cue.type === 'movement').every((cue) => cue.gait === 'slide')).toBeTrue()
    }

    // keeps each trap hit between movement segments and floats total MP after the path
    {
      const state = checkpoint()
      const from = state.contract.fighters[1]!.cell
      const events: readonly FightEvent[] = [
        {
          type: 'fighter_moved',
          payload: { fighter: 1n, from, to: from + 1n, mode: 'walk', source: 1n, mp_spent: 1n },
        },
        {
          type: 'trap_triggered',
          payload: { zone_id: 'zone:1', owner: 0n, fighter: 1n, from, cell: from + 1n },
        },
        { type: 'zone_removed', payload: { zone_id: 'zone:1', kind: 'trap', reason: 'triggered' } },
        {
          type: 'damage_number',
          payload: {
            source: 0n,
            target: 1n,
            amount: 6n,
            hp_before: 100n,
            hp_after: 94n,
            element: 'earth',
            cause: 'trap',
          },
        },
        {
          type: 'fighter_moved',
          payload: { fighter: 1n, from: from + 1n, to: from + 2n, mode: 'walk', source: 1n, mp_spent: 1n },
        },
        {
          type: 'trap_triggered',
          payload: { zone_id: 'zone:2', owner: 0n, fighter: 1n, from: from + 1n, cell: from + 2n },
        },
        { type: 'zone_removed', payload: { zone_id: 'zone:2', kind: 'trap', reason: 'triggered' } },
        {
          type: 'damage_number',
          payload: {
            source: 0n,
            target: 1n,
            amount: 7n,
            hp_before: 94n,
            hp_after: 87n,
            element: 'earth',
            cause: 'trap',
          },
        },
        {
          type: 'fighter_moved',
          payload: { fighter: 1n, from: from + 2n, to: from + 3n, mode: 'walk', source: 1n, mp_spent: 1n },
        },
      ]

      const cues = project_fight_cues({ checkpoint: state, events, batch: 8 })

      expect(cues.map(({ type }) => type)).toEqual([
        'movement',
        'zone',
        'damage',
        'movement',
        'zone',
        'damage',
        'movement',
      ])
      expect(cues.filter((cue) => cue.type === 'movement').map(({ mp_spent }) => mp_spent)).toEqual([0, 0, 3])
      expect(cues.filter((cue) => cue.type === 'movement').map(({ gait }) => gait)).toEqual(['run', 'run', 'run'])
      expect(cues.filter((cue) => cue.type === 'damage').every(({ critical }) => !critical)).toBeTrue()
    }

    // a self-triggered trap gives every damaged bystander its own hit cue
    {
      const state = checkpoint()
      const owner_cell = state.contract.fighters[0]!.cell
      const enemy_cell = state.contract.fighters[1]!.cell
      const events: readonly FightEvent[] = [
        {
          type: 'trap_triggered',
          payload: { zone_id: 'zone:self', owner: 0n, fighter: 0n, from: owner_cell, cell: owner_cell },
        },
        { type: 'zone_removed', payload: { zone_id: 'zone:self', kind: 'trap', reason: 'triggered' } },
        {
          type: 'effect_applied',
          payload: {
            target: 1n,
            effect_id: 'effect:trap',
            kind: 5n,
            channel: 6n,
            element: '',
            value: 1n,
            turns: 1n,
            source: 0n,
          },
        },
        {
          type: 'damage_number',
          payload: {
            source: 0n,
            target: 1n,
            amount: 8n,
            hp_before: 100n,
            hp_after: 92n,
            element: 'earth',
            cause: 'trap',
          },
        },
      ]

      const cues = project_fight_cues({ checkpoint: state, events, batch: 11 })

      expect(cues).toContainEqual(
        expect.objectContaining({
          type: 'zone',
          target_id: 'fight_character_0',
          affected_ids: [],
        })
      )
      expect(cues).toContainEqual(expect.objectContaining({ type: 'damage', target_id: 'fight_mob_1', amount: 8 }))
      expect(enemy_cell).not.toBe(owner_cell)
    }
  })

  test('a mob turn cue carries the chain turn floor; a player turn does not', () => {
    const state = checkpoint()
    const events: readonly FightEvent[] = [
      { type: 'turn_switched', payload: { from: 0n, to: 1n, round: 1n, skipped: [], reason: 'end_turn' } },
      { type: 'turn_switched', payload: { from: 1n, to: 0n, round: 2n, skipped: [], reason: 'end_turn' } },
    ]

    const cues = project_fight_cues({ checkpoint: state, events, batch: 4 })

    expect(cues[0]).toMatchObject({ type: 'turn', entity_id: 'fight_mob_1', min_ms: 3000 })
    expect(cues[1]).toMatchObject({ type: 'turn', entity_id: 'fight_character_0' })
    expect(cues[1] && 'min_ms' in cues[1] ? cues[1].min_ms : undefined).toBeUndefined()
  })

  test('coalesces consecutive movement steps but keeps their accepted order', () => {
    const state = checkpoint()
    const from = state.contract.fighters[0]!.cell
    const events: readonly FightEvent[] = [
      {
        type: 'fighter_moved',
        payload: { fighter: 0n, from, to: from + 1n, mode: 'walk', source: 0n, mp_spent: 1n },
      },
      {
        type: 'fighter_moved',
        payload: { fighter: 0n, from: from + 1n, to: from + 2n, mode: 'walk', source: 0n, mp_spent: 1n },
      },
    ]

    expect(project_fight_cues({ checkpoint: state, events, batch: 3 })).toEqual([
      {
        id: '0xf1:3:0',
        type: 'movement',
        entity_id: 'fight_character_0',
        cells: [Number(from + 1n), Number(from + 2n)],
        mode: 'walk',
        source_id: 'fight_character_0',
        mp_spent: 2,
        gait: 'walk',
      },
    ])
  })

  test('projects tackle losses before the accepted movement beat', () => {
    const state = checkpoint()
    const from = state.contract.fighters[0]!.cell
    const events: readonly FightEvent[] = [
      {
        type: 'tackle_resolved',
        payload: {
          runner: 0n,
          cell: from,
          lockers: [1n],
          escaped: false,
          ap_lost: 2n,
          mp_lost: 1n,
        },
      },
      {
        type: 'fighter_moved',
        payload: { fighter: 0n, from, to: from + 1n, mode: 'walk', source: 0n, mp_spent: 1n },
      },
    ]

    expect(project_fight_cues({ checkpoint: state, events, batch: 10 })).toEqual([
      {
        id: '0xf1:10:0',
        type: 'tackle',
        entity_id: 'fight_character_0',
        source_id: 'fight_mob_1',
        ap_lost: 2,
        mp_lost: 1,
      },
      expect.objectContaining({ type: 'movement', entity_id: 'fight_character_0' }),
    ])
  })

  test('a self-triggered status trap flinches another affected fighter', () => {
    const state = checkpoint()
    const owner_cell = state.contract.fighters[0]!.cell
    const events: readonly FightEvent[] = [
      {
        type: 'trap_triggered',
        payload: { zone_id: 'zone:status', owner: 0n, fighter: 0n, from: owner_cell, cell: owner_cell },
      },
      {
        type: 'effect_applied',
        payload: {
          target: 1n,
          effect_id: 'effect:status',
          kind: 5n,
          channel: 6n,
          element: '',
          value: 1n,
          turns: 1n,
          source: 0n,
        },
      },
    ]

    expect(project_fight_cues({ checkpoint: state, events, batch: 12 })).toContainEqual(
      expect.objectContaining({ type: 'zone', affected_ids: ['fight_mob_1'] })
    )
  })

  test('presents displacement before the damage rows of the same cast', () => {
    const state = checkpoint()
    const target = state.contract.fighters[1]!
    const events: readonly FightEvent[] = [
      {
        type: 'spell_cast',
        payload: {
          caster: 0n,
          spell: 'slash',
          cast_level: 1n,
          target_cell: target.cell,
          slot: 0n,
          ap_cost: 3n,
          critical: false,
          weapon: false,
        },
      },
      {
        type: 'damage_number',
        payload: {
          source: 0n,
          target: 1n,
          amount: 8n,
          hp_before: 100n,
          hp_after: 92n,
          element: 'earth',
          cause: 'spell',
        },
      },
      {
        type: 'fighter_moved',
        payload: { fighter: 1n, from: target.cell, to: target.cell + 1n, mode: 'push', source: 0n, mp_spent: 0n },
      },
    ]

    expect(project_fight_cues({ checkpoint: state, events, batch: 9 }).map(({ type }) => type)).toEqual([
      'cast',
      'movement',
      'damage',
    ])
  })

  test('carries the resolved element on a trap trigger cue', () => {
    const state = checkpoint()
    const target_cell = state.contract.fighters[1]!.cell
    const events: readonly FightEvent[] = [
      {
        type: 'trap_triggered',
        payload: { zone_id: 'zone:1', owner: 0n, fighter: 1n, from: target_cell - 1n, cell: target_cell },
      },
      { type: 'zone_removed', payload: { zone_id: 'zone:1', kind: 'trap', reason: 'triggered' } },
      {
        type: 'damage_number',
        payload: {
          source: 0n,
          target: 1n,
          amount: 12n,
          hp_before: 100n,
          hp_after: 88n,
          element: 'earth',
          cause: 'trap',
        },
      },
    ]

    expect(project_fight_cues({ checkpoint: state, events, batch: 4 })[0]).toMatchObject({
      type: 'zone',
      action: 'trap_triggered',
      element: 'earth',
    })
  })

  test('keeps trap placement as an ordered presentation beat after its cast', () => {
    const state = checkpoint()
    const target_cell = state.contract.fighters[0]!.cell + 1n
    const events: readonly FightEvent[] = [
      {
        type: 'spell_cast',
        payload: {
          caster: 0n,
          spell: 'slash',
          cast_level: 1n,
          target_cell,
          slot: 0n,
          ap_cost: 3n,
          critical: false,
          weapon: false,
        },
      },
      {
        type: 'trap_placed',
        payload: {
          zone_id: 'zone:1',
          owner: 0n,
          anchor: target_cell,
          shape: 0n,
          size: 0n,
          visibility: 'owner',
        },
      },
    ]

    expect(project_fight_cues({ checkpoint: state, events, batch: 5 }).map(({ type }) => type)).toEqual([
      'cast',
      'zone_placed',
    ])
    expect(project_fight_cues({ checkpoint: state, events, batch: 5 })[0]).toMatchObject({
      type: 'cast',
      style: 'trap',
    })
  })
})
