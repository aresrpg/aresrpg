// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { describe, expect, test } from 'bun:test'

import { GRID_CELLS, mask_get, neighbours } from '../src/combat_grid.ts'
import { create_fight } from '../src/fight.ts'
import { hit, KINDS, STATS } from '../src/fighters.ts'
import { create_runtime } from '../src/runtime.ts'
import { tick_turn_end } from '../src/turn_effects.ts'
import type { BoardZone, HydratedFightCheckpoint, SpellEffect, SpellLevel } from '../src/types.ts'

import { create_fixture } from './helpers.ts'

const placement_effect = (kind: 12n | 13n, size = 2n): SpellEffect => ({
  kind,
  element: '',
  value: 0n,
  value_max: 0n,
  area_shape: 1n,
  area_size: size,
  target_filter: 0n,
  chance_bp: 10_000n,
  turns: kind === 13n ? 3n : 0n,
  stat: 0n,
})

const placement_level = (kind: 12n | 13n, count = 1): SpellLevel => ({
  ap_cost: 2n,
  range_min: 0n,
  range_max: 40n,
  modifiable_range: false,
  line_of_sight: false,
  line_launch: false,
  free_cell: true,
  casts_per_turn: 0n,
  casts_per_target: 0n,
  cooldown_turns: 0n,
  crit_1_in: 0n,
  effects: Array.from({ length: count }, () => placement_effect(kind)),
  crit_effects: [],
})

const with_placement_spell = (
  checkpoint: HydratedFightCheckpoint,
  kind: 12n | 13n,
  count = 1
): HydratedFightCheckpoint => ({
  ...checkpoint,
  sources: {
    ...checkpoint.sources,
    spells: {
      ...checkpoint.sources.spells,
      placement: { classe: 'senshi', unlock_level: 1n, levels: [placement_level(kind, count)] },
    },
  },
})

const zone = (trap: boolean, anchor: bigint): BoardZone => ({
  owner_fighter: 1n,
  trap,
  shape: 1n,
  size: 2n,
  anchor,
  turns_left: trap ? 0n : 3n,
  effects: [],
})

const open_pair = (checkpoint: HydratedFightCheckpoint): readonly [bigint, bigint] => {
  const occupied = new Set(checkpoint.contract.fighters.map(({ cell }) => cell))
  for (let index = 0n; index < GRID_CELLS; index += 1n) {
    if (mask_get(checkpoint.contract.closed, index) || occupied.has(index)) continue
    const adjacent = neighbours(index).find(
      (cell) => !mask_get(checkpoint.contract.closed, cell) && !occupied.has(cell)
    )
    if (adjacent !== undefined) return [index, adjacent]
  }
  throw new Error('fixture board has no adjacent open cells')
}

const started_fight = (checkpoint: HydratedFightCheckpoint) => {
  const fight = create_fight({ state: checkpoint, mode: 'local', seed: 91n })
  fight.apply({ type: 'start', observed_ms: 60_000n })
  return fight
}

