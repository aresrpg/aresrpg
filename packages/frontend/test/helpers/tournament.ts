// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import type { TournamentRow } from '@aresrpg/protocol'

export const tournament_fixture = (): TournamentRow => ({
  id: 'cup',
  version: '5',
  name: 'Cup',
  status: 'in_progress',
  organizer: 'admin',
  format: 3,
  entry_fee_mist: '0',
  max_level: null,
  start_before_ms: 10_000,
  sui_bps: [6000, 2500, 1000, 500, 0],
  token_bps: [6000, 2500, 1000, 500, 0],
  sui_pool: '9007199254740993',
  kares_pool: null,
  token_version: '0',
  token_refunded: true,
  token_pool: '0',
  sui_total: '9007199254740993',
  token_total: '0',
  rewards: [{ place: 1, template: 'sword', amount: 1 }],
  teams: [
    {
      name: 'A',
      revision: '0',
      allowed: [],
      place: 0,
      seats: [
        {
          character: 'a',
          owner: 'owner',
          sui_claimed: false,
          token_claimed: true,
          items_claimed: '0',
        },
        {
          character: 'b',
          owner: 'other',
          sui_claimed: false,
          token_claimed: true,
          items_claimed: '0',
        },
      ],
    },
    {
      name: 'B',
      revision: '0',
      allowed: ['c'],
      place: 0,
      seats: [
        {
          character: 'c',
          owner: 'other',
          sui_claimed: false,
          token_claimed: true,
          items_claimed: '0',
        },
      ],
    },
  ],
  matches: [{ a: 0, b: 1, available_ms: 1000, state: 1, winner: null, loser: null, fight: null }],
})
