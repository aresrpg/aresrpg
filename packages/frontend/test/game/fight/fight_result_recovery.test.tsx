// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { FightSettlementStatus } from '../../../src/game/fight/FightResultCard.tsx'
import { load_app_copy } from '../../../src/i18n/copy.ts'
import type { FightResult } from '../../../src/modules/fight_result.ts'

test.each([1, 2])('a failed settlement exposes its error and Retry for %s participants', async (total) => {
  const copy = await load_app_copy('en')
  const result: FightResult = {
    fight: '0xfight',
    boss_weight: 0,
    dungeon: null,
    kolizeum: null,
    kolizeum_wager: null,
    winner: 1,
    duration_ms: 106000,
    gas_spent_mist: 0n,
    own_seat: 0,
    loot_types: [],
    settlement_confirmed: false,
    progression_synced: true,
    error: 'Insufficient SUI for settlement',
    result_open: true,
    level_up_open: false,
    level_up_acknowledged: false,
    participants: [
      {
        seat: 0,
        team: 0,
        character_id: '0xcharacter',
        name: 'Rafix',
        level_before: 1,
        level_after: 1,
        experience_before: 0,
        experience_after: 0,
        hp: 0,
        max_hp: 100,
        dead: true,
        forfeited: false,
        settled: false,
        xp_awarded: 0,
        kares: 0n,
        loot: [],
      },
    ],
  }
  const html = renderToStaticMarkup(
    <FightSettlementStatus
      copy={copy}
      settlement={{
        progress: { completed: 0, total, failed_character: '0xcharacter' },
        failed_result: result,
        all_settled: false,
        failed: true,
      }}
    />
  )
  expect(html).toContain(result.error!)
  expect(html).toContain(copy.fight_hud.result_retry!)
})
