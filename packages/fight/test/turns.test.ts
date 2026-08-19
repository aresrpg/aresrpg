// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { KINDS } from '../src/fighters.ts'
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
