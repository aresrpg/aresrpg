// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { create_fight } from '../src/fight.ts'

import { create_fixture } from './helpers.ts'

test('forfeits return a character without reopening a fully admitted side', () => {
  const { checkpoint } = create_fixture()
  const source = checkpoint.sources.players['0xc1']
  const game = create_fight({ state: checkpoint })
  for (let index = 2; index <= 6; index++) {
    expect(
      game.apply({ type: 'join', team: 0n, character: `0xc${index}`, owner: '0xa1', hp: 100n, source }).error
    ).toBeNull()
  }
  expect(game.apply({ type: 'forfeit', fighter: 2n }).error).toBeNull()
  const refused = game.apply({ type: 'join', team: 0n, character: '0xc7', owner: '0xa1', hp: 100n, source })
  expect(refused.error?.code).toBe('team_full')
  expect(refused.state.contract.fighters[2]?.settled).toBe(true)
  expect(refused.state.contract.fighters).toHaveLength(7)
})

test('placement uses living occupancy and cannot move a forfeited seat', () => {
  const { checkpoint } = create_fixture()
  const game = create_fight({ state: checkpoint })
  const joined = game.apply({
    type: 'join',
    team: 0n,
    character: '0xc2',
    owner: '0xa1',
    hp: 100n,
    source: checkpoint.sources.players['0xc1'],
  })
  expect(joined.error).toBeNull()
  const { cell } = joined.state.contract.fighters[2]!
  expect(game.apply({ type: 'forfeit', fighter: 2n }).error).toBeNull()
  expect(game.apply({ type: 'place', fighter: 0n, cell }).error).toBeNull()
  expect(game.apply({ type: 'place', fighter: 2n, cell }).error?.code).toBe('bad_cell')
  expect(game.apply({ type: 'place', fighter: 0n, cell }).error?.code).toBe('bad_cell')
  expect(game.apply({ type: 'place', fighter: 999n, cell }).error?.code).toBe('not_your_fighter')
  expect(game.apply({ type: 'ready', fighter: 999n }).error?.code).toBe('not_your_fighter')
  expect(game.apply({ type: 'forfeit', fighter: 999n }).error?.code).toBe('already_settled')
})
