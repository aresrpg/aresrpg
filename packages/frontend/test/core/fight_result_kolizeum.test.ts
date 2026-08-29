// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'

import fight_result_module, { kolizeum_wager_outcome, type FightResult } from '../../src/modules/fight_result.ts'
import { initial_app_state } from '../../src/store.ts'

const pending_result = (): FightResult =>
  Object.freeze({
    fight: '0xf1',
    dungeon: null,
    kolizeum: '0xk1',
    kolizeum_wager: Object.freeze({ stake_mist: 200_000_000n, payout_mist: null }),
    winner: 0,
    duration_ms: 1,
    gas_spent_mist: 0n,
    participants: Object.freeze([]),
    own_seat: null,
    loot_types: Object.freeze([]),
    settlement_confirmed: false,
    progression_synced: true,
    error: null,
    result_open: true,
    level_up_open: false,
    level_up_acknowledged: false,
  })

test('the Kolizeum result reports certified winner payout or loser stake', () => {
  // Testnet KolizeumPaid in 8UtiTYgFB7nHm2DS7ADgb5wbZ6Q3uU4gC8jx95tyjARb, captured 2026-08-28.
  expect(kolizeum_wager_outcome({ stake_mist: 1_000_000_000n, payout_mist: 1_350_000_000n })).toEqual({
    kind: 'won',
    mist: 1_350_000_000n,
  })
  expect(kolizeum_wager_outcome({ stake_mist: 200_000_000n, payout_mist: 0n })).toEqual({
    kind: 'lost',
    mist: 200_000_000n,
  })
  expect(kolizeum_wager_outcome(null)).toBeNull()
})

test('a certified Kolizeum payment completes the wager result', () => {
  const base = initial_app_state({ quality: 'medium', flat_mode: false, music_enabled: true, render_distance: null })
  const settled = fight_result_module.reduce!(
    {
      ...base,
      fight_result: { ...base.fight_result, current_by_character: { '0xc1': pending_result() } },
    },
    {
      type: 'fight_result/settled',
      character_id: '0xc1',
      fight: '0xf1',
      paid_mist: 360_000_000n,
    }
  )

  expect(settled.fight_result.current_by_character['0xc1']?.kolizeum_wager).toEqual({
    stake_mist: 200_000_000n,
    payout_mist: 360_000_000n,
  })
})
