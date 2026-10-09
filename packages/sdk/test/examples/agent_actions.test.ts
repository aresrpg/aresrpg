// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_fight } from '../../../fight/src/index.ts'
import { create_fixture } from '../../../fight/test/helpers.ts'
import { preview_turn } from '../../examples/agent_actions.ts'

const active_checkpoint = () => {
  const runtime = create_fight({ state: create_fixture().checkpoint, mode: 'local' })
  const result = runtime.apply({ type: 'start', observed_ms: 1000n })
  if (result.error) throw new Error(result.error.code)
  return runtime.state()
}

test('combat example rejects placement, foreign seats, and illegal casts', () => {
  expect(() => preview_turn(create_fixture().checkpoint, [])).toThrow('live active turn')
  const checkpoint = active_checkpoint()
  expect(() => preview_turn(checkpoint, [{ type: 'strike', fighter_idx: 99n, target_cell: 0n }])).toThrow(
    'another seat'
  )
  const fighter_idx = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]!
  expect(() =>
    preview_turn(checkpoint, [{ type: 'cast', fighter_idx, spell: 'invented_spell', target_cell: 0n }])
  ).toThrow('Illegal draft')
})

test('combat example applies sequential AP and damage without mutating its checkpoint', () => {
  const checkpoint = active_checkpoint()
  const before = structuredClone(checkpoint)
  const fighter_idx = checkpoint.contract.queue[Number(checkpoint.contract.turn_ptr)]!
  const target = checkpoint.contract.fighters.findIndex((fighter) => fighter.team === 1n)
  const target_cell = checkpoint.contract.fighters[target]!.cell
  const action = { type: 'cast' as const, fighter_idx, spell: 'slash', target_cell }
  const predicted = preview_turn(checkpoint, [action, action])
  expect(predicted.contract.fighters[Number(fighter_idx)]!.ap).toBe(
    checkpoint.contract.fighters[Number(fighter_idx)]!.ap - 4n
  )
  expect(predicted.contract.fighters[target]!.hp).toBeLessThan(checkpoint.contract.fighters[target]!.hp)
  expect(checkpoint).toEqual(before)
})