describe('board-zone placement', () => {
  for (const existing_trap of [true, false]) {
    for (const incoming_kind of [12n, 13n] as const) {
      test(`${existing_trap ? 'trap' : 'glyph'} center rejects an incoming ${incoming_kind === 12n ? 'trap' : 'glyph'}`, () => {
        const checkpoint = with_placement_spell(structuredClone(create_fixture().checkpoint), incoming_kind)
        const [anchor] = open_pair(checkpoint)
        checkpoint.contract.zones = [zone(existing_trap, anchor)]
        const fight = started_fight(checkpoint)
        const before = fight.state()

        const result = fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'placement', target_cell: anchor })

        expect(result.error?.code).toBe('bad_target_cell')
        expect(result.events).toEqual([])
        expect(fight.state()).toEqual(before)
      })
    }
  }

  test('zone areas may overlap when their centers differ', () => {
    const checkpoint = with_placement_spell(structuredClone(create_fixture().checkpoint), 12n)
    const [anchor, overlapping_center] = open_pair(checkpoint)
    checkpoint.contract.zones = [zone(false, anchor)]
    const fight = started_fight(checkpoint)

    const result = fight.apply({
      type: 'cast_spell',
      fighter: 0n,
      spell: 'placement',
      target_cell: overlapping_center,
    })

    expect(result.error).toBeNull()
    expect(result.state.contract.zones.map(({ anchor: center }) => center)).toEqual([anchor, overlapping_center])
  })

  test('trap centers reject fighters while glyph centers allow them', () => {
    const occupied_cell = create_fixture().checkpoint.contract.fighters[1].cell
    const trap = started_fight(with_placement_spell(structuredClone(create_fixture().checkpoint), 12n))
    const glyph = started_fight(with_placement_spell(structuredClone(create_fixture().checkpoint), 13n))

    const trap_result = trap.apply({
      type: 'cast_spell',
      fighter: 0n,
      spell: 'placement',
      target_cell: occupied_cell,
    })
    const glyph_result = glyph.apply({
      type: 'cast_spell',
      fighter: 0n,
      spell: 'placement',
      target_cell: occupied_cell,
    })

    expect(trap_result.error?.code).toBe('bad_target_cell')
    expect(glyph_result.error).toBeNull()
    expect(glyph_result.state.contract.zones[0]?.anchor).toBe(occupied_cell)
  })

  test('one cast cannot create two zones at one center', () => {
    const checkpoint = with_placement_spell(structuredClone(create_fixture().checkpoint), 13n, 2)
    const [anchor] = open_pair(checkpoint)
    const fight = started_fight(checkpoint)

    const result = fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'placement', target_cell: anchor })

    expect(result.error?.code).toBe('bad_target_cell')
    expect(result.state.contract.zones).toEqual([])
  })

  test('placing a damaging trap preserves invisibility while direct damage reveals', () => {
    const checkpoint = with_placement_spell(structuredClone(create_fixture().checkpoint), 12n)
    checkpoint.sources.spells.placement!.levels[0]!.effects.push({
      kind: KINDS.damage,
      element: 'earth',
      value: 10n,
      value_max: 10n,
      area_shape: 0n,
      area_size: 0n,
      target_filter: 0n,
      chance_bp: 10_000n,
      turns: 0n,
      stat: 0n,
    })
    checkpoint.contract.fighters[0]!.effects.push({
      kind: KINDS.invis,
      element: '',
      value: 0n,
      turns_left: 3n,
      source: 0n,
      stat: 0n,
    })
    const [anchor] = open_pair(checkpoint)
    const fight = started_fight(checkpoint)

    const placed = fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'placement', target_cell: anchor })
    expect(placed.state.contract.fighters[0]!.effects.some(({ kind }) => kind === KINDS.invis)).toBeTrue()

    const damaged = fight.apply({
      type: 'cast_spell',
      fighter: 0n,
      spell: 'slash',
      target_cell: placed.state.contract.fighters[1]!.cell,
    })
    expect(damaged.state.contract.fighters[0]!.effects.some(({ kind }) => kind === KINDS.invis)).toBeFalse()
  })

  test('an invisible occupant still consumes the spell per-target cap', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.sources.spells.slash.levels[0]!.casts_per_target = 1n
    checkpoint.contract.fighters[1]!.effects.push({
      kind: KINDS.invis,
      element: '',
      value: 0n,
      turns_left: 2n,
      source: 1n,
      stat: STATS.any,
    })
    const target_cell = checkpoint.contract.fighters[1]!.cell
    const fight = started_fight(checkpoint)

    const first = fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell })
    const second = fight.apply({ type: 'cast_spell', fighter: 0n, spell: 'slash', target_cell })

    expect(first.error).toBeNull()
    expect(second.error?.code).toBe('target_cap')
  })

  test('life steal drinks exactly half of what landed', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.sources.spells.drain = {
      classe: 'senshi',
      unlock_level: 1n,
      levels: [
        {
          ...checkpoint.sources.spells.slash.levels[0]!,
          effects: [
            {
              kind: KINDS.steal,
              element: 'earth',
              value: 15n,
              value_max: 15n,
              area_shape: 0n,
              area_size: 0n,
              target_filter: 1n,
              chance_bp: 10_000n,
              turns: 0n,
              stat: STATS.hp,
            },
          ],
        },
      ],
    }
    checkpoint.contract.fighters[0]!.hp = 40n
    const fight = started_fight(checkpoint)

    const result = fight.apply({
      type: 'cast_spell',
      fighter: 0n,
      spell: 'drain',
      target_cell: checkpoint.contract.fighters[1]!.cell,
    })

    expect(result.error).toBeNull()
    const damage = result.events.find(({ type }) => type === 'damage_number')
    const heal = result.events.find(({ type }) => type === 'heal_number')
    if (damage?.type !== 'damage_number' || heal?.type !== 'heal_number') throw new Error('steal events missing')
    expect(damage.payload.amount).toBeGreaterThan(0n)
    expect(heal.payload.target).toBe(0n)
    expect(heal.payload.amount).toBe(damage.payload.amount / 2n)
  })

  test('a chatiment gains damage up to its cap once per active fighter turn', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.fighters[0]!.effects.push({
      kind: KINDS.chatiment,
      element: '',
      value: 60n,
      turns_left: 5n,
      source: 1n,
      stat: STATS.strength,
    })
    checkpoint.contract.fighters[0]!.hp = 300n
    checkpoint.contract.queue = [1n, 0n]
    const runtime = create_runtime(checkpoint)

    hit(runtime, { target: 0n, amount: 40n, source: 1n, cause: 'test' })
    hit(runtime, { target: 0n, amount: 40n, source: 1n, cause: 'test' })
    let gains = runtime.contract.fighters[0]!.effects.filter(
      ({ kind, stat }) => kind === KINDS.add && stat === STATS.strength
    )
    expect(gains).toHaveLength(1)
    expect(gains[0]!.value).toBe(60n)

    runtime.contract.fighters[1]!.kind = { type: 'player', character: '0xc2', owner: '0xa2', level: 10n }
    runtime.contract.turn_ptr = 1n
    hit(runtime, { target: 0n, amount: 40n, source: 1n, cause: 'test' })
    hit(runtime, { target: 0n, amount: 40n, source: 1n, cause: 'test' })
    gains = runtime.contract.fighters[0]!.effects.filter(
      ({ kind, stat }) => kind === KINDS.add && stat === STATS.strength
    )
    expect(gains.map(({ value }) => value)).toEqual([60n, 30n])
    expect(gains.every(({ turns_left }) => turns_left === 5n)).toBe(true)

    // Every damage trigger in one active turn references the same folded bonus row.
    const applied = runtime.render_actions.filter(({ type }) => type === 'effect_applied')
    expect(new Set(applied.map((event) => (event.type === 'effect_applied' ? event.payload.effect_id : ''))).size).toBe(
      2
    )

    tick_turn_end(runtime, 0n)
    tick_turn_end(runtime, 0n)
    tick_turn_end(runtime, 0n)
    tick_turn_end(runtime, 0n)
    expect(runtime.contract.fighters[0]!.effects.filter(({ kind }) => kind === KINDS.add)).toHaveLength(2)
    tick_turn_end(runtime, 0n)
    expect(runtime.contract.fighters[0]!.effects.filter(({ kind }) => kind === KINDS.add)).toHaveLength(0)
  })

  test('a second mob skips a claimed glyph center and tries its next spell', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const [first_mob_cell, second_mob_cell] = open_pair(checkpoint)
    const [, first_mob] = checkpoint.contract.fighters
    if (first_mob.kind.type !== 'mob') throw new Error('fixture opponent is not a mob')
    const glyph_level = {
      ...placement_level(13n),
      ap_cost: 3n,
      free_cell: false,
      cooldown_turns: 2n,
    }
    first_mob.cell = first_mob_cell
    first_mob.kind.snapshot.ap = 6n
    first_mob.kind.snapshot.kit = [{ name: 'Snaring Glyph', ordinal: 1n, level: glyph_level }]
    const second_mob = structuredClone(first_mob)
    second_mob.cell = second_mob_cell
    if (second_mob.kind.type !== 'mob') throw new Error('cloned opponent is not a mob')
    second_mob.kind.snapshot.kit.push({
      name: 'Fallback Strike',
      ordinal: 1n,
      level: checkpoint.sources.spells.slash.levels[0],
    })
    checkpoint.contract.fighters.push(second_mob)
    const fight = started_fight(checkpoint)

    const result = fight.apply({ type: 'end_turn', fighter: 0n, observed_ms: 63_000n })

    expect(result.error).toBeNull()
    expect(result.events.filter(({ type }) => type === 'glyph_placed')).toHaveLength(1)
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'spell_cast',
        payload: expect.objectContaining({ caster: 2n, spell: 'Fallback Strike' }),
      })
    )
    expect(result.state.contract.zones.map(({ anchor }) => anchor)).toEqual([result.state.contract.fighters[0].cell])
  })
})
