// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'

import { tournament_coin_claims, type TournamentRow, type TournamentTeam } from '../src/tournament.ts'

const team = (place: number, count: number): TournamentTeam => ({
  name: 'Team',
  revision: '0',
  allowed: [],
  place,
  seats: Array.from({ length: count }, (_, index) => ({
    character: String(index),
    owner: 'owner',
    sui_claimed: false,
    token_claimed: false,
    items_claimed: '0',
  })),
})
const fixture = (): TournamentRow => ({
  id: 'cup',
  version: '1',
  name: 'Cup',
  status: 'finished',
  organizer: 'owner',
  format: 3,
  start_before_ms: 1,
  sui_bps: [9500, 0, 0, 0, 500],
  token_bps: [10000, 0, 0, 0, 0],
  sui_pool: '20020',
  sui_total: '20020',
  kares_pool: null,
  token_pool: '0',
  token_total: '0',
  token_version: '0',
  token_refunded: true,
  rewards: [],
  matches: [],
  teams: [team(5, 3), team(1, 1), team(5, 3), team(5, 3), team(5, 3)],
})

test('joint fifth divides one allocation across all seats with Move roster-order remainders', () => {
  const row = fixture()
  const amounts = [0, 2, 3, 4].flatMap((team) => [0, 1, 2].map((seat) => tournament_coin_claims(row, team, seat).sui))
  expect(amounts).toEqual([84n, 84n, 84n, 84n, 84n, 83n, 83n, 83n, 83n, 83n, 83n, 83n])
  expect(amounts.reduce((sum, value) => sum + value, 0n)).toBe(1001n)
  expect(tournament_coin_claims(row, 1, 0).sui).toBe(19019n)
  const claimed = {
    ...row,
    teams: [
      { ...row.teams[0], seats: row.teams[0].seats.map((seat) => ({ ...seat, sui_claimed: true })) },
      ...row.teams.slice(1),
    ],
  }
  expect(tournament_coin_claims(claimed, 0, 0).sui).toBe(0n)
  expect(tournament_coin_claims(claimed, 2, 0).sui).toBe(84n)
})

test('u64 totals retain exact atomic units and independent asset claim flags', () => {
  const row = {
    ...fixture(),
    sui_bps: [10000, 0, 0, 0, 0],
    sui_total: '18446744073709551615',
    kares_pool: 'pool',
    token_total: '2',
    teams: [team(1, 3)],
  }
  expect(tournament_coin_claims(row, 0, 0)).toEqual({ sui: 6148914691236517205n, kares: 1n })
  expect(tournament_coin_claims(row, 0, 2)).toEqual({ sui: 6148914691236517205n, kares: 0n })
  const paid = {
    ...row,
    teams: [{ ...row.teams[0], seats: row.teams[0].seats.map((seat) => ({ ...seat, sui_claimed: true })) }],
  }
  expect(tournament_coin_claims(paid, 0, 0)).toEqual({ sui: 0n, kares: 1n })
})

test('open events, unplaced teams, absent currencies and zero allocations have no coin claims', () => {
  const row = fixture()
  expect(tournament_coin_claims({ ...row, status: 'open' }, 0, 0)).toEqual({ sui: 0n, kares: 0n })
  expect(tournament_coin_claims({ ...row, teams: [team(0, 1)] }, 0, 0)).toEqual({ sui: 0n, kares: 0n })
  expect(tournament_coin_claims({ ...row, sui_total: '0' }, 0, 0)).toEqual({ sui: 0n, kares: 0n })
  expect(tournament_coin_claims({ ...row, sui_bps: [10000, 0, 0, 0, 0] }, 0, 0)).toEqual({ sui: 0n, kares: 0n })
})
