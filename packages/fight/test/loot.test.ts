// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { fight_loot_types } from '../src/index.ts'

import { create_fixture } from './helpers.ts'

test('settlement templates derive only from defeated opposing mobs for eligible winners', () => {
  const { checkpoint } = create_fixture()
  const mob = checkpoint.contract.fighters[1]!
  if (mob.kind.type !== 'mob') throw new Error('fixture requires mob')
  mob.kind.snapshot.loot = [
    { item_type: 'silk', chance_bp: 100n, min_qty: 1n, max_qty: 1n },
    { item_type: 'silk', chance_bp: 100n, min_qty: 1n, max_qty: 1n },
    { item_type: 'fang', chance_bp: 100n, min_qty: 1n, max_qty: 1n },
  ]
  checkpoint.contract.ended = true
  checkpoint.contract.winner = 0n
  expect(fight_loot_types(checkpoint, 0)).toEqual(['silk', 'fang'])
  checkpoint.contract.fighters[0]!.dead = true
  expect(fight_loot_types(checkpoint, 0)).toEqual(['silk', 'fang'])
  checkpoint.contract.fighters[0]!.forfeited = true
  expect(fight_loot_types(checkpoint, 0)).toEqual([])
  checkpoint.contract.fighters[0]!.forfeited = false
  checkpoint.contract.winner = 1n
  expect(fight_loot_types(checkpoint, 0)).toEqual([])
  expect(fight_loot_types(checkpoint, 1)).toEqual([])
  expect(fight_loot_types(checkpoint, 99)).toEqual([])
  checkpoint.contract.winner = null
  expect(fight_loot_types(checkpoint, 0)).toEqual([])
})
