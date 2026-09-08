// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { resolve_rows } from '../src/effects.ts'
import { KINDS, STATS, sheet_of } from '../src/fighters.ts'
import { project_spell_turn } from '../src/spell_turn_projection.ts'
import { create_runtime } from '../src/runtime.ts'
import { draw } from '../src/prng.ts'
import { AREA_SHAPES } from '../src/move_contract.gen.ts'
import type { SpellEffect } from '../src/types.ts'

import { create_fixture } from './helpers.ts'

const row = (kind: bigint, stat: bigint, value = 2n, value_max = 30n): SpellEffect => ({
  kind,
  stat,
  value,
  value_max,
  element: '',
  area_shape: 0n,
  area_size: 0n,
  target_filter: 0n,
  chance_bp: 10_000n,
  turns: 2n,
})

for (const kind of [KINDS.add, KINDS.remove, KINDS.steal, KINDS.reduce, KINDS.reflect, KINDS.chatiment]) {
  test(`numeric kind ${kind} consumes one range draw and retains the resolved amount`, () => {
    const runtime = create_runtime(create_fixture().checkpoint)
    const cursor = { state: 1n }
    const expected = { state: 1n }
    const amount = 2n + ((draw(expected) % 10_000n) * 29n) / 10_000n
    resolve_rows({
      runtime,
      caster: 0n,
      sheet: sheet_of(runtime, 0n),
      rows: [row(kind, STATS.raw_damage)],
      anchor: runtime.contract.fighters[1]!.cell,
      origin: runtime.contract.fighters[0]!.cell,
      cursor,
      cast_level: 1n,
      cause: 'test',
    })
    expect(runtime.contract.fighters[1]!.effects[0]!.value).toBe(amount)
    expect(cursor.state).toBe(expected.state)
    if (kind === KINDS.steal) expect(runtime.contract.fighters[0]!.effects[0]!.value).toBe(amount)
  })
}

test('fixed and control rows consume no magnitude entropy', () => {
  const runtime = create_runtime(create_fixture().checkpoint)
  const cursor = { state: 1n }
  resolve_rows({
    runtime,
    caster: 0n,
    sheet: sheet_of(runtime, 0n),
    rows: [row(KINDS.add, STATS.raw_damage, 4n, 4n), row(KINDS.return, 0n), row(KINDS.invis, 0n)],
    anchor: runtime.contract.fighters[1]!.cell,
    origin: runtime.contract.fighters[0]!.cell,
    cursor,
    cast_level: 6n,
    cause: 'test',
  })
  expect(cursor.state).toBe(1n)
  expect(runtime.contract.fighters[1]!.effects.map(({ value }) => value)).toEqual([4n, 6n, 2n])
})

test('each eligible area target consumes its own magnitude draw', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  const extra = structuredClone(checkpoint.contract.fighters[1]!)
  extra.cell = checkpoint.contract.board.start_cells_b[1]!
  checkpoint.contract.fighters.push(extra)
  const runtime = create_runtime(checkpoint)
  const cursor = { state: 1n }
  const expected = { state: 1n }
  const ordered = runtime.contract.fighters
    .map(({ cell }, seat) => ({ cell, seat }))
    .toSorted((a, b) => Number(a.cell - b.cell))
  const amounts = new Map(ordered.map(({ seat }) => [seat, 2n + ((draw(expected) % 10_000n) * 29n) / 10_000n]))
  resolve_rows({
    runtime,
    caster: 0n,
    sheet: sheet_of(runtime, 0n),
    rows: [{ ...row(KINDS.add, STATS.raw_damage), area_shape: AREA_SHAPES.allmap }],
    anchor: runtime.contract.fighters[1]!.cell,
    origin: runtime.contract.fighters[0]!.cell,
    cursor,
    cast_level: 1n,
    cause: 'test',
  })
  expect(runtime.contract.fighters.map(({ effects }) => effects[0]!.value)).toEqual(
    [0, 1, 2].map((seat) => amounts.get(seat)!)
  )
  expect(cursor.state).toBe(expected.state)
})

test('failed chance rolls do not consume a magnitude draw', () => {
  const runtime = create_runtime(create_fixture().checkpoint)
  const cursor = { state: 1n }
  const expected = { state: 1n }
  draw(expected)
  resolve_rows({
    runtime,
    caster: 0n,
    sheet: sheet_of(runtime, 0n),
    rows: [{ ...row(KINDS.add, STATS.raw_damage), chance_bp: 0n }],
    anchor: runtime.contract.fighters[1]!.cell,
    origin: runtime.contract.fighters[0]!.cell,
    cursor,
    cast_level: 1n,
    cause: 'test',
  })
  expect(runtime.contract.fighters[1]!.effects).toEqual([])
  expect(cursor.state).toBe(expected.state)
})

test('fixed stat, variable stat, and HP damage consume exactly two magnitude draws', () => {
  const runtime = create_runtime(create_fixture().checkpoint)
  const cursor = { state: 1n }
  const expected = { state: 1n }
  const buff = 2n + ((draw(expected) % 10_000n) * 29n) / 10_000n
  const damage = 2n + ((draw(expected) % 10_000n) * 29n) / 10_000n
  const { hp } = runtime.contract.fighters[1]!
  resolve_rows({
    runtime,
    caster: 0n,
    sheet: { ...sheet_of(runtime, 0n), strength: 0n },
    rows: [
      row(KINDS.add, STATS.raw_damage, 4n, 4n),
      row(KINDS.add, STATS.strength),
      { ...row(KINDS.damage, 0n), element: 'earth' },
    ],
    anchor: runtime.contract.fighters[1]!.cell,
    origin: runtime.contract.fighters[0]!.cell,
    cursor,
    cast_level: 1n,
    cause: 'test',
  })
  expect(runtime.contract.fighters[1]!.effects.map(({ value }) => value)).toEqual([4n, buff])
  expect(runtime.contract.fighters[1]!.hp).toBe(hp - damage)
  expect(cursor.state).toBe(expected.state)
})

test('the target-free HUD retains ranges when area-target count controls later RNG', () => {
  const checkpoint = structuredClone(create_fixture().checkpoint)
  checkpoint.sources.spells.slash!.levels[0]!.effects = [
    { ...row(KINDS.add, STATS.raw_damage), area_shape: AREA_SHAPES.allmap },
    { ...row(KINDS.damage, 0n, 10n, 20n), element: 'earth' },
  ]
  const projected = project_spell_turn(checkpoint, 0n, 'slash')!
  expect(projected.effects[0]).toMatchObject({ value: 2n, value_max: 30n })
  expect(projected.effects[1]).toMatchObject({ value: 10n, value_max: 20n })
})
