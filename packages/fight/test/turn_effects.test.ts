// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
// Turn ownership for lasting rows and board zones. These are the presentation-facing semantics
// shared with fight.move: another fighter's turn never consumes your effects or your glyphs.

import { describe, expect, test } from 'bun:test'

import { GRID_CELLS, mask_get } from '../src/combat_grid.ts'
import { deal } from '../src/damage.ts'
import { resolve_rows } from '../src/effects.ts'
import { KINDS, STATS, sheet_of } from '../src/fighters.ts'
import { create_runtime } from '../src/runtime.ts'
import { CONTRACT_CONSTANTS } from '../src/move_contract.gen.ts'
import { tick_turn_start } from '../src/turn_effects.ts'
import type { ActiveEffect, BoardZone, SpellEffect } from '../src/types.ts'
import { on_enter } from '../src/zones.ts'

import { create_fixture } from './helpers.ts'

const lasting = (kind: bigint, stat: bigint, value: bigint): ActiveEffect => ({
  kind,
  element: 'earth',
  value,
  turns_left: 2n,
  source: 1n,
  stat,
})

const damage_row = (value: bigint): SpellEffect => ({
  kind: KINDS.damage,
  element: 'earth',
  value,
  value_max: value,
  area_shape: 0n,
  area_size: 0n,
  target_filter: 0n,
  chance_bp: 10_000n,
  turns: 0n,
  stat: STATS.any,
})

const push_row = (value: bigint): SpellEffect => ({
  kind: KINDS.push,
  element: '',
  value,
  value_max: value,
  area_shape: 1n,
  area_size: 1n,
  target_filter: 1n,
  chance_bp: 10_000n,
  turns: 0n,
  stat: STATS.any,
})

