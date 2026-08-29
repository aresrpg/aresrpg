// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import { kolizeum_join_review } from '../../src/kolizeum/join_confirmation.ts'

test('a join review pins the exact character, side, and wager shown at confirmation', () => {
  const lobby = { id: '0xlobby', pledge_mist: '200000001' }
  const character = { id: '0xcharacter', name: 'Sceat' }

  expect(kolizeum_join_review(lobby, character, 1)).toEqual({
    kolizeum: '0xlobby',
    character_id: '0xcharacter',
    character_name: 'Sceat',
    side: 1,
    stake_mist: 200_000_001n,
    stake_sui: '0.200000001',
  })
})
