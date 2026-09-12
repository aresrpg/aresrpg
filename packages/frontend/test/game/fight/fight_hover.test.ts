// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { create_character_source, create_fight } from '@aresrpg/fight'

import { resolve_fight_hover } from '../../../src/game/fight/fight_hover.ts'

const checkpoint = () =>
  create_fight({
    mode: 'local',
    seed: 17n,
    setup: {
      fight_id: 'hover',
      board_seed: 17n,
      players: [
        {
          character: 'alice',
          owner: 'owner',
          team: 0n,
          hp: 55n,
          source: create_character_source({ classe: 'senshi', level: 1n }),
        },
      ],
      mobs: [],
    },
  }).state()

test('a hover cannot refer to a missing fighter or another fight', () => {
  const state = checkpoint()
  expect(resolve_fight_hover(state, { fight: 'hover', type: 'fighter', seat: 2n })).toEqual({ cell: null, seat: null })
  expect(resolve_fight_hover(state, { fight: 'old-fight', type: 'fighter', seat: 0n })).toEqual({
    cell: null,
    seat: null,
  })
  expect(resolve_fight_hover(null, { fight: 'hover', type: 'cell', cell: 1n })).toEqual({ cell: null, seat: null })
})

test('cell hover follows current occupancy and timeline hover follows the current fighter position', () => {
  const before = checkpoint()
  const { cell } = before.contract.fighters[0]!
  const next_cell = before.contract.board.start_cells_a[1]!
  const moved = {
    ...before,
    contract: { ...before.contract, fighters: [{ ...before.contract.fighters[0]!, cell: next_cell }] },
  }
  expect(resolve_fight_hover(before, { fight: 'hover', type: 'cell', cell })).toEqual({ cell, seat: 0n })
  expect(resolve_fight_hover(moved, { fight: 'hover', type: 'cell', cell })).toEqual({ cell, seat: null })
  expect(resolve_fight_hover(moved, { fight: 'hover', type: 'fighter', seat: 0n })).toEqual({
    cell: next_cell,
    seat: 0n,
  })
})
