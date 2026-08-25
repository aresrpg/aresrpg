// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { KINDS, STATS } from '../src/fighters.ts'
import { encode_cell, mask_from_cells } from '../src/combat_grid.ts'
import { create_runtime } from '../src/runtime.ts'
import { mob_turn } from '../src/turns.ts'

import { create_fixture } from './helpers.ts'

test('a mob searches toward its own starting band when every enemy is invisible', () => {
  const { checkpoint } = create_fixture()
  const [player, mob] = checkpoint.contract.fighters
  if (!player || !mob) throw new Error('fixture has no opposing fighters')
  player.cell = checkpoint.contract.board.start_cells_a[1]!
  player.effects.push({ kind: KINDS.invis, element: '', value: 0n, turns_left: 2n, source: 0n, stat: 0n })
  mob.cell = checkpoint.contract.board.start_cells_a[0]!
  mob.mp = 3n
  const before = mob.cell
  const runtime = create_runtime(checkpoint)

  mob_turn(runtime, 1n)

  expect(runtime.contract.fighters[1]?.cell).not.toBe(before)
  expect(runtime.render_actions.some(({ type }) => type === 'fighter_moved')).toBeTrue()
})

// THE FROG LAW (owner repro 2026-08-23), twin side: straight-line "close" is never a reason
// to hold — a blocked mob spends its budget on the detour. Mirrors move fight_ai_tests.
const frog_wall = () => Array.from({ length: 6 }, (_, i) => encode_cell(4n, BigInt(3 + i)))

test('a blocked mob walks its budget around the wall', () => {
  const { checkpoint } = create_fixture()
  const [player, mob] = checkpoint.contract.fighters
  if (!player || !mob) throw new Error('fixture has no opposing fighters')
  checkpoint.contract.closed = mask_from_cells(frog_wall())
  player.cell = encode_cell(5n, 5n)
  mob.cell = encode_cell(3n, 5n)
  mob.mp = 3n
  const runtime = create_runtime(checkpoint)

  mob_turn(runtime, 1n)

  expect(runtime.contract.fighters[1]?.cell).toBe(encode_cell(3n, 2n))
})

test('a sealed target is the one legal hold', () => {
  const { checkpoint } = create_fixture()
  const [player, mob] = checkpoint.contract.fighters
  if (!player || !mob) throw new Error('fixture has no opposing fighters')
  checkpoint.contract.closed = mask_from_cells([
    ...frog_wall(),
    encode_cell(5n, 4n),
    encode_cell(5n, 6n),
    encode_cell(6n, 5n),
  ])
  player.cell = encode_cell(5n, 5n)
  mob.cell = encode_cell(3n, 5n)
  mob.mp = 6n
  const runtime = create_runtime(checkpoint)

  mob_turn(runtime, 1n)

  expect(runtime.contract.fighters[1]?.cell).toBe(encode_cell(3n, 5n))
})

test('a mob aims an ally-only raw-damage buff at its family ally instead of the player', () => {
  const { checkpoint } = create_fixture()
  const player = checkpoint.contract.fighters[0]!
  const caster = checkpoint.contract.fighters[1]!
  if (caster.kind.type !== 'mob') throw new Error('fixture mob changed')
  const ally = structuredClone(caster)
  if (ally.kind.type !== 'mob') throw new Error('cloned fixture mob changed')
  player.cell = checkpoint.contract.board.start_cells_a[0]!
  caster.cell = checkpoint.contract.board.start_cells_b[0]!
  caster.ap = 6n
  ally.cell = checkpoint.contract.board.start_cells_b[1]!
  ally.kind.snapshot.kit = []
  caster.kind.snapshot.kit = [
    {
      name: 'Nifuwoost',
      ordinal: 1n,
      level: {
        ap_cost: 2n,
        range_min: 0n,
        range_max: 40n,
        modifiable_range: false,
        line_of_sight: false,
        line_launch: false,
        free_cell: false,
        casts_per_turn: 0n,
        casts_per_target: 0n,
        cooldown_turns: 5n,
        crit_1_in: 0n,
        effects: [
          {
            kind: KINDS.add,
            element: '',
            value: 4n,
            value_max: 10n,
            area_shape: 0n,
            area_size: 0n,
            target_filter: 3n,
            chance_bp: 10_000n,
            turns: 2n,
            stat: STATS.raw_damage,
          },
        ],
        crit_effects: [],
      },
    },
  ]
  checkpoint.contract.fighters.push(ally)
  const runtime = create_runtime(checkpoint)

  mob_turn(runtime, 1n)

  expect(runtime.contract.fighters[0]?.effects.some(({ stat }) => stat === STATS.raw_damage)).toBeFalse()
  expect(runtime.contract.fighters[2]?.effects.some(({ stat }) => stat === STATS.raw_damage)).toBeTrue()
})
