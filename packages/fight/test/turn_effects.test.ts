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
})
