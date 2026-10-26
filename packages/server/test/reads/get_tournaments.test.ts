// SPDX-License-Identifier: LicenseRef-AresRPG-Source-Available
// © 2026 Sceat — All rights reserved. See LICENSE.
import { expect, test } from 'bun:test'
import { tournament_coin_claims, type TournamentRow } from '@aresrpg/protocol'

import type { Graph } from '../../src/graph.ts'
import { get_tournaments } from '../../src/reads/get_tournaments.ts'

const tournament = {
  id: 'cup',
  version: '10',
  name: 'Cup',
  status: 'finished',
  organizer: 'owner',
  format: 1,
  start_before_ms: 1,
  sui_bps: [10000, 0, 0, 0, 0],
  token_bps: [10000, 0, 0, 0, 0],
  sui_pool: '0',
  sui_total: '9007199254740993',
  kares_pool: 'pool',
  rewards: [] as TournamentRow['rewards'],
  matches: [],
  teams: [
    {
      name: 'A',
      revision: '0',
      allowed: [],
      place: 1,
      seats: [{ character: 'hero', owner: 'owner', sui_claimed: true, items_claimed: '0' }],
    },
  ],
}
const graph_for = (
  pool: Record<string, unknown> | null,
  with_pool = true,
  rows: readonly (typeof tournament & { finished_at_ms?: number })[] = [tournament]
): Graph =>
  ({
    read: async (query: string) => {
      if (query.startsWith('MATCH (t:Tournament)'))
        return rows.map((row, index) => ({
          tournament: {
            properties: {
              created_ckpt: rows.length - index,
              finished_at_ms: row.finished_at_ms,
              data: JSON.stringify({ ...row, kares_pool: with_pool ? 'pool' : null }),
            },
          },
        }))
      if (query.startsWith('MATCH (p:TournamentKaresPool)')) return pool ? [{ pool: { properties: pool } }] : []
      return [{ id: 'hero', name: 'Hero' }]
    },
  }) as unknown as Graph

test('recent results remain in the feed after claims and expire independently of newer events', async () => {
  const now = 100_000_000
  const latest = { ...tournament, id: 'latest', status: 'open' }
  const finished = { ...tournament, id: 'finished', finished_at_ms: now - 1000 }
  const rows = await get_tournaments(graph_for(null, false, [latest, finished]), 'spectator', now)
  expect(rows.map((row) => row.id)).toEqual(['latest', 'finished'])
  expect(rows[1].finished_at_ms).toBe(now - 1000)
  const expired = await get_tournaments(graph_for(null, false, [latest, finished]), 'spectator', now + 86_400_000)
  expect(expired.map((row) => row.id)).toEqual(['latest'])
  const legacy = await get_tournaments(graph_for(null, false, [latest, tournament]), 'spectator', now)
  expect(legacy.map((row) => row.id)).toEqual(['latest'])
})

test('malformed completion timestamps fail instead of silently hiding or extending results', async () => {
  await expect(
    get_tournaments(graph_for(null, false, [{ ...tournament, finished_at_ms: Number.NaN }]), 'owner')
  ).rejects.toThrow('Invalid indexed tournament completion time')
})

test('SUI-only recovery requires no currency projection and preserves exact funded totals', async () => {
  const [row] = await get_tournaments(graph_for(null, false), 'owner')
  expect(row.sui_total).toBe('9007199254740993')
  expect(row.token_total).toBe('0')
  expect(tournament_coin_claims(row, 0, 0)).toEqual({ sui: 0n, kares: 0n })
})

test('token claims and versions are independent of already settled SUI', async () => {
  const [row] = await get_tournaments(
    graph_for({ id: 'pool', balance: '99', total: '101', version: '20', refunded: true, claimed: [] }),
    'owner'
  )
  expect(row.token_version).toBe('20')
  expect(row.token_total).toBe('101')
  expect(row.teams[0].seats[0]).toMatchObject({ sui_claimed: true, token_claimed: false })
  expect(tournament_coin_claims(row, 0, 0)).toEqual({ sui: 0n, kares: 101n })
})

test('a missing pool never becomes a false zero balance or a completed token claim', async () => {
  await expect(get_tournaments(graph_for(null), 'owner')).rejects.toThrow('not available yet')
})

test('old zero-value recovery candidates disappear while positive claims and the latest event remain', async () => {
  const seat = { ...tournament.teams[0].seats[0], sui_claimed: false }
  const old = { ...tournament, id: 'old', sui_total: '0', teams: [{ ...tournament.teams[0], seats: [seat] }] }
  const latest = { ...tournament, id: 'latest', status: 'cancelled' }
  const empty = await get_tournaments(graph_for(null, false, [latest, old]), 'owner')
  expect(empty.map((row) => row.id)).toEqual(['latest'])
  const paid = await get_tournaments(graph_for(null, false, [latest, { ...old, sui_total: '1' }]), 'owner')
  expect(paid.map((row) => row.id)).toEqual(['latest', 'old'])
  const foreign = await get_tournaments(graph_for(null, false, [latest, { ...old, sui_total: '1' }]), 'stranger')
  expect(foreign.map((row) => row.id)).toEqual(['latest'])
})

test('positive token recovery survives already settled SUI but zero token percentages do not', async () => {
  const pool = { id: 'pool', balance: '99', total: '101', version: '20', refunded: true, claimed: [] }
  const latest = { ...tournament, id: 'latest', status: 'cancelled' }
  const old = { ...tournament, id: 'old', token_bps: [0, 10000, 0, 0, 0] }
  expect((await get_tournaments(graph_for(pool, true, [latest, old]), 'owner')).map((row) => row.id)).toEqual([
    'latest',
  ])
  expect(
    (await get_tournaments(graph_for(pool, true, [latest, { ...old, token_bps: tournament.token_bps }]), 'owner')).map(
      (row) => row.id
    )
  ).toEqual(['latest', 'old'])
})

test('filtering zero-value coins preserves item-only claims and unreleased organizer refunds', async () => {
  const latest = { ...tournament, id: 'latest', status: 'cancelled' }
  const old = { ...tournament, id: 'old', sui_total: '0', rewards: [{ place: 1, template: 'item', amount: 1 }] }
  expect((await get_tournaments(graph_for(null, false, [latest, old]), 'owner')).map((row) => row.id)).toEqual([
    'latest',
    'old',
  ])
  const pool = { id: 'pool', balance: '99', total: '99', version: '20', refunded: false, claimed: [] }
  expect(
    (
      await get_tournaments(graph_for(pool, true, [latest, { ...old, status: 'cancelled', rewards: [] }]), 'stranger')
    ).map((row) => row.id)
  ).toEqual(['latest', 'old'])
})

test('reserved character names share the existing Character lookup and missing names stay absent', async () => {
  const queries: string[] = []
  const graph = {
    read: async (query: string) => {
      queries.push(query)
      if (query.startsWith('MATCH (t:Tournament)'))
        return [
          {
            tournament: {
              properties: {
                created_ckpt: 1,
                data: JSON.stringify({
                  ...tournament,
                  kares_pool: null,
                  teams: [{ ...tournament.teams[0], allowed: ['reserved', 'unknown'] }],
                }),
              },
            },
          },
        ]
      return [
        { id: 'hero', name: 'Hero' },
        { id: 'reserved', name: 'Reserved hero' },
        { id: 'unknown', name: null },
      ]
    },
  } as unknown as Graph
  const [row] = await get_tournaments(graph, 'owner')
  expect(queries).toHaveLength(2)
  expect(queries[1]).toContain('reserved')
  expect(row.teams[0].allowed_names).toEqual({ reserved: 'Reserved hero' })
})