describe('fight turn effects', () => {
  test('dots, regeneration, bonuses, maluses, and shields consume only the target turns', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const target = checkpoint.contract.fighters[0]!
    target.hp = 80n
    target.effects = [
      lasting(KINDS.remove, STATS.hp, 7n),
      lasting(KINDS.add, STATS.hp, 3n),
      lasting(KINDS.add, STATS.strength, 11n),
      lasting(KINDS.remove, STATS.strength, 4n),
      lasting(KINDS.reduce, STATS.any, 5n),
    ]
    const runtime = create_runtime(checkpoint)

    const strength_with_rows = sheet_of(runtime, 0n).strength
    tick_turn_start(runtime, 1n)

    expect(runtime.contract.fighters[0]!.effects.map(({ turns_left }) => turns_left)).toEqual([2n, 2n, 2n, 2n, 2n])
    expect(sheet_of(runtime, 0n).strength).toBe(strength_with_rows)
    expect(
      deal({
        runtime,
        caster: 1n,
        sheet: sheet_of(runtime, 1n),
        target: 0n,
        element: 'earth',
        base: 20n,
        cast_level: 1n,
        cause: 'audit',
      })
    ).toBe(15n)

    tick_turn_start(runtime, 0n)
    expect(runtime.contract.fighters[0]!.effects.map(({ turns_left }) => turns_left)).toEqual([1n, 1n, 1n, 1n, 1n])
    expect(sheet_of(runtime, 0n).strength).toBe(strength_with_rows)

    tick_turn_start(runtime, 0n)
    expect(runtime.contract.fighters[0]!.effects).toEqual([])
    expect(sheet_of(runtime, 0n).strength).toBe(strength_with_rows - 7n)
    expect(runtime.render_actions.filter(({ type }) => type === 'damage_number')).toHaveLength(3)
    expect(runtime.render_actions.filter(({ type }) => type === 'heal_number')).toHaveLength(2)
    expect(runtime.render_actions.filter(({ type }) => type === 'damage_reduced')).toHaveLength(1)
  })

  test('a glyph fires at the victim turn start and expires only on its owner turns', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const victim = checkpoint.contract.fighters[1]!
    const zone: BoardZone = {
      owner_fighter: 0n,
      trap: false,
      shape: 0n,
      size: 0n,
      anchor: victim.cell,
      turns_left: 2n,
      effects: [damage_row(4n)],
    }
    checkpoint.contract.zones = [zone]
    const runtime = create_runtime(checkpoint)

    tick_turn_start(runtime, 1n)
    expect(runtime.contract.zones[0]?.turns_left).toBe(2n)
    tick_turn_start(runtime, 0n)
    expect(runtime.contract.zones[0]?.turns_left).toBe(1n)
    tick_turn_start(runtime, 1n)
    tick_turn_start(runtime, 0n)
    const hp_after_expiry = runtime.contract.fighters[1]!.hp
    tick_turn_start(runtime, 1n)

    expect(runtime.contract.zones).toEqual([])
    expect(runtime.contract.fighters[1]!.hp).toBe(hp_after_expiry)
    expect(runtime.render_actions.filter(({ type }) => type === 'glyph_triggered')).toHaveLength(2)
    expect(runtime.render_actions).toContainEqual({
      type: 'zone_removed',
      payload: { zone_id: 'initial:zone:0', kind: 'glyph', reason: 'expired' },
    })
  })

  test('a trap is removed before its payload resolves and cannot fire twice', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const target = checkpoint.contract.fighters[0]!
    const from = target.cell
    const anchor = Array.from({ length: Number(GRID_CELLS) }, (_, cell) => BigInt(cell)).find(
      (cell) => cell !== from && !mask_get(checkpoint.contract.closed, cell)
    )!
    target.cell = anchor
    checkpoint.contract.zones = [
      {
        owner_fighter: 1n,
        trap: true,
        shape: 0n,
        size: 0n,
        anchor,
        turns_left: 0n,
        effects: [damage_row(4n)],
      },
    ]
    const runtime = create_runtime(checkpoint)

    expect(on_enter(runtime, 0n, from, resolve_rows)).toBe(true)
    expect(runtime.contract.zones).toEqual([])
    expect(on_enter(runtime, 0n, from, resolve_rows)).toBe(false)
    expect(runtime.render_actions.filter(({ type }) => type === 'trap_triggered')).toHaveLength(1)
    expect(runtime.render_actions.filter(({ type }) => type === 'zone_removed')).toHaveLength(1)
    expect(runtime.render_actions.filter(({ type }) => type === 'damage_number')).toHaveLength(1)
  })

  test('movement fires a multi-cell trap when the fighter was already inside it', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const target = checkpoint.contract.fighters[0]!
    const anchor = 100n
    const from = 101n
    target.cell = 102n
    checkpoint.contract.zones = [
      {
        owner_fighter: 1n,
        trap: true,
        shape: 1n,
        size: 2n,
        anchor,
        turns_left: 0n,
        effects: [damage_row(4n)],
      },
    ]
    const runtime = create_runtime(checkpoint)

    expect(on_enter(runtime, 0n, from, resolve_rows)).toBeTrue()
    expect(runtime.contract.zones).toEqual([])
    expect(runtime.render_actions.filter(({ type }) => type === 'trap_triggered')).toHaveLength(1)
  })

  test('a trap triggered by its owner still damages every enemy inside its payload area', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.closed = checkpoint.contract.closed.map(() => 0n)
    checkpoint.contract.fighters[0]!.cell = 100n
    checkpoint.contract.fighters[1]!.cell = 101n
    checkpoint.contract.zones = [
      {
        owner_fighter: 0n,
        trap: true,
        shape: 1n,
        size: 1n,
        anchor: 100n,
        turns_left: 0n,
        effects: [{ ...damage_row(4n), area_shape: 1n, area_size: 1n, target_filter: 1n }],
      },
    ]
    const runtime = create_runtime(checkpoint)

    expect(on_enter(runtime, 0n, 99n, resolve_rows)).toBeTrue()
    expect(runtime.render_actions).toContainEqual(
      expect.objectContaining({ type: 'damage_number', payload: expect.objectContaining({ target: 1n }) })
    )
  })

  test('overlapping damage traps resolve before a push trap moves the fighter away', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    const width = BigInt(CONTRACT_CONSTANTS.grid_w)
    const start = Array.from({ length: Number(GRID_CELLS) }, (_, cell) => BigInt(cell)).find(
      (cell) =>
        cell % width < width - 2n &&
        !mask_get(checkpoint.contract.closed, cell) &&
        !mask_get(checkpoint.contract.closed, cell + 1n) &&
        !mask_get(checkpoint.contract.closed, cell + 2n)
    )
    if (start === undefined) throw new Error('fixture board has no open three-cell run')
    const target = checkpoint.contract.fighters[0]!
    target.cell = start + 1n
    checkpoint.contract.fighters[1]!.cell = start + width
    checkpoint.contract.zones = [
      {
        owner_fighter: 1n,
        trap: true,
        shape: 1n,
        size: 1n,
        anchor: start,
        turns_left: 0n,
        effects: [push_row(1n)],
      },
      {
        owner_fighter: 1n,
        trap: true,
        shape: 0n,
        size: 0n,
        anchor: start + 1n,
        turns_left: 0n,
        effects: [damage_row(5n)],
      },
    ]
    const runtime = create_runtime(checkpoint)

    expect(on_enter(runtime, 0n, start - 1n, resolve_rows)).toBeTrue()
    expect(
      runtime.render_actions
        .filter(({ type }) => ['trap_triggered', 'zone_removed', 'damage_number', 'fighter_moved'].includes(type))
        .map(({ type }) => type)
    ).toEqual(['trap_triggered', 'zone_removed', 'damage_number', 'trap_triggered', 'zone_removed', 'fighter_moved'])
  })

  test('elemental shields scale from their matching caster characteristic without raw damage', () => {
    const shield_value = (agility: bigint): bigint => {
      const checkpoint = structuredClone(create_fixture().checkpoint)
      checkpoint.sources.players['0xc1']!.agility = agility
      checkpoint.sources.players['0xc1']!.folded_stats.raw_damage = 33_168n
      const runtime = create_runtime(checkpoint)
      const caster = runtime.contract.fighters[0]!
      resolve_rows({
        runtime,
        caster: 0n,
        sheet: sheet_of(runtime, 0n),
        rows: [
          {
            kind: KINDS.reduce,
            element: 'air',
            value: 12n,
            value_max: 12n,
            area_shape: 0n,
            area_size: 0n,
            target_filter: 4n,
            chance_bp: 10_000n,
            turns: 1n,
            stat: STATS.any,
          },
        ],
        anchor: caster.cell,
        origin: caster.cell,
        cursor: { state: 1n },
        cast_level: 1n,
        cause: 'spell',
      })
      return runtime.contract.fighters[0]!.effects.at(-1)!.value
    }

    expect(shield_value(0n)).toBe(12n)
    expect(shield_value(400n)).toBe(60n)
  })

  test('elemental shields mitigate only matching damage while empty shields remain universal', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.fighters[0]!.effects = [
      { kind: KINDS.reduce, element: 'earth', value: 100n, turns_left: 1n, source: 0n, stat: STATS.any },
      { kind: KINDS.reduce, element: 'air', value: 9n, turns_left: 1n, source: 0n, stat: STATS.any },
      { kind: KINDS.reduce, element: '', value: 3n, turns_left: 1n, source: 0n, stat: STATS.any },
    ]
    const runtime = create_runtime(checkpoint)

    expect(
      deal({
        runtime,
        caster: 1n,
        sheet: sheet_of(runtime, 1n),
        target: 0n,
        element: 'air',
        base: 100n,
        cast_level: 1n,
        cause: 'shield_test',
      })
    ).toBe(88n)
    expect(runtime.render_actions.find(({ type }) => type === 'damage_reduced')).toEqual({
      type: 'damage_reduced',
      payload: {
        source: 1n,
        target: 0n,
        prevented: 12n,
        remaining: 88n,
        effect_ids: ['initial:effect:0:1', 'initial:effect:0:2'],
      },
    })
  })

  test('an inactive fighter contests pool removal against the points available on its next turn', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.queue = [0n, 1n]
    checkpoint.contract.turn_ptr = 0n
    checkpoint.contract.fighters[0]!.ap = 6n
    checkpoint.contract.fighters[1]!.ap = 0n
    checkpoint.sources.players['0xc1']!.wisdom = 1_000n
    const runtime = create_runtime(checkpoint)
    resolve_rows({
      runtime,
      caster: 0n,
      sheet: sheet_of(runtime, 0n),
      rows: [
        {
          kind: KINDS.remove,
          element: '',
          value: 2n,
          value_max: 2n,
          area_shape: 0n,
          area_size: 0n,
          target_filter: 1n,
          chance_bp: 10_000n,
          turns: 1n,
          stat: STATS.ap,
        },
      ],
      anchor: checkpoint.contract.fighters[1]!.cell,
      origin: checkpoint.contract.fighters[0]!.cell,
      cursor: { state: 1n },
      cast_level: 1n,
      cause: 'spell',
    })

    expect(runtime.contract.fighters[1]!.effects).toEqual([
      expect.objectContaining({ kind: KINDS.remove, stat: STATS.ap, value: 2n }),
    ])
  })

  test('an instant pool removal applied during the target turn is not stored for another turn', () => {
    const checkpoint = structuredClone(create_fixture().checkpoint)
    checkpoint.contract.queue = [1n, 0n]
    checkpoint.contract.turn_ptr = 0n
    checkpoint.contract.fighters[1]!.ap = 6n
    checkpoint.sources.players['0xc1']!.wisdom = 1_000n
    const runtime = create_runtime(checkpoint)
    resolve_rows({
      runtime,
      caster: 0n,
      sheet: sheet_of(runtime, 0n),
      rows: [
        {
          kind: KINDS.remove,
          element: '',
          value: 2n,
          value_max: 2n,
          area_shape: 0n,
          area_size: 0n,
          target_filter: 1n,
          chance_bp: 10_000n,
          turns: 0n,
          stat: STATS.ap,
        },
      ],
      anchor: checkpoint.contract.fighters[1]!.cell,
      origin: checkpoint.contract.fighters[0]!.cell,
      cursor: { state: 1n },
      cast_level: 1n,
      cause: 'glyph',
    })

    expect(runtime.contract.fighters[1]!.ap).toBe(4n)
    expect(runtime.contract.fighters[1]!.effects).toEqual([])
  })

  test('enemy-only swap refuses allies and invisible enemies', () => {
    const swap = (target: 'ally' | 'invisible_enemy') => {
      const checkpoint = structuredClone(create_fixture().checkpoint)
      checkpoint.contract.closed = checkpoint.contract.closed.map(() => 0n)
      checkpoint.contract.fighters[0]!.cell = 100n
      checkpoint.contract.fighters[1]!.cell = 102n
      const ally = structuredClone(checkpoint.contract.fighters[0]!)
      ally.cell = 101n
      checkpoint.contract.fighters.push(ally)
      if (target === 'invisible_enemy')
        checkpoint.contract.fighters[1]!.effects = [
          { kind: KINDS.invis, element: '', value: 0n, turns_left: 2n, source: 1n, stat: STATS.any },
        ]
      const runtime = create_runtime(checkpoint)
      resolve_rows({
        runtime,
        caster: 0n,
        sheet: sheet_of(runtime, 0n),
        rows: [
          {
            kind: KINDS.swap,
            element: '',
            value: 0n,
            value_max: 0n,
            area_shape: 0n,
            area_size: 0n,
            target_filter: 1n,
            chance_bp: 10_000n,
            turns: 0n,
            stat: STATS.any,
          },
        ],
        anchor: target === 'ally' ? 101n : 102n,
        origin: 100n,
        cursor: { state: 1n },
        cast_level: 1n,
        cause: 'spell',
      })
      return runtime.contract.fighters.map(({ cell }) => cell)
    }

    expect(swap('ally')).toEqual([100n, 102n, 101n])
    expect(swap('invisible_enemy')).toEqual([100n, 102n, 101n])
  })
})
