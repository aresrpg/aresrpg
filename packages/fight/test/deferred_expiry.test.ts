// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { KINDS, STATS, sheet_of, action_points_of, movement_points_of } from '../src/fighters.ts'
import { deal } from '../src/damage.ts'
import { on_enter } from '../src/zones.ts'
import { resolve_rows } from '../src/effects.ts'
import { create_runtime } from '../src/runtime.ts'
import { apply_pool_effects, expire_turn_effects, tick_turn_end, tick_turn_start } from '../src/turn_effects.ts'

import { create_fixture } from './helpers.ts'

test('a final-turn damage buff stays effective between turns without promising another AP refill', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  checkpoint.contract.fighters[0]!.effects = [
    { kind: KINDS.add, stat: STATS.raw_damage, value: 5n, turns_left: 1n, source: 0n, element: '' },
    { kind: KINDS.add, stat: STATS.ap, value: 2n, turns_left: 1n, source: 0n, element: '' },
  ]
  const runtime = create_runtime(checkpoint)
  tick_turn_end(runtime, 0n)
  expect(sheet_of(runtime, 0n).raw_damage).toBe(5n)
  expect(runtime.contract.fighters[0]!.effects.map(({ turns_left }) => turns_left)).toEqual([0n, 0n])
  expect(action_points_of(runtime, 0n)).toBe(6n)
  expect(runtime.render_actions.some(({ type }) => type === 'effect_expired')).toBe(false)
})

const row = (kind: bigint, stat: bigint, value: bigint, turns_left = 1n) => ({
  kind,
  stat,
  value,
  turns_left,
  source: 0n,
  element: '',
})
const begin = (runtime: ReturnType<typeof create_runtime>, seat: bigint) => {
  expire_turn_effects(runtime, seat)
  runtime.contract.fighters[Number(seat)]!.ap = 6n
  apply_pool_effects(runtime, seat)
  tick_turn_start(runtime, seat)
}

test('one-turn poison, regeneration and AP changes apply once, while a newly received ally buff survives its first start', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  checkpoint.contract.fighters[0]!.hp = 70n
  checkpoint.contract.fighters[0]!.effects = [
    row(KINDS.remove, STATS.hp, 7n),
    row(KINDS.add, STATS.hp, 3n),
    row(KINDS.add, STATS.ap, 2n),
    row(KINDS.add, STATS.power, 50n),
  ]
  const runtime = create_runtime(checkpoint)
  begin(runtime, 0n)
  expect(runtime.contract.fighters[0]!.hp).toBe(66n)
  expect(runtime.contract.fighters[0]!.ap).toBe(8n)
  expect(sheet_of(runtime, 0n).strength).toBe(150n)
  tick_turn_end(runtime, 0n)
  expect(sheet_of(runtime, 0n).strength).toBe(150n)
  begin(runtime, 0n)
  expect(runtime.contract.fighters[0]!.hp).toBe(66n)
  expect(runtime.contract.fighters[0]!.ap).toBe(6n)
  expect(sheet_of(runtime, 0n).strength).toBe(100n)
})

test('a refreshed damage glyph never doubles its bonus and traps use the retained inter-turn bonus', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  const base = checkpoint.sources.spells.slash!.levels[0]!.effects[0]!
  checkpoint.contract.zones = [
    {
      owner_fighter: 0n,
      trap: false,
      shape: 0n,
      size: 0n,
      anchor: checkpoint.contract.fighters[0]!.cell,
      turns_left: 3n,
      effects: [{ ...base, kind: KINDS.add, stat: STATS.raw_damage, value: 5n, value_max: 5n, turns: 1n }],
    },
    {
      owner_fighter: 0n,
      trap: true,
      shape: 0n,
      size: 0n,
      anchor: checkpoint.contract.fighters[1]!.cell,
      turns_left: 0n,
      effects: [{ ...base, value: 10n, value_max: 10n }],
    },
  ]
  const runtime = create_runtime(checkpoint)
  begin(runtime, 0n)
  expect(sheet_of(runtime, 0n).raw_damage).toBe(5n)
  tick_turn_end(runtime, 0n)
  const { hp } = runtime.contract.fighters[1]!
  on_enter(runtime, 1n, 0n, resolve_rows)
  expect(hp - runtime.contract.fighters[1]!.hp).toBe(25n)
  begin(runtime, 0n)
  expect(sheet_of(runtime, 0n).raw_damage).toBe(5n)
  expect(runtime.contract.fighters[0]!.effects).toHaveLength(1)
})

test('expired AP and MP penalties cannot reduce the next pool used for contests', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  checkpoint.contract.fighters[0]!.effects = [row(KINDS.fixed_remove, STATS.ap, 2n), row(KINDS.remove, STATS.mp, 1n)]
  const runtime = create_runtime(checkpoint)
  expect(action_points_of(runtime, 0n)).toBe(4n)
  expect(movement_points_of(runtime, 0n)).toBe(2n)
  tick_turn_end(runtime, 0n)
  expect(action_points_of(runtime, 0n)).toBe(6n)
  expect(movement_points_of(runtime, 0n)).toBe(3n)
})

test('invisibility stays through enemy turns and only reveals when the last row expires', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  checkpoint.contract.fighters[0]!.effects = [row(KINDS.invis, 0n, 0n), row(KINDS.invis, 0n, 0n, 2n)]
  const runtime = create_runtime(checkpoint)
  tick_turn_end(runtime, 0n)
  expire_turn_effects(runtime, 0n)
  expect(runtime.render_actions.filter(({ type }) => type === 'invisibility_changed')).toHaveLength(0)
  tick_turn_end(runtime, 0n)
  expect(runtime.render_actions.filter(({ type }) => type === 'invisibility_changed')).toHaveLength(0)
  expire_turn_effects(runtime, 0n)
  expect(runtime.render_actions.filter(({ type }) => type === 'invisibility_changed')).toEqual([
    { type: 'invisibility_changed', payload: { fighter: 0n, invisible: false, reason: 'expired' } },
  ])
})

test('a final-turn shield protects between turns but expires before the next action', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  checkpoint.contract.fighters[0]!.effects = [row(KINDS.reduce, STATS.any, 5n)]
  const runtime = create_runtime(checkpoint)
  tick_turn_end(runtime, 0n)
  const hit_target = () =>
    deal({
      runtime,
      caster: 1n,
      sheet: sheet_of(runtime, 1n),
      target: 0n,
      element: 'earth',
      base: 10n,
      cast_level: 1n,
      cause: 'test',
    })
  expect(hit_target()).toBe(5n)
  begin(runtime, 0n)
  expect(hit_target()).toBe(10n)
})
